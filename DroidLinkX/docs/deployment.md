# Deployment

## 1. Single-host Docker Compose (recommended to start)

```bash
git clone <your-fork> droidlinkx && cd droidlinkx
cp infrastructure/docker/.env.example infrastructure/docker/.env
$EDITOR infrastructure/docker/.env      # secrets + public hostnames
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/docker-compose.yml up -d --build
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/docker-compose.yml ps
curl -fsS http://127.0.0.1:8080/api/health
```

Services: `postgres` (not published), `redis` (not published), `backend` (`127.0.0.1:8080`),
`dashboard` (`:8081`, nginx + static build, proxies `/api` and `/ws`), `coturn` (host network, 3478 UDP/TCP).

The backend container runs as UID 10001, drops to `NODE_ENV=production`, runs the compiled `dist/`, applies
pending migrations on boot and stores uploads in the `backend-storage` volume.

## 2. TLS termination

Put nginx/Caddy/the cloud load balancer in front of the dashboard container; the backend must be reachable
only through it:

```nginx
server {
    listen 443 ssl http2;
    server_name cloud.example.com;
    ssl_certificate     /etc/letsencrypt/live/cloud.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cloud.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    client_max_body_size 16m;      # chunk uploads are 8 MiB; file API uploads honour MAX_UPLOAD_BYTES

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location /ws {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}

server {
    listen 80;
    server_name cloud.example.com;
    return 301 https://$host$request_uri;
}
```

Set `PUBLIC_BASE_URL=https://cloud.example.com`, `CORS_ORIGINS=https://cloud.example.com` and
`TRUST_PROXY=true` in the backend environment so signed URLs and client IPs are correct.

## 3. TURN

```bash
docker compose ... logs coturn
```

* `TURN_URLS` (backend) and coturn must agree: e.g. `turn:turn.example.com:3478?transport=udp`,
  `turn:turn.example.com:3478?transport=tcp`.
* `TURN_SECRET` must be identical to coturn's `--static-auth-secret` (compose passes it).
* Set `TURN_EXTERNAL_IP` to the host's public address; otherwise relayed candidates advertise a private IP.
* Open `3478/udp`, `3478/tcp` and `5349/tcp` (TLS) in the firewall. For TURN over TLS, terminate with a
  certificate on coturn or a TCP proxy.
* `turnserver.conf` denies private peer ranges on purpose — do not remove those lines.

## 4. Operations

```bash
# logs
docker compose ... logs -f backend
# restart after config change
docker compose ... up -d backend
# backups (nightly cron)
pg_dump --format=custom -f /backups/db-$(date +%F).dump "$DATABASE_URL"
docker run --rm -v droidlinkx_backend-storage:/data -v /backups:/backup alpine \
  tar czf /backup/storage-$(date +%F).tgz -C /data .
```

Health checks: `/api/health` (DB + cache), the container `HEALTHCHECK` and the dashboard `/`.

### Scaling notes

* Backend instances are stateless except for the storage volume; share PostgreSQL, Redis and a network
  filesystem (or S3-compatible storage adapter) before scaling horizontally.
* WebSocket fan-out is in-process. For multiple instances, put a Redis pub/sub bridge in front of
  `realtime/hub.ts` (the emit interface is already centralised) or use sticky sessions with a single node.
* Transfer chunks are appended to per-item files; concurrent uploads of the same item are serialised by
  the chunk ledger (`transfer_chunks` unique constraint), so the design is safe across instances.

## 5. Without Docker

```bash
# backend
cd backend && npm ci && npm run build && NODE_ENV=production node dist/index.js
# systemd unit (sketch)
[Service]
WorkingDirectory=/srv/droidlinkx/backend
EnvironmentFile=/srv/droidlinkx/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
User=droidlinkx
```

Serve `dashboard/dist` with any static server that proxies `/api` and `/ws` to the backend.

## 6. Release checklist

1. `cd backend && npx vitest run` — all suites green.
2. `cd dashboard && npm run build` — zero TypeScript errors.
3. `cd android && ./gradlew :app:assembleRelease` (signed APK; requires JDK 17 + SDK 36).
4. Rotate/verify secrets, confirm TLS + WSS, verify TURN with `turnutils_uclient` or the dashboard's
   Mirroring diagnostics panel.
5. Enroll a test device, verify presence, a mirroring session, a resumable transfer and a revocation.
6. Back up the database and storage volume.

---

## 6. Supabase deployment (current architecture)

1. **Database**: `supabase db push` applies the 5 migrations. Verify with the SQL recipe in
   `docs/supabase.md` (21 RLS assertions) before pointing clients at it.
2. **Secrets**: `DEVICE_JWT_SECRET`, `SIGNALING_URL`, `TURN_*`, `STUN_URLS`, `APP_ORIGINS`,
   `DOWNLOAD_URL_TTL_SECONDS`, `MAX_TRANSFER_BYTES`.
3. **Functions**: deploy all eight names — `enroll-device`, `revoke-device`, `create-session`,
   `authorize-connection`, `initiate-transfer`, `generate-secure-download`, `update-device-status`,
   `finalize-transfer`. `create-session` and `update-device-status` run with `verify_jwt = false`
   (they authenticate a device secret / device token in-code) — everything else requires a JWT.
4. **Storage**: both buckets are created by the migrations and are private. Never make them public:
   downloads go through `generate-secure-download` signed URLs (5-minute TTL by default).
5. **Signalling relay**: `docker compose -f infrastructure/docker/docker-compose.yml up -d signaling`
   (image built from `signaling/Dockerfile`). Terminate TLS in front of it and publish
   `wss://signal.example.com/ws`; set `SIGNALING_URL` to the same origin in function secrets.
6. **Dashboard**: static build with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_SIGNALING_URL`, `VITE_STUN_URLS`, `VITE_TURN_URLS`; nginx must upgrade `/ws` to the relay.
7. **Android**: build with Gradle properties `droidlinkx.supabase.url`,
   `droidlinkx.supabase.anonKey`, `droidlinkx.signaling.url` (or the matching environment variables).
   The anon key is public by design; the `service_role` key must never appear in an APK.

### Operational checks

```bash
curl -fsS https://signal.example.com/health          # {"status":"ok",...}
curl -fsS -H "apikey: $ANON" "$SUPABASE_URL/rest/v1/" -o /dev/null -w "%{http_code}\n"
supabase functions logs finalize-transfer --tail
```
