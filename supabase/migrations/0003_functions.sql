-- 0003_functions.sql — atomic RPCs. SECURITY DEFINER, callable by service_role only:
-- the API calls them after its own requireUser/requireRoomRole checks, and passes the
-- email from the verified JWT. Exposing them to `authenticated` would let a caller
-- supply any p_email and defeat the invite's email binding.

-- Creates the room and its OWNER membership in one transaction.
create or replace function public.create_room_with_owner(p_title text, p_owner_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_title   text;
begin
  if p_owner_id is null then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0001';
  end if;
  if auth.role() = 'authenticated' and p_owner_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  v_title := coalesce(nullif(btrim(p_title), ''), 'Untitled Workspace');
  if char_length(v_title) > 120 then
    raise exception 'TITLE_TOO_LONG' using errcode = '22001';
  end if;

  insert into public.rooms (owner_id, title)
  values (p_owner_id, v_title)
  returning id into v_room_id;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, p_owner_id, 'OWNER');

  return v_room_id;
end;
$$;

-- Single-use, time-boxed, email-bound acceptance. The UPDATE ... WHERE is the
-- atomic claim: two concurrent calls with the same token cannot both succeed.
create or replace function public.accept_invite(p_token_hash text, p_user_id uuid, p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite public.room_invites%rowtype;
begin
  if p_user_id is null or p_email is null then
    raise exception 'INVITE_INVALID' using errcode = 'P0001';
  end if;
  if auth.role() = 'authenticated' and p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.room_invites
     set accepted_at = now()
   where token_hash = p_token_hash
     and accepted_at is null
     and expires_at > now()
     and lower(email) = lower(p_email)
  returning * into v_invite;

  if not found then
    raise exception 'INVITE_INVALID' using errcode = 'P0001';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_invite.room_id, p_user_id, v_invite.role)
  on conflict (room_id, user_id) do update
    set role = excluded.role
    where public.room_members.role <> 'OWNER';

  return v_invite.room_id;
end;
$$;

-- Total bytes stored for a room; used before signing an upload URL (PRD §5.6).
create or replace function public.room_storage_bytes(p_room_id uuid)
returns bigint
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(size_bytes), 0)::bigint
  from public.room_assets
  where room_id = p_room_id;
$$;

revoke all on function public.create_room_with_owner(text, uuid) from public, anon, authenticated;
revoke all on function public.accept_invite(text, uuid, text)    from public, anon, authenticated;
revoke all on function public.room_storage_bytes(uuid)           from public, anon, authenticated;
grant execute on function public.create_room_with_owner(text, uuid) to service_role;
grant execute on function public.accept_invite(text, uuid, text)    to service_role;
grant execute on function public.room_storage_bytes(uuid)           to service_role;
