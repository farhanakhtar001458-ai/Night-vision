# Security model

DroidLink X is a single-owner system: one account controls the devices it enrolled. There is no device
sharing, no "friend" access and no implicit trust between accounts. The threat model covers a stolen
phone, a stolen refresh token, a malicious network peer, an exposed server and a rogue dashboard user.

## Identity and credentials

| Secret | Where it lives | Protection |
| --- | --- | --- |
| Owner password | server only | scrypt hash with per-user salt; never logged, never returned |
| Owner access token | client memory / `localStorage` (dashboard) | JWT, 15 min TTL, `jti` revocable server-side |
| Owner refresh token | client storage | opaque 256-bit value, only its SHA-256 hash is stored, rotated on every use |
| Device secret | Android Keystore-encrypted vault | scrypt hash server-side, returned **once** at enrollment |
| Device token | Android Keystore-encrypted vault | JWT bound to `device_sessions.id`, revocable per device |
| TURN credential | per connection, in memory | HMAC of `username = expiry:connectionId` with the TURN shared secret |
| Download authorisation | URL token | short-lived signed token, bound to the file and account |

Android never persists a secret in plain text: `EncryptedCredentialVault` writes AES-256-GCM ciphertext
(AndroidKeyStore, `droidlinkx.vault.v1`) into a private SharedPreferences file that is excluded from
backup and device transfer. Room and DataStore hold only catalogue/settings data.

## Session and token handling

* Refresh tokens are grouped in **families**. Presenting an already-rotated token revokes the whole family
  (reuse detection) and forces a fresh sign-in.
* Access-token revocation writes `revoked:token:<jti>` to Redis with a TTL equal to the token lifetime, so
  logout/revocation takes effect immediately.
* Device sessions are explicit rows: revoking a device (`DELETE /api/devices/:id`), rotating its secret or
  hitting `POST /:id/revoke-sessions` invalidates the tokens bound to those rows.
* Passwords are never used for device authentication, and device tokens cannot call owner endpoints
  (`requireUser` vs `requireDevice` guards).

## Presence integrity

`online` is derived from two facts: a TTL'd Redis presence record *and* a live, authenticated WebSocket
for that device in the hub registry. A device that loses its socket is marked offline immediately and
broadcast as `device:offline`; the UI cannot show a device as online without a verified connection.

## Transport and API hardening

* HTTPS/WSS only in production (`network_security_config` forbids cleartext outside debug builds).
* `helmet` security headers, strict CORS allowlist (`CORS_ORIGINS`), JSON body limits, Zod validation on
  every payload, parameterised SQL only.
* Redis-backed rate limits per route family and subject; tighter windows on auth endpoints.
* Uniform error envelope with no stack traces in production (`pino` logs server-side, redacted).
* Uploads are size-limited (`MAX_UPLOAD_BYTES`) and served through signed, expiring URLs.

## Media and privacy invariants

* **Screen mirroring** requires a MediaProjection consent dialog per capture session and a foreground
  service notification for as long as capture runs.
* **Remote camera** requires an explicit in-app confirmation and shows a persistent indicator; there is no
  way to open the camera without a visible surface.
* **Notification mirroring** uses `NotificationListenerService`, filters packages the owner excluded and
  marks OTP/password-looking content as sensitive so it is not stored or displayed by default.
* **Clipboard sync is manual only**; a value marked sensitive is never relayed silently and is excluded
  unless the owner explicitly allows sensitive clipboard entries.
* **Remote interaction** (later phase) is accessibility-based and opt-in: the accessibility service must be
  enabled by the user in Android settings, every injection is visible on screen and logged. Hidden input
  injection, silent recording and security bypasses are out of scope by design.
* File access uses the Storage Access Framework: DroidLink X never bypasses scoped storage or requests
  `MANAGE_EXTERNAL_STORAGE`.

## Server hardening checklist

1. `JWT_SECRET` = 48 random bytes (`openssl rand -base64 48`); never reuse the dev secret.
2. `TURN_SECRET` shared only between backend and coturn; TURN credentials are minted per connection.
3. PostgreSQL/Redis bound to the Docker network, never published.
4. Backend behind TLS termination with HSTS; `TRUST_PROXY=true` only when a trusted proxy is in front.
5. Keep `denied-peer-ip` ranges in `turnserver.conf` so the relay cannot reach private networks.
6. Rotate `JWT_SECRET` during an incident — all access tokens die immediately; refresh tokens stay valid
   unless revoked, so also `revoke-all` sessions.
7. Back up the database **and** the storage volume; both contain private user data.
8. Review `activity_logs` for unexpected enrollments, permission changes or repeated auth failures.

## What this project deliberately does not do

* No keylogging, no hidden screen capture, no background camera/mic activation.
* No bypass of Android permission, Doze or scoped-storage rules.
* No third-party analytics or crash reporting that would exfiltrate device data.
* No plaintext secrets in logs: `DroidLog` redacts bearer tokens and `token` fields before writing.
