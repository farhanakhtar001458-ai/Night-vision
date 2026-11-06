# DroidLink X

A private, self-hosted device-management ecosystem for **your own** Android devices — an AirDroid-class
product with no third-party accounts, no hidden control and no telemetry leaving your server.

```
┌─────────────────────┐        HTTPS / REST        ┌──────────────────────────┐
│  Android app        │ ─────────────────────────► │  Node 22 + Express 5     │
│  Kotlin + Compose   │ ◄───────────────────────── │  REST + WebSocket + WS   │
│  Material 3         │        WSS (device link)   │  relay + TURN creds      │
└─────────┬───────────┘                            └────────────┬─────────────┘
          │ WebRTC (STUN/TURN, per-connection creds)            │ pg / redis
          ▼                                                     ▼
┌─────────────────────┐                            ┌──────────────────────────┐
│  Your other Android │                            │  PostgreSQL 16 + Redis 7 │
│  devices            │                            └──────────────────────────┘
└─────────────────────┘                                        ▲
                                                  ┌────────────┴─────────────┐
                                                  │  React dashboard (Vite)  │
                                                  │  12 pages, glass UI      │
                                                  └──────────────────────────┘
```

## Repository layout

| Path | What it is |
| --- | --- |
| `backend/` | Node 22 / TypeScript backend: auth, device registry, presence, WebSocket relay, WebRTC signalling, file & chunked transfer APIs, notifications, clipboard, activity, audit. |
| `dashboard/` | React + Vite + Tailwind dashboard (12 pages) with real-time updates. |
| `android/` | Android Studio project: Kotlin, Jetpack Compose Material 3, Hilt, Room, DataStore, OkHttp, WorkManager. |
| `infrastructure/` | docker-compose stack (Postgres, Redis, backend, dashboard, coturn), TURN config, SQL schema. |
| `docs/` | Architecture, API, WebSocket protocol, database, security, installation, deployment, testing, Android and roadmap documents. |

## Quick start (Docker)

```bash
cp infrastructure/docker/.env.example infrastructure/docker/.env   # fill in secrets
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/docker-compose.yml up -d --build
curl -fsS http://127.0.0.1:8080/api/health
```

Then create the owner account (open `http://<host>:8081`, choose **Create account**). Every additional
Android device that signs in with the same owner account enrolls itself automatically — there is no QR
step and no device sharing.

## Local development

```bash
# backend
cd backend && cp .env.example .env && npm install && npm run migrate && npm run dev   # :8080

# dashboard
cd dashboard && npm install && npm run dev                                          # :5173, proxies /api + /ws

# tests
cd backend && npx vitest run                                                        # 43 tests
cd dashboard && npm run build
```

Android: open `android/` in Android Studio (JDK 17, AGP 8.11.1, compileSdk 36). Debug builds default to
`http://10.0.2.2:8080/`; the server URL is editable in **Settings → Server configuration**.

See `docs/installation.md` for prerequisites and `docs/android.md` for the module graph.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Backend: schema, auth, devices, presence, WebSocket, signalling, files, transfers, notifications, activity | ✅ implemented, 43 tests green |
| 2 | React dashboard: 12 pages, real API + WS, WebRTC viewer, chunked uploader | ✅ implemented, production build green |
| 3 | Android: Gradle/Hilt/Compose app, encrypted vault, enrollment, cloud link, dashboard/devices/settings | ✅ code complete (compiled only in Android Studio — this sandbox has no JDK/Android SDK) |
| 4 | File manager, resumable transfers on Android (SAF) | ⏳ next |
| 5 | Screen mirroring (MediaProjection + WebRTC) | ⏳ |
| 6 | Remote camera, notifications, clipboard, accessibility control | ⏳ |
| 7 | Offline/mDNS mode, hardening, accessibility polish | ⏳ |
| 8 | Release engineering: signed APK, CI, docs finalisation | ⏳ |

`docs/roadmap.md` holds the detailed per-phase acceptance criteria. Nothing in the app is a fake button:
tools that are not built yet are not exposed as controls.

## Security highlights

* Owner passwords hashed with scrypt; access tokens are short-lived JWTs with server-side revocation
  (`revoked:token:<jti>`); refresh tokens rotate with reuse detection and family revocation.
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
