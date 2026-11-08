-- 0004_triggers.sql — bookkeeping triggers.

-- rooms.updated_at always reflects the last write; version increments only when
-- the Yjs snapshot actually changes (so a title edit does not bump the doc version).
create or replace function public.rooms_before_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.yjs_snapshot is distinct from old.yjs_snapshot then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists rooms_before_update on public.rooms;
create trigger rooms_before_update
  before update on public.rooms
  for each row execute function public.rooms_before_update();

-- Mirror auth.users → public.profiles on sign-up and keep email/name in sync.
create or replace function public.handle_auth_user_upsert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email        = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        avatar_url   = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user_upsert();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_upsert();
