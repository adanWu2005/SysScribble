import type { RoomRole } from '@wb/shared';
import { MAX_UPLOAD_BYTES } from '@wb/shared';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as acceptRoute from '../../src/app/api/invites/accept/route';
import * as assetRoute from '../../src/app/api/rooms/[roomId]/assets/[assetId]/route';
import * as inviteRoute from '../../src/app/api/rooms/[roomId]/invite/route';
import * as revokeRoute from '../../src/app/api/rooms/[roomId]/invites/[inviteId]/route';
import * as livekitRoute from '../../src/app/api/rooms/[roomId]/livekit-token/route';
import * as uploadRoute from '../../src/app/api/rooms/[roomId]/upload-url/route';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findMemberRole: vi.fn(),
  reserveAsset: vi.fn(),
  findAsset: vi.fn(),
  deleteAssetRow: vi.fn(),
  presignPut: vi.fn(),
  presignGet: vi.fn(),
  deleteObject: vi.fn(),
  enforceRateLimit: vi.fn(),
  createInvite: vi.fn(),
  deleteInvite: vi.fn(),
  listPendingInvites: vi.fn(),
  revokeInvite: vi.fn(),
  acceptInvite: vi.fn(),
  getRoom: vi.fn(),
  sendInviteEmail: vi.fn(),
  mintHuddleToken: vi.fn(),
  publishControlEvent: vi.fn(),
}));

vi.mock('@/lib/auth/requireUser', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/members', () => ({ findMemberRole: mocks.findMemberRole }));
vi.mock('@/lib/db/assets', () => ({
  reserveAsset: mocks.reserveAsset,
  findAsset: mocks.findAsset,
  deleteAssetRow: mocks.deleteAssetRow,
}));
vi.mock('@/lib/r2', () => ({
  buildObjectKey: (room: string, asset: string) => `rooms/${room}/${asset}.png`,
  presignPut: mocks.presignPut,
  presignGet: mocks.presignGet,
  deleteObject: mocks.deleteObject,
}));
vi.mock('@/lib/ratelimit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/db/invites', () => ({
  createInvite: mocks.createInvite,
  deleteInvite: mocks.deleteInvite,
  listPendingInvites: mocks.listPendingInvites,
  revokeInvite: mocks.revokeInvite,
  acceptInvite: mocks.acceptInvite,
}));
vi.mock('@/lib/db/rooms', () => ({ getRoom: mocks.getRoom }));
vi.mock('@/lib/resend', () => ({ sendInviteEmail: mocks.sendInviteEmail }));
vi.mock('@/lib/livekit', () => ({ mintHuddleToken: mocks.mintHuddleToken }));
vi.mock('@/lib/redis-publish', () => ({ publishControlEvent: mocks.publishControlEvent }));

const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const ASSET = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CALLER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const TOKEN = 'a'.repeat(43);

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost:3000/api/x', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function ctx<P>(params: P) {
  return { params: Promise.resolve(params) };
}

function callerIs(role: RoomRole | null) {
  mocks.findMemberRole.mockResolvedValue(role);
}

const upload = { filename: 'photo.png', contentType: 'image/png', sizeBytes: 1024 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: CALLER, email: 'me@example.com' });
  mocks.reserveAsset.mockResolvedValue(true);
  mocks.presignPut.mockResolvedValue('https://r2.example/put');
  mocks.presignGet.mockResolvedValue('https://r2.example/get');
  mocks.getRoom.mockResolvedValue({ id: ROOM, title: 'Plan' });
  mocks.createInvite.mockResolvedValue({ id: ASSET });
  mocks.mintHuddleToken.mockResolvedValue('lk-token');
  mocks.enforceRateLimit.mockResolvedValue(undefined);
});

describe('POST upload-url', () => {
  const params = ctx({ roomId: ROOM });

  it('VIEWER and non-members cannot get a slot', async () => {
    for (const role of ['VIEWER', null] as const) {
      callerIs(role);
      const res = await uploadRoute.POST(req('POST', upload), params);
      expect(res.status).toBe(403);
    }
    expect(mocks.presignPut).not.toHaveBeenCalled();
    expect(mocks.reserveAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['SVG', { ...upload, contentType: 'image/svg+xml' }],
    ['HTML', { ...upload, contentType: 'text/html' }],
    ['an oversized file', { ...upload, sizeBytes: MAX_UPLOAD_BYTES + 1 }],
  ])('refuses %s before reserving anything', async (_name, body) => {
    callerIs('EDITOR');
    const res = await uploadRoute.POST(req('POST', body), params);
    expect(res.status).toBe(400);
    expect(mocks.reserveAsset).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied object key', async () => {
    callerIs('EDITOR');
    const res = await uploadRoute.POST(
      req('POST', { ...upload, objectKey: `rooms/${OTHER}/stolen.png`, r2_object_key: '../evil' }),
      params,
    );
    expect(res.status).toBe(201);
    const { objectKey } = (await res.json()) as { objectKey: string };
    expect(objectKey.startsWith(`rooms/${ROOM}/`)).toBe(true);
  });

  it('reserves before signing and returns no URL when the quota is full', async () => {
    callerIs('EDITOR');
    mocks.reserveAsset.mockResolvedValue(false);
    const res = await uploadRoute.POST(req('POST', upload), params);
    expect(res.status).toBe(413);
    expect(mocks.presignPut).not.toHaveBeenCalled();
  });

  it('signs the exact declared size', async () => {
    callerIs('EDITOR');
    const res = await uploadRoute.POST(req('POST', upload), params);
    expect(res.status).toBe(201);
    expect(mocks.presignPut).toHaveBeenCalledWith(expect.any(String), 'image/png', 1024);
  });

  it('a rate-limited caller gets no reservation', async () => {
    callerIs('EDITOR');
    mocks.enforceRateLimit.mockRejectedValue(new ApiError(429, 'RATE_LIMITED'));
    const res = await uploadRoute.POST(req('POST', upload), params);
    expect(res.status).toBe(429);
    expect(mocks.reserveAsset).not.toHaveBeenCalled();
  });
});

describe('asset access', () => {
  const params = ctx({ roomId: ROOM, assetId: ASSET });
  const asset = { id: ASSET, roomId: ROOM, uploadedBy: OTHER, objectKey: `rooms/${ROOM}/${ASSET}.png`, mimeType: 'image/png' };

  it('IDOR: a non-member cannot read an asset', async () => {
    callerIs(null);
    mocks.findAsset.mockResolvedValue(asset);
    const res = await assetRoute.GET(req('GET'), params);
    expect(res.status).toBe(403);
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it('IDOR: an asset from another room looks like it does not exist', async () => {
    callerIs('OWNER');
    mocks.findAsset.mockResolvedValue(null);
    expect((await assetRoute.GET(req('GET'), params)).status).toBe(404);
    expect((await assetRoute.DELETE(req('DELETE'), params)).status).toBe(404);
    expect(mocks.findAsset).toHaveBeenCalledWith(ROOM, ASSET);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('a VIEWER cannot delete', async () => {
    callerIs('VIEWER');
    mocks.findAsset.mockResolvedValue(asset);
    expect((await assetRoute.DELETE(req('DELETE'), params)).status).toBe(403);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('an EDITOR can delete their own upload but not someone else\'s', async () => {
    callerIs('EDITOR');
    mocks.findAsset.mockResolvedValue(asset);
    expect((await assetRoute.DELETE(req('DELETE'), params)).status).toBe(403);
    expect(mocks.deleteObject).not.toHaveBeenCalled();

    mocks.findAsset.mockResolvedValue({ ...asset, uploadedBy: CALLER });
    expect((await assetRoute.DELETE(req('DELETE'), params)).status).toBe(200);
  });

  it('OWNER delete uses the stored key, not anything from the request', async () => {
    callerIs('OWNER');
    mocks.findAsset.mockResolvedValue(asset);
    const res = await assetRoute.DELETE(req('DELETE', { key: 'rooms/other/x.png' }), params);
    expect(res.status).toBe(200);
    expect(mocks.deleteObject).toHaveBeenCalledWith(asset.objectKey);
  });
});

describe('invites', () => {
  const params = ctx({ roomId: ROOM });
  const body = { email: 'New@Example.com', role: 'EDITOR' };

  it.each(['EDITOR', 'VIEWER'] as const)('%s cannot invite', async (role) => {
    callerIs(role);
    expect((await inviteRoute.POST(req('POST', body), params)).status).toBe(403);
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('OWNER cannot be granted by invite', async () => {
    callerIs('OWNER');
    const res = await inviteRoute.POST(req('POST', { ...body, role: 'OWNER' }), params);
    expect(res.status).toBe(400);
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('stores only the hash and never returns the token', async () => {
    callerIs('OWNER');
    const res = await inviteRoute.POST(req('POST', body), params);
    expect(res.status).toBe(201);

    const emailed = mocks.sendInviteEmail.mock.calls[0]?.[0] as { token: string; to: string };
    const stored = mocks.createInvite.mock.calls[0]?.[0] as { tokenHash: string; email: string };
    expect(emailed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(emailed.to).toBe('new@example.com');
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toContain(emailed.token);
    expect(JSON.stringify(await res.json())).not.toContain(emailed.token);
  });

  it('a failed email leaves no usable invite behind', async () => {
    callerIs('OWNER');
    mocks.sendInviteEmail.mockRejectedValue(new Error('resend down'));
    const res = await inviteRoute.POST(req('POST', body), params);
    expect(res.status).toBe(502);
    expect(mocks.deleteInvite).toHaveBeenCalled();
  });

  it('the rate limit runs before any email is sent', async () => {
    callerIs('OWNER');
    mocks.enforceRateLimit.mockRejectedValue(new ApiError(429, 'RATE_LIMITED'));
    expect((await inviteRoute.POST(req('POST', body), params)).status).toBe(429);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith('invite', CALLER);
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('only an OWNER can list or revoke', async () => {
    callerIs('EDITOR');
    expect((await inviteRoute.GET(req('GET'), params)).status).toBe(403);
    const res = await revokeRoute.DELETE(req('DELETE'), ctx({ roomId: ROOM, inviteId: ASSET }));
    expect(res.status).toBe(403);
    expect(mocks.revokeInvite).not.toHaveBeenCalled();
  });

  describe('accept', () => {
    it('hashes the token and takes the email from the verified session', async () => {
      mocks.acceptInvite.mockResolvedValue(ROOM);
      callerIs('EDITOR');
      const res = await acceptRoute.POST(
        req('POST', { token: TOKEN, email: 'attacker@evil.example' }),
        ctx({}),
      );
      expect(res.status).toBe(200);
      const [hash, userId, email] = mocks.acceptInvite.mock.calls[0] as [string, string, string];
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(userId).toBe(CALLER);
      expect(email).toBe('me@example.com');
    });

    it('updates sockets that are already open', async () => {
      mocks.acceptInvite.mockResolvedValue(ROOM);
      callerIs('VIEWER');
      await acceptRoute.POST(req('POST', { token: TOKEN }), ctx({}));
      expect(mocks.publishControlEvent).toHaveBeenCalledWith({
        type: 'ROLE_CHANGED',
        roomId: ROOM,
        userId: CALLER,
        role: 'VIEWER',
      });
    });

    it('refuses a malformed token without touching the database', async () => {
      const res = await acceptRoute.POST(req('POST', { token: "' OR 1=1 --" }), ctx({}));
      expect(res.status).toBe(400);
      expect(mocks.acceptInvite).not.toHaveBeenCalled();
    });

    it('requires sign-in', async () => {
      mocks.requireUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED'));
      expect((await acceptRoute.POST(req('POST', { token: TOKEN }), ctx({}))).status).toBe(401);
    });
  });
});

describe('POST livekit-token', () => {
  const params = ctx({ roomId: ROOM });

  it('a non-member gets no token', async () => {
    callerIs(null);
    expect((await livekitRoute.POST(req('POST'), params)).status).toBe(403);
    expect(mocks.mintHuddleToken).not.toHaveBeenCalled();
  });

  it('mints with the server-side role, not anything the client sends', async () => {
    callerIs('VIEWER');
    const res = await livekitRoute.POST(req('POST', { role: 'OWNER', canPublish: true }), params);
    expect(res.status).toBe(200);
    expect(mocks.mintHuddleToken).toHaveBeenCalledWith(ROOM, CALLER, 'me', 'VIEWER');
    await expect(res.json()).resolves.toMatchObject({ canPublish: false });
  });

  it('is rate limited', async () => {
    callerIs('EDITOR');
    mocks.enforceRateLimit.mockRejectedValue(new ApiError(429, 'RATE_LIMITED'));
    expect((await livekitRoute.POST(req('POST'), params)).status).toBe(429);
    expect(mocks.mintHuddleToken).not.toHaveBeenCalled();
  });
});
