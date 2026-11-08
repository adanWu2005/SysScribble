import 'server-only';
import { KICK_BAN_MS, controlChannel, controlEventSchema, kickBanKey, type ControlEvent } from '@wb/shared';
import { getRedis } from '@/lib/redis';

/**
 * Publish a control event to `room:{roomId}:control`. Every WS instance subscribes
 * and applies it to its in-process sockets within milliseconds (PRD §5.4, §6.4).
 * Fire after the DB write has committed, never before.
 *
 * A Redis failure is logged, not thrown: the database write already happened, so failing
 * the request would misreport it. WS instances re-read roles on a timer as a backstop.
 */
export async function publishControlEvent(event: ControlEvent): Promise<void> {
  const parsed = controlEventSchema.parse(event);
  try {
    await getRedis().publish(controlChannel(parsed.roomId), JSON.stringify(parsed));
  } catch (err) {
    console.error('[control] publish failed', parsed.type, err instanceof Error ? err.message : err);
  }
}

/** Stops a kicked client from simply reconnecting. WS handshakes check this key. */
export async function banFromRoom(roomId: string, userId: string): Promise<void> {
  await getRedis().set(kickBanKey(roomId, userId), '1', { px: KICK_BAN_MS });
}
