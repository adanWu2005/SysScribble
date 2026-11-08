import { z } from 'zod';
import { assignableRoleSchema, roomRoleSchema } from '../roles';
import { uuidSchema } from './ids';

/** 32 random bytes, base64url, no padding → exactly 43 chars. */
export const INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export const createInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  role: assignableRoleSchema.default('EDITOR'),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().regex(INVITE_TOKEN_REGEX, 'Malformed invite token'),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const inviteSchema = z.object({
  id: uuidSchema,
  roomId: uuidSchema,
  email: z.string(),
  role: roomRoleSchema,
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdBy: uuidSchema,
});
export type Invite = z.infer<typeof inviteSchema>;

export const inviteListResponseSchema = z.object({ invites: z.array(inviteSchema) });
export const acceptInviteResponseSchema = z.object({ roomId: uuidSchema, role: roomRoleSchema });

export const inviteIdParamsSchema = z.object({ inviteId: uuidSchema });

/**
 * An invitation as its recipient sees it on the dashboard. It names the room and who sent it, and
 * carries no token, no hash and no email address of the sender.
 */
export const pendingInviteSchema = z.object({
  inviteId: uuidSchema,
  roomId: uuidSchema,
  roomTitle: z.string().max(120),
  role: roomRoleSchema,
  invitedBy: z.string().max(80),
  expiresAt: z.string(),
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;
export const pendingInvitesResponseSchema = z.object({ invites: z.array(pendingInviteSchema) });
