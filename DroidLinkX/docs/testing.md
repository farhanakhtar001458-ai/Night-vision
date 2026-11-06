# Testing

## Automated

### Backend (vitest + supertest, real PostgreSQL)

```bash
cd backend
npx vitest run            # 7 suites, 43 tests
npx vitest run --reporter=verbose
npm run typecheck         # tsc --noEmit
```

Suites cover health, auth (register/login/refresh rotation/reuse detection/logout/me/password), devices
(enroll, listing, presence, permissions, revoke, rotate secret), sessions and revocation, connections and
signalling/TURN config, files (upload/download authorisation), transfers (create, chunk upload,
idempotent duplicates, resume, checksum mismatch, pause/resume/cancel/retry, history), notifications and
clipboard filtering, activity pagination and the WebSocket protocol (handshake auth, relay, presence).

Tests use a dedicated database (`TEST_DATABASE_URL` / `droidlinkx_test`), reset it between suites and spin
up an ephemeral HTTP server for WebSocket cases.

### Dashboard

```bash
cd dashboard
npm run build             # tsc -b && vite build, fails on any type error
```

### Android

```bash
cd android
./gradlew test            # JVM unit tests (domain/data modules)
./gradlew :app:assembleDebug
./gradlew lint
```

> **Sandbox note:** the environment used to author this repository has no JDK, Gradle or Android SDK, so
> `assembleDebug` was not executed there. The Android sources are complete and internally consistent, but
> the first Gradle sync in Android Studio is the authoritative compile for Phase 3.

## Manual acceptance matrix

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Register owner, sign in on the dashboard | 201 then 200, dashboard shows profile |
| 2 | Sign in on an Android device with the same account | Device auto-enrolls, appears in Devices list within seconds |
| 3 | Kill the app on the device | Device flips to offline (`device:offline`), no stale "online" |
| 4 | Re-enable Wi-Fi after airplane mode | Socket reconnects with backoff, presence returns |
| 5 | Revoke the device from the dashboard | Device token rejected (401), device shows "Authorization failed" |
| 6 | Rename/retrust a device, toggle a permission | Changes persist and are audited |
| 7 | Start a mirroring session from the dashboard | Device shows a request; after accept, WebRTC video negotiates |
| 8 | Upload a folder via the dashboard Transfers page | Chunks resume after a refresh; SHA-256 verifies |
| 9 | Toggle reduce motion / accent in Settings | UI updates and persists after reload |
| 10 | Change password, then use an old refresh token | Refresh fails and the family is revoked |

## Security checks

* Wrong password → `401`, correct password → `200` (no user enumeration differences beyond rate limits).
* Device token cannot call owner endpoints (`403`), owner token cannot report device status.
* Reused refresh token → family revoked.
* Download of another account's file with a different bearer → `401/403`.
* Sensitive notification/clipboard content is excluded unless explicitly allowed.
* Android Keystore: secrets survive process death but not device restore; backup rules exclude them.

## Performance smoke tests

* `GET /api/devices` with 50 devices < 150 ms locally.
* 100 MiB transfer in 8 MiB chunks completes with constant memory in the backend (`rss` stable).
* WebSocket: 50 concurrent device sockets, 1 heartbeat/s, no message loss in the hub fan-out.

## Supabase + signalling (added with the backend migration)

```bash
# database: migrations + RLS assertions on plain PG16, no Docker required
createdb droidlinkx
psql -v ON_ERROR_STOP=1 -f supabase/tests/local_stub.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql          # -> RLS TESTS PASSED (21 assertions)

# edge functions (plain tsc + deno shim; no Deno needed)
cd supabase/functions && ./typecheck.sh

# signalling relay
cd signaling && npx tsc -p tsconfig.json --noEmit && npx vitest run   # 18 passed

# dashboard (Supabase client + realtime)
cd dashboard && npm run build                                          # tsc -b + vite build
```
