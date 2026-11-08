import {
  MAX_AWARENESS_PAYLOAD_BYTES,
  MSG_AWARENESS,
  MSG_PING,
  MSG_QUERY_AWARENESS,
  MSG_STATS_REQUEST,
  MSG_SYNC,
  STATS_MIN_INTERVAL_MS,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
  WS_CLOSE,
  awarenessStateSchema,
  canMutate,
  encodeAwarenessFrame,
  encodeControlFrame,
  encodePong,
  encodeSyncStep2,
  usesMutationOnlyAwareness,
  type RoomStats,
} from '@wb/shared';
import * as decoding from 'lib0/decoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { securityEvent, type Logger } from '../logger';
import type { Client } from './Client';

/** The parts of a room the packet handler touches, which keeps it unit-testable. */
export interface MessageContext {
  roomId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  overQuota: boolean;
  log: Logger;
  /** Counts and times for the Chaos Lab. Nothing from the document. */
  stats(): RoomStats;
}

interface AwarenessEntry {
  clientId: number;
  state: unknown;
}

function parseAwarenessUpdate(update: Uint8Array): AwarenessEntry[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries: AwarenessEntry[] = [];
  for (let i = 0; i < count; i++) {
    const clientId = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder); // clock
    entries.push({ clientId, state: JSON.parse(decoding.readVarString(decoder)) });
  }
  return entries;
}

function dropMalformed(ctx: MessageContext, client: Client): void {
  securityEvent(ctx.log, 'malformed_frame', {
    userId: client.data.userId,
    roomId: ctx.roomId,
    ip: client.data.ip,
  });
  client.close(WS_CLOSE.POLICY_VIOLATION, 'Malformed frame');
}

/**
 * A socket may only publish one awareness identity, must carry its authenticated user id,
 * and cannot overwrite or clear a state that belongs to another user.
 */
function isOwnAwareness(ctx: MessageContext, client: Client, entries: AwarenessEntry[]): boolean {
  if (entries.length !== 1) return false;
  const entry = entries[0];
  if (!entry) return false;
  if (client.awarenessClientId !== null && client.awarenessClientId !== entry.clientId) return false;

  const existing = awarenessStateSchema.safeParse(ctx.awareness.getStates().get(entry.clientId));
  if (existing.success && existing.data.user.id !== client.data.userId) return false;

  if (entry.state !== null) {
    const next = awarenessStateSchema.safeParse(entry.state);
    if (!next.success || next.data.user.id !== client.data.userId) return false;
  }
  client.awarenessClientId = entry.clientId;
  return true;
}

function handleSync(ctx: MessageContext, client: Client, decoder: decoding.Decoder): void {
  const subtype = decoding.readVarUint(decoder);
  const payload = decoding.readVarUint8Array(decoder);
  if (decoding.hasContent(decoder)) throw new Error('trailing bytes');

  switch (subtype) {
    case SYNC_STEP1:
      // Read-only: the client asks for what it is missing. Allowed for every role.
      client.send(encodeSyncStep2(Y.encodeStateAsUpdate(ctx.doc, payload)));
      return;
    case SYNC_STEP2:
    case SYNC_UPDATE:
      // This check is the real authorization. Any UI restriction is cosmetic (PRD §5.3).
      if (!canMutate(client.data.role)) {
        securityEvent(ctx.log, 'viewer_mutation_dropped', {
          userId: client.data.userId,
          roomId: ctx.roomId,
          ip: client.data.ip,
        });
        return;
      }
      if (ctx.overQuota) {
        securityEvent(ctx.log, 'room_over_quota_dropped', { userId: client.data.userId, roomId: ctx.roomId });
        return;
      }
      Y.applyUpdate(ctx.doc, payload, client);
      return;
    default:
      throw new Error('unknown sync subtype');
  }
}

function handleAwareness(ctx: MessageContext, client: Client, decoder: decoding.Decoder): void {
  const update = decoding.readVarUint8Array(decoder);
  if (decoding.hasContent(decoder)) throw new Error('trailing bytes');
  if (update.length > MAX_AWARENESS_PAYLOAD_BYTES) throw new Error('awareness payload too large');

  const entries = parseAwarenessUpdate(update);

  // A viewer may show a cursor, a viewport and a selection, but never a laser or a drawing
  // indicator. Those say "I am editing", and the UI hiding the tool is only cosmetic.
  if (!canMutate(client.data.role) && entries.some((entry) => usesMutationOnlyAwareness(entry.state))) {
    securityEvent(ctx.log, 'viewer_awareness_dropped', {
      userId: client.data.userId,
      roomId: ctx.roomId,
      ip: client.data.ip,
    });
    return;
  }

  if (!isOwnAwareness(ctx, client, entries)) {
    securityEvent(ctx.log, 'awareness_spoof_dropped', {
      userId: client.data.userId,
      roomId: ctx.roomId,
      ip: client.data.ip,
    });
    return;
  }
  awarenessProtocol.applyAwarenessUpdate(ctx.awareness, update, client);
}

/** Entry point for every inbound frame. Malformed input closes the socket with 1008. */
export function handleMessage(ctx: MessageContext, client: Client, data: Uint8Array): void {
  const decoder = decoding.createDecoder(data);
  try {
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MSG_SYNC:
        handleSync(ctx, client, decoder);
        return;
      case MSG_AWARENESS:
        handleAwareness(ctx, client, decoder);
        return;
      case MSG_PING: {
        // Latency probe: echo the nonce. It reads and writes no room state, so every role may.
        const nonce = decoding.readVarUint(decoder);
        if (decoding.hasContent(decoder)) throw new Error('trailing bytes');
        client.send(encodePong(nonce));
        return;
      }
      case MSG_STATS_REQUEST: {
        if (decoding.hasContent(decoder)) throw new Error('trailing bytes');
        // Allowed for every role: it reads no document content. Asking more often than the
        // Chaos Lab does is pointless, so extra requests are dropped without a reply.
        const now = Date.now();
        if (now - client.lastStatsAt < STATS_MIN_INTERVAL_MS) return;
        client.lastStatsAt = now;
        client.send(encodeControlFrame({ type: 'ROOM_STATS', ...ctx.stats() }));
        return;
      }
      case MSG_QUERY_AWARENESS: {
        const ids = Array.from(ctx.awareness.getStates().keys());
        if (ids.length > 0) {
          client.send(encodeAwarenessFrame(awarenessProtocol.encodeAwarenessUpdate(ctx.awareness, ids)));
        }
        return;
      }
      default:
        dropMalformed(ctx, client);
    }
  } catch {
    dropMalformed(ctx, client);
  }
}
