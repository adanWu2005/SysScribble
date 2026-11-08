import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as acceptRoute from '../../src/app/api/invites/[inviteId]/accept/route';
import * as declineRoute from '../../src/app/api/invites/[inviteId]/decline/route';
import * as pendingRoute from '../../src/app/api/invites/pending/route';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  enforceRateLimit: vi.fn(),
  listPendingInvitesForEmail: vi.fn(),
  acceptInviteById: vi.fn(),
  declineInviteById: vi.fn(),
  findMemberRole: vi.fn(),
  publishControlEvent: vi.fn(),
}));

vi.mock('@/lib/auth/requireUser', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/ratelimit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/db/invites', () => ({
  listPendingInvitesForEmail: mocks.listPendingInvitesForEmail,
  acceptInviteById: mocks.acceptInviteById,
  declineInviteById: mocks.declineInviteById,
}));
vi.mock('@/lib/db/members', () => ({ findMemberRole: mocks.findMemberRole }));
vi.mock('@/lib/redis-publish', () => ({ publishControlEvent: mocks.publishControlEvent }));

const INVITE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const USER = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'Ada@Example.com';

const url = (path: string) => `http://localhost:3000${path}`;
const run = async (res: Promise<Response>) => ({ status: (await res).status });
const accept = (id: string) =>
  run(acceptRoute.POST(new NextRequest(url(`/api/invites/${id}/accept`), { method: 'POST' }), { params: Promise.resolve({ inviteId: id }) }));
const decline = (id: string) =>
  run(declineRoute.POST(new NextRequest(url(`/api/invites/${id}/decline`), { method: 'POST' }), { params: Promise.resolve({ inviteId: id }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: USER, email: EMAIL });
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.listPendingInvitesForEmail.mockResolvedValue([]);
  mocks.acceptInviteById.mockResolvedValue(ROOM);
  mocks.declineInviteById.mockResolvedValue(true);
  mocks.findMemberRole.mockResolvedValue('EDITOR');
});

describe('GET /api/invites/pending', () => {
  const get = () => pendingRoute.GET(new NextRequest(url('/api/invites/pending')), { params: Promise.resolve({}) });

  it('requires sign-in', async () => {
    mocks.requireUser.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await run(get())).status).toBe(401);
    expect(mocks.listPendingInvitesForEmail).not.toHaveBeenCalled();
  });

  it('looks up the caller\'s own verified email and nothing else, whatever the query says', async () => {
    const res = await pendingRoute.GET(new NextRequest(url('/api/invites/pending?email=victim@example.com')), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(mocks.listPendingInvitesForEmail).toHaveBeenCalledTimes(1);
    expect(mocks.listPendingInvitesForEmail).toHaveBeenCalledWith(EMAIL);
  });

  it('returns an empty list for an account without an email, without querying', async () => {
    mocks.requireUser.mockResolvedValueOnce({ userId: USER, email: null });
    const res = await get();
    expect(await res.json()).toEqual({ invites: [] });
    expect(mocks.listPendingInvitesForEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/invites/:inviteId/accept', () => {
  it('rejects a malformed id before touching auth or the database', async () => {
    for (const id of ["' OR 1=1 --", 'not-a-uuid', '../x', '123']) expect((await accept(id)).status).toBe(400);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.acceptInviteById).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    mocks.requireUser.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await accept(INVITE)).status).toBe(401);
    expect(mocks.acceptInviteById).not.toHaveBeenCalled();
  });

  it('is rate-limited before it does anything', async () => {
    mocks.enforceRateLimit.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Too many'));
    expect((await accept(INVITE)).status).toBe(429);
    expect(mocks.acceptInviteById).not.toHaveBeenCalled();
  });

  it('accepts using the id from the URL and the identity from the token, then tells live sockets', async () => {
    const res = await acceptRoute.POST(new NextRequest(url(`/api/invites/${INVITE}/accept`), { method: 'POST', body: JSON.stringify({ email: 'x@y.z', userId: 'evil' }) }), {
      params: Promise.resolve({ inviteId: INVITE }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roomId: ROOM, role: 'EDITOR' });
    expect(mocks.acceptInviteById).toHaveBeenCalledWith(INVITE, USER, EMAIL);
    expect(mocks.publishControlEvent).toHaveBeenCalledWith({ type: 'ROLE_CHANGED', roomId: ROOM, userId: USER, role: 'EDITOR' });
  });

  it('answers 400 for an invite that is not theirs, expired or used, and joins nobody', async () => {
    mocks.acceptInviteById.mockRejectedValueOnce(new ApiError(400, 'INVITE_INVALID', 'This invite is invalid, expired or already used'));
    expect((await accept(INVITE)).status).toBe(400);
    expect(mocks.publishControlEvent).not.toHaveBeenCalled();
  });

  it('refuses an account with no email', async () => {
    mocks.requireUser.mockResolvedValueOnce({ userId: USER, email: null });
    expect((await accept(INVITE)).status).toBe(400);
    expect(mocks.acceptInviteById).not.toHaveBeenCalled();
  });
});

describe('POST /api/invites/:inviteId/decline', () => {
  it('rejects a malformed id before touching auth or the database', async () => {
    for (const id of ["' OR 1=1 --", 'nope']) expect((await decline(id)).status).toBe(400);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.declineInviteById).not.toHaveBeenCalled();
  });

  it('requires sign-in and is rate-limited', async () => {
    mocks.requireUser.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await decline(INVITE)).status).toBe(401);
    mocks.enforceRateLimit.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Too many'));
    expect((await decline(INVITE)).status).toBe(429);
    expect(mocks.declineInviteById).not.toHaveBeenCalled();
  });

  it('declines with the caller\'s own email', async () => {
    expect((await decline(INVITE)).status).toBe(200);
    expect(mocks.declineInviteById).toHaveBeenCalledWith(INVITE, EMAIL);
  });

  it('answers the same for someone else\'s invite as for one that does not exist', async () => {
    mocks.declineInviteById.mockResolvedValue(false);
    const other = await decline(INVITE);
    const missing = await decline('bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(other.status).toBe(400);
    expect(missing.status).toBe(400);
  });
});
