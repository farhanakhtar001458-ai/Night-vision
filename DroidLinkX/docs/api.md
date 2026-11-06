# API

## Supabase surface (primary)

The app no longer treats a bespoke REST server as the backend. Clients use:

| Surface | Base | Auth | Used for |
| --- | --- | --- | --- |
| GoTrue | `/auth/v1` | anon key (+ `Authorization` once signed in) | signup, password grant, refresh, logout, `GET /user` |
| PostgREST | `/rest/v1` | anon key + owner JWT | devices, permissions, connection sessions/events, files, transfers, transfer items, profiles |
| Storage | `/storage/v1` | anon key + owner JWT | chunk parts and browser uploads (`x-upsert: true`) |
| Functions | `/functions/v1` | anon key + owner JWT (or device secret/token) | the 8 privileged operations |
| Realtime | `wss://…/realtime/v1` | owner JWT | `postgres_changes` + broadcast |

The complete contract table (request/response bodies per function) lives in
[`docs/supabase.md`](supabase.md#4-edge-function-contracts).

Two PostgREST details matter:

* every table is filtered by RLS, so clients never send `owner_id` filters for security — only for UI;
* writes that must return the row send `Prefer: return=representation` (the dashboard and the Android
  client both do this).

# Legacy REST API (optional self-hosted BFF)

Base URL `https://<host>/api`. This server is optional: it exists for LAN/offline deployments and is no
longer the path used by the shipped dashboard or Android app. All responses are JSON. Errors use
`{ "error": { "code": "…", "message": "…", "details": … } }` with codes such as `BAD_REQUEST`,
`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `CONFLICT`, `INTERNAL`.

Auth headers:
* owner requests — `Authorization: Bearer <user access token>`
* device requests — `Authorization: Bearer <device token>` (only on device-agent endpoints)

`GET /health` (no version prefix) and `GET /api/health` are unauthenticated liveness checks.

## Auth (`/api/auth`)

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| POST | `/register` | `{email, password, displayName}` | 201, `{user, tokens}`. Password ≥ 10 chars with letter + number. Rate limited 10/h. |
| POST | `/login` | `{email, password}` | 200, `{user, tokens}`; 401 on bad credentials. Rate limited 20/15 min. |
| POST | `/refresh` | `{refreshToken}` | Rotates the refresh family; reuse revokes the family. |
| POST | `/logout` | `{refreshToken?}` | 204. Revokes the presented refresh token and the access `jti`. |
| GET | `/me` | — | `{user, counts:{devices, online}}`. |
| PATCH | `/me` | `{displayName?, settings?}` | `{user}`. |
| POST | `/password` | `{currentPassword, newPassword}` | 204; other sessions keep working until revoked. |

`tokens` = `{accessToken, expiresIn, refreshToken, refreshExpiresIn, tokenType:"Bearer"}`.

## Devices (`/api/devices`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/enroll` | owner | Enroll the calling installation. `{name?, manufacturer, model, androidVersion, sdkInt, appVersion}` → `{device, deviceSecret}` (secret shown once). |
| POST | `/token` | none (secret) | `{deviceId, deviceSecret}` → `{accessToken, expiresIn, sessionId, wsUrl, device}`. |
| GET | `/` | owner | `{devices:[…]}` with verified presence + latest telemetry. |
| GET | `/:id` | owner | `{device}`. |
| PATCH | `/:id` | owner | `{name?, trusted?}`. |
| DELETE | `/:id` | owner | Revokes credential + sessions and removes the device. |
| GET | `/:id/history` | owner | `{events:[…]}` connection/presence history. |
| GET | `/:id/permissions` | owner | `{permissions:{…}}`. |
| PUT | `/:id/permissions/:permission` | owner | `{granted:boolean}` → `{permissions}`. |
| POST | `/:id/status` | device | `{telemetry:{battery, charging, network, ip, storage…}}`; updates presence payload. |
| POST | `/:id/rotate-secret` | owner | Issues a new device secret (invalidates the old one). |
| POST | `/:id/revoke-sessions` | owner | Terminates every device session; the device must re-authenticate. |

## Sessions (`/api/sessions`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Browser sessions (refresh-token families) with UA/IP/created/last-used. |
| POST | `/revoke` | `{sessionId}` — revoke one browser session. |
| POST | `/revoke-all` | Revoke every session except the current one (or all with `{includeCurrent:true}`). |

## Connections & signalling

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| POST | `/api/connections/create` | `{sourceDeviceId, targetDeviceId?, type}` (`mirror\|camera\|file\|control\|clipboard`) | 201 `{connection}`; pushes `connection:request` to the target device. |
| GET | `/api/connections/status` | `?deviceId=` | `{connections, config:{turnConfigured, stunUrls, turnUrls}}`. |
| POST | `/api/connections/accept` | `{connectionId}` | `{connection}`; both peers get `connection:accepted`. |
| POST | `/api/connections/terminate` | `{connectionId, reason?}` | Ends the session, audits, notifies both peers. |
| GET | `/api/connections/ice` | `?connectionId=` | `{iceServers, ttl}` — STUN plus per-connection TURN credentials. |
| GET | `/api/signaling/config` | — | `{turnConfigured, stunUrls, turnUrls}`. |
| GET | `/api/signaling/turn` | — | `{urls, username, credential, ttl}`. |

## Files (`/api/files`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | List stored files (`?deviceId=`, `?path=`). |
| POST | `/upload` | Multipart or raw upload with size limit `MAX_UPLOAD_BYTES`. |
| GET | `/download/:id` | Signed short-lived download token in the returned URL; a different account's bearer is rejected. |
| GET | `/:id` | File metadata. |
| PATCH | `/:id` | Rename/move metadata. |
| DELETE | `/:id` | Delete the stored blob and record. |

## Transfers (`/api/transfers`)

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| POST | `/` | `{items:[{name, size, mimeType, relativePath?}], direction, kind?}` | `{transfer:{id, chunkSize, items:[…]}}`. |
| GET | `/` | — | Active sessions. |
| GET | `/history` | — | Completed/failed sessions. |
| GET | `/:id` | — | `{transfer:{…, receivedChunkIndexes}}` for resume. |
| PUT | `/:id/items/:index/chunks/:chunkIndex` | raw `application/octet-stream` | 201; duplicate → 200 `{duplicate:true}`. |
| POST | `/:id/items/:index/complete` | header `X-Content-Sha256` (optional) | Verifies checksum; mismatch → 409 and item `failed`. |
| POST | `/:id/pause` `/resume` `/cancel` `/retry` | — | Session state transitions, broadcast as `transfer:progress`. |

## Notifications & clipboard

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/notifications/sync` | device | Push a batch `{notifications:[{packageName, appName, title, text, postedAt, sensitive?}]}`; sensitive fields are filtered server-side. |
| GET | `/api/notifications/` | owner | `{notifications:[…]}` (`?deviceId=`, `?limit=`). |
| DELETE | `/api/notifications/` | owner | Clear stored notifications. |
| POST | `/api/clipboard/sync` | device | Push a clipboard entry `{content, mimeType?, sensitive?}`; sensitive entries are only stored when the owner opted in. |
| GET | `/api/clipboard/` | owner | `{entries:[…]}`. |
| GET | `/api/clipboard/latest` | owner | `{entry}` or 404. |
| POST | `/api/clipboard/push` | owner | `{content, mimeType?}` → delivered to the device socket as `clipboard:update`. |

## Activity (`/api/activity`)

`GET /api/activity?limit=&offset=&action=` → `{entries:[{id, actorType, actorId, action, detail, ip, createdAt}], total}`.
Audited actions include sign-in/out, device enroll/revoke, permission changes, connection start/end,
transfer completion and clipboard pushes.

## Rate limiting

Redis-backed sliding windows keyed by route family and `ip`/`userId`/`deviceId`. Exceeding the limit
answers `429` with `Retry-After`. Auth routes are the tightest (register 10/h, login 20/15 min,
refresh 120/15 min, password change 10/h).
