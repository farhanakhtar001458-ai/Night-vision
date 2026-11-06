# Installation and local development

## Prerequisites

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | ≥ 22 (20.11 minimum) | backend + dashboard |
| npm | ≥ 10 | dependency install |
| PostgreSQL | 16 (14+ works) | database |
| Redis | 7 | presence, revocation, rate limits (optional in development: falls back to in-memory cache) |
| JDK | 17 | Gradle/Android builds |
| Android Studio | Ladybug or newer | Android app, SDK 36 platform + build-tools |
| Docker + Compose v2 | latest | full-stack deployment / TURN |

## Backend

```bash
cd backend
cp .env.example .env            # set DATABASE_URL, JWT_SECRET, CORS_ORIGINS
npm install
npm run migrate
npm run dev                     # http://0.0.0.0:8080
```

Minimal `.env`:

```
NODE_ENV=development
PORT=8080
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/droidlinkx
CORS_ORIGINS=http://localhost:5173
JWT_SECRET=dev-only-change-me-48-bytes
```

`npm run migrate` is idempotent. Without Redis, set `REDIS_URL=` empty and the cache layer keeps state in
process memory (fine for one instance, not for production).

Check it:

```bash
curl -fsS http://127.0.0.1:8080/api/health
# {"status":"ok", ...}
```

### Create the first owner

Either use the dashboard's **Create account** page, or:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"Str0ngPassword!","displayName":"Owner"}'
```

## Dashboard

```bash
cd dashboard
npm install
npm run dev        # http://0.0.0.0:5173, proxies /api and /ws to 127.0.0.1:8080
npm run build      # production bundle in dist/
```

The proxy targets can be changed in `vite.config.ts` (`server.proxy`). In production the nginx config in
`dashboard/nginx.conf` performs the same proxying.

## Android

1. Install JDK 17 and Android Studio with SDK 36 / build-tools 36.
2. `File → Open…` → `DroidLinkX/android`.
3. Let Gradle sync (wrapper 8.14.3 downloads automatically).
4. Debug builds default to `http://10.0.2.2:8080/` (emulator → host loopback). On a physical device set
   your LAN URL in **Settings → Server configuration**; cleartext is permitted only in debug builds.
5. Run the `app` configuration.

```bash
cd android
./gradlew :app:assembleDebug          # requires JDK 17 + Android SDK
./gradlew test                        # JVM unit tests
```

### Emulator networking

| Target | URL |
| --- | --- |
| Emulator → host machine | `http://10.0.2.2:8080/` |
| Physical device → host | `http://<host-LAN-IP>:8080/` (same Wi-Fi) |
| Public deployment | `https://cloud.example.com/` |

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Invalid backend configuration` on boot | Missing `DATABASE_URL` or production `JWT_SECRET`. |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL not running / wrong port in `DATABASE_URL`. |
| Dashboard login 401 with correct password | Wrong `CORS_ORIGINS`, or a different database than the one seeded. |
| Dashboard loads but no live updates | `/ws` proxy missing; check `vite.config.ts` or nginx `location /ws`. |
| Android "Authorization failed" | Device was revoked or its secret rotated; sign in again / re-enroll. |
| Android "No internet connection" despite Wi-Fi | Captive portal or a network without `NET_CAPABILITY_VALIDATED`; the link retries with backoff. |
| TURN sessions fall back to relay and fail | `TURN_SECRET` mismatch between backend and coturn, or `TURN_EXTERNAL_IP` unset. |
| `429` on login | Rate limit is per IP; wait for the window or raise it for development. |
