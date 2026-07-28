"""BikeFriends backend regression tests."""
import os
import uuid
import pytest
import requests

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
