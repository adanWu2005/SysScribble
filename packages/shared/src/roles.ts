import { z } from 'zod';

/** The three room roles stored in `room_members.role` (PRD §3.1). */
export const roomRoleSchema = z.enum(['OWNER', 'EDITOR', 'VIEWER']);
export type RoomRole = z.infer<typeof roomRoleSchema>;

/** Roles an OWNER may assign to someone else. OWNER itself is never assignable via the API. */
export const assignableRoleSchema = z.enum(['EDITOR', 'VIEWER']);
export type AssignableRole = z.infer<typeof assignableRoleSchema>;

export const ROLE_RANK: Readonly<Record<RoomRole, number>> = {
  OWNER: 3,
  EDITOR: 2,
  VIEWER: 1,
};

export const ALL_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const satisfies readonly RoomRole[];
export const MUTATING_ROLES = ['OWNER', 'EDITOR'] as const satisfies readonly RoomRole[];
export const OWNER_ONLY = ['OWNER'] as const satisfies readonly RoomRole[];

/** Whether a role may change document state (Yjs sync updates, uploads, shape edits). */
export function canMutate(role: RoomRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}

/** Whether `role` is at least as privileged as `min`. */
export function hasAtLeast(role: RoomRole, min: RoomRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Type guard used at trust boundaries (e.g. DB rows). */
export function isRoomRole(value: unknown): value is RoomRole {
  return roomRoleSchema.safeParse(value).success;
}
