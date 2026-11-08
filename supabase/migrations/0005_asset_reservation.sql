-- 0005_asset_reservation.sql — atomic quota check for uploads (PRD §5.6).
-- A plain "sum, then sign" lets concurrent requests each see free space and together
-- overrun the quota. The advisory lock serialises reservations per room, and the row is
-- inserted before the URL is issued, so an unfinished upload still counts.

create or replace function public.reserve_room_asset(
  p_id          uuid,
  p_room_id     uuid,
  p_uploaded_by uuid,
  p_key         text,
  p_mime        text,
  p_size        bigint,
  p_quota       bigint
)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  select coalesce(sum(size_bytes), 0) into v_used
  from public.room_assets
  where room_id = p_room_id;

  if v_used + p_size > p_quota then
    return false;
  end if;

  insert into public.room_assets (id, room_id, uploaded_by, r2_object_key, mime_type, size_bytes)
  values (p_id, p_room_id, p_uploaded_by, p_key, p_mime, p_size);
  return true;
end;
$$;

revoke all on function public.reserve_room_asset(uuid, uuid, uuid, text, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_room_asset(uuid, uuid, uuid, text, text, bigint, bigint)
  to service_role;
