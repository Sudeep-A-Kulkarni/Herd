"""BikeFriends iteration 3 tests: live-positions, register-push, push side-effects."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break
API = f"{BASE_URL.rstrip('/')}/api"

LIVE_TEST_RIDE_ID = "890a8409-cb96-41cd-9ed4-d8c065c94e46"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, pw="password123"):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def rider_token(session):
    return _login(session, "rider@bike.com")


@pytest.fixture(scope="module")
def sam_token(session):
    return _login(session, "sam@bike.com")


# ---------- GET /api/groups/{ride_id}/live-positions ----------

class TestLivePositions:
    def test_participant_gets_positions(self, session, rider_token):
        r = session.get(f"{API}/groups/{LIVE_TEST_RIDE_ID}/live-positions", headers=_auth(rider_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # All 3 seeded riders should have live positions
        assert len(data) == 3, f"expected 3 live riders, got {len(data)}: {data}"
        # Data shape
        for item in data:
            assert "rider" in item and "lat" in item and "lng" in item
            assert "speed_kmh" in item and "is_on_comms" in item and "updated_at" in item
            assert isinstance(item["rider"], dict)
            assert item["rider"].get("username")
            assert item["rider"].get("email")
            assert isinstance(item["lat"], float)
            assert isinstance(item["lng"], float)
            assert -90 <= item["lat"] <= 90
            assert -180 <= item["lng"] <= 180
        # Verify SF-area coordinates
        for item in data:
            assert 37.0 < item["lat"] < 38.0
            assert -123.0 < item["lng"] < -122.0
        # Verify rider identities include the three seeded
        usernames = {i["rider"]["username"] for i in data}
        assert usernames == {"throttle", "maria_moto", "jay_speed"}, usernames

    def test_non_participant_403(self, session, sam_token):
        r = session.get(f"{API}/groups/{LIVE_TEST_RIDE_ID}/live-positions", headers=_auth(sam_token))
        assert r.status_code == 403

    def test_requires_auth(self, session):
        r = session.get(f"{API}/groups/{LIVE_TEST_RIDE_ID}/live-positions")
        assert r.status_code == 401

    def test_nonexistent_ride_403(self, session, rider_token):
        r = session.get(f"{API}/groups/{uuid.uuid4().hex}/live-positions", headers=_auth(rider_token))
        assert r.status_code == 403


# ---------- POST /api/register-push ----------

class TestRegisterPush:
    def test_requires_auth(self, session):
        r = session.post(f"{API}/register-push", json={"platform": "ios", "device_token": "tok_abc"})
        assert r.status_code == 401

    def test_placeholder_key_returns_500(self, session, rider_token):
        r = session.post(
            f"{API}/register-push",
            headers=_auth(rider_token),
            json={"platform": "ios", "device_token": "TEST_dev_token_123"},
        )
        # EMERGENT_PUSH_KEY = 'placeholder' -> upstream 401 -> our 500 (or 502 unavailable)
        assert r.status_code in (500, 502), r.text
        if r.status_code == 500:
            assert "EMERGENT_PUSH_KEY" in r.json().get("detail", "")

    def test_missing_body_422(self, session, rider_token):
        r = session.post(f"{API}/register-push", headers=_auth(rider_token), json={})
        assert r.status_code == 422


# ---------- send_push wired into /groups & /groups/{id}/invite ----------

class TestPushSideEffects:
    """Verify create/invite still 200 despite upstream 401 from placeholder key."""

    def test_create_group_returns_200_despite_push_failure(self, session, rider_token):
        r = session.post(
            f"{API}/groups",
            headers=_auth(rider_token),
            json={"title": "TEST_PushCreate", "invite_usernames": ["maria_moto"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["title"] == "TEST_PushCreate"
        assert body["ride_id"]
        # There must be an invited participant (maria) despite push failing
        invited = [p for p in body["participants"] if p["status"] == "invited"]
        assert any(p["user"]["username"] == "maria_moto" for p in invited)
        # cleanup
        session.post(f"{API}/groups/{body['ride_id']}/leave", headers=_auth(rider_token))

    def test_invite_more_returns_200_despite_push_failure(self, session, rider_token):
        r = session.post(
            f"{API}/groups",
            headers=_auth(rider_token),
            json={"title": "TEST_PushInvite", "invite_usernames": []},
        )
        assert r.status_code == 200
        rid = r.json()["ride_id"]
        r2 = session.post(
            f"{API}/groups/{rid}/invite",
            headers=_auth(rider_token),
            json={"title": "x", "invite_usernames": ["jay_speed"]},
        )
        assert r2.status_code == 200, r2.text
        assert any(
            p["user"]["username"] == "jay_speed" and p["status"] == "invited"
            for p in r2.json()["participants"]
        )
        # cleanup
        session.post(f"{API}/groups/{rid}/leave", headers=_auth(rider_token))
