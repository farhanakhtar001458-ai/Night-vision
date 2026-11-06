# Architecture

## Components

| Component | Technology | Responsibility |
| --- | --- | --- |
| Android app | Kotlin 2.1, Compose Material 3, Hilt, Room, DataStore, OkHttp/Retrofit, WorkManager | Owner sign-in, automatic enrollment, foreground cloud link, presence/telemetry, device management UI |
| Backend | Node 22, Express 5, ws 8, pg, ioredis, zod, pino | REST API, authenticated WebSocket relay, WebRTC signalling, transfer chunk store, audit log |
| Dashboard | React 19, TypeScript, Vite, Tailwind | 12-page owner console: devices, files, transfers, mirroring, notifications, security, activity, settings |
| PostgreSQL 16 | relational store | users, devices, credentials, sessions, permissions, transfers, notifications, activity, refresh tokens, connection events |
| Redis 7 | cache / presence TTL / rate limits / revocation | `presence`, `revoked:token:<jti>`, rate-limit counters, clipboard relay buffer |
| coturn | TURN/STUN relay | NAT traversal for WebRTC sessions, credentials minted per connection |

## Backend layering

```
index.ts        -> starts HTTP + WS servers, boot migrations
app.ts          -> helmet, cors, request logging, raw-body exemptions, routers, error handler
<feature>/routes.ts  -> zod validation, auth guard, rate limiting, HTTP mapping
<feature>/service.ts -> SQL, business rules, audit + realtime side effects
realtime/hub.ts -> registry of authenticated sockets (user + device), presence TTL, fan-out
websocket/server.ts -> upgrade, token auth, heartbeat, protocol dispatch
middleware/auth.ts -> requireUser / requireDevice / requireUserOrDevice (JWT verify + revocation)
```

Business rules live in services; routes never touch SQL directly and services never write HTTP responses.

## Android layering

```
:app            -> Application (@HiltAndroidApp, WorkManager factory), MainActivity, 5-tab Compose shell, auth screens
:feature:*      -> dashboard / devices / settings screens + ViewModels
:core:domain    -> pure Kotlin: models, Outcome, repository interfaces (no Android imports)
:core:data      -> repository impls, SessionStorage, settings, telemetry collector, LinkManager, workers, service, Hilt binds
:core:network   -> Retrofit APIs, Moshi DTOs, RealtimeSocket, OkHttp/Retrofit providers
:core:security  -> Android Keystore AES-256-GCM, EncryptedCredentialVault
:core:database  -> Room entities/DAOs (offline catalogue + event feed + telemetry outbox)
:core:designsystem -> Compose theme and shared components
:core:common    -> redacting logger, formatters
```

Dependency direction is one-way: `app -> feature -> domain`, `data -> domain + network + security + database`.
Feature modules never see OkHttp, SQL or Keystore types; they consume `Outcome<T>` and Flows.

## Key flows

### Automatic enrollment (no QR)

1. Owner signs in → `POST /api/auth/login` → access + rotating refresh token.
2. `DeviceRegistrationRepositoryImpl` derives a stable installation identity (`installation.id` in the
   encrypted vault) and calls `POST /api/devices/enroll` with device metadata (manufacturer, model, SDK,
   app version).
3. The backend stores `devices` + `device_credentials` (secret hashed with scrypt) and returns the
   device secret **once**.
4. The device exchanges the secret at `POST /api/devices/token` for a device-scoped JWT bound to a
   `device_sessions` row, then opens `wss://…/ws?token=…&role=device`.

### Presence

A device is shown online only when *both* a TTL'd Redis presence record exists and a live authenticated
device socket is registered. `GET /api/devices` therefore never reports a stale "online".

### Connection + WebRTC signalling

1. Owner (dashboard or app) calls `POST /api/connections/create` with source device and type.
2. Backend creates a `connection_events` row, pushes `connection:request` to the target device socket.
3. Optional accept (`POST /api/connections/accept`) → `connection:accepted` to both peers.
4. Peers exchange `rtc:offer` / `rtc:answer` / `rtc:ice` through the relay; TURN credentials come from
   `GET /api/signaling/turn` (per connection, TTL bounded).
5. `POST /api/connections/terminate` or `rtc:hangup` ends the session and is audited.

### Chunked transfers

`POST /api/transfers` creates a session with items; clients `PUT` raw 8 MiB chunks
(`.../items/:index/chunks/:chunkIndex`), then `POST .../complete` with optional `X-Content-Sha256`.
Duplicate chunks answer `200 {duplicate:true}` so resumption is idempotent; a checksum mismatch fails the
item with `409`. Bytes are written under `STORAGE_DIR` with per-item offsets, never buffered whole in memory.

## Failure handling

* Every network call is wrapped in `Outcome`; transport, HTTP and validation errors become typed failures
  with a human-readable message and optional HTTP status.
* The WebSocket reconnects with jittered exponential backoff capped at 60 s and stops retrying on
  `4401`/`401` (credential rejection) so a revoked device cannot hammer the server.
* Room caches the device catalogue and a telemetry outbox so the app renders offline and flushes later.
* WorkManager performs bounded recovery (credential refresh + telemetry flush) and honours network
  constraints; it never holds a socket open in the background. The live socket runs in a foreground
  service with a visible notification when the owner enables "Foreground connection".
