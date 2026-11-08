import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ARTIFICIAL_LATENCY_MS } from '../src';
import { DelayQueue, clampLatency, countFrame, emptyCounter } from '../src/client';

describe('DelayQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function queue(minGapMs = 0) {
    const delivered: { item: string; at: number }[] = [];
    const q = new DelayQueue<string>({ deliver: (item) => delivered.push({ item, at: Date.now() }), minGapMs });
    return { q, delivered };
  }

  it('holds an item for the latency, then delivers it', () => {
    const { q, delivered } = queue();
    q.setLatency(300);
    q.push('a');
    vi.advanceTimersByTime(299);
    expect(delivered).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(delivered.map((d) => d.item)).toEqual(['a']);
  });

  it('delivers in the order items arrived', () => {
    const { q, delivered } = queue();
    q.setLatency(100);
    for (const item of ['a', 'b', 'c']) q.push(item);
    vi.advanceTimersByTime(100);
    expect(delivered.map((d) => d.item)).toEqual(['a', 'b', 'c']);
  });

  it('never lets a later item overtake an earlier one when the latency drops', () => {
    const { q, delivered } = queue();
    q.setLatency(1_000);
    q.push('slow');
    vi.advanceTimersByTime(100);
    q.setLatency(0);
    q.push('fast');
    vi.advanceTimersByTime(2_000);
    expect(delivered.map((d) => d.item)).toEqual(['slow', 'fast']);
  });

  it('spaces releases at least minGap apart, so a backlog drains at a steady rate', () => {
    const { q, delivered } = queue(20);
    for (let i = 0; i < 50; i++) q.push(`m${i}`);
    vi.advanceTimersByTime(5_000);
    expect(delivered).toHaveLength(50);
    for (let i = 1; i < delivered.length; i++) {
      expect((delivered[i]?.at ?? 0) - (delivered[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(20);
    }
    // 50 items in about a second is the most the server's per-socket limit can take.
    const span = (delivered[49]?.at ?? 0) - (delivered[0]?.at ?? 0);
    expect(span).toBeGreaterThanOrEqual(49 * 20);
  });

  it('never exceeds the server limit even after a long hold is released', () => {
    const { q, delivered } = queue(20);
    q.setLatency(2_000);
    for (let i = 0; i < 100; i++) {
      q.push(`m${i}`);
      vi.advanceTimersByTime(10);
    }
    q.setLatency(0);
    vi.advanceTimersByTime(10_000);
    expect(delivered).toHaveLength(100);
    // In any one-second window at most 50 items leave.
    for (let i = 0; i + 50 < delivered.length; i++) {
      const window = (delivered[i + 50]?.at ?? 0) - (delivered[i]?.at ?? 0);
      expect(window).toBeGreaterThanOrEqual(1_000);
    }
  });

  it('can be idle or busy', () => {
    const { q } = queue();
    expect(q.idle).toBe(true);
    q.setLatency(50);
    q.push('a');
    expect(q.idle).toBe(false);
    expect(q.size).toBe(1);
    vi.advanceTimersByTime(50);
    expect(q.idle).toBe(true);
  });

  it('drops everything waiting when cleared, and delivers nothing afterwards', () => {
    const { q, delivered } = queue();
    q.setLatency(500);
    q.push('a');
    q.push('b');
    q.clear();
    vi.advanceTimersByTime(5_000);
    expect(delivered).toEqual([]);
    expect(q.idle).toBe(true);
  });

  it('works again after being cleared', () => {
    const { q, delivered } = queue(20);
    q.setLatency(100);
    q.push('a');
    q.clear();
    q.push('b');
    vi.advanceTimersByTime(100);
    expect(delivered.map((d) => d.item)).toEqual(['b']);
  });

  it('keeps going when a delivery pushes another item', () => {
    const delivered: string[] = [];
    const q: DelayQueue<string> = new DelayQueue<string>({
      deliver: (item) => {
        delivered.push(item);
        if (item === 'a') q.push('b');
      },
    });
    q.setLatency(100);
    q.push('a');
    vi.advanceTimersByTime(250);
    expect(delivered).toEqual(['a', 'b']);
  });
});

describe('clampLatency', () => {
  it('stays inside 0 to the maximum and rounds', () => {
    expect(clampLatency(-5)).toBe(0);
    expect(clampLatency(120.6)).toBe(121);
    expect(clampLatency(99_999)).toBe(MAX_ARTIFICIAL_LATENCY_MS);
    expect(MAX_ARTIFICIAL_LATENCY_MS).toBe(2000);
  });

  it('turns nonsense into no delay', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampLatency(value)).toBe(0);
    }
  });
});

describe('countFrame', () => {
  it('counts frames, bytes and the two kinds the Chaos Lab separates', () => {
    const counter = emptyCounter();
    countFrame(counter, new Uint8Array([0, 2, 9, 9]));
    countFrame(counter, new Uint8Array([0, 1]));
    countFrame(counter, new Uint8Array([1, 5, 5, 5, 5]));
    countFrame(counter, new Uint8Array([5, 1]));
    expect(counter).toEqual({ frames: 4, bytes: 13, sync: 2, awareness: 1 });
  });

  it('copes with an empty frame', () => {
    const counter = emptyCounter();
    countFrame(counter, new Uint8Array([]));
    expect(counter).toEqual({ frames: 1, bytes: 0, sync: 0, awareness: 0 });
  });
});
