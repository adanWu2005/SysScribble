-- 0001_schema.sql — tables from PRD §4 plus a public profile mirror of auth.users.
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent where practical.

-- ---------------------------------------------------------------------------
-- Profiles: the only user data the app reads. auth.users is never queried by app code.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1. Rooms
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  title        text not null default 'Untitled Workspace'
               constraint rooms_title_length check (char_length(title) between 1 and 120),
  yjs_snapshot bytea, -- compacted Y.Doc binary state
  version      int  not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists rooms_owner_id_idx on public.rooms(owner_id);

-- ---------------------------------------------------------------------------
-- 2. Room members & roles (RBAC)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'room_role') then
    create type public.room_role as enum ('OWNER', 'EDITOR', 'VIEWER');
  end if;
end $$;

create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      public.room_role not null default 'VIEWER',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_id_idx on public.room_members(user_id);

-- ---------------------------------------------------------------------------
-- 3. Room invites (sent via Resend). Token is stored only as a SHA-256 hash.
-- ---------------------------------------------------------------------------
create table if not exists public.room_invites (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  email       text not null
              constraint room_invites_email_length check (char_length(email) between 3 and 254),
  role        public.room_role not null default 'EDITOR'
              constraint room_invites_role_not_owner check (role <> 'OWNER'),
  token_hash  text not null unique
              constraint room_invites_token_hash_hex check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists room_invites_room_id_idx on public.room_invites(room_id);
create index if not exists room_invites_email_idx   on public.room_invites(lower(email));

-- ---------------------------------------------------------------------------
-- 4. Media assets (Cloudflare R2 tracking for quota enforcement)
-- ---------------------------------------------------------------------------
create table if not exists public.room_assets (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  uploaded_by   uuid not null references auth.users(id),
  r2_object_key text not null unique
                constraint room_assets_key_format check (r2_object_key ~ '^rooms/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|pdf)$'),
  mime_type     text not null
                constraint room_assets_mime_allowlist check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size_bytes    bigint not null
                constraint room_assets_size_positive check (size_bytes > 0 and size_bytes <= 10485760),
  created_at    timestamptz not null default now()
);

create index if not exists room_assets_room_id_idx on public.room_assets(room_id);
