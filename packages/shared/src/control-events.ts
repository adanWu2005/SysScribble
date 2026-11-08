import { z } from 'zod';
import { roomRoleSchema } from './roles';
import { uuidSchema } from './schemas/ids';

/**
 * Events published by the REST layer to Redis `room:{roomId}:control` so every
 * WebSocket instance can mutate or close affected sockets in-process (PRD §5.4).
 */
export const controlEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ROLE_CHANGED'),
    roomId: uuidSchema,
    userId: uuidSchema,
    role: roomRoleSchema,
  }),
  z.object({ type: z.literal('MEMBER_REMOVED'), roomId: uuidSchema, userId: uuidSchema }),
  z.object({ type: z.literal('KICK'), roomId: uuidSchema, userId: uuidSchema }),
  z.object({ type: z.literal('ROOM_DELETED'), roomId: uuidSchema }),
]);
export type ControlEvent = z.infer<typeof controlEventSchema>;

export const CONTROL_CHANNEL_PATTERN = 'room:*:control' as const;

export function controlChannel(roomId: string): string {
  return `room:${roomId}:control`;
}

export function syncChannel(roomId: string): string {
  return `room:${roomId}:sync`;
}

export function kickBanKey(roomId: string, userId: string): string {
  return `kick:room:${roomId}:${userId}`;
}

export function flushLockKey(roomId: string): string {
  return `lock:room:${roomId}:flush`;
}

/** Extract the roomId from a `room:{id}:control` or `room:{id}:sync` channel name. */
export function roomIdFromChannel(channel: string): string | null {
  const m = /^room:([0-9a-f-]{36}):(control|sync)$/i.exec(channel);
  return m?.[1] ?? null;
}
