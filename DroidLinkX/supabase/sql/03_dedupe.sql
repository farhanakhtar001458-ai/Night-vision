-- Remove duplicate enrollment rows for the same phone, keeping the newest one per model.
-- Only rows that never reported telemetry are touched, so a genuinely used second phone
-- (which has a last_seen_at) is never deleted.
delete from public.devices d
 using (
   select id,
          row_number() over (
            partition by owner_id, coalesce(model, name)
            order by created_at desc
          ) as rn
     from public.devices
    where last_seen_at is null
 ) k
 where d.id = k.id
   and k.rn > 1;
