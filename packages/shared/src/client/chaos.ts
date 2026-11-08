import { MAX_ARTIFICIAL_LATENCY_MS } from '../limits';

/**
 * Network conditions a developer can impose on their own connection to watch how Yjs behaves.
 * Everything here is local to one browser. It can slow or pause what this client sends and
 * receives, but it cannot loosen anything the server enforces.
 */

export interface ChaosState {
  /** Extra delay added to every frame in each direction. */
  latencyMs: number;
  /** True while the connection is held offline on purpose. */
  offline: boolean;
}

export const NO_CHAOS: ChaosState = { latencyMs: 0, offline: false };

export function clampLatency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_ARTIFICIAL_LATENCY_MS, Math.max(0, Math.round(value)));
}

interface Waiting<T> {
  item: T;
  due: number;
}

export interface DelayQueueOptions<T> {
  deliver: (item: T) => void;
  /** Frames leave at least this far apart, so a backlog drains at a steady pace. */
  minGapMs?: number;
}

/**
 * Holds items back by a configurable delay and releases them in the order they arrived. An item
 * never overtakes an earlier one, even when the delay is lowered while items are waiting, because
 * a connection that reordered frames would be a different experiment.
 */
export class DelayQueue<T> {
  latencyMs = 0;

  private waiting: Waiting<T>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastDue = 0;
  private readonly deliver: (item: T) => void;
  private readonly minGapMs: number;

  constructor(options: DelayQueueOptions<T>) {
    this.deliver = options.deliver;
    this.minGapMs = options.minGapMs ?? 0;
  }

  /** True when nothing is waiting, so a caller may skip the queue when the delay is zero. */
  get idle(): boolean {
    return this.waiting.length === 0;
  }

  get size(): number {
    return this.waiting.length;
  }

  setLatency(ms: number): void {
    this.latencyMs = clampLatency(ms);
  }

  push(item: T): void {
    const now = Date.now();
    const earliestAfterPrevious = this.lastDue === 0 ? 0 : this.lastDue + this.minGapMs;
    const due = Math.max(now + this.latencyMs, earliestAfterPrevious);
    this.lastDue = due;
    this.waiting.push({ item, due });
    this.arm();
  }

  /** Drops everything waiting, as a real network does when a connection dies. */
  clear(): void {
    this.waiting = [];
    this.lastDue = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(): void {
    if (this.timer || this.waiting.length === 0) return;
    const head = this.waiting[0];
    if (!head) return;
    this.timer = setTimeout(() => this.release(), Math.max(0, head.due - Date.now()));
  }

  private release(): void {
    this.timer = null;
    const now = Date.now();
    while (this.waiting.length > 0) {
      const head = this.waiting[0];
      if (!head || head.due > now) break;
      this.waiting.shift();
      this.deliver(head.item);
    }
    this.arm();
  }
}

export interface FrameCounter {
  frames: number;
  bytes: number;
  /** Document sync frames (Yjs updates). */
  sync: number;
  /** Cursor and presence frames. */
  awareness: number;
}

export interface TrafficCounters {
  in: FrameCounter;
  out: FrameCounter;
}

export function emptyCounter(): FrameCounter {
  return { frames: 0, bytes: 0, sync: 0, awareness: 0 };
}

/** Counts one frame on the wire. The first byte is the message type (0 sync, 1 awareness). */
export function countFrame(counter: FrameCounter, data: Uint8Array): void {
  counter.frames += 1;
  counter.bytes += data.byteLength;
  const type = data[0];
  if (type === 0) counter.sync += 1;
  else if (type === 1) counter.awareness += 1;
}

/** What happened when a connection that had been held offline came back. */
export interface ReconcileReport {
  /** Size of the edits made while offline, sent to the server. */
  sentBytes: number;
  /** Size of what the server had meanwhile, received. */
  receivedBytes: number;
  /** From asking to reconnect until the two sides had exchanged their differences. */
  durationMs: number;
}
