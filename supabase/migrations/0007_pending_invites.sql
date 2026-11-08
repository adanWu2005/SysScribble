-- 0007_pending_invites.sql — lets a signed-in person see, accept or decline the invitations sent to
-- their own email, from the dashboard, without needing the emailed link.
--
-- An invite stores only a HASH of its token (rule 11), so these functions work by invite id instead.
-- What makes that safe is that every function takes the caller's email from the VERIFIED JWT (the API
-- passes it, never the client) and matches it against the invite's email. An invite id on its own,
-- guessed or leaked, does nothing for anyone but the person it was sent to.
--
-- Like the other RPCs, these are SECURITY DEFINER and callable by service_role only. The API
-- authenticates first and passes the identity in.

-- Pending invitations for one email, with the room's name and who sent it. Never returns a token or a hash.
create or replace function public.list_pending_invites(p_email text)
returns table (
  invite_id       uuid,
  room_id         uuid,
  room_title      text,
  role            public.room_role,
  invited_by_name text,
  expires_at      timestamptz,
  created_at      timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select i.id,
         i.room_id,
         r.title,
         i.role,
         coalesce(
           nullif(btrim(p.display_name), ''),
           nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
           'Someone'
         ),
         i.expires_at,
         i.created_at
    from public.room_invites i
    join public.rooms r on r.id = i.room_id
    left join public.profiles p on p.id = i.created_by
   where p_email is not null
     and lower(i.email) = lower(p_email)
     and i.accepted_at is null
     and i.expires_at > now()
   order by i.created_at desc
   limit 50;
$$;

-- Same single-use, time-boxed, email-bound claim as accept_invite, found by id instead of token.
-- The UPDATE ... WHERE is the atomic claim: two concurrent calls cannot both succeed.
create or replace function public.accept_invite_by_id(p_invite_id uuid, p_user_id uuid, p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite public.room_invites%rowtype;
begin
  if p_invite_id is null or p_user_id is null or p_email is null then
    raise exception 'INVITE_INVALID' using errcode = 'P0001';
  end if;
  if auth.role() = 'authenticated' and p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.room_invites
     set accepted_at = now()
   where id = p_invite_id
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

-- Declining deletes the invite, so the emailed link stops working too. Only the person it was
-- sent to can do this. Returns false when there was nothing to decline.
create or replace function public.decline_invite(p_invite_id uuid, p_email text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if p_invite_id is null or p_email is null then
    return false;
  end if;
  delete from public.room_invites
   where id = p_invite_id
     and accepted_at is null
     and lower(email) = lower(p_email);
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.list_pending_invites(text)                from public, anon, authenticated;
revoke all on function public.accept_invite_by_id(uuid, uuid, text)     from public, anon, authenticated;
revoke all on function public.decline_invite(uuid, text)                from public, anon, authenticated;
grant execute on function public.list_pending_invites(text)             to service_role;
grant execute on function public.accept_invite_by_id(uuid, uuid, text)  to service_role;
grant execute on function public.decline_invite(uuid, text)             to service_role;
