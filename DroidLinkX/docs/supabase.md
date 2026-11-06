# Supabase backend

Supabase **is** the backend of DroidLink X. There is no second PostgreSQL database and no second
authentication system: owner identities live in Supabase Auth (`auth.users`), application data lives
in `public` tables under Row Level Security, binary content lives in Supabase Storage, live state
travels over Supabase Realtime, and every privileged operation is an Edge Function running with the
`service_role` key **server-side only**.

```
Android app ─┐
             ├─► Supabase Auth (GoTrue)          identity + refresh
Dashboard ───┤   Supabase PostgREST + RLS        devices, transfers, files, activity
             │   Supabase Storage (2 buckets)    uploads, chunk parts, documents, media
             ├─► Edge Functions (Deno)           8 privileged operations
             └─► Signalling relay (WebSocket)    WebRTC SDP/ICE only — never media
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `supabase/config.toml` | Local stack + per-function `verify_jwt` policy |
| `supabase/migrations/20261106090000_schema.sql` | Tables, enums, indexes, triggers |
| `supabase/migrations/20261106090100_rls.sql` | Row Level Security on every table |
| `supabase/migrations/20261106090200_storage.sql` | Buckets, object policies, `files`-only writes |
| `supabase/migrations/20261106090300_realtime.sql` | `supabase_realtime` publication + sequence grants |
| `supabase/migrations/20261106090400_transfer_progress.sql` | Server-side transfer aggregation trigger |
| `supabase/functions/` | 8 Edge Functions + `_shared/` helpers |
| `supabase/tests/rls_test.sql` | 21 executable RLS assertions |
| `supabase/tests/local_stub.sql` | `auth`/`storage` stubs so migrations can be tested on plain PG16 |
| `signaling/` | Dedicated WebRTC signalling relay (TypeScript, 18 tests) |

## 0. Live project status

Project `zarxnrkzdwnjiauybghl` (`https://zarxnrkzdwnjiauybghl.supabase.co`) is already provisioned:

| Piece | State |
| --- | --- |
| Schema (15 tables), RLS + 21 policies | applied |
| Buckets `droidlinkx-files`, `droidlinkx-transfers` + owner-folder policies | applied |
| Realtime publication (7 tables) + broadcast topics `owner:<uuid>` / `device:<uuid>` | applied |
| `rtc_signals`, `prune_rtc_signals()`, `sync_transfer_progress()` | applied |
| Secrets: `DEVICE_JWT_SECRET`, `APP_ORIGINS`, `DOWNLOAD_URL_TTL_SECONDS`, `MAX_TRANSFER_BYTES`, `STUN_URLS` | set |
| Edge function `enroll-device` | deployed (`verify_jwt=true`) |
| Other 7 functions | bundle + deploy with `supabase/functions/deploy.sh` (see §3) |

`supabase db push` is only needed for a *new* project; on this one it is a no-op replay.

## 1. Create the project and apply the database

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                      # applies migrations/*.sql in order
```

The schema is idempotent (`create table if not exists`, `drop policy if exists`), so re-pushing is
safe. It creates:

`profiles`, `devices`, `device_credentials`, `device_sessions`, `device_permissions`,
`connection_sessions`, `connection_events`, `file_transfers`, `transfer_items`, `transfer_chunks`,
`transfer_history`, `files`, `notification_records`, `clipboard_entries`, `activity_logs`.

`profiles.id` **is** `auth.users.id` — a trigger inserts the profile row on signup. `devices.owner_id`
references `auth.users(id)`; every child table repeats `owner_id` so RLS predicates are a single
indexed lookup instead of a join chain.

## 2. Secrets (never shipped to a client)

```bash
supabase secrets set \
  DEVICE_JWT_SECRET="$(openssl rand -hex 32)" \
  SIGNALING_URL="wss://signal.example.com" \
  TURN_URLS="turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp" \
  TURN_SECRET="$(openssl rand -hex 32)" \
  TURN_TTL_SECONDS=3600 \
  STUN_URLS="stun:stun.l.google.com:19302" \
  APP_ORIGINS="https://cloud.example.com" \
  DOWNLOAD_URL_TTL_SECONDS=300
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

| Variable | Used by | Notes |
| --- | --- | --- |
| `DEVICE_JWT_SECRET` | all functions that mint/verify device tokens, signalling service | HS256, ≥32 bytes |
| `SIGNALING_URL` | `enroll-device`, `create-session`, `authorize-connection` | origin **without** `/ws` |
| `TURN_URLS` / `TURN_SECRET` / `TURN_TTL_SECONDS` | `authorize-connection` | ephemeral TURN credentials |
| `STUN_URLS` | `authorize-connection` | public STUN is fine |
| `APP_ORIGINS` | CORS on every function | comma separated |
| `DOWNLOAD_URL_TTL_SECONDS` | `generate-secure-download` | signed URL lifetime |
| `MAX_TRANSFER_BYTES` | `initiate-transfer` | default 2 GiB |
| `MAX_DEVICES_PER_OWNER` | `enroll-device` | default 25 |

## 3. Deploy the Edge Functions

```bash
supabase functions deploy enroll-device revoke-device create-session authorize-connection \
  initiate-transfer generate-secure-download update-device-status finalize-transfer
```

`config.toml` sets the JWT policy explicitly:

| Function | `verify_jwt` | Why |
| --- | --- | --- |
| `create-session` | `false` | the device only holds its enrolment secret at that point |
| `update-device-status` | `false` | authenticated with `x-device-token`, verified in-code |
| all others | `true` | owner JWT is verified by the platform, then re-checked for resource ownership |

Every function additionally re-validates ownership server-side: the platform JWT proves *who* you
are, not *what* you may touch.

## 4. Edge Function contracts

| Function | Auth | Request | Response |
| --- | --- | --- | --- |
| `enroll-device` | owner JWT | `{name, manufacturer?, model?, androidVersion?, sdkInt?, appVersion?, platform?}` | `{device, deviceId, deviceSecret, permissions, signaling}` |
| `revoke-device` | owner JWT | `{deviceId?, sessionId?, delete?, sessionsOnly?}` | `{revoked, sessionsRevoked?}` |
| `create-session` | device secret | `{deviceId, deviceSecret, userAgent?}` | `{accessToken, expiresIn, sessionId, device, signaling}` |
| `authorize-connection` | owner JWT | `{sourceDeviceId, targetDeviceId?, type}` or `{connectionId}` | `{connection, iceServers, ttl, signaling}` |
| `initiate-transfer` | owner JWT | `{direction, mode?, sourceDeviceId?, targetDeviceId?, items[]}` | `{transfer, items, uploadTargets, bucket, chunkSize}` |
| `generate-secure-download` | owner JWT | `{fileId}` or `{transferItemId}` | `{url, expiresAt, ttl, name, mimeType}` |
| `update-device-status` | device token | `{telemetry?, battery?, charging?, network?, name?}` | `{ok, serverTime, deviceId, telemetry}` |
| `finalize-transfer` | owner JWT | `{transferId, itemIndex, sha256?}` | `{transfer, itemId, bytes, sha256, checksumVerified}` |

`finalize-transfer` downloads `‹owner›/‹transfer›/parts/‹index›/N.part` in order, refuses more than
256 MiB of buffered parts, verifies byte length and SHA-256 (mismatch ⇒ HTTP 409, item `failed`,
`transfer_history` row `checksum_mismatch`), writes the merged object to the item's `storage_path`,
deletes the parts and completes the item. The `sync_transfer_progress` trigger then recomputes
`file_transfers.transferred_bytes / completed_items / status` and emits `transfer_history` +
`files` rows.

## 5. Storage

| Bucket | Path convention | Written by |
| --- | --- | --- |
| `droidlinkx-files` | `‹owner_id›/‹uuid›-‹name›` | dashboard uploads, device uploads |
| `droidlinkx-transfers` | `‹owner_id›/‹transfer_id›/parts/‹index›/‹n›.part` | chunked uploads, assembled by `finalize-transfer` |

Both buckets are private. Object policies require `(storage.foldername(name))[1] = auth.uid()::text`,
so a caller cannot read or write another owner's prefix even with a valid JWT. Downloads always go
through `generate-secure-download`, which returns a 5-minute signed URL after checking row ownership.

## 6. Realtime

Published tables: `devices`, `connection_sessions`, `file_transfers`, `transfer_items`,
`activity_logs`, `notification_records`, `clipboard_entries`.

| Topic | Purpose |
| --- | --- |
| `owner:‹uuid›` | presence of the owner's browsers/devices, broadcast events |
| `device:‹uuid›` | device-targeted commands (`connection:request`, `transfer:queued`) |

Broadcast events fired by the functions: `device:enrolled`, `device:revoked`, `device:status`,
`device:online`, `device:offline`, `connection:request`, `transfer:created`, `transfer:completed`,
`clipboard:update`, `notification:sync`.

`postgres_changes` is delivered under RLS: an authenticated owner receives rows from their own
devices/transfers only. Realtime carries **state**, never media — screen streaming uses WebRTC
through the dedicated signalling relay.

## 7. Signalling relay

`signaling/` is a separate Node 22 service (not an Edge Function: Edge Functions cannot hold a
stateful WebSocket). It:

* authenticates `GET /ws?token=…&role=user|device` **before** the upgrade (HTTP 401/403/404/503 JSON),
* verifies device tokens with `DEVICE_JWT_SECRET` and a live `device_sessions` row,
* verifies owner tokens with the project JWT secret or JWKS,
* relays `rtc:offer|answer|ice|hangup` between the owner socket and exactly one device socket,
* maintains presence in `devices.online` and broadcasts `device:online|offline`,
* rate-limits to 240 frames / 10 s per socket and closes superseded device sockets with code 4409.

```bash
cd signaling && npm ci && npm test        # 18 tests
PORT=8090 SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DEVICE_JWT_SECRET=… npm run dev
```

Expose it at `wss://signal.example.com/ws` behind TLS; `GET /health` returns
`{status, service, devicesOnline, connections, time}`.

## 8. Security model in one page

* **No `service_role` outside the functions.** The dashboard ships the anon key, Android ships the
  anon key, and both are useless without an RLS-valid JWT.
* **Every table has RLS enabled** and at least one policy; the 21 assertions in
  `supabase/tests/rls_test.sql` include negative cases (another owner sees zero rows, a device
  cannot read another device's session, `transfer_items` are only writable through their parent).
* **Device secrets are hashed** (`device_credentials.secret_hash`, `service_role`-only table).
  They are returned exactly once, at enrolment.
* **Device tokens are HS256**, short-lived, bound to a `device_sessions` row, and revocable from the
  dashboard (`sessionsOnly`) or by revoking the device.
* **Signed URLs** expire (default 300 s) and are minted only after a server-side ownership check.
* **CORS** is restricted by `APP_ORIGINS`; every function answers `OPTIONS` explicitly.

## 9. Verifying the database without Docker

The migrations are written to run on plain PostgreSQL 16 (no `contrib` needed — only built-in
`gen_random_uuid()`):

```bash
createdb droidlinkx
psql -v ON_ERROR_STOP=1 -f supabase/tests/local_stub.sql      # auth/storage stubs
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql        # prints RLS TESTS PASSED
```

Edge Functions are typechecked without Deno:

```bash
cd supabase/functions && ./typecheck.sh     # plain tsc + deno shim, 0 errors
```

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401` from a function | token expired, or `verify_jwt` mismatch | refresh the session; check `config.toml` |
| `403 FORBIDDEN` | JWT valid but the row belongs to another owner | do not trust client-side ids |
| `409 checksum_mismatch` | part uploaded out of order or truncated | re-send the part (uploads are idempotent) |
| Storage `403` on PUT | path does not start with the caller's uid | upload under `‹auth.uid()›/…` |
| Realtime silent | table not in the publication, or RLS hides the row | re-run `20261106090300_realtime.sql` |
| Signalling `404` | `DEVICE_JWT_SECRET` differs between functions and relay | set the same secret in both |
