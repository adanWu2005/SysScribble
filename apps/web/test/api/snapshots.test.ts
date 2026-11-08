import { CHECKPOINT_LABEL, type RoomRole } from '@wb/shared';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as listRoute from '../../src/app/api/rooms/[roomId]/snapshots/route';
import * as entryRoute from '../../src/app/api/rooms/[roomId]/snapshots/[snapshotId]/route';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findMemberRole: vi.fn(),
  listSnapshots: vi.fn(),
  getSnapshotBytes: vi.fn(),
  recordCheckpoint: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/requireUser', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/members', () => ({ findMemberRole: mocks.findMemberRole }));
vi.mock('@/lib/db/snapshots', () => ({
  listSnapshots: mocks.listSnapshots,
  getSnapshotBytes: mocks.getSnapshotBytes,
  recordCheckpoint: mocks.recordCheckpoint,
}));
vi.mock('@/lib/ratelimit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));

const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const SNAPSHOT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CALLER = '11111111-2222-4333-8444-555555555555';

function req(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/x', {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ctx = <P>(params: P) => ({ params: Promise.resolve(params) });
const callerIs = (role: RoomRole | null) => mocks.findMemberRole.mockResolvedValue(role);

const summary = { id: SNAPSHOT, version: 3, sizeBytes: 120, label: null, createdAt: '2026-11-07T10:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: CALLER, email: 'me@example.com' });
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.listSnapshots.mockResolvedValue([summary]);
  mocks.getSnapshotBytes.mockResolvedValue(new Uint8Array([1, 2, 3, 250]));
  mocks.recordCheckpoint.mockResolvedValue(SNAPSHOT);
});

describe('GET /snapshots', () => {
  const params = ctx({ roomId: ROOM });

  it.each(['VIEWER', null] as const)('refuses %s and reads nothing', async (role) => {
    callerIs(role);
    const res = await listRoute.GET(req('GET'), params);
    expect(res.status).toBe(403);
    expect(mocks.listSnapshots).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'EDITOR'] as const)('lets a %s list versions for this room only', async (role) => {
    callerIs(role);
    const res = await listRoute.GET(req('GET'), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ snapshots: [summary] });
    expect(mocks.listSnapshots).toHaveBeenCalledWith(ROOM);
  });

  it('rejects an id that is not a UUID before authenticating', async () => {
    const res = await listRoute.GET(req('GET'), ctx({ roomId: "1' or '1'='1" }));
    expect(res.status).toBe(400);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    mocks.requireUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Sign in'));
    const res = await listRoute.GET(req('GET'), params);
    expect(res.status).toBe(401);
    expect(mocks.findMemberRole).not.toHaveBeenCalled();
  });
});

describe('GET /snapshots/:snapshotId', () => {
  const params = ctx({ roomId: ROOM, snapshotId: SNAPSHOT });

  it.each(['VIEWER', null] as const)('refuses %s before rate limiting or reading', async (role) => {
    callerIs(role);
    const res = await entryRoute.GET(req('GET'), params);
    expect(res.status).toBe(403);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.getSnapshotBytes).not.toHaveBeenCalled();
  });

  it('looks the entry up by this room and this id, so another room cannot be read', async () => {
    callerIs('EDITOR');
    await entryRoute.GET(req('GET'), params);
    expect(mocks.getSnapshotBytes).toHaveBeenCalledWith(ROOM, SNAPSHOT);
  });

  it('answers 404 for an id that is not in this room', async () => {
    callerIs('EDITOR');
    mocks.getSnapshotBytes.mockResolvedValue(null);
    const res = await entryRoute.GET(req('GET'), params);
    expect(res.status).toBe(404);
  });

  it('returns the exact bytes as a download that cannot be sniffed or cached', async () => {
    callerIs('OWNER');
    const res = await entryRoute.GET(req('GET'), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3, 250]);
  });

  it('is rate limited before it touches the database', async () => {
    callerIs('EDITOR');
    mocks.enforceRateLimit.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'slow down'));
    const res = await entryRoute.GET(req('GET'), params);
    expect(res.status).toBe(429);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith('snapshotRead', CALLER);
    expect(mocks.getSnapshotBytes).not.toHaveBeenCalled();
  });

  it.each([
    ['room', { roomId: 'nope', snapshotId: SNAPSHOT }],
    ['snapshot', { roomId: ROOM, snapshotId: '../../etc/passwd' }],
  ])('rejects a bad %s id', async (_name, bad) => {
    const res = await entryRoute.GET(req('GET'), ctx(bad));
    expect(res.status).toBe(400);
    expect(mocks.getSnapshotBytes).not.toHaveBeenCalled();
  });
});

describe('POST /snapshots (checkpoint)', () => {
  const params = ctx({ roomId: ROOM });
  const body = { reason: 'before_restore' };

  it.each(['VIEWER', null] as const)('refuses %s and records nothing', async (role) => {
    callerIs(role);
    const res = await listRoute.POST(req('POST', body), params);
    expect(res.status).toBe(403);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.recordCheckpoint).not.toHaveBeenCalled();
  });

  it('records with the server-chosen label and the room from the URL', async () => {
    callerIs('EDITOR');
    const res = await listRoute.POST(req('POST', body), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ checkpointId: SNAPSHOT });
    expect(mocks.recordCheckpoint).toHaveBeenCalledWith(ROOM, CHECKPOINT_LABEL);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith('restore', CALLER);
  });

  it('reports null when nothing had been saved yet', async () => {
    callerIs('OWNER');
    mocks.recordCheckpoint.mockResolvedValue(null);
    const res = await listRoute.POST(req('POST', body), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ checkpointId: null });
  });

  it.each([
    ['a different reason', { reason: 'anything' }],
    ['no reason', {}],
    ['a client label', { reason: 'before_restore', label: 'x' }],
  ])('does not let a client influence the entry with %s', async (_name, payload) => {
    callerIs('EDITOR');
    const res = await listRoute.POST(req('POST', payload), params);
    // An unknown key is ignored, a wrong or missing reason is refused. Either way the label is fixed.
    if (res.status === 201) expect(mocks.recordCheckpoint).toHaveBeenCalledWith(ROOM, CHECKPOINT_LABEL);
    else expect(res.status).toBe(400);
    expect(mocks.recordCheckpoint).not.toHaveBeenCalledWith(ROOM, 'x');
  });

  it('is rate limited before it records', async () => {
    callerIs('EDITOR');
    mocks.enforceRateLimit.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'slow down'));
    const res = await listRoute.POST(req('POST', body), params);
    expect(res.status).toBe(429);
    expect(mocks.recordCheckpoint).not.toHaveBeenCalled();
  });

  it('passes on "too large to keep" so the restore can be stopped', async () => {
    callerIs('EDITOR');
    mocks.recordCheckpoint.mockRejectedValue(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'too large'));
    const res = await listRoute.POST(req('POST', body), params);
    expect(res.status).toBe(413);
  });

  it('refuses a cross-site request before doing anything', async () => {
    callerIs('EDITOR');
    const res = await listRoute.POST(req('POST', body, { origin: 'https://evil.example' }), params);
    expect(res.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.recordCheckpoint).not.toHaveBeenCalled();
  });
});
