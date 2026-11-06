-- DroidLink X initial schema (PostgreSQL 16)
-- UUID primary keys, foreign keys, indexes, append-only audit tables.

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  email_lower     text GENERATED ALWAYS AS (lower(email)) STORED,
  password_hash   text NOT NULL,
  display_name    text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (email_lower);
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id, expires_at DESC);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  manufacturer     text,
  model            text,
  android_version  text,
  sdk_int          integer,
  app_version      text,
  platform         text NOT NULL DEFAULT 'android',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  trusted          boolean NOT NULL DEFAULT false,
  online           boolean NOT NULL DEFAULT false,
  last_seen_at     timestamptz,
  last_ip          text,
  telemetry        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoked_reason   text
);
CREATE INDEX devices_user_idx ON devices (user_id, created_at DESC);
CREATE INDEX devices_online_idx ON devices (online) WHERE status = 'active';

CREATE TABLE device_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  secret_hash   text NOT NULL,
  label         text NOT NULL DEFAULT 'primary',
  created_at    timestamptz NOT NULL DEFAULT now(),
  rotated_at    timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz
);
CREATE INDEX device_credentials_device_idx ON device_credentials (device_id);
CREATE UNIQUE INDEX device_credentials_active_idx ON device_credentials (device_id, label) WHERE revoked_at IS NULL;

CREATE TABLE device_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_jti         text NOT NULL,
  connection_id     text,
  ip                text,
  user_agent        text,
  state             text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked', 'expired')),
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz,
  ended_at          timestamptz,
  ended_reason      text
);
CREATE INDEX device_sessions_device_idx ON device_sessions (device_id, started_at DESC);
CREATE INDEX device_sessions_active_idx ON device_sessions (device_id) WHERE state = 'active';
CREATE UNIQUE INDEX device_sessions_jti_idx ON device_sessions (token_jti);

CREATE TABLE device_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  permission  text NOT NULL,
  granted     boolean NOT NULL DEFAULT false,
  granted_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, permission)
);

CREATE TABLE files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    uuid REFERENCES devices(id) ON DELETE SET NULL,
  name         text NOT NULL,
  path         text NOT NULL DEFAULT '/',
  size         bigint NOT NULL DEFAULT 0,
  mime         text,
  sha256       text,
  storage_key  text,
  category     text NOT NULL DEFAULT 'documents',
  direction    text NOT NULL DEFAULT 'upload' CHECK (direction IN ('upload', 'download')),
  expires_at   timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_user_idx ON files (user_id, created_at DESC);
CREATE INDEX files_device_idx ON files (device_id, category);

CREATE TABLE connection_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  -- NULL target means "owner terminal" (web dashboard) is the viewer end of the session.
  target_device_id   uuid REFERENCES devices(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('mirror', 'camera', 'file', 'control', 'clipboard')),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'rejected', 'active', 'ended', 'failed', 'expired')),
  requested_by       text NOT NULL CHECK (requested_by IN ('device', 'user')),
  accepted_at        timestamptz,
  ended_at           timestamptz,
  ended_reason       text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  CONSTRAINT connection_sessions_distinct_endpoints CHECK (target_device_id IS NULL OR target_device_id <> source_device_id)
);
CREATE INDEX connection_sessions_user_idx ON connection_sessions (user_id, created_at DESC);
CREATE INDEX connection_sessions_devices_idx ON connection_sessions (source_device_id, target_device_id, status);

CREATE TABLE file_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_device_id   uuid REFERENCES devices(id) ON DELETE SET NULL,
  target_device_id   uuid REFERENCES devices(id) ON DELETE SET NULL,
  direction          text NOT NULL CHECK (direction IN ('device_to_device', 'device_to_cloud', 'cloud_to_device', 'dashboard_to_device', 'device_to_dashboard')),
  mode               text NOT NULL DEFAULT 'relay' CHECK (mode IN ('direct', 'relay')),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'paused', 'completed', 'failed', 'cancelled')),
  total_bytes        bigint NOT NULL DEFAULT 0,
  transferred_bytes  bigint NOT NULL DEFAULT 0,
  item_count         integer NOT NULL DEFAULT 0,
  completed_items    integer NOT NULL DEFAULT 0,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz
);
CREATE INDEX file_transfers_user_idx ON file_transfers (user_id, created_at DESC);
CREATE INDEX file_transfers_status_idx ON file_transfers (status);

CREATE TABLE transfer_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id    uuid NOT NULL REFERENCES file_transfers(id) ON DELETE CASCADE,
  item_index     integer NOT NULL,
  name           text NOT NULL,
  relative_path  text NOT NULL DEFAULT '/',
  size           bigint NOT NULL DEFAULT 0,
  sha256         text,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'uploading', 'verifying', 'completed', 'failed', 'skipped')),
  bytes_received bigint NOT NULL DEFAULT 0,
  received_chunks integer NOT NULL DEFAULT 0,
  checksum_verified boolean NOT NULL DEFAULT false,
  storage_key    text,
  file_id        uuid REFERENCES files(id) ON DELETE SET NULL,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  UNIQUE (transfer_id, item_index)
);

CREATE TABLE transfer_chunks (
  id           bigserial PRIMARY KEY,
  transfer_id  uuid NOT NULL REFERENCES file_transfers(id) ON DELETE CASCADE,
  item_index   integer NOT NULL,
  chunk_index  integer NOT NULL,
  size         integer NOT NULL,
  sha256       text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, item_index, chunk_index)
);
CREATE INDEX transfer_chunks_transfer_idx ON transfer_chunks (transfer_id, item_index, chunk_index);

CREATE TABLE transfer_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES file_transfers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_index  integer,
  event       text NOT NULL,
  bytes       bigint NOT NULL DEFAULT 0,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transfer_history_transfer_idx ON transfer_history (transfer_id, created_at);
CREATE INDEX transfer_history_user_idx ON transfer_history (user_id, created_at DESC);

CREATE TABLE notification_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  package_name  text NOT NULL,
  app_name      text NOT NULL,
  title         text,
  content       text,
  category      text,
  is_sensitive  boolean NOT NULL DEFAULT false,
  posted_at     timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_records_device_idx ON notification_records (device_id, posted_at DESC);
CREATE INDEX notification_records_user_idx ON notification_records (user_id, posted_at DESC);

CREATE TABLE clipboard_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    uuid REFERENCES devices(id) ON DELETE SET NULL,
  direction    text NOT NULL CHECK (direction IN ('device_to_cloud', 'cloud_to_device')),
  content_type text NOT NULL DEFAULT 'text/plain',
  content      text NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX clipboard_records_user_idx ON clipboard_records (user_id, created_at DESC);

CREATE TABLE activity_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  device_id   uuid REFERENCES devices(id) ON DELETE SET NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('user', 'device', 'system')),
  action      text NOT NULL,
  target_type text,
  target_id   text,
  ip          text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_logs_user_idx ON activity_logs (user_id, created_at DESC);
CREATE INDEX activity_logs_device_idx ON activity_logs (device_id, created_at DESC);

CREATE TABLE connection_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  connection_id text,
  event         text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connection_events_device_idx ON connection_events (device_id, created_at DESC);
CREATE INDEX connection_events_user_idx ON connection_events (user_id, created_at DESC);
