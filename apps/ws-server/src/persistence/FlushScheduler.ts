export type FlushOutcome = 'saved' | 'skipped' | 'busy';
/** What the last attempt came to, including a flush that threw. */
export type LastFlush = FlushOutcome | 'failed';

export interface FlushSchedulerOptions {
  debounceMs: number;
  maxWaitMs: number;
  /** Base retry delay after a failed or lock-contended flush. */
  retryMs?: number;
  onError?: (err: unknown) => void;
}

const DEFAULT_RETRY_MS = 500;
const MAX_RETRY_MS = 15_000;

/**
 * Write-behind timing (PRD §3.3): flush 5 s after the last edit, or 30 s into continuous
 * editing, or on demand when the last client leaves. Only one flush runs at a time for
 * a room, so a burst of triggers can never become concurrent UPDATEs.
 */
export class FlushScheduler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  private stopped = false;
  dirty = false;
  /** Edits recorded since the last flush that took them. Shown in the Chaos Lab. */
  pendingEdits = 0;
  /** When a flush last wrote to Postgres, in epoch milliseconds. */
  lastSavedAt: number | null = null;
  lastOutcome: LastFlush | null = null;

  constructor(
    private readonly flush: () => Promise<FlushOutcome>,
    private readonly options: FlushSchedulerOptions,
  ) {}

  /** Record an edit. */
  touch(): void {
    if (this.stopped) return;
    this.dirty = true;
    this.pendingEdits += 1;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.run(), this.options.debounceMs);
    this.maxWaitTimer ??= setTimeout(() => void this.run(), this.options.maxWaitMs);
  }

  /** Flush now and wait. Resolves true once nothing is left unsaved. */
  async flushNow(attempts = 5): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      if (this.inFlight) await this.inFlight;
      if (!this.dirty) return true;
      await this.run();
      if (!this.dirty) return true;
      await new Promise((resolve) => setTimeout(resolve, this.retryDelay()));
    }
    return !this.dirty;
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
  }

  private clearTimers(): void {
    for (const timer of [this.debounceTimer, this.maxWaitTimer, this.retryTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.debounceTimer = null;
    this.maxWaitTimer = null;
    this.retryTimer = null;
  }

  private retryDelay(): number {
    const base = this.options.retryMs ?? DEFAULT_RETRY_MS;
    return Math.min(MAX_RETRY_MS, base * 2 ** Math.min(this.failures, 8));
  }

  private run(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!this.dirty || this.stopped) return Promise.resolve();
    this.clearTimers();
    this.dirty = false; // Edits arriving during the write set it again.
    // The edits this flush covers. If it fails they are still unsaved, so they are added back.
    const covered = this.pendingEdits;
    this.pendingEdits = 0;

    this.inFlight = this.flush()
      .then((outcome) => {
        this.lastOutcome = outcome;
        if (outcome === 'busy') {
          this.pendingEdits += covered;
          this.markFailed();
        } else {
          if (outcome === 'saved') this.lastSavedAt = Date.now();
          this.failures = 0;
        }
      })
      .catch((err: unknown) => {
        this.lastOutcome = 'failed';
        this.pendingEdits += covered;
        this.options.onError?.(err);
        this.markFailed();
      })
      .finally(() => {
        this.inFlight = null;
        // Edits landed mid-flush and their timers were cleared, so re-arm.
        if (this.dirty && !this.stopped && !this.debounceTimer && !this.retryTimer) {
          this.debounceTimer = setTimeout(() => void this.run(), this.options.debounceMs);
          this.maxWaitTimer ??= setTimeout(() => void this.run(), this.options.maxWaitMs);
        }
      });
    return this.inFlight;
  }

  private markFailed(): void {
    this.dirty = true;
    this.failures += 1;
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.run();
    }, this.retryDelay());
  }
}
