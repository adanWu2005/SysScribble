import { describe, expect, it } from 'vitest';
import { assignableRoleSchema, canMutate, hasAtLeast, isRoomRole, roomRoleSchema } from '../src/roles';

describe('roles', () => {
  it('only OWNER and EDITOR can mutate', () => {
    expect(canMutate('OWNER')).toBe(true);
    expect(canMutate('EDITOR')).toBe(true);
    expect(canMutate('VIEWER')).toBe(false);
  });

  it('ranks roles', () => {
    expect(hasAtLeast('OWNER', 'EDITOR')).toBe(true);
    expect(hasAtLeast('EDITOR', 'OWNER')).toBe(false);
    expect(hasAtLeast('VIEWER', 'VIEWER')).toBe(true);
  });

  it('OWNER is never assignable through the API', () => {
    expect(assignableRoleSchema.safeParse('OWNER').success).toBe(false);
    expect(assignableRoleSchema.safeParse('EDITOR').success).toBe(true);
  });

  it('rejects unknown roles at the trust boundary', () => {
    expect(isRoomRole('ADMIN')).toBe(false);
    expect(roomRoleSchema.safeParse('owner').success).toBe(false);
  });
});
