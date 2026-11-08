import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlushScheduler, type FlushOutcome } from '../../src/persistence/FlushScheduler';

const options = { debounceMs: 5_000, maxWaitMs: 30_000, retryMs: 100 };

describe('FlushScheduler numbers for the Chaos Lab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    const scheduler = new FlushScheduler(async () => 'saved', options);
    expect(scheduler.pendingEdits).toBe(0);
    expect(scheduler.lastSavedAt).toBeNull();
    expect(scheduler.lastOutcome).toBeNull();
  });

  it('counts every edit until a flush takes them', () => {
    const scheduler = new FlushScheduler(async () => 'saved', options);
    for (let i = 0; i < 7; i++) scheduler.touch();
    expect(scheduler.pendingEdits).toBe(7);
  });

  it('clears the count and records the time when a flush saves', async () => {
    const scheduler = new FlushScheduler(async () => 'saved', options);
    scheduler.touch();
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scheduler.pendingEdits).toBe(0);
    expect(scheduler.lastOutcome).toBe('saved');
    expect(scheduler.lastSavedAt).toBe(Date.now());
  });

  it('counts edits that arrive while a flush is writing as still pending', async () => {
    let finish: (outcome: FlushOutcome) => void = () => undefined;
    const flush = vi.fn(() => new Promise<FlushOutcome>((resolve) => (finish = resolve)));
    const scheduler = new FlushScheduler(flush, options);
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(flush).toHaveBeenCalledTimes(1);

    scheduler.touch();
    scheduler.touch();
    finish('saved');
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.pendingEdits).toBe(2);
  });

  it('puts the edits back when the database is busy, and does not claim a save', async () => {
    const scheduler = new FlushScheduler(async () => 'busy', options);
    scheduler.touch();
    scheduler.touch();
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scheduler.pendingEdits).toBe(3);
    expect(scheduler.lastOutcome).toBe('busy');
    expect(scheduler.lastSavedAt).toBeNull();
  });

  it('puts the edits back when the flush throws, and reports failed', async () => {
    const onError = vi.fn();
    const scheduler = new FlushScheduler(
      async () => {
        throw new Error('db down');
      },
      { ...options, onError },
    );
    scheduler.touch();
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scheduler.pendingEdits).toBe(2);
    expect(scheduler.lastOutcome).toBe('failed');
    expect(scheduler.lastSavedAt).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  it('recovers: a later successful retry clears the count', async () => {
    const outcomes: (FlushOutcome | 'throw')[] = ['throw', 'saved'];
    const scheduler = new FlushScheduler(async () => {
      const next = outcomes.shift() ?? 'saved';
      if (next === 'throw') throw new Error('blip');
      return next;
    }, options);
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scheduler.pendingEdits).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.pendingEdits).toBe(0);
    expect(scheduler.lastOutcome).toBe('saved');
  });

  it('treats "nothing to write" as flushed, without moving the last-saved time', async () => {
    const outcomes: FlushOutcome[] = ['saved', 'skipped'];
    const scheduler = new FlushScheduler(async () => outcomes.shift() ?? 'skipped', options);
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    const firstSave = scheduler.lastSavedAt;

    await vi.advanceTimersByTimeAsync(60_000);
    scheduler.touch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scheduler.pendingEdits).toBe(0);
    expect(scheduler.lastOutcome).toBe('skipped');
    expect(scheduler.lastSavedAt).toBe(firstSave);
  });
});
