import { z } from 'zod';

/** Every ID that arrives from a URL, query string, body or WS payload goes through this first (PRD §5.1). */
export const uuidSchema = z.string().uuid();

export const roomIdParamsSchema = z.object({ roomId: uuidSchema });
export type RoomIdParams = z.infer<typeof roomIdParamsSchema>;

export const roomMemberParamsSchema = z.object({ roomId: uuidSchema, userId: uuidSchema });
export type RoomMemberParams = z.infer<typeof roomMemberParamsSchema>;

export const roomAssetParamsSchema = z.object({ roomId: uuidSchema, assetId: uuidSchema });
export type RoomAssetParams = z.infer<typeof roomAssetParamsSchema>;

export const roomInviteParamsSchema = z.object({ roomId: uuidSchema, inviteId: uuidSchema });
export type RoomInviteParams = z.infer<typeof roomInviteParamsSchema>;
