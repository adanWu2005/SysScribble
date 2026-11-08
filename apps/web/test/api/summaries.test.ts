import { presenceKey, encodePresence, type Shape } from '@wb/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { summariesFor } from '@/lib/db/summaries';
import { readRoomPresence } from '@/lib/presence';
import { addShapes } from '@/lib/whiteboard/model';

const db = vi.hoisted(() => ({
  rooms: [] as { id: string; yjs_snapshot: Uint8Array | null }[],
  members: [] as { room_id: string; user_id: string }[],
  profiles: [] as { id: string; display_name: string | null; email: string | null }[],
}));
const redis = vi.hoisted(() => ({ hashes: {} as Record<string, Record<string, unknown> | null>, fail: false }));

vi.mock('@wb/shared/server', () => ({ byteaToBytes: (value: unknown) => value }));
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: 'rooms' | 'room_members' | 'profiles') => {
      const rows = table === 'rooms' ? db.rooms : table === 'room_members' ? db.members : db.profiles;
      const result = { data: rows, error: null };
      return { select: () => ({ in: () => Object.assign(Promise.resolve(result), { order: async () => result }) }) };
    },
  }),
}));
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    pipeline: () => {
      const keys: string[] = [];
      const pipe = {
        hgetall: (key: string) => {
          keys.push(key);
          return pipe;
        },
        exec: async () => {
          if (redis.fail) throw new Error('redis down');
          return keys.map((key) => redis.hashes[key] ?? null);
        },
      };
      return pipe;
    },
  }),
}));

const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const OTHER = '9c3a7d8f-2b3c-4d4e-8f90-1b2c3d4e5f60';
const base = { rotation: 0, x: 0, y: 0 };

function snapshot(shapes: Shape[]): Uint8Array {
  const doc = new Y.Doc();
  addShapes(doc, shapes);
  return Y.encodeStateAsUpdate(doc);
}

beforeEach(() => {
  db.rooms = [];
  db.members = [];
  db.profiles = [];
  redis.hashes = {};
  redis.fail = false;
});

describe('summariesFor', () => {
  it('returns nothing for no rooms', async () => {
    expect(await summariesFor([])).toEqual([]);
  });

  it('counts shapes and draws a thumbnail as an image data URL', async () => {
    db.rooms = [
      {
        id: ROOM,
        yjs_snapshot: snapshot([
          { ...base, id: 'a', type: 'rect', width: 100, height: 60, fill: '#93c5fd' },
          { ...base, id: 'b', type: 'ellipse', x: 200, width: 80, height: 80, fill: '#86efac' },
        ]),
      },
    ];
    const [summary] = await summariesFor([ROOM]);
    expect(summary?.shapeCount).toBe(2);
    expect(summary?.thumbnail?.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(summary?.thumbnail?.split(',').slice(1).join(',') ?? '');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/<script|onload|onerror|foreignObject/i);
  });

  it('keeps markup in a label from becoming markup in the thumbnail', async () => {
    db.rooms = [
      {
        id: ROOM,
        yjs_snapshot: snapshot([
          { ...base, id: 's', type: 'sticky', width: 160, height: 160, fill: '#fde68a', text: '</text><script>alert(1)</script>' },
        ]),
      },
    ];
    const [summary] = await summariesFor([ROOM]);
    const svg = decodeURIComponent(summary?.thumbnail?.split(',').slice(1).join(',') ?? '');
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('shows no picture for an empty or never-saved room, and survives a damaged snapshot', async () => {
    db.rooms = [
      { id: ROOM, yjs_snapshot: null },
      { id: OTHER, yjs_snapshot: new Uint8Array([9, 9, 9, 9, 9]) },
    ];
    const summaries = await summariesFor([ROOM, OTHER]);
    expect(summaries.map((s) => [s.shapeCount, s.thumbnail])).toEqual([
      [0, null],
      [0, null],
    ]);
  });

  it('does not decode a snapshot that is too large for a card', async () => {
    db.rooms = [{ id: ROOM, yjs_snapshot: new Uint8Array(3 * 1024 * 1024) }];
    expect((await summariesFor([ROOM]))[0]).toMatchObject({ shapeCount: 0, thumbnail: null });
  });

  it('counts members and names the first three, falling back sensibly', async () => {
    db.rooms = [{ id: ROOM, yjs_snapshot: null }];
    db.members = ['u1', 'u2', 'u3', 'u4', 'u5'].map((user_id) => ({ room_id: ROOM, user_id }));
    db.profiles = [
      { id: 'u1', display_name: 'Ada', email: 'ada@x.io' },
      { id: 'u2', display_name: null, email: 'bob@x.io' },
      { id: 'u3', display_name: '  ', email: null },
    ];
    const [summary] = await summariesFor([ROOM]);
    expect(summary?.memberCount).toBe(5);
    expect(summary?.people).toEqual(['Ada', 'bob', 'Member']);
  });
});

describe('readRoomPresence', () => {
  it('sums live instances, drops quiet rooms and stale entries', async () => {
    const now = Date.now();
    redis.hashes = {
      [presenceKey(ROOM)]: { a: encodePresence(2, now), b: encodePresence(1, now - 1000), dead: encodePresence(9, now - 120_000) },
      [presenceKey(OTHER)]: { a: encodePresence(5, now - 120_000) },
    };
    expect(await readRoomPresence([ROOM, OTHER])).toEqual({ [ROOM]: 3 });
  });

  it('says nobody is here, rather than failing, when Redis cannot be read', async () => {
    redis.fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await readRoomPresence([ROOM])).toEqual({});
  });

  it('asks about nothing for no rooms', async () => {
    expect(await readRoomPresence([])).toEqual({});
  });
});
