"""
BikeFriends backend — FastAPI + MongoDB.

All routes are mounted under /api. JWT auth via Bearer header.
"""
from __future__ import annotations

import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional, List, Literal

import bcrypt
import httpx
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import json
from collections import defaultdict
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = os.environ.get("JWT_ALG", "HS256")
ACCESS_TOKEN_EXPIRES_MIN = 60 * 24 * 30  # 30 days

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="BikeFriends API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

# ---------- Emergent Push (SuprSend relay) ----------
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("bikefriends")


async def send_push(recipients: list[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    for chunk_start in range(0, len(recipients), 100):
        chunk = recipients[chunk_start:chunk_start + 100]
        payload: dict = {"recipients": chunk, "data": data}
        if idempotency_key:
            payload["$idempotency_key"] = idempotency_key
        try:
            resp = await _push_client.post("/api/v1/push/trigger", json=payload)
            if resp.status_code >= 400:
                logger.warning("push send failed (%s): %s", resp.status_code, resp.text[:200])
        except Exception as e:  # noqa: BLE001
            logger.warning("push send exception: %s", e)


# ---------- Utils ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": now_utc() + timedelta(minutes=ACCESS_TOKEN_EXPIRES_MIN),
        "iat": now_utc(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


# ---------- Models ----------
class SignupBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    username: str = Field(min_length=3, max_length=24)
    display_name: str = Field(min_length=1, max_length=48)
    bike_model: Optional[str] = None


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    username: str
    display_name: str
    bike_model: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    bike_model: Optional[str] = None
    avatar_url: Optional[str] = None


class FriendRequestBody(BaseModel):
    username: str


class FriendItem(BaseModel):
    id: str
    user: UserPublic
    status: str  # accepted | incoming | outgoing
    is_riding: bool = False
    current_speed_kmh: float = 0.0
    is_on_comms: bool = False


class StartRideBody(BaseModel):
    title: str = "Ride"
    is_group_ride: bool = False
    invite_usernames: Optional[List[str]] = None


class RoutePoint(BaseModel):
    lat: float
    lng: float
    speed_kmh: float = 0.0
    recorded_at: Optional[str] = None


class EndRideBody(BaseModel):
    distance_km: float
    top_speed_kmh: float
    avg_speed_kmh: float
    duration_seconds: int
    polyline: List[List[float]] = Field(default_factory=list)  # [[lat,lng], ...]


class LiveStatusBody(BaseModel):
    ride_session_id: str
    lat: float
    lng: float
    speed_kmh: float
    is_on_comms: bool = False


class RegisterPushBody(BaseModel):
    platform: str  # "android" | "ios"
    device_token: str


class LiveRider(BaseModel):
    rider: UserPublic
    lat: float
    lng: float
    speed_kmh: float
    is_on_comms: bool
    updated_at: str


class RideSummary(BaseModel):
    id: str
    ride_id: str
    rider: UserPublic
    title: str
    is_group_ride: bool
    livekit_room_name: Optional[str] = None
    distance_km: float
    top_speed_kmh: float
    avg_speed_kmh: float
    duration_seconds: int
    polyline: List[List[float]] = Field(default_factory=list)
    started_at: str
    ended_at: Optional[str] = None
    status: str


class LeaderboardEntry(BaseModel):
    rider: UserPublic
    total_km: float
    top_speed_kmh: float
    total_rides: int


class CreateGroupBody(BaseModel):
    title: str = "Group Ride"
    invite_usernames: List[str] = Field(default_factory=list)


class GroupParticipant(BaseModel):
    user: UserPublic
    status: str  # invited | joined | declined | left
    on_comms: bool = False
    muted: bool = False
    speaking: bool = False
    joined_at: Optional[str] = None


class GroupRide(BaseModel):
    ride_id: str
    title: str
    owner: UserPublic
    livekit_room_name: str
    started_at: str
    status: str
    participants: List[GroupParticipant]


# ---------- Serializers ----------
def user_public(doc: dict) -> UserPublic:
    return UserPublic(
        id=doc["id"],
        email=doc["email"],
        username=doc["username"],
        display_name=doc.get("display_name") or doc["username"],
        bike_model=doc.get("bike_model"),
        avatar_url=doc.get("avatar_url"),
        created_at=doc.get("created_at") or now_utc().isoformat(),
    )


# ---------- Auth dependency ----------
async def current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer)],
) -> dict:
    unauth = HTTPException(status_code=401, detail="Not authenticated")
    if not credentials or not credentials.credentials:
        raise unauth
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise unauth
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise unauth
    return user


# ---------- Startup ----------
@app.on_event("startup")
async def startup() -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username", unique=True)
    await db.friends.create_index([("requester_id", 1), ("addressee_id", 1)], unique=True)
    await db.ride_sessions.create_index("rider_id")
    await db.live_status.create_index("rider_id", unique=True)
    await seed_demo_data()
    logger.info("BikeFriends API ready")


async def seed_demo_data() -> None:
    if await db.users.count_documents({}) > 0:
        return
    demo = [
        {"email": "rider@bike.com", "password": "password123", "username": "throttle", "display_name": "Alex Rider", "bike_model": "Kawasaki Ninja 650"},
        {"email": "maria@bike.com", "password": "password123", "username": "maria_moto", "display_name": "Maria Vega", "bike_model": "Ducati Monster"},
        {"email": "jay@bike.com", "password": "password123", "username": "jay_speed", "display_name": "Jay Kim", "bike_model": "Yamaha MT-09"},
        {"email": "sam@bike.com", "password": "password123", "username": "sam_gears", "display_name": "Sam Wu", "bike_model": "Honda CBR600RR"},
    ]
    ids = []
    for d in demo:
        uid = str(uuid.uuid4())
        ids.append(uid)
        await db.users.insert_one({
            "id": uid,
            "email": d["email"],
            "password_hash": hash_password(d["password"]),
            "username": d["username"],
            "display_name": d["display_name"],
            "bike_model": d["bike_model"],
            "avatar_url": None,
            "created_at": now_utc().isoformat(),
        })
    # Auto-friend all demo users
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            await db.friends.insert_one({
                "id": str(uuid.uuid4()),
                "requester_id": a,
                "addressee_id": b,
                "status": "accepted",
                "created_at": now_utc().isoformat(),
            })
    # Seed a few completed rides for leaderboard
    import random
    for uid in ids:
        for _ in range(random.randint(2, 5)):
            await db.ride_sessions.insert_one({
                "id": str(uuid.uuid4()),
                "ride_id": str(uuid.uuid4()),
                "rider_id": uid,
                "title": random.choice(["Weekend Blast", "Coastal Cruise", "Mountain Loop", "City Ride"]),
                "is_group_ride": False,
                "livekit_room_name": None,
                "distance_km": round(random.uniform(20, 200), 1),
                "top_speed_kmh": round(random.uniform(90, 165), 1),
                "avg_speed_kmh": round(random.uniform(50, 90), 1),
                "duration_seconds": random.randint(1800, 10800),
                "polyline": [],
                "started_at": now_utc().isoformat(),
                "ended_at": now_utc().isoformat(),
                "status": "completed",
            })
    logger.info("Seeded %s demo users", len(ids))


# ---------- Auth routes ----------
@api.post("/auth/signup", response_model=AuthResponse)
async def signup(body: SignupBody):
    if await db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(409, "Email already registered")
    if await db.users.find_one({"username": body.username.lower()}):
        raise HTTPException(409, "Username taken")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid,
        "email": body.email.lower(),
        "password_hash": hash_password(body.password),
        "username": body.username.lower(),
        "display_name": body.display_name,
        "bike_model": body.bike_model,
        "avatar_url": None,
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(doc)
    return AuthResponse(access_token=make_token(uid), user=user_public(doc))


@api.post("/auth/login", response_model=AuthResponse)
async def login(body: LoginBody):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    return AuthResponse(access_token=make_token(user["id"]), user=user_public(user))


@api.get("/auth/me", response_model=UserPublic)
async def me(user: Annotated[dict, Depends(current_user)]):
    return user_public(user)


@api.patch("/auth/me", response_model=UserPublic)
async def update_me(body: ProfileUpdate, user: Annotated[dict, Depends(current_user)]):
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return user_public(updated)


# ---------- Friends ----------
async def _friend_edge(a: str, b: str) -> Optional[dict]:
    return await db.friends.find_one({
        "$or": [
            {"requester_id": a, "addressee_id": b},
            {"requester_id": b, "addressee_id": a},
        ]
    }, {"_id": 0})


@api.get("/friends", response_model=List[FriendItem])
async def list_friends(user: Annotated[dict, Depends(current_user)]):
    edges = await db.friends.find({
        "$or": [{"requester_id": user["id"]}, {"addressee_id": user["id"]}]
    }, {"_id": 0}).to_list(1000)

    items: List[FriendItem] = []
    for e in edges:
        other_id = e["addressee_id"] if e["requester_id"] == user["id"] else e["requester_id"]
        other = await db.users.find_one({"id": other_id}, {"_id": 0})
        if not other:
            continue
        if e["status"] == "accepted":
            status_label = "accepted"
        elif e["status"] == "pending":
            status_label = "outgoing" if e["requester_id"] == user["id"] else "incoming"
        else:
            status_label = e["status"]
        live = await db.live_status.find_one({"rider_id": other_id}, {"_id": 0})
        items.append(FriendItem(
            id=e["id"],
            user=user_public(other),
            status=status_label,
            is_riding=bool(live),
            current_speed_kmh=(live or {}).get("speed_kmh", 0.0),
            is_on_comms=(live or {}).get("is_on_comms", False),
        ))
    # accepted first, then incoming, then outgoing
    order = {"accepted": 0, "incoming": 1, "outgoing": 2}
    items.sort(key=lambda x: order.get(x.status, 9))
    return items


@api.get("/friends/search", response_model=List[UserPublic])
async def search_users(q: str = Query(min_length=1), user: Annotated[dict, Depends(current_user)] = None):
    cursor = db.users.find(
        {"username": {"$regex": q.lower(), "$options": "i"}, "id": {"$ne": user["id"]}},
        {"_id": 0},
    ).limit(20)
    return [user_public(u) async for u in cursor]


@api.post("/friends/request", response_model=FriendItem)
async def send_friend_request(body: FriendRequestBody, user: Annotated[dict, Depends(current_user)]):
    other = await db.users.find_one({"username": body.username.lower()}, {"_id": 0})
    if not other:
        raise HTTPException(404, "User not found")
    if other["id"] == user["id"]:
        raise HTTPException(400, "Cannot friend yourself")
    existing = await _friend_edge(user["id"], other["id"])
    if existing:
        raise HTTPException(409, "Friend request already exists")
    edge = {
        "id": str(uuid.uuid4()),
        "requester_id": user["id"],
        "addressee_id": other["id"],
        "status": "pending",
        "created_at": now_utc().isoformat(),
    }
    await db.friends.insert_one(edge)
    return FriendItem(id=edge["id"], user=user_public(other), status="outgoing")


@api.post("/friends/{friend_edge_id}/accept", response_model=FriendItem)
async def accept_friend(friend_edge_id: str, user: Annotated[dict, Depends(current_user)]):
    edge = await db.friends.find_one({"id": friend_edge_id}, {"_id": 0})
    if not edge or edge["addressee_id"] != user["id"] or edge["status"] != "pending":
        raise HTTPException(404, "Request not found")
    await db.friends.update_one({"id": friend_edge_id}, {"$set": {"status": "accepted"}})
    other = await db.users.find_one({"id": edge["requester_id"]}, {"_id": 0})
    return FriendItem(id=friend_edge_id, user=user_public(other), status="accepted")


@api.post("/friends/{friend_edge_id}/decline")
async def decline_friend(friend_edge_id: str, user: Annotated[dict, Depends(current_user)]):
    edge = await db.friends.find_one({"id": friend_edge_id}, {"_id": 0})
    if not edge or user["id"] not in (edge["requester_id"], edge["addressee_id"]):
        raise HTTPException(404, "Request not found")
    await db.friends.delete_one({"id": friend_edge_id})
    return {"ok": True}


# ---------- Rides ----------
@api.post("/rides/start", response_model=RideSummary)
async def start_ride(body: StartRideBody, user: Annotated[dict, Depends(current_user)]):
    ride_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    livekit_room = f"ride-{ride_id[:8]}" if body.is_group_ride else None
    ride_doc = {
        "id": ride_id,
        "owner_id": user["id"],
        "title": body.title,
        "is_group_ride": body.is_group_ride,
        "livekit_room_name": livekit_room,
        "started_at": now_utc().isoformat(),
        "ended_at": None,
        "status": "active",
    }
    await db.rides.insert_one(ride_doc)
    session_doc = {
        "id": session_id,
        "ride_id": ride_id,
        "rider_id": user["id"],
        "title": body.title,
        "is_group_ride": body.is_group_ride,
        "livekit_room_name": livekit_room,
        "distance_km": 0.0,
        "top_speed_kmh": 0.0,
        "avg_speed_kmh": 0.0,
        "duration_seconds": 0,
        "polyline": [],
        "started_at": ride_doc["started_at"],
        "ended_at": None,
        "status": "active",
    }
    await db.ride_sessions.insert_one(session_doc)
    return _ride_summary(session_doc, user)


@api.post("/rides/{session_id}/end", response_model=RideSummary)
async def end_ride(session_id: str, body: EndRideBody, user: Annotated[dict, Depends(current_user)]):
    session = await db.ride_sessions.find_one({"id": session_id, "rider_id": user["id"]}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Ride session not found")
    updates = {
        "distance_km": round(body.distance_km, 2),
        "top_speed_kmh": round(body.top_speed_kmh, 1),
        "avg_speed_kmh": round(body.avg_speed_kmh, 1),
        "duration_seconds": int(body.duration_seconds),
        "polyline": body.polyline,
        "ended_at": now_utc().isoformat(),
        "status": "completed",
    }
    await db.ride_sessions.update_one({"id": session_id}, {"$set": updates})
    # Only close the parent ride row for SOLO rides. For group rides, the ride
    # stays active until the owner explicitly leaves/ends it.
    parent = await db.rides.find_one({"id": session["ride_id"]}, {"_id": 0})
    if parent and not parent.get("is_group_ride"):
        await db.rides.update_one({"id": session["ride_id"]}, {"$set": {"ended_at": updates["ended_at"], "status": "completed"}})
    # Only clear the rider's live_status if it still points at THIS ending session.
    await db.live_status.delete_one({"rider_id": user["id"], "ride_session_id": session_id})
    session.update(updates)
    return _ride_summary(session, user)


@api.get("/rides/active", response_model=Optional[RideSummary])
async def active_ride(user: Annotated[dict, Depends(current_user)]):
    session = await db.ride_sessions.find_one(
        {"rider_id": user["id"], "status": "active"},
        {"_id": 0},
        sort=[("started_at", -1)],
    )
    if not session:
        return None
    return _ride_summary(session, user)


@api.get("/rides/mine", response_model=List[RideSummary])
async def my_rides(user: Annotated[dict, Depends(current_user)]):
    sessions = await db.ride_sessions.find(
        {"rider_id": user["id"]}, {"_id": 0}
    ).sort("started_at", -1).limit(50).to_list(50)
    return [_ride_summary(s, user) for s in sessions]


def _ride_summary(session: dict, rider: dict) -> RideSummary:
    return RideSummary(
        id=session["id"],
        ride_id=session["ride_id"],
        rider=user_public(rider),
        title=session.get("title", "Ride"),
        is_group_ride=session.get("is_group_ride", False),
        livekit_room_name=session.get("livekit_room_name"),
        distance_km=session.get("distance_km", 0.0),
        top_speed_kmh=session.get("top_speed_kmh", 0.0),
        avg_speed_kmh=session.get("avg_speed_kmh", 0.0),
        duration_seconds=session.get("duration_seconds", 0),
        polyline=session.get("polyline", []),
        started_at=session["started_at"],
        ended_at=session.get("ended_at"),
        status=session.get("status", "active"),
    )


# ---------- Live status ----------
@api.post("/live-status")
async def push_live_status(body: LiveStatusBody, user: Annotated[dict, Depends(current_user)]):
    doc = {
        "rider_id": user["id"],
        "ride_session_id": body.ride_session_id,
        "lat": body.lat,
        "lng": body.lng,
        "speed_kmh": body.speed_kmh,
        "is_on_comms": body.is_on_comms,
        "updated_at": now_utc().isoformat(),
    }
    await db.live_status.update_one({"rider_id": user["id"]}, {"$set": doc}, upsert=True)
    return {"ok": True}


@api.get("/live-status/friends")
async def friends_live_status(user: Annotated[dict, Depends(current_user)]):
    edges = await db.friends.find({
        "status": "accepted",
        "$or": [{"requester_id": user["id"]}, {"addressee_id": user["id"]}],
    }, {"_id": 0}).to_list(1000)
    friend_ids = [
        e["addressee_id"] if e["requester_id"] == user["id"] else e["requester_id"]
        for e in edges
    ]
    if not friend_ids:
        return []
    lives = await db.live_status.find({"rider_id": {"$in": friend_ids}}, {"_id": 0}).to_list(1000)
    out = []
    for l in lives:
        u = await db.users.find_one({"id": l["rider_id"]}, {"_id": 0})
        if not u:
            continue
        out.append({
            "rider": user_public(u).model_dump(),
            "lat": l["lat"], "lng": l["lng"],
            "speed_kmh": l["speed_kmh"],
            "is_on_comms": l["is_on_comms"],
            "updated_at": l["updated_at"],
        })
    return out


@api.get("/groups/{ride_id}/live-positions", response_model=List[LiveRider])
async def group_live_positions(ride_id: str, user: Annotated[dict, Depends(current_user)]):
    part = await db.group_participants.find_one({"ride_id": ride_id, "user_id": user["id"]}, {"_id": 0})
    if not part:
        raise HTTPException(403, "Not a participant")
    # Everyone currently in this group session
    parts = await db.group_participants.find(
        {"ride_id": ride_id, "status": "joined"}, {"_id": 0}
    ).to_list(500)
    rider_ids = [p["user_id"] for p in parts]
    if not rider_ids:
        return []
    # Only take live_status rows tied to a session inside THIS ride
    sessions = await db.ride_sessions.find(
        {"ride_id": ride_id, "rider_id": {"$in": rider_ids}, "status": "active"},
        {"_id": 0},
    ).to_list(500)
    session_map = {s["rider_id"]: s["id"] for s in sessions}
    lives = await db.live_status.find({"rider_id": {"$in": rider_ids}}, {"_id": 0}).to_list(500)
    out: List[LiveRider] = []
    for l in lives:
        # Only include if the live_status is for a session in this ride
        if session_map.get(l["rider_id"]) != l.get("ride_session_id"):
            continue
        u = await db.users.find_one({"id": l["rider_id"]}, {"_id": 0})
        if not u:
            continue
        out.append(LiveRider(
            rider=user_public(u),
            lat=l["lat"], lng=l["lng"],
            speed_kmh=l["speed_kmh"],
            is_on_comms=l["is_on_comms"],
            updated_at=l["updated_at"],
        ))
    return out


# ---------- Push registration ----------
@api.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, user: Annotated[dict, Depends(current_user)]):
    payload = {"user_id": user["id"], "platform": body.platform, "device_token": body.device_token}
    try:
        resp = await _push_client.post("/api/v1/push/users/register", json=payload)
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
        if resp.status_code >= 500:
            raise HTTPException(502, "Push provider unavailable")
        resp.raise_for_status()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.warning("register-push exception: %s", e)
        raise HTTPException(502, "Push provider unavailable")
    return {"status": "registered"}


# ---------- Leaderboard ----------
@api.get("/leaderboard", response_model=List[LeaderboardEntry])
async def leaderboard(
    scope: Literal["all", "week", "month"] = "all",
    user: Annotated[dict, Depends(current_user)] = None,
):
    match: dict = {"status": "completed"}
    if scope == "week":
        match["ended_at"] = {"$gte": (now_utc() - timedelta(days=7)).isoformat()}
    elif scope == "month":
        match["ended_at"] = {"$gte": (now_utc() - timedelta(days=30)).isoformat()}

    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$rider_id",
            "total_km": {"$sum": "$distance_km"},
            "top_speed_kmh": {"$max": "$top_speed_kmh"},
            "total_rides": {"$sum": 1},
        }},
        {"$sort": {"total_km": -1}},
        {"$limit": 100},
    ]
    rows = await db.ride_sessions.aggregate(pipeline).to_list(100)
    out: List[LeaderboardEntry] = []
    for r in rows:
        u = await db.users.find_one({"id": r["_id"]}, {"_id": 0})
        if not u:
            continue
        out.append(LeaderboardEntry(
            rider=user_public(u),
            total_km=round(r["total_km"], 1),
            top_speed_kmh=round(r["top_speed_kmh"], 1),
            total_rides=r["total_rides"],
        ))
    return out


# ---------- LiveKit token (stub) ----------
@api.post("/livekit/token")
async def livekit_token(user: Annotated[dict, Depends(current_user)]):
    # NOTE: MOCKED. Real implementation should mint LiveKit access tokens using
    # LIVEKIT_API_KEY / LIVEKIT_API_SECRET on the server (never on the client).
    return {
        "url": os.environ.get("LIVEKIT_URL", "wss://mock.livekit.local"),
        "token": f"mock-token-for-{user['username']}",
        "mocked": True,
    }


# ---------- Group rides ----------
async def _load_group(ride_id: str) -> Optional[dict]:
    ride = await db.rides.find_one({"id": ride_id, "is_group_ride": True}, {"_id": 0})
    return ride


async def _build_group(ride: dict) -> GroupRide:
    owner = await db.users.find_one({"id": ride["owner_id"]}, {"_id": 0})
    parts_docs = await db.group_participants.find({"ride_id": ride["id"]}, {"_id": 0}).to_list(200)
    participants: List[GroupParticipant] = []
    for p in parts_docs:
        u = await db.users.find_one({"id": p["user_id"]}, {"_id": 0})
        if not u:
            continue
        participants.append(GroupParticipant(
            user=user_public(u),
            status=p["status"],
            on_comms=p.get("on_comms", False),
            muted=p.get("muted", False),
            speaking=p.get("speaking", False),
            joined_at=p.get("joined_at"),
        ))
    return GroupRide(
        ride_id=ride["id"],
        title=ride["title"],
        owner=user_public(owner),
        livekit_room_name=ride["livekit_room_name"],
        started_at=ride["started_at"],
        status=ride["status"],
        participants=participants,
    )


@api.post("/groups", response_model=GroupRide)
async def create_group(body: CreateGroupBody, user: Annotated[dict, Depends(current_user)]):
    ride_id = str(uuid.uuid4())
    now = now_utc().isoformat()
    room = f"ride-{ride_id[:8]}"
    ride_doc = {
        "id": ride_id, "owner_id": user["id"], "title": body.title,
        "is_group_ride": True, "livekit_room_name": room,
        "started_at": now, "ended_at": None, "status": "active",
    }
    await db.rides.insert_one(ride_doc)
    # Owner auto-joins
    await db.group_participants.insert_one({
        "id": str(uuid.uuid4()), "ride_id": ride_id, "user_id": user["id"],
        "status": "joined", "joined_at": now, "on_comms": False, "muted": False, "speaking": False,
    })
    # Invite the listed usernames (only accepted friends)
    edges = await db.friends.find({
        "status": "accepted",
        "$or": [{"requester_id": user["id"]}, {"addressee_id": user["id"]}],
    }, {"_id": 0}).to_list(1000)
    friend_ids = {
        e["addressee_id"] if e["requester_id"] == user["id"] else e["requester_id"]
        for e in edges
    }
    for uname in body.invite_usernames:
        target = await db.users.find_one({"username": uname.lower()}, {"_id": 0})
        if not target or target["id"] == user["id"] or target["id"] not in friend_ids:
            continue
        await db.group_participants.insert_one({
            "id": str(uuid.uuid4()), "ride_id": ride_id, "user_id": target["id"],
            "status": "invited", "joined_at": None,
            "on_comms": False, "muted": False, "speaking": False,
        })
        try:
            await send_push(
                recipients=[target["id"]],
                data={
                    "title": f"{user.get('display_name') or user['username']} started a ride",
                    "message": f"Join \"{body.title}\" — tap to hop on the intercom.",
                    "action_url": f"/group/{ride_id}",
                },
                idempotency_key=f"invite-{ride_id}-{target['id']}",
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("push on invite failed (non-blocking): %s", e)
    return await _build_group(ride_doc)


@api.get("/groups/invitations", response_model=List[GroupRide])
async def my_invitations(user: Annotated[dict, Depends(current_user)]):
    parts = await db.group_participants.find(
        {"user_id": user["id"], "status": "invited"}, {"_id": 0}
    ).to_list(100)
    out: List[GroupRide] = []
    for p in parts:
        ride = await _load_group(p["ride_id"])
        if ride and ride["status"] == "active":
            out.append(await _build_group(ride))
    return out


@api.get("/groups/mine", response_model=List[GroupRide])
async def my_active_groups(user: Annotated[dict, Depends(current_user)]):
    parts = await db.group_participants.find(
        {"user_id": user["id"], "status": "joined"}, {"_id": 0}
    ).to_list(100)
    out: List[GroupRide] = []
    for p in parts:
        ride = await _load_group(p["ride_id"])
        if ride and ride["status"] == "active":
            out.append(await _build_group(ride))
    return out


@api.get("/groups/{ride_id}", response_model=GroupRide)
async def get_group(ride_id: str, user: Annotated[dict, Depends(current_user)]):
    ride = await _load_group(ride_id)
    if not ride:
        raise HTTPException(404, "Group not found")
    return await _build_group(ride)


@api.post("/groups/{ride_id}/join", response_model=GroupRide)
async def join_group(ride_id: str, user: Annotated[dict, Depends(current_user)]):
    ride = await _load_group(ride_id)
    if not ride or ride["status"] != "active":
        raise HTTPException(404, "Group not found")
    part = await db.group_participants.find_one({"ride_id": ride_id, "user_id": user["id"]}, {"_id": 0})
    if not part:
        raise HTTPException(403, "Not invited")
    await db.group_participants.update_one(
        {"ride_id": ride_id, "user_id": user["id"]},
        {"$set": {"status": "joined", "joined_at": now_utc().isoformat()}},
    )
    await intercom.broadcast(ride_id, {"type": "roster"})
    return await _build_group(ride)


@api.post("/groups/{ride_id}/decline")
async def decline_group(ride_id: str, user: Annotated[dict, Depends(current_user)]):
    await db.group_participants.update_one(
        {"ride_id": ride_id, "user_id": user["id"]},
        {"$set": {"status": "declined"}},
    )
    return {"ok": True}


@api.post("/groups/{ride_id}/leave")
async def leave_group(ride_id: str, user: Annotated[dict, Depends(current_user)]):
    ride = await _load_group(ride_id)
    if not ride:
        raise HTTPException(404, "Group not found")
    await db.group_participants.update_one(
        {"ride_id": ride_id, "user_id": user["id"]},
        {"$set": {"status": "left", "on_comms": False}},
    )
    # Owner leaving ends the group
    if ride["owner_id"] == user["id"]:
        await db.rides.update_one({"id": ride_id}, {"$set": {"status": "completed", "ended_at": now_utc().isoformat()}})
        await intercom.broadcast(ride_id, {"type": "ended"})
    else:
        await intercom.broadcast(ride_id, {"type": "roster"})
    return {"ok": True}


@api.post("/groups/{ride_id}/invite", response_model=GroupRide)
async def invite_more(ride_id: str, body: CreateGroupBody, user: Annotated[dict, Depends(current_user)]):
    ride = await _load_group(ride_id)
    if not ride or ride["status"] != "active":
        raise HTTPException(404, "Group not found")
    # Only participants can invite others
    me_part = await db.group_participants.find_one({"ride_id": ride_id, "user_id": user["id"]}, {"_id": 0})
    if not me_part or me_part["status"] != "joined":
        raise HTTPException(403, "Join the group first")
    edges = await db.friends.find({
        "status": "accepted",
        "$or": [{"requester_id": user["id"]}, {"addressee_id": user["id"]}],
    }, {"_id": 0}).to_list(1000)
    friend_ids = {
        e["addressee_id"] if e["requester_id"] == user["id"] else e["requester_id"]
        for e in edges
    }
    for uname in body.invite_usernames:
        target = await db.users.find_one({"username": uname.lower()}, {"_id": 0})
        if not target or target["id"] == user["id"] or target["id"] not in friend_ids:
            continue
        existing = await db.group_participants.find_one({"ride_id": ride_id, "user_id": target["id"]}, {"_id": 0})
        if existing:
            # Re-invite people who declined/left
            if existing["status"] in ("declined", "left"):
                await db.group_participants.update_one(
                    {"ride_id": ride_id, "user_id": target["id"]},
                    {"$set": {"status": "invited", "joined_at": None}},
                )
            continue
        await db.group_participants.insert_one({
            "id": str(uuid.uuid4()), "ride_id": ride_id, "user_id": target["id"],
            "status": "invited", "joined_at": None,
            "on_comms": False, "muted": False, "speaking": False,
        })
        try:
            await send_push(
                recipients=[target["id"]],
                data={
                    "title": f"{user.get('display_name') or user['username']} invited you",
                    "message": f"Join \"{ride['title']}\" — tap to hop on the intercom.",
                    "action_url": f"/group/{ride_id}",
                },
                idempotency_key=f"invite-more-{ride_id}-{target['id']}",
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("push on invite-more failed (non-blocking): %s", e)
    await intercom.broadcast(ride_id, {"type": "roster"})
    return await _build_group(ride)


class GroupStartRideBody(BaseModel):
    title: Optional[str] = None


@api.post("/groups/{ride_id}/start-ride")
async def group_start_ride(ride_id: str, body: GroupStartRideBody, user: Annotated[dict, Depends(current_user)]):
    ride = await _load_group(ride_id)
    if not ride or ride["status"] != "active":
        raise HTTPException(404, "Group not found")
    part = await db.group_participants.find_one({"ride_id": ride_id, "user_id": user["id"]}, {"_id": 0})
    if not part or part["status"] != "joined":
        raise HTTPException(403, "Join the group first")
    existing = await db.ride_sessions.find_one({"ride_id": ride_id, "rider_id": user["id"], "status": "active"}, {"_id": 0})
    if existing:
        return _ride_summary(existing, user)
    session_id = str(uuid.uuid4())
    now = now_utc().isoformat()
    session = {
        "id": session_id, "ride_id": ride_id, "rider_id": user["id"],
        "title": body.title or ride["title"], "is_group_ride": True,
        "livekit_room_name": ride["livekit_room_name"],
        "distance_km": 0.0, "top_speed_kmh": 0.0, "avg_speed_kmh": 0.0,
        "duration_seconds": 0, "polyline": [],
        "started_at": now, "ended_at": None, "status": "active",
    }
    await db.ride_sessions.insert_one(session)
    await intercom.broadcast(ride_id, {"type": "roster"})
    return _ride_summary(session, user)


class CrewMemberRecap(BaseModel):
    rider: UserPublic
    distance_km: float
    top_speed_kmh: float
    avg_speed_kmh: float
    duration_seconds: int
    polyline: List[List[float]] = Field(default_factory=list)


class GroupRecap(BaseModel):
    ride_id: str
    title: str
    started_at: str
    ended_at: Optional[str]
    crew_total_km: float
    crew_top_speed_kmh: float
    crew_avg_speed_kmh: float
    total_riders: int
    members: List[CrewMemberRecap]


@api.get("/groups/{ride_id}/recap", response_model=GroupRecap)
async def group_recap(ride_id: str, user: Annotated[dict, Depends(current_user)]):
    ride = await db.rides.find_one({"id": ride_id, "is_group_ride": True}, {"_id": 0})
    if not ride:
        raise HTTPException(404, "Group not found")
    # Everyone in the room can see the recap
    part = await db.group_participants.find_one({"ride_id": ride_id, "user_id": user["id"]}, {"_id": 0})
    if not part:
        raise HTTPException(403, "Not a participant")
    sessions = await db.ride_sessions.find({"ride_id": ride_id}, {"_id": 0}).to_list(500)
    members: List[CrewMemberRecap] = []
    crew_km = 0.0
    crew_top = 0.0
    crew_avg = 0.0
    for s in sessions:
        u = await db.users.find_one({"id": s["rider_id"]}, {"_id": 0})
        if not u:
            continue
        members.append(CrewMemberRecap(
            rider=user_public(u),
            distance_km=s.get("distance_km", 0.0),
            top_speed_kmh=s.get("top_speed_kmh", 0.0),
            avg_speed_kmh=s.get("avg_speed_kmh", 0.0),
            duration_seconds=s.get("duration_seconds", 0),
            polyline=s.get("polyline", []),
        ))
        crew_km += s.get("distance_km", 0.0)
        crew_top = max(crew_top, s.get("top_speed_kmh", 0.0))
        crew_avg += s.get("avg_speed_kmh", 0.0)
    n = len(members) or 1
    return GroupRecap(
        ride_id=ride_id,
        title=ride["title"],
        started_at=ride["started_at"],
        ended_at=ride.get("ended_at"),
        crew_total_km=round(crew_km, 1),
        crew_top_speed_kmh=round(crew_top, 1),
        crew_avg_speed_kmh=round(crew_avg / n, 1),
        total_riders=len(members),
        members=members,
    )


# ---------- Intercom WebSocket (presence signalling — real voice needs LiveKit) ----------
class IntercomHub:
    def __init__(self) -> None:
        self.rooms: dict[str, list[WebSocket]] = defaultdict(list)

    async def join(self, room: str, ws: WebSocket) -> None:
        await ws.accept()
        self.rooms[room].append(ws)

    def leave(self, room: str, ws: WebSocket) -> None:
        if ws in self.rooms.get(room, []):
            self.rooms[room].remove(ws)

    async def broadcast(self, room: str, payload: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.rooms.get(room, [])):
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for d in dead:
            self.leave(room, d)

    async def broadcast_except(self, room: str, exclude: WebSocket, payload: dict) -> None:
        dead: list[WebSocket] = []
        text = json.dumps(payload)
        for ws in list(self.rooms.get(room, [])):
            if ws is exclude:
                continue
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.leave(room, d)


intercom = IntercomHub()


async def _ws_user(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None
    return await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})


@app.websocket("/api/ws/intercom/{ride_id}")
async def ws_intercom(websocket: WebSocket, ride_id: str, token: str = ""):
    user = await _ws_user(token)
    if not user:
        await websocket.close(code=4401)
        return
    part = await db.group_participants.find_one({"ride_id": ride_id, "user_id": user["id"]}, {"_id": 0})
    if not part or part["status"] not in ("joined",):
        await websocket.close(code=4403)
        return
    await intercom.join(ride_id, websocket)
    # Broadcast join
    await db.group_participants.update_one(
        {"ride_id": ride_id, "user_id": user["id"]},
        {"$set": {"on_comms": True}},
    )
    await intercom.broadcast(ride_id, {"type": "presence", "user_id": user["id"], "on_comms": True})
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            t = msg.get("type")
            if t == "mute":
                muted = bool(msg.get("muted", False))
                await db.group_participants.update_one(
                    {"ride_id": ride_id, "user_id": user["id"]}, {"$set": {"muted": muted}}
                )
                await intercom.broadcast(ride_id, {"type": "mute", "user_id": user["id"], "muted": muted})
            elif t == "speaking":
                sp = bool(msg.get("speaking", False))
                await db.group_participants.update_one(
                    {"ride_id": ride_id, "user_id": user["id"]}, {"$set": {"speaking": sp}}
                )
                await intercom.broadcast(ride_id, {"type": "speaking", "user_id": user["id"], "speaking": sp})
            elif t == "audio":
                # Push-to-talk audio clip: server relays the base64 blob to other participants.
                # Payload: { type: "audio", data: "<base64>", mime: "audio/webm;codecs=opus" }
                await intercom.broadcast_except(ride_id, websocket, {
                    "type": "audio",
                    "user_id": user["id"],
                    "username": user["username"],
                    "display_name": user.get("display_name") or user["username"],
                    "data": msg.get("data"),
                    "mime": msg.get("mime", "audio/webm"),
                })
    except WebSocketDisconnect:
        pass
    finally:
        intercom.leave(ride_id, websocket)
        await db.group_participants.update_one(
            {"ride_id": ride_id, "user_id": user["id"]},
            {"$set": {"on_comms": False, "speaking": False}},
        )
        await intercom.broadcast(ride_id, {"type": "presence", "user_id": user["id"], "on_comms": False})


@api.get("/")
async def root():
    return {"service": "BikeFriends API", "ok": True}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown() -> None:
    client.close()
