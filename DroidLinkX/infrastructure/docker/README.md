# Docker deployment

`docker-compose.yml` in this directory runs the whole stack: PostgreSQL 16, Redis 7, the Node
backend, the nginx-served dashboard and coturn.

```bash
cp infrastructure/docker/.env.example infrastructure/docker/.env
# edit .env: set POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET, TURN_SECRET, PUBLIC_BASE_URL
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/docker-compose.yml up -d --build
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/docker-compose.yml ps
```

* The backend image lives in `backend/Dockerfile` and runs `node dist/index.js` as a non-root user.
* The dashboard image lives in `dashboard/Dockerfile` (multi-stage Vite build -> nginx, `/api` and `/ws` proxied).
* `../database/001_schema.sql` is mounted into `docker-entrypoint-initdb.d`, so a fresh volume is
  initialised automatically; the backend also applies the same migration on boot (`src/database/migrate.ts`).
* PostgreSQL and Redis are not published on the host. The backend binds to `127.0.0.1:8080` only;
  terminate TLS in front of it (nginx, Caddy or a cloud load balancer).
* coturn runs with `network_mode: host` because TURN needs the real public interface and a UDP port
  range. Set `TURN_EXTERNAL_IP` correctly or relayed candidates will be wrong.
