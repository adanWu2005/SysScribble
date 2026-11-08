-- 0006_snapshot_history.sql — recent versions of a room, for the History drawer.
--
-- `rooms.yjs_snapshot` keeps only the latest state. This table keeps a bounded trail of older
-- ones so an owner or editor can preview a version and restore it.
--
-- The limits below are what stops history from becoming a storage bill:
--   * at most one automatic entry per 5 minutes per room,
--   * at most 20 entries per room (the oldest are deleted),
--   * nothing over 2 MiB is kept (a normal room is a few KiB; images live in R2, not here).
-- Clients never touch this table. The API reads and writes it as service_role after checking
-- the caller's role, so RLS is deny-all and every privilege is revoked as defence in depth.

create table if not exists public.room_snapshots (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  version      int  not null,
  yjs_snapshot bytea not null,
  size_bytes   int  not null
               constraint room_snapshots_size_bounds check (size_bytes > 0 and size_bytes <= 2097152),
  -- Null for automatic entries. A fixed phrase such as 'Before restore' for checkpoints.
  label        text
               constraint room_snapshots_label_length check (label is null or char_length(label) between 1 and 80),
  created_at   timestamptz not null default now()
);

create index if not exists room_snapshots_room_created_idx
  on public.room_snapshots (room_id, created_at desc, id desc);

alter table public.room_snapshots enable row level security;
-- No policies on purpose: with RLS on and no policy, anon and authenticated see nothing.
-- Supabase default privileges grant them everything, so they are revoked explicitly too.
revoke all on public.room_snapshots from public, anon, authenticated;

-- Keeps the newest 20 entries for a room and deletes the rest.
create or replace function public.prune_room_snapshots(p_room_id uuid)
returns void
language sql security definer
set search_path = public
as $$
  delete from public.room_snapshots s
  where s.room_id = p_room_id
    and s.id not in (
      select k.id from public.room_snapshots k
      where k.room_id = p_room_id
      order by k.created_at desc, k.id desc
      limit 20
    );
$$;

revoke all on function public.prune_room_snapshots(uuid) from public, anon, authenticated;
grant execute on function public.prune_room_snapshots(uuid) to service_role;

-- Automatic history: runs in the same transaction as the snapshot write, so a saved state and
-- its history entry commit or fail together. SECURITY DEFINER because the writer may be a role
-- (an owner updating their own room through PostgREST) that has no privileges on this table.
create or replace function public.rooms_after_update_history()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.yjs_snapshot is null or new.yjs_snapshot is not distinct from old.yjs_snapshot then
    return new;
  end if;
  if octet_length(new.yjs_snapshot) > 2097152 then
    return new;
  end if;
  if exists (
    select 1 from public.room_snapshots s
    where s.room_id = new.id and s.created_at > now() - interval '5 minutes'
  ) then
    return new;
  end if;

  insert into public.room_snapshots (room_id, version, yjs_snapshot, size_bytes)
  values (new.id, new.version, new.yjs_snapshot, octet_length(new.yjs_snapshot));
  perform public.prune_room_snapshots(new.id);
  return new;
end;
$$;

revoke all on function public.rooms_after_update_history() from public, anon, authenticated;

drop trigger if exists rooms_history on public.rooms;
create trigger rooms_history
  after update of yjs_snapshot on public.rooms
  for each row execute function public.rooms_after_update_history();

-- A checkpoint: copies the room's current saved state into history right now, ignoring the
-- 5 minute spacing. The History drawer calls it before a restore, so the state being replaced
-- can be brought back. It copies what the database already holds, never bytes from a client.
-- Returns the entry's id, or null when there is nothing saved yet. Reuses the newest entry when
-- it is already identical. Raises 54000 when the saved state is too large to keep.
create or replace function public.record_room_checkpoint(p_room_id uuid, p_label text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_snapshot bytea;
  v_version  int;
  v_id       uuid;
begin
  select r.yjs_snapshot, r.version into v_snapshot, v_version
  from public.rooms r where r.id = p_room_id;

  if not found or v_snapshot is null then
    return null;
  end if;
  if octet_length(v_snapshot) > 2097152 then
    raise exception 'saved state is too large for history' using errcode = '54000';
  end if;

  select l.id into v_id
  from (
    select s.id, s.yjs_snapshot from public.room_snapshots s
    where s.room_id = p_room_id
    order by s.created_at desc, s.id desc
    limit 1
  ) l
  where l.yjs_snapshot = v_snapshot;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.room_snapshots (room_id, version, yjs_snapshot, size_bytes, label)
  values (p_room_id, v_version, v_snapshot, octet_length(v_snapshot), p_label)
  returning id into v_id;
  perform public.prune_room_snapshots(p_room_id);
  return v_id;
end;
$$;

revoke all on function public.record_room_checkpoint(uuid, text) from public, anon, authenticated;
grant execute on function public.record_room_checkpoint(uuid, text) to service_role;
