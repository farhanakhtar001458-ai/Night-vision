# DroidLink X

A private, self-hosted device-management ecosystem for **your own** Android devices — an AirDroid-class
product with no third-party accounts, no hidden control and no telemetry leaving your server.

```
┌─────────────────────┐   Supabase Auth + PostgREST + Storage   ┌──────────────────────────┐
│  Android app        │ ──────────────────────────────────────► │  Supabase (primary)       │
│  Kotlin + Compose   │ ◄────────────────────────────────────── │  Postgres + RLS           │
│  Material 3         │      Supabase Realtime (state only)     │  Auth (GoTrue)            │
└─────────┬───────────┘                                         │  Storage (2 buckets)      │
          │ WebRTC (STUN/TURN, per-connection creds)            │  8 Edge Functions         │
          ▼                                                     └────────────┬─────────────┘
┌─────────────────────┐        SDP / ICE over WSS                           │
│  Your other Android │ ◄──────────────────────────────► ┌──────────────────▼───────────┐
│  devices            │                                  │  Signalling relay (:8090)    │
└─────────────────────┘                                  │  auth + presence + relay     │
                                                         └──────────────────────────────┘
┌─────────────────────┐   anon key + owner JWT (RLS)
│  React dashboard    │ ──────────────────────────────────► Supabase
└─────────────────────┘
```

## Repository layout

| Path | What it is |
| --- | --- |
| `supabase/` | **Primary backend**: 5 SQL migrations, RLS on every table, 2 storage buckets, Realtime publication, 8 Edge Functions, executable RLS tests. |
| `signaling/` | Dedicated WebRTC signalling relay (Node 22 + ws, 18 tests): authenticated upgrade, presence, SDP/ICE relay, rate limiting. |
| `backend/` | Optional self-hosted BFF retained for offline/LAN deployments; it is **not** the source of truth and shares no schema with Supabase. |
| `dashboard/` | React + Vite + Tailwind dashboard (12 pages) talking to Supabase Auth/PostgREST/Storage/Realtime with the anon key. |
| `android/` | Android Studio project: Kotlin, Jetpack Compose Material 3, Hilt, Room, DataStore, OkHttp, WorkManager. |
| `infrastructure/` | docker-compose stack (signalling relay, dashboard, coturn) plus TURN config. Supabase itself is hosted or run with `supabase start`. |
| `docs/` | Architecture, API, WebSocket protocol, database, security, installation, deployment, testing, Android and roadmap documents. |

## Quick start (Supabase)

```bash
# 1. database + functions
supabase link --project-ref <project-ref>
supabase db push
supabase secrets set DEVICE_JWT_SECRET=$(openssl rand -hex 32) SIGNALING_URL=wss://signal.example.com \
  TURN_URLS="turn:turn.example.com:3478?transport=udp" TURN_SECRET=$(openssl rand -hex 32) \
  APP_ORIGINS=https://cloud.example.com
supabase functions deploy enroll-device revoke-device create-session authorize-connection \
  initiate-transfer generate-secure-download update-device-status finalize-transfer

# 2. dashboard
cd dashboard && cp .env.example .env      # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_SIGNALING_URL
npm install && npm run dev                 # http://localhost:5173

# 3. signalling relay
cd ../signaling && cp .env.example .env && npm ci && npm run dev   # ws://localhost:8090/ws
```

**APK download:** [Releases](https://github.com/farhanakhtar001458-ai/Night-vision/releases) → `droidlinkx-debug.apk` (built by CI on every push). Install build kit: **`docs/build-kit.md`**.

Full walkthrough — schema, policies, secrets, storage, realtime, verification: **`docs/supabase.md`**.

Then create the owner account (open the dashboard, choose **Create account**; Supabase Auth confirms the
address when email confirmation is enabled). Every additional Android device that signs in with the same
owner account enrolls itself automatically — there is no QR step and no device sharing.

## Local development

```bash
# local Supabase (requires Docker) — or point at a hosted project
supabase start
supabase db reset                       # migrations + seed
supabase functions serve

# dashboard
cd dashboard && cp .env.example .env && npm install && npm run dev   # :5173, proxies /ws to :8090

# signalling relay
cd signaling && cp .env.example .env && npm ci && npm run dev       # :8090

# checks
cd signaling && npx vitest run && npx tsc --noEmit                  # 18 tests
cd ../supabase/functions && ./typecheck.sh                          # 0 errors
cd ../dashboard && npm run build
```

Android: open `android/` in Android Studio (JDK 17, AGP 8.11.1, compileSdk 36). The app reads the
Supabase project from Gradle properties (`droidlinkx.supabase.url`, `droidlinkx.supabase.anonKey`,
`droidlinkx.signaling.url`) or the `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SIGNALING_URL` environment
variables. Only the **anon** key is compiled into the APK.

See `docs/installation.md` for prerequisites, `docs/android.md` for the module graph and the transfer
engine, and `docs/supabase.md` for the backend.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Backend: schema, auth, devices, presence, WebSocket, signalling, files, transfers, notifications, activity | ✅ implemented, 43 tests green |
| 2 | React dashboard: 12 pages, real API + WS, WebRTC viewer, chunked uploader | ✅ implemented, production build green |
| 3 | Android: Gradle/Hilt/Compose app, encrypted vault, enrollment, cloud link, dashboard/devices/settings | ✅ code complete (compiled only in Android Studio — this sandbox has no JDK/Android SDK) |
| 4 | File manager + resumable 8 MiB transfers on Android (SAF), SHA-256 verified by `finalize-transfer` | ✅ implemented (Gradle build required — no JDK/Android SDK in this sandbox) |
| 5 | Screen mirroring (MediaProjection + WebRTC) | ⏳ |
| 6 | Remote camera, notifications, clipboard, accessibility control | ⏳ |
| 7 | Offline/mDNS mode, hardening, accessibility polish | ⏳ |
| 8 | Release engineering: signed APK, CI, docs finalisation | ⏳ |

`docs/roadmap.md` holds the detailed per-phase acceptance criteria. Nothing in the app is a fake button:
tools that are not built yet are not exposed as controls.

## Security highlights

* Supabase Auth owns credentials and refresh tokens; the app and dashboard hold only the anon key, so
  `service_role` never leaves the server. 21 RLS assertions run in CI-able SQL (`supabase/tests`).
* Device secrets are stored as hashes (`device_credentials`, service-role only) and exchanged once for a
  short-lived device token bound to a revocable `device_sessions` row.
* Devices authenticate with a device secret, exchanged for a *device-scoped* JWT bound to a revocable
  `device_sessions` row. Presence is only reported online when a live, authenticated socket exists.
* Device secrets never leave the device unencrypted: Android Keystore AES-256-GCM via
  `EncryptedCredentialVault`; Room/DataStore never hold credentials.
* TURN credentials are minted per connection with a TTL; the relay refuses private peer ranges.
* Screen capture/camera/notifications/clipboard always require a visible consent surface and an Android
  permission dialog. There is no hidden injection, no scoped-storage bypass and no silent recording.

Full document: `docs/security.md`.

## Documentation

| Document | Contents |
| --- | --- |
| `docs/build-kit.md` | **APK build kit** — CI workflow, local Gradle build, signing, install steps |
| `docs/mirroring.md` | Phone→phone screen mirroring (WebRTC + `rtc_signals` signalling) |
| `docs/notifications.md` | Notification mirroring — privacy filters, relay, dashboard feed |
| `docs/supabase.md` | Supabase setup: migrations, RLS, storage, realtime, functions, signalling |
| `docs/architecture.md` | Components, request flows, failure handling |
| `docs/api.md` | Every REST endpoint with auth scope and payloads |
| `docs/websocket.md` | Handshake, event catalogue, heartbeat, close codes |
| `docs/database.md` | Tables, relationships, migrations, backup/restore |
| `docs/security.md` | Threat model and controls |
| `docs/installation.md` | Local setup prerequisites and troubleshooting |
| `docs/deployment.md` | Docker/TLS/TURN production deployment |
| `docs/testing.md` | Automated and manual test matrix |
| `docs/android.md` | Module graph, startup sequence, permissions |
| `docs/roadmap.md` | Phase-by-phase plan and status |
