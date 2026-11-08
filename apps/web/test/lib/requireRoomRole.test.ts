import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { requireRoomMember, requireRoomRole } from '@/lib/auth/requireRoomRole';

vi.mock('@/lib/db/members', () => ({ findMemberRole: vi.fn() }));

const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const USER = '11111111-2222-4333-8444-555555555555';

describe('requireRoomRole', () => {
  it('rejects a non-member even with an otherwise valid identity', async () => {
    await expect(requireRoomRole(ROOM, USER, ['OWNER'], async () => null)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('rejects a member whose role is not allowed', async () => {
    const err = await requireRoomRole(ROOM, USER, ['OWNER', 'EDITOR'], async () => 'VIEWER').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'INSUFFICIENT_ROLE' });
  });

  it('returns the role when allowed and looks up the exact room and user', async () => {
    const lookup = vi.fn(async () => 'EDITOR' as const);
    await expect(requireRoomRole(ROOM, USER, ['OWNER', 'EDITOR'], lookup)).resolves.toBe('EDITOR');
    expect(lookup).toHaveBeenCalledWith(ROOM, USER);
  });

  it('requireRoomMember accepts any role but still requires a row', async () => {
    await expect(requireRoomMember(ROOM, USER, async () => 'VIEWER')).resolves.toBe('VIEWER');
    await expect(requireRoomMember(ROOM, USER, async () => null)).rejects.toMatchObject({ status: 403 });
  });
});
