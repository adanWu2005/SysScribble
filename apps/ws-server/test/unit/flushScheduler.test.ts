import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlushScheduler, type FlushOutcome } from '../../src/persistence/FlushScheduler';

const options = { debounceMs: 5_000, maxWaitMs: 30_000 };

describe('FlushScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes 5 s after the last edit', async () => {
    const flush = vi.fn(async (): Promise<FlushOutcome> => 'saved');
    const scheduler = new FlushScheduler(flush, options);
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(3_000);
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(scheduler.dirty).toBe(false);
  });

  it('flushes at 30 s during continuous editing', async () => {
    const flush = vi.fn(async (): Promise<FlushOutcome> => 'saved');
    const scheduler = new FlushScheduler(flush, options);
    for (let t = 0; t < 29_000; t += 1_000) {
      scheduler.touch();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(flush).not.toHaveBeenCalled();
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('never runs two flushes at once, however many triggers fire', async () => {
    let active = 0;
    let peak = 0;
    const flush = vi.fn(async (): Promise<FlushOutcome> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
      return 'saved';
    });
    const scheduler = new FlushScheduler(flush, options);
    scheduler.touch();
    const all = Array.from({ length: 20 }, () => scheduler.flushNow());
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(all);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
  });

  it('keeps edits that land during a flush and flushes them next', async () => {
    let release: (() => void) | undefined;
    const flush = vi.fn(
      (): Promise<FlushOutcome> =>
        new Promise((resolve) => {
          release = () => resolve('saved');
        }),
    );
    const scheduler = new FlushScheduler(flush, options);
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(flush).toHaveBeenCalledTimes(1);

    scheduler.touch();
    release?.();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('stays dirty and retries after a database error', async () => {
    const onError = vi.fn();
    const flush = vi
      .fn<() => Promise<FlushOutcome>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue('saved');
    const scheduler = new FlushScheduler(flush, { ...options, onError });
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(scheduler.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(scheduler.dirty).toBe(false);
  });

  it('retries when another instance holds the lock', async () => {
    const flush = vi
      .fn<() => Promise<FlushOutcome>>()
      .mockResolvedValueOnce('busy')
      .mockResolvedValue('saved');
    const scheduler = new FlushScheduler(flush, options);
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scheduler.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(scheduler.dirty).toBe(false);
  });

  it('does nothing when there are no unsaved edits', async () => {
    const flush = vi.fn(async (): Promise<FlushOutcome> => 'saved');
    const scheduler = new FlushScheduler(flush, options);
    await expect(scheduler.flushNow()).resolves.toBe(true);
    expect(flush).not.toHaveBeenCalled();
  });
});
