# Device enrollment SQL (applied 2026-11-08)

These statements are **already applied** to project `zarxnrkzdwnjiauybghl`. They are kept
here so a fresh project can be brought to the same state in three small steps (each one is
safe to re-run):

1. `01_installation_id.sql` — adds `devices.installation_id` + the per-owner unique index,
   so one install can never enrol twice.
2. `02_insert_policy.sql` — adds the `devices_insert_own` RLS policy (owner may insert their
   own row).
3. `03_dedupe.sql` — removes duplicate rows for the same phone, keeping the newest and never
   touching a row that has reported telemetry / a `last_seen_at`.

The canonical, idempotent version of the same work lives in
`supabase/migrations/20261108090000_device_enrollment.sql`.
