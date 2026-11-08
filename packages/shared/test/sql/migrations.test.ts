import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Applies the real migrations to real Postgres (PGlite) and attacks them as each role.
 * The stub mirrors Supabase, including default privileges that grant everything to anon
 * and authenticated, because that is the condition RLS and REVOKE must hold up under.
 */
const SUPABASE_STUB = `
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as
    $$ select coalesce(nullif(current_setting('test.role', true), ''), 'service_role') $$;

  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');
const HASH = (char: string) => char.repeat(64);

describe('database migrations', () => {
  let db: PGlite;

  const ids = {
    owner: '00000000-0000-4000-8000-000000000001',
    editor: '00000000-0000-4000-8000-000000000002',
    viewer: '00000000-0000-4000-8000-000000000003',
    stranger: '00000000-0000-4000-8000-000000000004',
  };
  let roomA: string;
  let roomB: string;

  async function superuser(): Promise<void> {
    await db.exec(`reset role; select set_config('test.sub', '', false), set_config('test.role', '', false);`);
  }

  /** Runs fn under the same role and identity that PostgREST would use for this JWT. */
  async function as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
    const role = userId ? 'authenticated' : 'anon';
    await db.query(`select set_config('test.sub', $1, false), set_config('test.role', $2, false)`, [
      userId ?? '',
      role,
    ]);
    await db.exec(`set role ${role};`);
    try {
      return await fn();
    } finally {
      await superuser();
    }
  }

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await db.query<T>(sql, params)).rows;
  }

  async function newRoom(owner: string, title: string): Promise<string> {
    const [row] = await rows<{ id: string }>(`select public.create_room_with_owner($1, $2) as id`, [title, owner]);
    return (row as { id: string }).id;
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SUPABASE_STUB);
    for (const file of readdirSync(MIGRATIONS).sort()) {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
    }
    for (const [name, id] of Object.entries(ids)) {
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
        id,
        `${name}@example.com`,
        JSON.stringify({ full_name: name }),
      ]);
    }
  }, 60_000);

  beforeEach(async () => {
    await superuser();
    await db.exec(`truncate public.rooms cascade;`);
    roomA = await newRoom(ids.owner, 'Room A');
    roomB = await newRoom(ids.stranger, 'Room B');
    await db.query(`insert into public.room_members (room_id, user_id, role) values ($1, $2, 'EDITOR'), ($1, $3, 'VIEWER')`, [
      roomA,
      ids.editor,
      ids.viewer,
    ]);
  });

  describe('schema', () => {
    it('create_room_with_owner writes the room and an OWNER membership', async () => {
      const members = await rows<{ role: string }>(`select role from public.room_members where room_id = $1 and user_id = $2`, [
        roomA,
        ids.owner,
      ]);
      expect(members).toEqual([{ role: 'OWNER' }]);
    });

    it('mirrors new auth users into profiles', async () => {
      const [profile] = await rows<{ display_name: string }>(`select display_name from public.profiles where id = $1`, [ids.owner]);
      expect(profile?.display_name).toBe('owner');
    });

    it('stores SQL-looking input as plain text', async () => {
      const title = `'; drop table public.rooms; --`;
      const id = await newRoom(ids.owner, title);
      const [row] = await rows<{ title: string }>(`select title from public.rooms where id = $1`, [id]);
      expect(row?.title).toBe(title);
    });

    it.each([
      ['SVG mime', 'image/svg+xml', 'png'],
      ['SVG extension', 'image/png', 'svg'],
    ])('refuses an asset with %s at the database level', async (_name, mime, ext) => {
      const key = `rooms/${roomA}/${roomA}.${ext}`;
      await expect(
        db.query(
          `insert into public.room_assets (room_id, uploaded_by, r2_object_key, mime_type, size_bytes) values ($1, $2, $3, $4, 10)`,
          [roomA, ids.owner, key, mime],
        ),
      ).rejects.toThrow(/check constraint/);
    });

    it('refuses an OWNER invite and a plaintext token', async () => {
      const insert = (role: string, hash: string) =>
        db.query(
          `insert into public.room_invites (room_id, email, role, token_hash, expires_at, created_by)
           values ($1, 'x@example.com', $2, $3, now() + interval '1 day', $4)`,
          [roomA, role, hash, ids.owner],
        );
      await expect(insert('OWNER', HASH('a'))).rejects.toThrow(/check constraint/);
      await expect(insert('EDITOR', 'plaintext-token')).rejects.toThrow(/check constraint/);
    });

    it('bumps version only when the snapshot changes', async () => {
      const version = async () =>
        (await rows<{ version: number }>(`select version from public.rooms where id = $1`, [roomA]))[0]?.version;
      const start = await version();
      await db.query(`update public.rooms set title = 'renamed' where id = $1`, [roomA]);
      expect(await version()).toBe(start);
      await db.query(`update public.rooms set yjs_snapshot = '\\x0102' where id = $1`, [roomA]);
      expect(await version()).toBe((start as number) + 1);
    });
  });

  describe('row level security', () => {
    it('IDOR: a stranger sees nothing in another room', async () => {
      await db.query(
        `insert into public.room_invites (room_id, email, token_hash, expires_at, created_by)
         values ($1, 'x@example.com', $2, now() + interval '1 day', $3)`,
        [roomA, HASH('a'), ids.owner],
      );
      const seen = await as(ids.stranger, async () => ({
        rooms: await rows(`select id from public.rooms where id = $1`, [roomA]),
        members: await rows(`select user_id from public.room_members where room_id = $1`, [roomA]),
        invites: await rows(`select id from public.room_invites where room_id = $1`, [roomA]),
      }));
      expect(seen).toEqual({ rooms: [], members: [], invites: [] });
    });

    it('anon sees no rows at all', async () => {
      const seen = await as(null, async () => ({
        rooms: await rows(`select id from public.rooms`),
        profiles: await rows(`select id from public.profiles`),
      }));
      expect(seen).toEqual({ rooms: [], profiles: [] });
    });

    it('a member can read their room', async () => {
      const seen = await as(ids.viewer, () => rows(`select id from public.rooms where id = $1`, [roomA]));
      expect(seen).toHaveLength(1);
    });

    it.each(['editor', 'viewer'] as const)('a %s cannot rename or delete the room', async (who) => {
      await as(ids[who], async () => {
        await db.query(`update public.rooms set title = 'pwned' where id = $1`, [roomA]);
        await db.query(`delete from public.rooms where id = $1`, [roomA]);
      });
      const [row] = await rows<{ title: string }>(`select title from public.rooms where id = $1`, [roomA]);
      expect(row?.title).toBe('Room A');
    });

    it('a viewer cannot write a snapshot directly', async () => {
      await as(ids.viewer, () => db.query(`update public.rooms set yjs_snapshot = '\\xff' where id = $1`, [roomA]));
      const [row] = await rows<{ yjs_snapshot: unknown }>(`select yjs_snapshot from public.rooms where id = $1`, [roomA]);
      expect(row?.yjs_snapshot).toBeNull();
    });

    it('an owner cannot give the room away by rewriting owner_id', async () => {
      await expect(
        as(ids.owner, () => db.query(`update public.rooms set owner_id = $1 where id = $2`, [ids.editor, roomA])),
      ).rejects.toThrow(/row-level security/);
    });

    it('privilege escalation: an editor cannot promote themselves', async () => {
      await as(ids.editor, () =>
        db.query(`update public.room_members set role = 'OWNER' where room_id = $1 and user_id = $2`, [roomA, ids.editor]),
      );
      const [row] = await rows<{ role: string }>(`select role from public.room_members where room_id = $1 and user_id = $2`, [
        roomA,
        ids.editor,
      ]);
      expect(row?.role).toBe('EDITOR');
    });

    it('an owner cannot mint a second OWNER', async () => {
      await expect(
        as(ids.owner, () =>
          db.query(`update public.room_members set role = 'OWNER' where room_id = $1 and user_id = $2`, [roomA, ids.editor]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('cross-room hijack: an owner cannot move a member row into someone else\'s room', async () => {
      await expect(
        as(ids.owner, () =>
          db.query(`update public.room_members set room_id = $1 where room_id = $2 and user_id = $3`, [
            roomB,
            roomA,
            ids.editor,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('an owner cannot hand themselves a membership through a member row', async () => {
      await expect(
        as(ids.owner, () =>
          db.query(`update public.room_members set user_id = $1 where room_id = $2 and user_id = $3`, [
            ids.owner,
            roomA,
            ids.editor,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('an owner cannot plant an invite in another room', async () => {
      await expect(
        as(ids.owner, () =>
          db.query(
            `insert into public.room_invites (room_id, email, token_hash, expires_at, created_by)
             values ($1, 'x@example.com', $2, now() + interval '1 day', $3)`,
            [roomB, HASH('b'), ids.owner],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('a member can leave, but an owner cannot orphan the room', async () => {
      await as(ids.viewer, () =>
        db.query(`delete from public.room_members where room_id = $1 and user_id = $2`, [roomA, ids.viewer]),
      );
      await as(ids.owner, () =>
        db.query(`delete from public.room_members where room_id = $1 and user_id = $2`, [roomA, ids.owner]),
      );
      const left = await rows<{ user_id: string }>(`select user_id from public.room_members where room_id = $1`, [roomA]);
      expect(left.map((r) => r.user_id).sort()).toEqual([ids.owner, ids.editor].sort());
    });

    it('privacy: emails are visible only to people who share a room', async () => {
      const own = await as(ids.editor, () =>
        rows<{ email: string }>(`select email from public.profiles order by email`),
      );
      expect(own.map((r) => r.email)).toEqual(['editor@example.com', 'owner@example.com', 'viewer@example.com']);
    });

    it('asset rows must use the room prefix', async () => {
      await expect(
        as(ids.editor, () =>
          db.query(
            `insert into public.room_assets (room_id, uploaded_by, r2_object_key, mime_type, size_bytes) values ($1, $2, $3, 'image/png', 10)`,
            [roomA, ids.editor, `rooms/${roomB}/${roomB}.png`],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('function privileges', () => {
    it.each([
      ['create_room_with_owner', `select public.create_room_with_owner('x', '${ids.stranger}')`],
      ['accept_invite', `select public.accept_invite('${HASH('a')}', '${ids.stranger}', 'x@example.com')`],
      ['room_storage_bytes', `select public.room_storage_bytes('${ids.stranger}')`],
      ['list_pending_invites', `select * from public.list_pending_invites('stranger@example.com')`],
      ['accept_invite_by_id', `select public.accept_invite_by_id('${ids.owner}', '${ids.stranger}', 'stranger@example.com')`],
      ['decline_invite', `select public.decline_invite('${ids.owner}', 'stranger@example.com')`],
      [
        'reserve_room_asset',
        `select public.reserve_room_asset('${ids.owner}', '${ids.owner}', '${ids.owner}', 'k', 'image/png', 1, 1)`,
      ],
    ])('%s cannot be called with the public anon key, signed in or not', async (_name, sql) => {
      await expect(as(null, () => db.query(sql))).rejects.toThrow(/permission denied/);
      await expect(as(ids.stranger, () => db.query(sql))).rejects.toThrow(/permission denied/);
    });

    it('anon cannot use the RLS helpers', async () => {
      await expect(as(null, () => db.query(`select public.room_role_of('${ids.owner}')`))).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('pending invitations by id', () => {
    async function invite(
      overrides: { role?: string; email?: string; expires?: string; accepted?: boolean } = {},
    ): Promise<string> {
      const [row] = await rows<{ id: string }>(
        `insert into public.room_invites (room_id, email, role, token_hash, expires_at, accepted_at, created_by)
         values ($1, $2, $3, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now() + $4::interval, $5, $6)
         returning id`,
        [
          roomA,
          overrides.email ?? 'stranger@example.com',
          overrides.role ?? 'EDITOR',
          overrides.expires ?? '1 day',
          overrides.accepted ? new Date().toISOString() : null,
          ids.owner,
        ],
      );
      return (row as { id: string }).id;
    }

    const list = (email: string | null) =>
      rows<{ invite_id: string; room_title: string; role: string; invited_by_name: string }>(
        `select * from public.list_pending_invites($1)`,
        [email],
      );
    const accept = (inviteId: string, userId: string, email: string) =>
      db.query(`select public.accept_invite_by_id($1, $2, $3) as room`, [inviteId, userId, email]);
    const decline = async (inviteId: string, email: string) =>
      (await rows<{ ok: boolean }>(`select public.decline_invite($1, $2) as ok`, [inviteId, email]))[0]?.ok;
    const membership = (userId: string) =>
      rows<{ role: string }>(`select role from public.room_members where room_id = $1 and user_id = $2`, [roomA, userId]);

    it('lists only live invitations for that email, ignoring case', async () => {
      const mine = await invite({ email: 'Stranger@Example.com' });
      await invite({ email: 'someone-else@example.com' });
      await invite({ expires: '-1 hour' });
      await invite({ accepted: true });
      const found = await list('STRANGER@example.COM');
      expect(found.map((row) => row.invite_id)).toEqual([mine]);
    });

    it('shows the room name, the role and who invited, and never a token or hash', async () => {
      await invite({ role: 'VIEWER' });
      const [row] = await list('stranger@example.com');
      expect(row).toMatchObject({ room_title: 'Room A', role: 'VIEWER' });
      expect(row?.invited_by_name).toBe('owner');
      expect(Object.keys(row ?? {}).join(' ')).not.toMatch(/token|hash/);
    });

    it('treats an underscore or percent in an email as itself, not as a pattern', async () => {
      await invite({ email: 'a_b@example.com' });
      expect(await list('axb@example.com')).toEqual([]);
      expect(await list('%@example.com')).toEqual([]);
      expect(await list('a_b@example.com')).toHaveLength(1);
    });

    it('finds nothing for a missing email', async () => {
      await invite();
      expect(await list(null)).toEqual([]);
    });

    it('accepting makes the caller a member with the invited role', async () => {
      const id = await invite({ role: 'VIEWER' });
      await accept(id, ids.stranger, 'stranger@example.com');
      expect((await membership(ids.stranger))[0]?.role).toBe('VIEWER');
      expect(await list('stranger@example.com')).toEqual([]);
    });

    it('is single use', async () => {
      const id = await invite();
      await accept(id, ids.stranger, 'stranger@example.com');
      await expect(accept(id, ids.stranger, 'stranger@example.com')).rejects.toThrow(/INVITE_INVALID/);
    });

    it('refuses an invite sent to someone else, even with its id', async () => {
      const id = await invite({ email: 'victim@example.com' });
      await expect(accept(id, ids.stranger, 'stranger@example.com')).rejects.toThrow(/INVITE_INVALID/);
      expect(await membership(ids.stranger)).toEqual([]);
    });

    it('refuses an expired, unknown or null invite', async () => {
      const expired = await invite({ expires: '-1 minute' });
      await expect(accept(expired, ids.stranger, 'stranger@example.com')).rejects.toThrow(/INVITE_INVALID/);
      await expect(
        accept('00000000-0000-4000-8000-0000000000ff', ids.stranger, 'stranger@example.com'),
      ).rejects.toThrow(/INVITE_INVALID/);
      await expect(
        db.query(`select public.accept_invite_by_id(null, $1, $2)`, [ids.stranger, 'stranger@example.com']),
      ).rejects.toThrow(/INVITE_INVALID/);
    });

    it('never demotes an owner who is invited to their own room', async () => {
      const id = await invite({ email: 'owner@example.com', role: 'VIEWER' });
      await accept(id, ids.owner, 'owner@example.com');
      expect((await membership(ids.owner))[0]?.role).toBe('OWNER');
    });

    it('declining removes the invite for its recipient only', async () => {
      const id = await invite({ email: 'victim@example.com' });
      expect(await decline(id, 'stranger@example.com')).toBe(false);
      expect(await rows(`select 1 from public.room_invites where id = $1`, [id])).toHaveLength(1);
      expect(await decline(id, 'VICTIM@example.com')).toBe(true);
      expect(await rows(`select 1 from public.room_invites where id = $1`, [id])).toHaveLength(0);
      expect(await decline(id, 'victim@example.com')).toBe(false);
    });

    it('does not let a decline erase an invite that was already accepted', async () => {
      const id = await invite({ accepted: true });
      expect(await decline(id, 'stranger@example.com')).toBe(false);
      expect(await rows(`select 1 from public.room_invites where id = $1`, [id])).toHaveLength(1);
    });
  });

  describe('accept_invite', () => {
    async function invite(overrides: { role?: string; email?: string; expires?: string } = {}): Promise<string> {
      const hash = HASH(Math.random().toString(16).slice(2, 3) || 'c');
      await db.query(`delete from public.room_invites where token_hash = $1`, [hash]);
      await db.query(
        `insert into public.room_invites (room_id, email, role, token_hash, expires_at, created_by)
         values ($1, $2, $3, $4, now() + $5::interval, $6)`,
        [roomA, overrides.email ?? 'stranger@example.com', overrides.role ?? 'EDITOR', hash, overrides.expires ?? '1 day', ids.owner],
      );
      return hash;
    }

    const accept = (hash: string, userId: string, email: string) =>
      db.query(`select public.accept_invite($1, $2, $3) as room`, [hash, userId, email]);

    it('joins the room with the invited role', async () => {
      const hash = await invite({ role: 'VIEWER' });
      await accept(hash, ids.stranger, 'stranger@example.com');
      const [row] = await rows<{ role: string }>(`select role from public.room_members where room_id = $1 and user_id = $2`, [
        roomA,
        ids.stranger,
      ]);
      expect(row?.role).toBe('VIEWER');
    });

    it('is single use', async () => {
      const hash = await invite();
      await accept(hash, ids.stranger, 'stranger@example.com');
      await expect(accept(hash, ids.stranger, 'stranger@example.com')).rejects.toThrow(/INVITE_INVALID/);
    });

    it('refuses an expired invite', async () => {
      const hash = await invite({ expires: '-1 minute' });
      await expect(accept(hash, ids.stranger, 'stranger@example.com')).rejects.toThrow(/INVITE_INVALID/);
    });

    it('is bound to the invited email', async () => {
      const hash = await invite();
      await expect(accept(hash, ids.stranger, 'someone-else@example.com')).rejects.toThrow(/INVITE_INVALID/);
      const members = await rows(`select 1 from public.room_members where room_id = $1 and user_id = $2`, [roomA, ids.stranger]);
      expect(members).toEqual([]);
    });

    it('matches the email case-insensitively', async () => {
      const hash = await invite({ email: 'Stranger@Example.com' });
      await expect(accept(hash, ids.stranger, 'stranger@example.com')).resolves.toBeDefined();
    });

    it('can never downgrade the room owner', async () => {
      const hash = await invite({ email: 'owner@example.com', role: 'VIEWER' });
      await accept(hash, ids.owner, 'owner@example.com');
      const [row] = await rows<{ role: string }>(`select role from public.room_members where room_id = $1 and user_id = $2`, [
        roomA,
        ids.owner,
      ]);
      expect(row?.role).toBe('OWNER');
    });

    it('a failed accept does not consume the invite', async () => {
      const hash = await invite();
      await expect(accept(hash, ids.stranger, 'wrong@example.com')).rejects.toThrow(/INVITE_INVALID/);
      await expect(accept(hash, ids.stranger, 'stranger@example.com')).resolves.toBeDefined();
    });
  });

  describe('reserve_room_asset', () => {
    const quota = 100;
    const reserve = async (id: string, size: number) => {
      const key = `rooms/${roomA}/${id}.png`;
      const [row] = await rows<{ ok: boolean }>(
        `select public.reserve_room_asset($1, $2, $3, $4, 'image/png', $5, $6) as ok`,
        [id, roomA, ids.editor, key, size, quota],
      );
      return row?.ok;
    };

    it('stops exactly at the quota and records nothing beyond it', async () => {
      expect(await reserve('aaaaaaaa-0000-4000-8000-000000000001', 60)).toBe(true);
      expect(await reserve('aaaaaaaa-0000-4000-8000-000000000002', 40)).toBe(true);
      expect(await reserve('aaaaaaaa-0000-4000-8000-000000000003', 1)).toBe(false);
      const [used] = await rows<{ bytes: string }>(`select public.room_storage_bytes($1) as bytes`, [roomA]);
      expect(Number(used?.bytes)).toBe(100);
    });

    it('refuses a key that is not in the server format', async () => {
      await expect(
        db.query(`select public.reserve_room_asset($1, $2, $3, '../evil.png', 'image/png', 1, 100)`, [
          'aaaaaaaa-0000-4000-8000-000000000004',
          roomA,
          ids.editor,
        ]),
      ).rejects.toThrow(/check constraint/);
    });
  });

  describe('snapshot history (0006)', () => {
    const MIB2 = 2 * 1024 * 1024;

    async function save(room: string, text: string): Promise<void> {
      await db.query(`update public.rooms set yjs_snapshot = convert_to($2, 'UTF8') where id = $1`, [room, text]);
    }
    async function saveBig(room: string, bytes: number): Promise<void> {
      await db.query(`update public.rooms set yjs_snapshot = convert_to(repeat('x', $2::int), 'UTF8') where id = $1`, [room, bytes]);
    }
    async function count(room: string): Promise<number> {
      const [row] = await rows<{ n: number }>(`select count(*)::int as n from public.room_snapshots where room_id = $1`, [room]);
      return row?.n ?? -1;
    }
    async function backdate(room: string, minutes: number): Promise<void> {
      await db.query(
        `update public.room_snapshots set created_at = created_at - ($2 || ' minutes')::interval where room_id = $1`,
        [room, String(minutes)],
      );
    }
    async function asService<T>(fn: () => Promise<T>): Promise<T> {
      await db.exec('set role service_role;');
      try {
        return await fn();
      } finally {
        await superuser();
      }
    }

    it('records the first saved state, then waits five minutes before the next', async () => {
      await save(roomA, 'one');
      expect(await count(roomA)).toBe(1);
      await save(roomA, 'two');
      await save(roomA, 'three');
      expect(await count(roomA)).toBe(1);

      await backdate(roomA, 6);
      await save(roomA, 'four');
      expect(await count(roomA)).toBe(2);
    });

    it('stores the state and the version it was saved as', async () => {
      await save(roomA, 'hello');
      const [entry] = await rows<{ text: string; version: number; size_bytes: number; label: string | null }>(
        `select convert_from(yjs_snapshot, 'UTF8') as text, version, size_bytes, label from public.room_snapshots where room_id = $1`,
        [roomA],
      );
      const [room] = await rows<{ version: number }>(`select version from public.rooms where id = $1`, [roomA]);
      expect(entry).toEqual({ text: 'hello', version: room?.version, size_bytes: 5, label: null });
    });

    it('records nothing for an edit that leaves the snapshot alone', async () => {
      await db.query(`update public.rooms set title = 'Renamed' where id = $1`, [roomA]);
      expect(await count(roomA)).toBe(0);
    });

    it('keeps nothing over 2 MiB, and the save itself still goes through', async () => {
      await saveBig(roomA, MIB2 + 1);
      expect(await count(roomA)).toBe(0);
      const [room] = await rows<{ size: number }>(`select octet_length(yjs_snapshot) as size from public.rooms where id = $1`, [roomA]);
      expect(room?.size).toBe(MIB2 + 1);

      await saveBig(roomA, MIB2);
      expect(await count(roomA)).toBe(1);
    });

    it('keeps only the newest 20 entries', async () => {
      for (let i = 1; i <= 25; i++) {
        await db.query(
          `insert into public.room_snapshots (room_id, version, yjs_snapshot, size_bytes, created_at)
           values ($1, $2, convert_to($3, 'UTF8'), 3, now() - ($4 || ' minutes')::interval)`,
          [roomA, i, `old${i}`, String(10 + i)],
        );
      }
      await save(roomA, 'newest');
      expect(await count(roomA)).toBe(20);
      const kept = await rows<{ text: string }>(
        `select convert_from(yjs_snapshot, 'UTF8') as text from public.room_snapshots where room_id = $1`,
        [roomA],
      );
      expect(kept.map((entry) => entry.text)).toContain('newest');
      // The oldest ones were the ones deleted: old25 is 35 minutes old, old6 is 16.
      expect(kept.map((entry) => entry.text)).not.toContain('old25');
      expect(kept.map((entry) => entry.text)).toContain('old6');
    });

    it('is bounded per room, not across rooms', async () => {
      await save(roomA, 'a');
      await save(roomB, 'b');
      expect(await count(roomA)).toBe(1);
      expect(await count(roomB)).toBe(1);
    });

    it('goes away with its room', async () => {
      await save(roomA, 'x');
      await db.query(`delete from public.rooms where id = $1`, [roomA]);
      const [row] = await rows<{ n: number }>(`select count(*)::int as n from public.room_snapshots`);
      expect(row?.n).toBe(0);
    });

    it('refuses an over-long label', async () => {
      await expect(
        db.query(
          `insert into public.room_snapshots (room_id, version, yjs_snapshot, size_bytes, label) values ($1, 1, decode('00', 'hex'), 1, $2)`,
          [roomA, 'x'.repeat(81)],
        ),
      ).rejects.toThrow(/check constraint/);
    });

    describe('access', () => {
      beforeEach(async () => {
        await save(roomA, 'secret');
      });

      it.each([
        ['owner', ids.owner],
        ['editor', ids.editor],
        ['viewer', ids.viewer],
        ['stranger', ids.stranger],
        ['anonymous', null],
      ])('%s cannot read history directly', async (_name, userId) => {
        await expect(as(userId, () => db.query(`select id from public.room_snapshots`))).rejects.toThrow(/permission denied/);
      });

      it.each([
        ['owner', ids.owner],
        ['editor', ids.editor],
        ['anonymous', null],
      ])('%s cannot write or delete history directly', async (_name, userId) => {
        await expect(
          as(userId, () =>
            db.query(
              `insert into public.room_snapshots (room_id, version, yjs_snapshot, size_bytes) values ($1, 1, decode('00', 'hex'), 1)`,
              [roomA],
            ),
          ),
        ).rejects.toThrow(/permission denied/);
        await expect(as(userId, () => db.query(`delete from public.room_snapshots`))).rejects.toThrow(/permission denied/);
      });

      it('lets the API role read it', async () => {
        const read = await asService(() => db.query(`select id from public.room_snapshots where room_id = $1`, [roomA]));
        expect(read.rows).toHaveLength(1);
      });

      it('does not break an owner who saves their own room through the API', async () => {
        await backdate(roomA, 6);
        await as(ids.owner, () =>
          db.query(`update public.rooms set yjs_snapshot = convert_to('by owner', 'UTF8') where id = $1`, [roomA]),
        );
        expect(await count(roomA)).toBe(2);
      });
    });

    describe('record_room_checkpoint', () => {
      const checkpoint = (room: string, label = 'Before restore') =>
        rows<{ id: string | null }>(`select public.record_room_checkpoint($1, $2) as id`, [room, label]).then((r) => r[0]?.id ?? null);

      it('is callable by the API role only', async () => {
        await expect(
          as(ids.owner, () => db.query(`select public.record_room_checkpoint($1, 'x')`, [roomA])),
        ).rejects.toThrow(/permission denied/);
        await expect(
          as(null, () => db.query(`select public.record_room_checkpoint($1, 'x')`, [roomA])),
        ).rejects.toThrow(/permission denied/);
        await save(roomA, 'saved');
        const viaService = await asService(() => db.query<{ id: string }>(`select public.record_room_checkpoint($1, 'Before restore') as id`, [roomA]));
        expect(viaService.rows[0]?.id).toBeTruthy();
      });

      it('returns null when there is nothing saved yet, or no such room', async () => {
        expect(await checkpoint(roomA)).toBeNull();
        expect(await checkpoint('00000000-0000-4000-8000-0000000000ff')).toBeNull();
        expect(await count(roomA)).toBe(0);
      });

      it('copies the saved state at once, ignoring the five minute spacing', async () => {
        await save(roomA, 'first');
        await save(roomA, 'second');
        expect(await count(roomA)).toBe(1);

        const id = await checkpoint(roomA);
        expect(id).not.toBeNull();
        expect(await count(roomA)).toBe(2);
        const [entry] = await rows<{ text: string; label: string }>(
          `select convert_from(yjs_snapshot, 'UTF8') as text, label from public.room_snapshots where id = $1`,
          [id],
        );
        expect(entry).toEqual({ text: 'second', label: 'Before restore' });
      });

      it('reuses the newest entry when it is already identical', async () => {
        await save(roomA, 'same');
        const [only] = await rows<{ id: string }>(`select id from public.room_snapshots where room_id = $1`, [roomA]);
        expect(await checkpoint(roomA)).toBe(only?.id);
        expect(await count(roomA)).toBe(1);
      });

      it('refuses a saved state that is too large to keep', async () => {
        await saveBig(roomA, MIB2 + 1);
        await expect(checkpoint(roomA)).rejects.toThrow(/too large/);
      });

      it('also prunes to 20', async () => {
        for (let i = 0; i < 25; i++) {
          await save(roomA, `state${i}`);
          await backdate(roomA, 6);
          await checkpoint(roomA);
        }
        expect(await count(roomA)).toBeLessThanOrEqual(20);
      });

      it('rejects a label that is too long', async () => {
        // The newest entry must differ from the saved state, or the checkpoint is simply reused.
        await save(roomA, 'first');
        await save(roomA, 'second');
        await expect(checkpoint(roomA, 'x'.repeat(81))).rejects.toThrow(/check constraint/);
      });
    });
  });
});
