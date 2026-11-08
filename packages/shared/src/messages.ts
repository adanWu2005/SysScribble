import { z } from 'zod';
import { roomRoleSchema } from './roles';

/**
 * WebSocket wire protocol.
 *
 * Every frame is binary: `[messageType: varUint][payload]`.
 * Types 0, 1 and 3 match y-websocket so the y-protocols helpers apply unchanged.
 */
export const MSG_SYNC = 0 as const;
export const MSG_AWARENESS = 1 as const;
export const MSG_AUTH = 2 as const;
export const MSG_QUERY_AWARENESS = 3 as const;
/** Server → client only. Payload is a JSON string (see `serverControlFrameSchema`). */
export const MSG_CONTROL = 4 as const;
/**
 * Latency probe. The client sends MSG_PING with a varUint nonce and the server answers
 * MSG_PONG with the same nonce. Allowed for every role: it touches no room state.
 */
export const MSG_PING = 5 as const;
export const MSG_PONG = 6 as const;
/**
 * Client asks for this room's server-side numbers (pending edits, last flush). The server answers
 * with a MSG_CONTROL `ROOM_STATS` frame. It reads no document content, so every role may ask.
 */
export const MSG_STATS_REQUEST = 7 as const;

/** Sub-types inside MSG_SYNC, from y-protocols/sync. */
export const SYNC_STEP1 = 0 as const; // client sends its state vector — read-only, VIEWER allowed
export const SYNC_STEP2 = 1 as const; // full diff — MUTATES the doc
export const SYNC_UPDATE = 2 as const; // incremental update — MUTATES the doc

/** Close codes. 1008 is the RFC 6455 "policy violation"; 4xxx are application-defined. */
export const WS_CLOSE = {
  POLICY_VIOLATION: 1008,
  UNAUTHORIZED: 4001,
  FORBIDDEN: 4003,
  REMOVED: 4004,
  ROOM_DELETED: 4005,
  KICKED: 4006,
  SERVER_SHUTDOWN: 4010,
} as const;
export type WsCloseCode = (typeof WS_CLOSE)[keyof typeof WS_CLOSE];

/**
 * Numbers about one room on the instance a socket is connected to. No user ids and nothing from
 * the document, only counts and times. `serverTime` lets the client measure ages without
 * trusting its own clock.
 */
export const roomStatsSchema = z.object({
  /** Edits received since the last write to Postgres. */
  pendingEdits: z.number().int().nonnegative(),
  /** When this instance last wrote the room to Postgres, in epoch milliseconds. */
  lastFlushAt: z.number().int().nullable(),
  lastFlushOutcome: z.enum(['saved', 'skipped', 'busy', 'failed']).nullable(),
  /** Sockets on this instance for this room. */
  sockets: z.number().int().nonnegative(),
  serverTime: z.number().int(),
});
export type RoomStats = z.infer<typeof roomStatsSchema>;

/** Control frames the server pushes to a single client (MSG_CONTROL + JSON). */
export const serverControlFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ROLE_UPDATED'), role: roomRoleSchema }),
  z.object({ type: z.literal('SESSION'), role: roomRoleSchema, userId: z.string().uuid() }),
  roomStatsSchema.extend({ type: z.literal('ROOM_STATS') }),
]);
export type ServerControlFrame = z.infer<typeof serverControlFrameSchema>;

/** Subprotocol used by the browser client. The JWT travels as a second subprotocol entry `bearer.<jwt>`. */
export const WS_SUBPROTOCOL = 'wb.v1' as const;
export const WS_BEARER_PREFIX = 'bearer.' as const;
