/** Per-socket limiter (PRD §5.6). A false return means the caller closes with 1008. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(): boolean {
    const current = this.now();
    const elapsedSeconds = Math.max(0, current - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.last = current;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
