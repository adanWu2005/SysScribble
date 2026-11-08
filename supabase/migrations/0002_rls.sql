-- 0002_rls.sql — Row Level Security. Defence in depth behind the explicit
-- requireRoomRole() checks in the API layer (PRD §5.2, §5.3).

alter table public.profiles     enable row level security;
alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;
alter table public.room_assets  enable row level security;

-- Helper functions are SECURITY DEFINER so policies on room_members can consult
-- room_members without recursing into their own RLS.
create or replace function public.room_role_of(p_room_id uuid)
returns public.room_role
language sql stable security definer
set search_path = public
as $$
  select role from public.room_members
  where room_id = p_room_id and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

-- Supabase default privileges grant EXECUTE to anon directly, so revoking from
-- PUBLIC alone is not enough.
revoke all on function public.room_role_of(uuid)   from public, anon;
revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.room_role_of(uuid)   to authenticated, service_role;
grant execute on function public.is_room_member(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles: you may read your own profile and those of people you share a room with.
-- A blanket `using (true)` would let any account enumerate every user's email.
-- only the owner of a profile may update it.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.room_members mine
      join public.room_members theirs on theirs.room_id = mine.room_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member on public.rooms
  for select to authenticated using (public.is_room_member(id));

-- Direct inserts are allowed only for yourself; the app uses create_room_with_owner().
drop policy if exists rooms_insert_self on public.rooms;
create policy rooms_insert_self on public.rooms
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists rooms_update_owner on public.rooms;
create policy rooms_update_owner on public.rooms
  for update to authenticated
  using (public.room_role_of(id) = 'OWNER')
  with check (owner_id = auth.uid());

drop policy if exists rooms_delete_owner on public.rooms;
create policy rooms_delete_owner on public.rooms
  for delete to authenticated using (public.room_role_of(id) = 'OWNER');

-- ---------------------------------------------------------------------------
-- room_members
-- ---------------------------------------------------------------------------
drop policy if exists room_members_select_member on public.room_members;
create policy room_members_select_member on public.room_members
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists room_members_insert_owner on public.room_members;
create policy room_members_insert_owner on public.room_members
  for insert to authenticated
  with check (public.room_role_of(room_id) = 'OWNER' and role <> 'OWNER');

-- Owner may change anyone's role except their own, and may never grant OWNER.
drop policy if exists room_members_update_owner on public.room_members;
create policy room_members_update_owner on public.room_members
  for update to authenticated
  using (public.room_role_of(room_id) = 'OWNER' and user_id <> auth.uid())
  -- Re-check the NEW row: without this an owner of room A could rewrite room_id/user_id
  -- and plant themselves in room B.
  with check (
    public.room_role_of(room_id) = 'OWNER'
    and user_id <> auth.uid()
    and role <> 'OWNER'
  );

-- Owner may remove non-owners; anyone may leave unless they are the owner.
drop policy if exists room_members_delete on public.room_members;
create policy room_members_delete on public.room_members
  for delete to authenticated
  using (
    (public.room_role_of(room_id) = 'OWNER' and role <> 'OWNER')
    or (user_id = auth.uid() and role <> 'OWNER')
  );

-- ---------------------------------------------------------------------------
-- room_invites: owner-only in every direction. Acceptance goes through accept_invite().
-- ---------------------------------------------------------------------------
drop policy if exists room_invites_owner_all on public.room_invites;
create policy room_invites_owner_all on public.room_invites
  for all to authenticated
  using (public.room_role_of(room_id) = 'OWNER')
  with check (public.room_role_of(room_id) = 'OWNER' and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- room_assets
-- ---------------------------------------------------------------------------
drop policy if exists room_assets_select_member on public.room_assets;
create policy room_assets_select_member on public.room_assets
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists room_assets_insert_editor on public.room_assets;
create policy room_assets_insert_editor on public.room_assets
  for insert to authenticated
  with check (
    public.room_role_of(room_id) in ('OWNER', 'EDITOR')
    and uploaded_by = auth.uid()
    and r2_object_key like 'rooms/' || room_id::text || '/%'
  );

drop policy if exists room_assets_delete on public.room_assets;
create policy room_assets_delete on public.room_assets
  for delete to authenticated
  using (
    public.room_role_of(room_id) = 'OWNER'
    or (public.room_role_of(room_id) = 'EDITOR' and uploaded_by = auth.uid())
  );
