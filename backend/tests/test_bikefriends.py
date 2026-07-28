"""BikeFriends backend regression tests."""
import os
import uuid
import json
import base64
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # fallback: read frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def rider_token(session):
    r = session.post(f"{API}/auth/login", json={"email": "rider@bike.com", "password": "password123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth(rider_token):
    return {"Authorization": f"Bearer {rider_token}", "Content-Type": "application/json"}


# ---------- Health ----------
def test_health(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("ok") is True


# ---------- Auth ----------
def test_login_success(session):
    r = session.post(f"{API}/auth/login", json={"email": "rider@bike.com", "password": "password123"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "rider@bike.com"
    assert body["user"]["username"] == "throttle"
    assert body["access_token"]


def test_login_bad_password(session):
    r = session.post(f"{API}/auth/login", json={"email": "rider@bike.com", "password": "wrong"})
    assert r.status_code == 401


def test_signup_and_duplicate(session):
    rand = uuid.uuid4().hex[:8]
    payload = {
        "email": f"test_{rand}@bike.com",
        "password": "password123",
        "username": f"test_{rand}",
        "display_name": "Test User",
        "bike_model": "Test Bike",
    }
    r = session.post(f"{API}/auth/signup", json=payload)
    assert r.status_code == 200, r.text
    # duplicate should 409
    r2 = session.post(f"{API}/auth/signup", json=payload)
    assert r2.status_code == 409


def test_me_and_patch(session, auth):
    r = session.get(f"{API}/auth/me", headers=auth)
    assert r.status_code == 200
    assert r.json()["email"] == "rider@bike.com"
    orig_name = r.json()["display_name"]
    new_name = "Alex Rider Updated"
    r2 = session.patch(f"{API}/auth/me", headers=auth, json={"display_name": new_name})
    assert r2.status_code == 200
    assert r2.json()["display_name"] == new_name
    # revert
    session.patch(f"{API}/auth/me", headers=auth, json={"display_name": orig_name})


def test_me_no_token(session):
    r = session.get(f"{API}/auth/me")
    assert r.status_code == 401


# ---------- Friends ----------
def test_friends_list_has_three(session, auth):
    r = session.get(f"{API}/friends", headers=auth)
    assert r.status_code == 200
    friends = r.json()
    accepted = [f for f in friends if f["status"] == "accepted"]
    assert len(accepted) >= 3, f"Expected 3 accepted friends, got {len(accepted)}"


def test_friends_search_maria(session, auth):
    r = session.get(f"{API}/friends/search", headers=auth, params={"q": "maria"})
    assert r.status_code == 200
    results = r.json()
    assert any(u["username"] == "maria_moto" for u in results)


def test_friend_request_duplicate_returns_409(session, auth):
    # Rider is already friends with Maria — creating request should 409
    r = session.post(f"{API}/friends/request", headers=auth, json={"username": "maria_moto"})
    assert r.status_code == 409


# ---------- Rides ----------
def test_ride_solo_start_and_end(session, auth):
    r = session.post(f"{API}/rides/start", headers=auth, json={"title": "Solo Test", "is_group_ride": False})
    assert r.status_code == 200, r.text
    ride = r.json()
    assert ride["is_group_ride"] is False
    assert ride["livekit_room_name"] is None
    assert ride["status"] == "active"
    sid = ride["id"]

    # active reflects
    r2 = session.get(f"{API}/rides/active", headers=auth)
    assert r2.status_code == 200
    assert r2.json() and r2.json()["id"] == sid

    # end
    r3 = session.post(
        f"{API}/rides/{sid}/end",
        headers=auth,
        json={"distance_km": 12.5, "top_speed_kmh": 88.0, "avg_speed_kmh": 55.0, "duration_seconds": 900, "polyline": [[10.0, 20.0], [10.1, 20.1]]},
    )
    assert r3.status_code == 200, r3.text
    ended = r3.json()
    assert ended["status"] == "completed"
    assert ended["distance_km"] == 12.5

    # active is cleared
    r4 = session.get(f"{API}/rides/active", headers=auth)
    assert r4.status_code == 200
    assert r4.json() is None


def test_ride_group_mints_livekit_room(session, auth):
    r = session.post(f"{API}/rides/start", headers=auth, json={"title": "Group Test", "is_group_ride": True})
    assert r.status_code == 200
    ride = r.json()
    assert ride["is_group_ride"] is True
    assert ride["livekit_room_name"] and ride["livekit_room_name"].startswith("ride-")
    # cleanup: end it
    session.post(
        f"{API}/rides/{ride['id']}/end",
        headers=auth,
        json={"distance_km": 1.0, "top_speed_kmh": 30.0, "avg_speed_kmh": 20.0, "duration_seconds": 60, "polyline": []},
    )


def test_rides_mine_returns_seeded(session, auth):
    r = session.get(f"{API}/rides/mine", headers=auth)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert len(r.json()) >= 2


# ---------- Live status ----------
def test_live_status_upsert_and_friends(session, auth):
    # start a ride to get a session id
    r = session.post(f"{API}/rides/start", headers=auth, json={"title": "Live Test", "is_group_ride": False})
    sid = r.json()["id"]
    r2 = session.post(
        f"{API}/live-status",
        headers=auth,
        json={"ride_session_id": sid, "lat": 12.34, "lng": 56.78, "speed_kmh": 42.0, "is_on_comms": False},
    )
    assert r2.status_code == 200
    assert r2.json().get("ok") is True

    # login as maria and check she can see rider's live status
    r3 = session.post(f"{API}/auth/login", json={"email": "maria@bike.com", "password": "password123"})
    maria_token = r3.json()["access_token"]
    r4 = session.get(f"{API}/live-status/friends", headers={"Authorization": f"Bearer {maria_token}"})
    assert r4.status_code == 200
    lives = r4.json()
    assert any(x["rider"]["email"] == "rider@bike.com" for x in lives)

    # cleanup
    session.post(
        f"{API}/rides/{sid}/end",
        headers=auth,
        json={"distance_km": 0.5, "top_speed_kmh": 42.0, "avg_speed_kmh": 30.0, "duration_seconds": 60, "polyline": []},
    )


# ---------- Leaderboard ----------
@pytest.mark.parametrize("scope", ["all", "week", "month"])
def test_leaderboard_scopes(session, auth, scope):
    r = session.get(f"{API}/leaderboard", headers=auth, params={"scope": scope})
    assert r.status_code == 200
    entries = r.json()
    assert isinstance(entries, list)
    if scope == "all":
        assert len(entries) >= 1
        e = entries[0]
        assert "total_km" in e and "total_rides" in e and "top_speed_kmh" in e
        # sorted desc
        kms = [x["total_km"] for x in entries]
        assert kms == sorted(kms, reverse=True)


# ---------- LiveKit token (mocked) ----------
def test_livekit_token_mocked(session, auth):
    r = session.post(f"{API}/livekit/token", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body.get("mocked") is True
    assert body.get("token")


# =====================================================================
# Iteration 2 — new features: invite-more, group start-ride, recap, WS audio
# =====================================================================

def _login(session, email):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sunset_ride_id(session, auth):
    r = session.get(f"{API}/groups/mine", headers=auth)
    assert r.status_code == 200, r.text
    for g in r.json():
        if g["title"] == "Sunset Cruise":
            return g["ride_id"]
    pytest.skip("Sunset Cruise seed not present")


# ---------- Recap ----------
def test_group_recap_sunset_cruise(session, auth, sunset_ride_id):
    r = session.get(f"{API}/groups/{sunset_ride_id}/recap", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_riders"] == 3
    assert abs(body["crew_total_km"] - 175.5) < 0.5
    assert abs(body["crew_top_speed_kmh"] - 134.0) < 0.5
    # 3 members each with polyline
    assert len(body["members"]) == 3
    assert all(len(m["polyline"]) >= 2 for m in body["members"])
    # avg = mean of avg speeds; should be a reasonable positive number
    assert body["crew_avg_speed_kmh"] > 0


def test_group_recap_non_participant_403(session, sunset_ride_id):
    # sam is a friend but NOT in Sunset Cruise seed roster
    sam_tok = _login(session, "sam@bike.com")
    r = session.get(f"{API}/groups/{sunset_ride_id}/recap", headers=_auth(sam_tok))
    assert r.status_code == 403


# ---------- Invite more ----------
def test_group_invite_more_flow(session, auth):
    # rider creates a fresh group with no invites, then invites maria via /invite
    r = session.post(f"{API}/groups", headers=auth, json={"title": "TEST_InviteFlow", "invite_usernames": []})
    assert r.status_code == 200
    grp = r.json()
    rid = grp["ride_id"]
    assert len(grp["participants"]) == 1  # only owner joined

    # invite maria (a friend)
    r2 = session.post(
        f"{API}/groups/{rid}/invite",
        headers=auth,
        json={"title": "x", "invite_usernames": ["maria_moto"]},
    )
    assert r2.status_code == 200, r2.text
    parts = r2.json()["participants"]
    maria = [p for p in parts if p["user"]["username"] == "maria_moto"]
    assert len(maria) == 1 and maria[0]["status"] == "invited"

    # re-invite same user should be a no-op (skip already-invited)
    r3 = session.post(
        f"{API}/groups/{rid}/invite",
        headers=auth,
        json={"title": "x", "invite_usernames": ["maria_moto", "not_a_username_xyz"]},
    )
    assert r3.status_code == 200
    parts3 = r3.json()["participants"]
    maria_count = sum(1 for p in parts3 if p["user"]["username"] == "maria_moto")
    assert maria_count == 1

    # cleanup: owner leaves ends the group
    session.post(f"{API}/groups/{rid}/leave", headers=auth)


def test_group_invite_403_when_not_joined(session, auth):
    # create group as rider — sam is NOT invited/joined
    r = session.post(f"{API}/groups", headers=auth, json={"title": "TEST_InviteAuth", "invite_usernames": []})
    rid = r.json()["ride_id"]

    sam_tok = _login(session, "sam@bike.com")
    r2 = session.post(
        f"{API}/groups/{rid}/invite",
        headers=_auth(sam_tok),
        json={"title": "x", "invite_usernames": ["maria_moto"]},
    )
    assert r2.status_code == 403

    session.post(f"{API}/groups/{rid}/leave", headers=auth)


# ---------- Group start-ride ----------
def test_group_start_ride_idempotent_and_keeps_group_active(session, auth):
    r = session.post(f"{API}/groups", headers=auth, json={"title": "TEST_StartFlow", "invite_usernames": []})
    rid = r.json()["ride_id"]

    r1 = session.post(f"{API}/groups/{rid}/start-ride", headers=auth, json={})
    assert r1.status_code == 200, r1.text
    s1 = r1.json()
    assert s1["is_group_ride"] is True
    assert s1["ride_id"] == rid
    assert s1["status"] == "active"

    # idempotent — same session returned
    r2 = session.post(f"{API}/groups/{rid}/start-ride", headers=auth, json={})
    assert r2.status_code == 200
    assert r2.json()["id"] == s1["id"]

    # end the session — parent group should stay active (regression)
    r3 = session.post(
        f"{API}/rides/{s1['id']}/end",
        headers=auth,
        json={"distance_km": 5.5, "top_speed_kmh": 100.0, "avg_speed_kmh": 60.0, "duration_seconds": 600, "polyline": [[1, 2], [1.1, 2.1]]},
    )
    assert r3.status_code == 200
    assert r3.json()["status"] == "completed"

    grp = session.get(f"{API}/groups/{rid}", headers=auth).json()
    assert grp["status"] == "active", "Ending a group ride session must NOT close the parent group"

    # cleanup
    session.post(f"{API}/groups/{rid}/leave", headers=auth)


def test_group_start_ride_403_when_not_joined(session, auth):
    r = session.post(f"{API}/groups", headers=auth, json={"title": "TEST_StartAuth", "invite_usernames": []})
    rid = r.json()["ride_id"]
    sam_tok = _login(session, "sam@bike.com")
    r2 = session.post(f"{API}/groups/{rid}/start-ride", headers=_auth(sam_tok), json={})
    assert r2.status_code == 403
    session.post(f"{API}/groups/{rid}/leave", headers=auth)


# ---------- WebSocket intercom audio relay ----------
def _ws_url(rid, token):
    base = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
    return f"{base}/api/ws/intercom/{rid}?token={token}"


@pytest.mark.asyncio
async def test_ws_audio_relayed_to_others_not_sender(session, auth, rider_token):
    # Use Test Ride which has rider (owner) — need at least 2 joined participants
    grps = session.get(f"{API}/groups/mine", headers=auth).json()
    rid = next(g["ride_id"] for g in grps if g["title"] == "Test Ride")
    # Ensure maria is joined
    maria_tok = _login(session, "maria@bike.com")
    session.post(f"{API}/groups/{rid}/join", headers=_auth(maria_tok))

    async with websockets.connect(_ws_url(rid, rider_token)) as ws_a, \
               websockets.connect(_ws_url(rid, maria_tok)) as ws_b:
        # Drain initial presence broadcasts
        async def drain(ws):
            try:
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=0.3)
            except asyncio.TimeoutError:
                pass
        await drain(ws_a)
        await drain(ws_b)

        # rider (ws_a) sends an audio blob
        payload = {"type": "audio", "data": base64.b64encode(b"hello").decode(), "mime": "audio/webm"}
        await ws_a.send(json.dumps(payload))

        # ws_b should receive it, ws_a should NOT
        got_b = json.loads(await asyncio.wait_for(ws_b.recv(), timeout=2.0))
        assert got_b["type"] == "audio"
        assert got_b["data"] == payload["data"]
        assert got_b["username"] == "throttle"

        # Sender must not receive their own audio
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(ws_a.recv(), timeout=0.6)


@pytest.mark.asyncio
async def test_ws_mute_and_speaking_broadcast(session, auth, rider_token):
    grps = session.get(f"{API}/groups/mine", headers=auth).json()
    rid = next(g["ride_id"] for g in grps if g["title"] == "Test Ride")
    maria_tok = _login(session, "maria@bike.com")
    session.post(f"{API}/groups/{rid}/join", headers=_auth(maria_tok))

    async with websockets.connect(_ws_url(rid, rider_token)) as ws_a, \
               websockets.connect(_ws_url(rid, maria_tok)) as ws_b:
        async def drain(ws):
            try:
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=0.3)
            except asyncio.TimeoutError:
                pass
        await drain(ws_a)
        await drain(ws_b)

        await ws_a.send(json.dumps({"type": "mute", "muted": True}))
        got = None
        for _ in range(3):
            m = json.loads(await asyncio.wait_for(ws_b.recv(), timeout=2.0))
            if m.get("type") == "mute":
                got = m
                break
        assert got is not None and got["muted"] is True

        await ws_a.send(json.dumps({"type": "speaking", "speaking": True}))
        got2 = None
        for _ in range(3):
            m = json.loads(await asyncio.wait_for(ws_b.recv(), timeout=2.0))
            if m.get("type") == "speaking":
                got2 = m
                break
        assert got2 is not None and got2["speaking"] is True
