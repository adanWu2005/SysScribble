import type { RoomRole } from '@wb/shared';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as duplicateRoute from '../../src/app/api/rooms/[roomId]/duplicate/route';
import * as presenceRoute from '../../src/app/api/rooms/presence/route';
import * as summariesRoute from '../../src/app/api/rooms/summaries/route';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  enforceRateLimit: vi.fn(),
  findMemberRole: vi.fn(),
  getRoom: vi.fn(),
  listRoomsForUser: vi.fn(),
  summariesFor: vi.fn(),
  readRoomPresence: vi.fn(),
  duplicateRoom: vi.fn(),
}));

vi.mock('@/lib/auth/requireUser', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/ratelimit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/db/members', () => ({ findMemberRole: mocks.findMemberRole }));
vi.mock('@/lib/db/rooms', () => ({ getRoom: mocks.getRoom, listRoomsForUser: mocks.listRoomsForUser }));
vi.mock('@/lib/db/summaries', () => ({ summariesFor: mocks.summariesFor }));
vi.mock('@/lib/presence', () => ({ readRoomPresence: mocks.readRoomPresence }));
vi.mock('@/lib/db/duplicate', () => ({ duplicateRoom: mocks.duplicateRoom }));

const A = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const B = '9c3a7d8f-2b3c-4d4e-8f90-1b2c3d4e5f60';
const NOT_MINE = '7a1e5b6d-0a1b-4b2c-8d7e-9f0a1b2c3d4e';
const CALLER = '11111111-2222-4333-8444-555555555555';

const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const call = (res: Promise<Response>) => res.then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
const none = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: CALLER, email: 'a@b.c' });
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.listRoomsForUser.mockResolvedValue([{ id: A }, { id: B }]);
  mocks.summariesFor.mockImplementation(async (ids: string[]) => ids.map((roomId) => ({ roomId, shapeCount: 1 })));
  mocks.readRoomPresence.mockResolvedValue({ [A]: 2 });
});

describe('GET /api/rooms/presence', () => {
  it('requires sign-in', async () => {
    mocks.requireUser.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await call(presenceRoute.GET(get('/api/rooms/presence'), none))).status).toBe(401);
    expect(mocks.readRoomPresence).not.toHaveBeenCalled();
  });

  it('asks only about rooms the caller belongs to, whatever the query says', async () => {
    const res = await call(presenceRoute.GET(get(`/api/rooms/presence?ids=${NOT_MINE}`), none));
    expect(res.status).toBe(200);
    expect(mocks.readRoomPresence).toHaveBeenCalledWith([A, B]);
    expect(res.body).toEqual({ presence: { [A]: 2 } });
  });

  it('is rate-limited', async () => {
    mocks.enforceRateLimit.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Too many'));
    expect((await call(presenceRoute.GET(get('/api/rooms/presence'), none))).status).toBe(429);
    expect(mocks.listRoomsForUser).not.toHaveBeenCalled();
  });
});

describe('GET /api/rooms/summaries', () => {
  it('rejects missing, malformed and too many ids before any lookup', async () => {
    const tooMany = Array.from({ length: 13 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
    for (const query of ['', '?ids=', "?ids=' OR 1=1 --", '?ids=not-a-uuid', `?ids=${A},oops`, `?ids=${tooMany}`]) {
      const res = await call(summariesRoute.GET(get(`/api/rooms/summaries${query}`), none));
      expect(res.status).toBe(400);
    }
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.summariesFor).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    mocks.requireUser.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await call(summariesRoute.GET(get(`/api/rooms/summaries?ids=${A}`), none))).status).toBe(401);
  });

  it('returns details for the caller\'s rooms and silently drops anyone else\'s', async () => {
    const res = await call(summariesRoute.GET(get(`/api/rooms/summaries?ids=${A},${NOT_MINE}`), none));
    expect(res.status).toBe(200);
    expect(mocks.summariesFor).toHaveBeenCalledWith([A]);
    expect(JSON.stringify(res.body)).not.toContain(NOT_MINE);
  });

  it('answers the same for a room that does not exist as for one that is not yours', async () => {
    const other = await call(summariesRoute.GET(get(`/api/rooms/summaries?ids=${NOT_MINE}`), none));
    expect(other.status).toBe(200);
    expect(mocks.summariesFor).toHaveBeenCalledWith([]);
  });

  it('counts a repeated id once', async () => {
    await call(summariesRoute.GET(get(`/api/rooms/summaries?ids=${A},${A},${A}`), none));
    expect(mocks.summariesFor).toHaveBeenCalledWith([A]);
  });
});

describe('POST /api/rooms/:roomId/duplicate', () => {
  const post = (roomId: string) =>
    call(duplicateRoute.POST(new NextRequest(`http://localhost:3000/api/rooms/${roomId}/duplicate`, { method: 'POST' }), {
      params: Promise.resolve({ roomId }),
    }));
  const callerIs = (role: RoomRole | null) => mocks.findMemberRole.mockResolvedValue(role);

  beforeEach(() => {
    mocks.getRoom.mockResolvedValue({ id: A, title: 'Plan' });
    mocks.duplicateRoom.mockResolvedValue({ id: B, title: 'Plan (copy)' });
  });

  it('rejects a malformed id before touching auth', async () => {
    expect((await post("' OR 1=1 --")).status).toBe(400);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    mocks.requireUser.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await post(A)).status).toBe(401);
    expect(mocks.duplicateRoom).not.toHaveBeenCalled();
  });

  it('refuses a non-member, and does not even rate-limit them', async () => {
    callerIs(null);
    expect((await post(A)).status).toBe(403);
    expect(mocks.duplicateRoom).not.toHaveBeenCalled();
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
  });

  it('refuses a viewer', async () => {
    callerIs('VIEWER');
    expect((await post(A)).status).toBe(403);
    expect(mocks.duplicateRoom).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'EDITOR'] as const)('lets %s copy, and the copy is owned by the caller', async (role) => {
    callerIs(role);
    const res = await post(A);
    expect(res.status).toBe(201);
    expect(res.body['role']).toBe('OWNER');
    expect(mocks.duplicateRoom).toHaveBeenCalledWith(A, 'Plan', CALLER);
  });

  it('checks the role of the room in the URL, not some other room the caller owns', async () => {
    mocks.findMemberRole.mockImplementation(async (roomId: string) => (roomId === B ? 'OWNER' : null));
    expect((await post(A)).status).toBe(403);
    expect(mocks.duplicateRoom).not.toHaveBeenCalled();
  });

  it('is rate-limited', async () => {
    callerIs('OWNER');
    mocks.enforceRateLimit.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Too many'));
    expect((await post(A)).status).toBe(429);
    expect(mocks.duplicateRoom).not.toHaveBeenCalled();
  });

  it('reports a missing source room', async () => {
    callerIs('OWNER');
    mocks.getRoom.mockResolvedValueOnce(null);
    expect((await post(A)).status).toBe(404);
  });

  it('passes a refusal from the copy step through, such as no room for the files', async () => {
    callerIs('OWNER');
    mocks.duplicateRoom.mockRejectedValueOnce(new ApiError(413, 'STORAGE_QUOTA_EXCEEDED', 'Not enough storage'));
    expect((await post(A)).status).toBe(413);
  });
});
