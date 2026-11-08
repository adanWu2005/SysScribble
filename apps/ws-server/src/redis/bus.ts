import { randomUUID } from 'node:crypto';
import {
  PRESENCE_KEY_TTL_SEC,
  controlChannel,
  encodePresence,
  kickBanKey,
  presenceKey,
  roomIdFromChannel,
  syncChannel,
} from '@wb/shared';
import { Redis } from 'ioredis';
import type { Logger } from '../logger';

export interface RoomHandlers {
  onSync(frame: Uint8Array): void;
  onControl(json: string): void;
}

/** Everything the server needs from Redis. Tests can swap in an in-process implementation. */
export interface Bus {
  subscribeRoom(roomId: string, handlers: RoomHandlers): Promise<void>;
  unsubscribeRoom(roomId: string): Promise<void>;
  /** Resolves to the number of subscribers reached, including this instance. */
  publishSync(roomId: string, frame: Uint8Array): Promise<number>;
  /** Fires after a dropped connection is restored, because messages may have been missed. */
  onReconnect(listener: () => void): void;
  acquireLock(key: string, ttlMs: number): Promise<string | null>;
  releaseLock(key: string, token: string): Promise<void>;
  isKicked(roomId: string, userId: string): Promise<boolean>;
  /** Reports how many distinct people this instance has in a room. Zero removes the entry. Best effort. */
  setPresence(roomId: string, instanceId: string, users: number): Promise<void>;
  close(): Promise<void>;
}

/** Deletes the lock only if we still own it, so an expired holder cannot free a new owner's lock. */
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

export class RedisBus implements Bus {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly rooms = new Map<string, RoomHandlers>();
  private readonly reconnectListeners = new Set<() => void>();
  private hasConnected = false;

  constructor(url: string, private readonly log: Logger) {
    this.pub = new Redis(url, { maxRetriesPerRequest: 3 });
    this.sub = new Redis(url, { maxRetriesPerRequest: null, autoResubscribe: true });
    this.pub.on('error', (err) => this.log.error({ err: err.message }, 'redis publisher error'));
    this.sub.on('error', (err) => this.log.error({ err: err.message }, 'redis subscriber error'));

    this.sub.on('ready', () => {
      if (this.hasConnected) for (const listener of this.reconnectListeners) listener();
      this.hasConnected = true;
    });

    this.sub.on('messageBuffer', (channel: Buffer, message: Buffer) => {
      const name = channel.toString();
      const roomId = roomIdFromChannel(name);
      const handlers = roomId ? this.rooms.get(roomId) : undefined;
      if (!handlers || !roomId) return;
      if (name === syncChannel(roomId)) handlers.onSync(new Uint8Array(message));
      else handlers.onControl(message.toString('utf8'));
    });
  }

  async subscribeRoom(roomId: string, handlers: RoomHandlers): Promise<void> {
    this.rooms.set(roomId, handlers);
    await this.sub.subscribe(syncChannel(roomId), controlChannel(roomId));
  }

  async unsubscribeRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
    await this.sub.unsubscribe(syncChannel(roomId), controlChannel(roomId));
  }

  publishSync(roomId: string, frame: Uint8Array): Promise<number> {
    return this.pub.publish(syncChannel(roomId), Buffer.from(frame));
  }

  onReconnect(listener: () => void): void {
    this.reconnectListeners.add(listener);
  }

  async setPresence(roomId: string, instanceId: string, users: number): Promise<void> {
    const key = presenceKey(roomId);
    try {
      if (users <= 0) {
        await this.pub.hdel(key, instanceId);
        return;
      }
      await this.pub.pipeline().hset(key, instanceId, encodePresence(users, Date.now())).expire(key, PRESENCE_KEY_TTL_SEC).exec();
    } catch (err) {
      // The headcount is a nicety. It must never take a room down.
      this.log.warn({ err: err instanceof Error ? err.message : err }, 'presence write failed');
    }
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.pub.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    await this.pub.eval(RELEASE_LOCK_LUA, 1, key, token);
  }

  async isKicked(roomId: string, userId: string): Promise<boolean> {
    return (await this.pub.exists(kickBanKey(roomId, userId))) === 1;
  }

  async close(): Promise<void> {
    this.pub.disconnect();
    this.sub.disconnect();
  }
}
