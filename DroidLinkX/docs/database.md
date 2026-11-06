# Database

> **The production database is Supabase Postgres.** Its schema is defined by
> `supabase/migrations/*.sql` (5 files) and documented in [`docs/supabase.md`](supabase.md).
> The tables listed below belong to the optional self-hosted BFF and are *not* created in, or used by,
> the Supabase project — there is no second schema and no duplicated auth.


PostgreSQL 16. Schema: `backend/src/database/migrations/001_init.sql`, mirrored at
`infrastructure/database/001_schema.sql` (mounted into the Postgres container for first boot).
The backend also applies migrations on startup (`npm run migrate`) and is idempotent.

## Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | Owner accounts | `id`, `email`, `email_lower` (unique), `password_hash` (scrypt), `display_name`, `settings jsonb`, `status`, `last_login_at` |
| `refresh_tokens` | Rotating refresh families | `id`, `user_id`, `token_hash`, `family_id`, `user_agent`, `ip`, `expires_at`, `revoked_at`, `replaced_by` |
| `devices` | Enrolled Android devices | `id`, `user_id`, `name`, `manufacturer`, `model`, `android_version`, `sdk_int`, `app_version`, `trusted`, `online`, `last_seen_at`, `telemetry jsonb`, `status` |
| `device_credentials` | Per-device secret | `device_id` (unique), `secret_hash`, `rotated_at`, `revoked_at` |
| `device_sessions` | Device-scoped tokens | `id`, `device_id`, `user_id`, `ip`, `user_agent`, `created_at`, `last_heartbeat_at`, `expires_at`, `revoked_at` |
| `device_permissions` | Capability grants | `device_id`, `permission`, `granted`, `updated_at` (PK `device_id, permission`) |
| `connection_sessions` | Signalling sessions | `id`, `user_id`, `source_device_id`, `target_device_id`, `type`, `status`, `requested_by`, `created_at`, `expires_at`, `ended_at`, `ended_reason` |
| `file_transfers` | Transfer sessions | `id`, `user_id`, `source_device_id`, `target_device_id`, `direction`, `mode` (`direct`/`relay`), `status`, `total_bytes`, `transferred_bytes`, `item_count`, `completed_items`, `error`, timestamps |
| `transfer_items` | Files inside a transfer | `id`, `transfer_id`, `item_index`, `name`, `relative_path`, `size`, `sha256`, `status`, `bytes_received`, `received_chunks` (count), `checksum_verified`, `storage_key`, `file_id` |
| `transfer_chunks` | Received chunk ledger (idempotency) | `id`, `transfer_id`, `item_index`, `chunk_index`, `size`, `sha256`, `received_at`, unique `(transfer_id, item_index, chunk_index)` |
| `transfer_history` | Transfer event log | `id`, `transfer_id`, `user_id`, `item_index`, `event`, `bytes`, `detail jsonb`, `created_at` |
| `files` | Stored blobs/metadata | `id`, `user_id`, `device_id`, `name`, `path`, `mime_type`, `size`, `checksum`, `storage_path`, `deleted_at` |
| `notification_records` | Mirrored notifications | `id`, `user_id`, `device_id`, `package_name`, `app_name`, `title`, `content`, `category`, `is_sensitive`, `posted_at`, `created_at` |
| `clipboard_records` | Manual clipboard sync history | `id`, `user_id`, `device_id`, `direction`, `content_type`, `content`, `is_sensitive`, `created_at`, `expires_at` (24 h) |
| `activity_logs` | Audit trail | `id`, `user_id`, `device_id`, `actor_type`, `actor_id`, `action`, `detail jsonb`, `ip`, `user_agent`, `created_at` |
| `connection_events` | Per-connection timeline | `id`, `connection_id`, `device_id`, `event`, `detail jsonb`, `created_at` |

Indexes cover `devices(user_id, status)`, `activity_logs(user_id, created_at DESC)`,
`connection_events(connection_id, created_at)`, `transfer_chunks(transfer_id, item_index, chunk_index)`, `transfer_items(transfer_id, item_index)` and the
`refresh_tokens(token_hash)` lookup.

## Relationships

```
users 1─n devices 1─1 device_credentials
              │ 1─n device_sessions
              │ 1─n device_permissions
              │ 1─n connection_sessions ─n connection_events
users 1─n refresh_tokens
users 1─n file_transfers ─n transfer_items ─n transfer_chunks
users 1─n files
users 1─n notification_records
users 1─n activity_logs
```

## Redis keys

| Key | Use |
| --- | --- |
| `presence:<deviceId>` | Presence payload with TTL (refreshed by heartbeat) |
| `revoked:token:<jti>` | Access-token revocation list (TTL = token lifetime) |
| `ratelimit:<name>:<subject>` | Sliding-window rate-limit counters |
| `clipboard:latest:<userId>` | Last clipboard entry for quick fetch |
| `download:<fileId>:<nonce>` | Short-lived signed download authorisation |

## Operations

```bash
# migrate (idempotent)
cd backend && npm run migrate

# backup
pg_dump --format=custom --file=droidlinkx-$(date +%F).dump "$DATABASE_URL"
# restore
pg_restore --clean --if-exists --dbname "$DATABASE_URL" droidlinkx-$(date +%F).dump
```

Uploaded files live under `STORAGE_DIR` (default `backend/storage`, `/app/storage` in Docker) and are
**not** covered by `pg_dump`; back up the volume together with the database so `files.storage_path`
stays meaningful. Chunk bytes and blobs are stored outside the database by design.
