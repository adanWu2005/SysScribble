import type { RoomRole } from '@wb/shared';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as kickRoute from '../../src/app/api/rooms/[roomId]/members/[userId]/kick/route';
import * as memberRoute from '../../src/app/api/rooms/[roomId]/members/[userId]/route';
import * as roomRoute from '../../src/app/api/rooms/[roomId]/route';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findMemberRole: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  listMembers: vi.fn(),
  getRoom: vi.fn(),
  updateRoomTitle: vi.fn(),
  deleteRoom: vi.fn(),
  publishControlEvent: vi.fn(),
  banFromRoom: vi.fn(),
  listAssetKeys: vi.fn(),
  deleteObjects: vi.fn(),
  setHuddlePermissions: vi.fn(),
  removeFromHuddle: vi.fn(),
}));

vi.mock('@/lib/auth/requireUser', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/members', () => ({
  findMemberRole: mocks.findMemberRole,
  updateMemberRole: mocks.updateMemberRole,
  removeMember: mocks.removeMember,
  listMembers: mocks.listMembers,
}));
vi.mock('@/lib/db/rooms', () => ({
  getRoom: mocks.getRoom,
  updateRoomTitle: mocks.updateRoomTitle,
  deleteRoom: mocks.deleteRoom,
}));
vi.mock('@/lib/redis-publish', () => ({
  publishControlEvent: mocks.publishControlEvent,
  banFromRoom: mocks.banFromRoom,
}));
vi.mock('@/lib/db/assets', () => ({ listAssetKeys: mocks.listAssetKeys }));
vi.mock('@/lib/r2', () => ({ deleteObjects: mocks.deleteObjects }));
vi.mock('@/lib/livekit', () => ({
  setHuddlePermissions: mocks.setHuddlePermissions,
  removeFromHuddle: mocks.removeFromHuddle,
}));

const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const CALLER = '11111111-2222-4333-8444-555555555555';
const TARGET = '99999999-8888-4777-8666-555555555555';

function req(method: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000/api/rooms/${ROOM}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function ctx<P>(params: P) {
  return { params: Promise.resolve(params) };
}

function callerIs(role: RoomRole | null) {
  mocks.findMemberRole.mockImplementation(async (_room: string, user: string) => (user === CALLER ? role : 'EDITOR'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: CALLER, email: 'a@b.c' });
  mocks.getRoom.mockResolvedValue({ id: ROOM, title: 'x' });
  mocks.updateMemberRole.mockResolvedValue(true);
  mocks.removeMember.mockResolvedValue(true);
  mocks.listAssetKeys.mockResolvedValue([]);
  mocks.deleteObjects.mockResolvedValue(undefined);
});

describe('GET /api/rooms/:roomId', () => {
  it('rejects a malformed room id before touching auth or the database', async () => {
    const res = await roomRoute.GET(req('GET'), ctx({ roomId: "' OR 1=1 --" }));
    expect(res.status).toBe(400);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.getRoom).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED'));
    const res = await roomRoute.GET(req('GET'), ctx({ roomId: ROOM }));
    expect(res.status).toBe(401);
  });

  it('IDOR: a signed-in non-member cannot read the room', async () => {
    callerIs(null);
    const res = await roomRoute.GET(req('GET'), ctx({ roomId: ROOM }));
    expect(res.status).toBe(403);
    expect(mocks.getRoom).not.toHaveBeenCalled();
  });

  it('returns the room and role to a member', async () => {
    callerIs('VIEWER');
    const res = await roomRoute.GET(req('GET'), ctx({ roomId: ROOM }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ role: 'VIEWER' });
  });
});

describe('PATCH and DELETE /api/rooms/:roomId', () => {
  it('a viewer cannot rename the room', async () => {
    callerIs('VIEWER');
    const res = await roomRoute.PATCH(req('PATCH', { title: 'pwned' }), ctx({ roomId: ROOM }));
    expect(res.status).toBe(403);
    expect(mocks.updateRoomTitle).not.toHaveBeenCalled();
  });

  it('a non-member cannot rename the room', async () => {
    callerIs(null);
    const res = await roomRoute.PATCH(req('PATCH', { title: 'pwned' }), ctx({ roomId: ROOM }));
    expect(res.status).toBe(403);
    expect(mocks.updateRoomTitle).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'EDITOR'] as const)('%s can rename the room', async (role) => {
    callerIs(role);
    mocks.updateRoomTitle.mockResolvedValue({ id: ROOM, title: 'New name' });
    const res = await roomRoute.PATCH(req('PATCH', { title: 'New name' }), ctx({ roomId: ROOM }));
    expect(res.status).toBe(200);
    expect(mocks.updateRoomTitle).toHaveBeenCalledWith(ROOM, 'New name');
  });

  it('refuses an empty or oversized new name', async () => {
    callerIs('OWNER');
    for (const title of ['', '   ', 'x'.repeat(121)]) {
      const res = await roomRoute.PATCH(req('PATCH', { title }), ctx({ roomId: ROOM }));
      expect(res.status).toBe(400);
    }
  });

  it.each(['EDITOR', 'VIEWER'] as const)('%s cannot delete the room', async (role) => {
    callerIs(role);
    const res = await roomRoute.DELETE(req('DELETE'), ctx({ roomId: ROOM }));
    expect(res.status).toBe(403);
    expect(mocks.deleteRoom).not.toHaveBeenCalled();
    expect(mocks.publishControlEvent).not.toHaveBeenCalled();
  });

  it('room delete also removes the R2 objects the cascade cannot reach', async () => {
    callerIs('OWNER');
    const key = `rooms/${ROOM}/a.png`;
    mocks.listAssetKeys.mockResolvedValue([key]);
    const res = await roomRoute.DELETE(req('DELETE'), ctx({ roomId: ROOM }));
    expect(res.status).toBe(200);
    expect(mocks.deleteObjects).toHaveBeenCalledWith([key]);
    const [listOrder] = mocks.listAssetKeys.mock.invocationCallOrder;
    const [deleteOrder] = mocks.deleteRoom.mock.invocationCallOrder;
    expect(listOrder).toBeLessThan(deleteOrder as number);
  });

  it('a storage failure does not fail an already-committed room delete', async () => {
    callerIs('OWNER');
    mocks.listAssetKeys.mockResolvedValue([`rooms/${ROOM}/a.png`]);
    mocks.deleteObjects.mockRejectedValue(new Error('r2 down'));
    const res = await roomRoute.DELETE(req('DELETE'), ctx({ roomId: ROOM }));
    expect(res.status).toBe(200);
  });

  it('OWNER delete removes the room, then evicts live sockets', async () => {
    callerIs('OWNER');
    const res = await roomRoute.DELETE(req('DELETE'), ctx({ roomId: ROOM }));
    expect(res.status).toBe(200);
    expect(mocks.deleteRoom).toHaveBeenCalledWith(ROOM);
    expect(mocks.publishControlEvent).toHaveBeenCalledWith({ type: 'ROOM_DELETED', roomId: ROOM });
    const [deleteOrder] = mocks.deleteRoom.mock.invocationCallOrder;
    const [publishOrder] = mocks.publishControlEvent.mock.invocationCallOrder;
    expect(deleteOrder).toBeLessThan(publishOrder as number);
  });
});

describe('PATCH /api/rooms/:roomId/members/:userId', () => {
  const params = ctx({ roomId: ROOM, userId: TARGET });

  it('EDITOR cannot change roles', async () => {
    callerIs('EDITOR');
    const res = await memberRoute.PATCH(req('PATCH', { role: 'VIEWER' }), params);
    expect(res.status).toBe(403);
    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
  });

  it('OWNER cannot be granted through the API', async () => {
    callerIs('OWNER');
    const res = await memberRoute.PATCH(req('PATCH', { role: 'OWNER' }), params);
    expect(res.status).toBe(400);
    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
  });

  it('an owner cannot change their own role', async () => {
    callerIs('OWNER');
    const res = await memberRoute.PATCH(req('PATCH', { role: 'VIEWER' }), ctx({ roomId: ROOM, userId: CALLER }));
    expect(res.status).toBe(400);
  });

  it('downgrade writes first, then publishes ROLE_CHANGED for live sockets', async () => {
    callerIs('OWNER');
    const res = await memberRoute.PATCH(req('PATCH', { role: 'VIEWER' }), params);
    expect(res.status).toBe(200);
    expect(mocks.publishControlEvent).toHaveBeenCalledWith({
      type: 'ROLE_CHANGED',
      roomId: ROOM,
      userId: TARGET,
      role: 'VIEWER',
    });
    const [writeOrder] = mocks.updateMemberRole.mock.invocationCallOrder;
    const [publishOrder] = mocks.publishControlEvent.mock.invocationCallOrder;
    expect(writeOrder).toBeLessThan(publishOrder as number);
  });

  it('a downgrade also strips publish rights in a live huddle', async () => {
    callerIs('OWNER');
    await memberRoute.PATCH(req('PATCH', { role: 'VIEWER' }), params);
    expect(mocks.setHuddlePermissions).toHaveBeenCalledWith(ROOM, TARGET, 'VIEWER');
  });

  it('publishes nothing when the target row did not change', async () => {
    callerIs('OWNER');
    mocks.updateMemberRole.mockResolvedValue(false);
    const res = await memberRoute.PATCH(req('PATCH', { role: 'VIEWER' }), params);
    expect(res.status).toBe(404);
    expect(mocks.publishControlEvent).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/rooms/:roomId/members/:userId', () => {
  it('a VIEWER cannot remove someone else', async () => {
    callerIs('VIEWER');
    const res = await memberRoute.DELETE(req('DELETE'), ctx({ roomId: ROOM, userId: TARGET }));
    expect(res.status).toBe(403);
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });

  it('a non-owner can leave, which closes their sockets everywhere', async () => {
    callerIs('EDITOR');
    const res = await memberRoute.DELETE(req('DELETE'), ctx({ roomId: ROOM, userId: CALLER }));
    expect(res.status).toBe(200);
    expect(mocks.publishControlEvent).toHaveBeenCalledWith({ type: 'MEMBER_REMOVED', roomId: ROOM, userId: CALLER });
  });

  it('an owner cannot leave their own room', async () => {
    callerIs('OWNER');
    const res = await memberRoute.DELETE(req('DELETE'), ctx({ roomId: ROOM, userId: CALLER }));
    expect(res.status).toBe(400);
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });
});

describe('POST /api/rooms/:roomId/members/:userId/kick', () => {
  const params = ctx({ roomId: ROOM, userId: TARGET });

  it.each(['EDITOR', 'VIEWER'] as const)('%s cannot kick', async (role) => {
    callerIs(role);
    const res = await kickRoute.POST(req('POST'), params);
    expect(res.status).toBe(403);
    expect(mocks.publishControlEvent).not.toHaveBeenCalled();
  });

  it('OWNER kick bans first, then closes sockets and the huddle', async () => {
    callerIs('OWNER');
    const res = await kickRoute.POST(req('POST'), params);
    expect(res.status).toBe(200);
    expect(mocks.publishControlEvent).toHaveBeenCalledWith({ type: 'KICK', roomId: ROOM, userId: TARGET });
    expect(mocks.removeFromHuddle).toHaveBeenCalledWith(ROOM, TARGET);
    const [banOrder] = mocks.banFromRoom.mock.invocationCallOrder;
    const [publishOrder] = mocks.publishControlEvent.mock.invocationCallOrder;
    expect(banOrder).toBeLessThan(publishOrder as number);
  });

  it('the owner cannot be kicked', async () => {
    mocks.findMemberRole.mockResolvedValue('OWNER');
    const res = await kickRoute.POST(req('POST'), params);
    expect(res.status).toBe(400);
    expect(mocks.publishControlEvent).not.toHaveBeenCalled();
  });
});
