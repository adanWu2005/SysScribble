import { Y_KEYS, createRoomSchema, shapeSchema } from '@wb/shared';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as roomsRoute from '../../src/app/api/rooms/route';
import { ApiError } from '@/lib/api';
import { notesSchema } from '@/lib/notes/schema';
import { readNotesTitle } from '@/lib/notes/title';
import { buildTemplateSnapshot } from '@/lib/templates/build';
import { templateNotes } from '@/lib/templates/notes';
import { readShapes } from '@/lib/whiteboard/model';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createRoom: vi.fn(),
  deleteRoom: vi.fn(),
  listRoomsForUser: vi.fn(),
  setInitialSnapshot: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/requireUser', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/ratelimit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/db/rooms', () => ({
  createRoom: mocks.createRoom,
  deleteRoom: mocks.deleteRoom,
  listRoomsForUser: mocks.listRoomsForUser,
  setInitialSnapshot: mocks.setInitialSnapshot,
}));

const USER = '11111111-2222-4333-8444-555555555555';
const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';

const post = (body: unknown) =>
  roomsRoute.POST(
    new NextRequest('http://localhost:3000/api/rooms', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: USER, email: 'ada@example.com' });
  mocks.createRoom.mockImplementation(async (_owner: string, title: string) => ({ id: ROOM, title }));
  mocks.setInitialSnapshot.mockResolvedValue(undefined);
  mocks.deleteRoom.mockResolvedValue(undefined);
  mocks.enforceRateLimit.mockResolvedValue(undefined);
});

describe('POST /api/rooms with a template', () => {
  it('makes an empty room when no template is named, and stores no snapshot', async () => {
    const res = await post({ title: 'Plain' });
    expect(res.status).toBe(201);
    expect(mocks.setInitialSnapshot).not.toHaveBeenCalled();
  });

  it('makes an empty room for the blank template', async () => {
    await post({ title: 'Plain', template: 'blank' });
    expect(mocks.setInitialSnapshot).not.toHaveBeenCalled();
  });

  it.each(['rfc', 'kanban', 'retro'] as const)('stores a server-built snapshot for %s', async (template) => {
    const res = await post({ title: 'Team space', template });
    expect(res.status).toBe(201);
    expect(mocks.setInitialSnapshot).toHaveBeenCalledTimes(1);
    const [roomId, bytes] = mocks.setInitialSnapshot.mock.calls[0] as [string, Uint8Array];
    expect(roomId).toBe(ROOM);
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it('rejects a template that is not on the list, before creating anything', async () => {
    for (const template of ['../../etc', 'RFC', '', 5, {}, null]) {
      const res = await post({ title: 'x', template });
      expect(res.status).toBe(400);
    }
    expect(mocks.createRoom).not.toHaveBeenCalled();
  });

  it('ignores document bytes a client tries to send along', async () => {
    const res = await post({ title: 'x', template: 'kanban', yjs_snapshot: 'AAAA', snapshot: [1, 2, 3] });
    expect(res.status).toBe(201);
    const [, bytes] = mocks.setInitialSnapshot.mock.calls[0] as [string, Uint8Array];
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes);
    expect(readShapes(doc).length).toBeGreaterThan(3);
  });

  it('requires sign-in and is rate-limited like any room creation', async () => {
    mocks.requireUser.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await post({ template: 'rfc' })).status).toBe(401);
    expect(mocks.createRoom).not.toHaveBeenCalled();

    mocks.enforceRateLimit.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Too many'));
    expect((await post({ template: 'rfc' })).status).toBe(429);
    expect(mocks.createRoom).not.toHaveBeenCalled();
  });

  it('removes the room rather than leave a half-made one when storing the template fails', async () => {
    mocks.setInitialSnapshot.mockRejectedValueOnce(new Error('db down'));
    const res = await post({ title: 'x', template: 'rfc' });
    expect(res.status).toBe(500);
    expect(mocks.deleteRoom).toHaveBeenCalledWith(ROOM);
  });
});

describe('template documents', () => {
  const open = (template: 'rfc' | 'kanban' | 'retro') => {
    const bytes = buildTemplateSnapshot(template, 'My space', 'Ada');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes ?? new Uint8Array());
    return doc;
  };

  it('builds nothing for a blank room', () => {
    expect(buildTemplateSnapshot('blank', 'x', 'Ada')).toBeNull();
    expect(templateNotes('blank')).toBeNull();
  });

  it.each(['rfc', 'kanban', 'retro'] as const)('%s: notes pass the editor schema and have a title', (template) => {
    const doc = open(template);
    expect(readNotesTitle(doc)).toBe('My space');
    expect(doc.getXmlFragment(Y_KEYS.notes).length).toBeGreaterThan(3);
    // Building the notes through the editor's schema throws on any node the editor does not know.
    const json = templateNotes(template);
    expect(() => notesSchema().nodeFromJSON(json).check()).not.toThrow();
  });

  it.each(['rfc', 'kanban', 'retro'] as const)('%s: every shape is valid, unique and opens in the default view', (template) => {
    const shapes = readShapes(open(template));
    expect(shapes.length).toBeGreaterThan(3);
    for (const shape of shapes) expect(shapeSchema.safeParse(shape).success).toBe(true);
    expect(new Set(shapes.map((s) => s.id)).size).toBe(shapes.length);
    for (const shape of shapes) {
      if (shape.type === 'arrow') continue;
      expect(shape.x).toBeGreaterThanOrEqual(0);
      expect(shape.y).toBeGreaterThanOrEqual(0);
      expect(shape.x).toBeLessThan(1300);
      expect(shape.y).toBeLessThan(800);
    }
  });

  it('rfc: draws Client to API to Redis and Postgres with connected arrows', () => {
    const shapes = readShapes(open('rfc'));
    const byId = new Map(shapes.map((s) => [s.id, s]));
    const label = (id: string | undefined) => {
      const shape = id ? byId.get(id) : undefined;
      return shape && 'text' in shape ? shape.text : undefined;
    };
    const edges = shapes.flatMap((s) => (s.type === 'arrow' ? [`${label(s.startShapeId)}>${label(s.endShapeId)}`] : []));
    expect(edges.sort()).toEqual(['API>Postgres', 'API>Redis', 'Client>API']);
  });

  it('kanban: three columns with sticky notes', () => {
    const shapes = readShapes(open('kanban'));
    expect(shapes.filter((s) => s.type === 'rect')).toHaveLength(3);
    expect(shapes.filter((s) => s.type === 'sticky').length).toBeGreaterThanOrEqual(3);
  });

  it('retro: has the three columns by name', () => {
    const titles = readShapes(open('retro')).flatMap((s) => (s.type === 'text' ? [s.text] : []));
    expect(titles).toEqual(expect.arrayContaining(['Went well', 'To improve', 'Action items']));
  });

  it('a template stays small enough to store', () => {
    for (const template of ['rfc', 'kanban', 'retro'] as const) {
      expect(buildTemplateSnapshot(template, 'x', 'Ada')?.byteLength).toBeLessThan(50_000);
    }
  });

  it('keeps an overlong title and author within their limits', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildTemplateSnapshot('kanban', 'x'.repeat(5000), 'y'.repeat(500)) ?? new Uint8Array());
    expect(readNotesTitle(doc).length).toBeLessThanOrEqual(200);
    for (const shape of readShapes(doc)) expect(shapeSchema.safeParse(shape).success).toBe(true);
  });
});

describe('createRoomSchema', () => {
  it('accepts only the listed templates', () => {
    expect(createRoomSchema.safeParse({ template: 'rfc' }).success).toBe(true);
    expect(createRoomSchema.safeParse({ template: 'evil' }).success).toBe(false);
    expect(createRoomSchema.safeParse({}).success).toBe(true);
  });
});
