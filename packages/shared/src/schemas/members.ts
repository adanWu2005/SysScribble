import { z } from 'zod';
import { assignableRoleSchema, roomRoleSchema } from '../roles';
import { uuidSchema } from './ids';

export const updateMemberRoleSchema = z.object({
  role: assignableRoleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const memberSchema = z.object({
  userId: uuidSchema,
  role: roomRoleSchema,
  joinedAt: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberListResponseSchema = z.object({ members: z.array(memberSchema) });
