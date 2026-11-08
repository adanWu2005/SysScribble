-- seed.sql — local development only. Creates nothing in auth.users; sign up through
-- the app first, then run this to give the first user a sample room.
do $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then
    raise notice 'No users yet — sign up via the app, then re-run seed.sql';
    return;
  end if;
  perform public.create_room_with_owner('Sample Workspace', v_user);
end $$;
