# BikeFriends — Product Spec

## Overview
BikeFriends is a mobile-first group-ride tracker for motorcyclists. Ride together, track together — GPS route recording, live friend positions, group voice intercom (real push-to-talk over WebSocket), leaderboard, ride recap sharing, and social friend graph.

## Stack
- **Frontend**: Expo Router (SDK 54), TypeScript, react-native-webview + inline-iframe Leaflet map, expo-location, expo-secure-store, native MediaRecorder API for PTT audio on web.
- **Backend**: FastAPI + MongoDB (motor async), WebSocket intercom relay.
- **Auth**: JWT + bcrypt.
- **Design**: Dark tactical theme, brand orange `#FF6B00`, deep obsidian surfaces.

## Screens
- Auth: `/(auth)/sign-in`, `/(auth)/sign-up`
- Tabs: Home, Ride (solo), Friends, Leaderboard, Profile
- Group flow: `/group/create`, `/group/[id]` (room), `/group/[id]/recap`

## Group Ride Flow
1. From Home tap **Start a Group Ride** → title + multi-select friends → `POST /api/groups`.
2. Invited friends see the invite on Home → **Join** → `POST /api/groups/{id}/join`.
3. Inside the room: **Join intercom** (WebSocket connect), **HOLD TO TALK** (MediaRecorder → base64 → WS relay to peers → auto-play), **Start my ride** (creates a linked `ride_session` with GPS + live status), **Invite more** (bottom sheet lists uninvited friends), **Live recap** anytime, **End group ride** (owner) or **Leave**.
4. Recap: aggregates crew km, crew top speed, avg speed, longest rider, per-member breakdown, share via native share sheet.

## Ride Tracker Logic
- Haversine distance.
- 5-point rolling speed average, raw > 180 km/h rejected as GPS noise.
- Distance only accrues when smoothed speed > 1 km/h.
- Live status pushed to `/api/live-status` every 5s.

## Backend API (all under `/api`)
- Auth: `POST /auth/signup|login`, `GET|PATCH /auth/me`
- Friends: `GET /friends`, `GET /friends/search`, `POST /friends/request`, `POST /friends/{id}/accept|decline`
- Rides (solo): `POST /rides/start`, `POST /rides/{id}/end`, `GET /rides/active`, `GET /rides/mine`
- Groups: `POST /groups`, `GET /groups/invitations|mine|{id}`, `POST /groups/{id}/join|decline|leave|invite|start-ride`, `GET /groups/{id}/recap`
- Live status: `POST /live-status`, `GET /live-status/friends`
- Leaderboard: `GET /leaderboard?scope=all|week|month`
- WebSocket: `/api/ws/intercom/{ride_id}?token=…` — presence, mute, speaking, and audio-clip relay to peers

## Environment Notes / Mocks
- **Map**: Leaflet in WebView on native, inline iframe on web (Expo Go compatible).
- **Push-to-talk audio**: MediaRecorder + base64 blob over WebSocket. Works on any browser (web preview). Native Expo Go reports `audioSupported=false` and gracefully degrades to presence-only — a native dev build adding `expo-audio` recording behind the same interface enables mobile audio.
- **LiveKit token minting endpoint** (`POST /api/livekit/token`) is stubbed and returned only for compatibility with the original spec — free WebSocket path replaces it.
- **Location**: Foreground tracking today. Background tracking permissions declared in `app.json` for a native dev build.

## Seeded Demo Data
4 users all-friended, 2–5 completed rides each, plus example group rides for recap demos. See `/app/memory/test_credentials.md`.
