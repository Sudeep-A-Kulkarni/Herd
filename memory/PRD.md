# BikeFriends — Product Spec

## Overview
BikeFriends is a mobile-first group-ride tracker for motorcyclists. Ride together, track together — GPS route recording, live friend positions, group voice intercom (LiveKit stub), leaderboard, and social friend graph.

## Stack
- **Frontend**: Expo Router (SDK 54), TypeScript, react-native-webview + Leaflet (map, Expo Go compatible), expo-location, expo-secure-store
- **Backend**: FastAPI + MongoDB (motor async)
- **Auth**: JWT + bcrypt (Bearer tokens, stored via SecureStore)
- **Design**: Dark-first "Tactical Utility" theme, brand orange `#FF6B00`, deep obsidian surfaces

## Core Features
1. **Auth** — email + password signup / login, JWT.
2. **Home** — greets rider, lists friends riding live with real-time speed, recent rides.
3. **Ride** — full-screen Leaflet map with live-drawn polyline. HUD: current speed (huge), distance, top speed, duration. Start/End ride buttons. Optional Group Ride toggle spawns a LiveKit room name + intercom UI (join/leave, mic mute).
4. **Friends** — search by username, send/accept/decline requests, live status dots.
5. **Leaderboard** — all-time / month / week ranking by total km, with podium for top 3 and highlight for the current user.
6. **Profile** — avatar, name, bike model (editable), lifetime stats, recent rides, sign out.

## Ride Tracker Logic (`src/lib/ride-tracker.ts`)
- Distance via Haversine.
- Rolling 5-point speed smoother.
- Rejects raw GPS speeds > 180 km/h as noise.
- Distance only accrues when smoothed speed > 1 km/h.
- Pushes live status to `/api/live-status` every 5 s while tracking.

## Backend API (all under `/api`)
- `POST /auth/signup` · `POST /auth/login` · `GET /auth/me` · `PATCH /auth/me`
- `GET /friends` · `GET /friends/search?q=` · `POST /friends/request` · `POST /friends/{id}/accept` · `POST /friends/{id}/decline`
- `POST /rides/start` · `POST /rides/{session_id}/end` · `GET /rides/active` · `GET /rides/mine`
- `POST /live-status` · `GET /live-status/friends`
- `GET /leaderboard?scope=all|week|month`
- `POST /livekit/token` — **MOCKED** (returns a stub URL + token; real minting must be done server-side with LiveKit API secret)

## Environment Notes / Mocks
- **Map**: Uses Leaflet + Carto dark tiles in a WebView (Expo Go compatible). For production native builds, swap to `@rnmapbox/maps` as originally specified.
- **Location**: Foreground tracking via `expo-location`. Background location (`Location.startLocationUpdatesAsync` + `expo-task-manager`) requires a native dev build; permissions declared in app.json.
- **Intercom**: LiveKit voice room is **UI-only / MOCKED** in this build. Real integration needs a native build with `livekit-react-native` and a server-minted token via LIVEKIT_API_KEY / LIVEKIT_API_SECRET env vars.
- **Backend swap**: Original spec called for Supabase; we implemented FastAPI + MongoDB because that's what the Emergent environment ships. The schema is equivalent; a Supabase SQL migration can be derived from `server.py` models.

## Seeded Demo Data
4 users all-friended, 2–5 completed rides each for realistic leaderboard. See `/app/memory/test_credentials.md`.
