import { z } from 'zod';
import { roomRoleSchema } from '../roles';
import { uuidSchema } from './ids';

export const ROOM_TITLE_MAX = 120;

const titleSchema = z.string().trim().min(1).max(ROOM_TITLE_MAX);

/**
 * Starting points for a new workspace. `blank` is an empty room; the others are built on the
 * server, so the client names a template and never sends document bytes.
 */
export const TEMPLATE_IDS = ['blank', 'rfc', 'kanban', 'retro'] as const;
export const templateIdSchema = z.enum(TEMPLATE_IDS);
export type RoomTemplateId = z.infer<typeof templateIdSchema>;

export const createRoomSchema = z.object({
  title: titleSchema.optional().default('Untitled Workspace'),
  template: templateIdSchema.optional(),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const updateRoomSchema = z.object({
  title: titleSchema,
});
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

export const roomSchema = z.object({
  id: uuidSchema,
  ownerId: uuidSchema,
  title: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Room = z.infer<typeof roomSchema>;

export const roomWithRoleSchema = roomSchema.extend({ role: roomRoleSchema });
export type RoomWithRole = z.infer<typeof roomWithRoleSchema>;

export const roomListResponseSchema = z.object({ rooms: z.array(roomWithRoleSchema) });
export const roomResponseSchema = z.object({ room: roomSchema, role: roomRoleSchema });

/** What a dashboard card shows beyond the room row. Names are only a few initials' worth. */
export const roomSummarySchema = z.object({
  roomId: uuidSchema,
  shapeCount: z.number().int().min(0),
  /** A small SVG picture of the board, as a `data:` URL for an <img>, or null when there is nothing to draw. */
  thumbnail: z.string().max(120_000).nullable(),
  memberCount: z.number().int().min(0),
  /** The first few members, oldest first, for the avatar stack. */
  people: z.array(z.string().max(80)).max(3),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;
export const roomSummariesResponseSchema = z.object({ summaries: z.array(roomSummarySchema) });

/** Active headcount by room id. Rooms nobody is in are left out. */
export const presenceResponseSchema = z.object({ presence: z.record(uuidSchema, z.number().int().min(1)) });
export type PresenceResponse = z.infer<typeof presenceResponseSchema>;
