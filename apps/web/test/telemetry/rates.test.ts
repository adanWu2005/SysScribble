import { describe, expect, it } from 'vitest';
import { groupPeers, followTarget, type PresencePeer } from '@/lib/whiteboard/presence';
import { HISTORY_LENGTH, formatAge, formatRate, pushHistory, rate, sparklinePoints } from '@/lib/telemetry/rates';

describe('rate', () => {
  it('divides the change by the time', () => {
    expect(rate(100, 160, 2)).toBe(30);
    expect(rate(0, 5, 1)).toBe(5);
    expect(rate(0, 1, 3)).toBe(0.3);
  });

  it('never goes negative or non-finite', () => {
    expect(rate(50, 10, 1)).toBe(0);
    expect(rate(0, 10, 0)).toBe(0);
    expect(rate(0, 10, -1)).toBe(0);
    expect(rate(Number.NaN, 10, 1)).toBe(0);
    expect(rate(0, Number.POSITIVE_INFINITY, 1)).toBe(0);
  });
});

describe('pushHistory', () => {
  it('appends without changing the original', () => {
    const original = [1, 2];
    expect(pushHistory(original, 3)).toEqual([1, 2, 3]);
    expect(original).toEqual([1, 2]);
  });

  it('keeps only the newest values', () => {
    let history: number[] = [];
    for (let i = 0; i < HISTORY_LENGTH + 25; i++) history = pushHistory(history, i);
    expect(history).toHaveLength(HISTORY_LENGTH);
    expect(history[history.length - 1]).toBe(HISTORY_LENGTH + 24);
    expect(history[0]).toBe(25);
  });

  it('records a bad value as zero', () => {
    expect(pushHistory([], Number.NaN)).toEqual([0]);
  });
});

describe('sparklinePoints', () => {
  it('maps the largest value to the top and the smallest to the bottom', () => {
    expect(sparklinePoints([0, 10], 100, 20)).toBe('0,20 100,0');
  });

  it('spaces points evenly', () => {
    const xs = sparklinePoints([1, 2, 3, 4, 5], 100, 10)
      .split(' ')
      .map((p) => Number(p.split(',')[0]));
    expect(xs).toEqual([0, 25, 50, 75, 100]);
  });

  it('shares a scale between lines when given a ceiling', () => {
    const quiet = sparklinePoints([5], 100, 20, 20);
    expect(quiet).toBe('100,15');
  });

  it('draws a flat line for all zeros and nothing for no data', () => {
    expect(sparklinePoints([0, 0, 0], 100, 20)).toBe('0,20 50,20 100,20');
    expect(sparklinePoints([], 100, 20)).toBe('');
    expect(sparklinePoints([1, 2], 0, 20)).toBe('');
  });

  it('clamps values above the ceiling and below zero', () => {
    expect(sparklinePoints([100, -5], 10, 10, 10)).toBe('0,0 10,10');
  });
});

describe('formatAge', () => {
  it('reads naturally at each scale', () => {
    expect(formatAge(null)).toBe('Not yet');
    expect(formatAge(Number.NaN)).toBe('Not yet');
    expect(formatAge(400)).toBe('Just now');
    expect(formatAge(3200)).toBe('3.2 s ago');
    expect(formatAge(42_000)).toBe('42 s ago');
    expect(formatAge(5 * 60_000)).toBe('5 min ago');
    expect(formatAge(3 * 3_600_000)).toBe('3 h ago');
    expect(formatAge(-50)).toBe('Just now');
  });
});

describe('formatRate', () => {
  it('shows bytes, then kilobytes, per second', () => {
    expect(formatRate(0)).toBe('0 B/s');
    expect(formatRate(512)).toBe('512 B/s');
    expect(formatRate(2048)).toBe('2.0 KB/s');
    expect(formatRate(-1)).toBe('');
  });
});

describe('ghosts in the roster', () => {
  const peer = (clientId: number, userId: string, ghost = false, viewport = true): PresencePeer => ({
    clientId,
    user: { id: userId, name: ghost ? `Ghost ${clientId}` : 'Ada', color: '#2563eb' },
    ghost,
    viewport: viewport ? { cx: 1, cy: 2, scale: 1 } : null,
  });
  const ME = '11111111-2222-4333-8444-555555555555';
  const OTHER = '99999999-8888-4777-8666-555555555555';

  it('lists a ghost as its own participant, not inside the user it belongs to', () => {
    const groups = groupPeers([peer(1, OTHER), peer(2, OTHER, true), peer(3, OTHER, true)]);
    expect(groups).toHaveLength(3);
    expect(groups.filter((g) => g.ghost)).toHaveLength(2);
    expect(groups.find((g) => !g.ghost)?.userId).toBe(OTHER);
    expect(new Set(groups.map((g) => g.userId)).size).toBe(3);
  });

  it('keeps my own ghosts visible even though I am filtered out of the list', () => {
    const groups = groupPeers([peer(1, ME), peer(2, ME, true)]).filter((g) => g.userId !== ME);
    expect(groups.map((g) => g.ghost)).toEqual([true]);
  });

  it('still folds several tabs of one person into one entry', () => {
    expect(groupPeers([peer(1, OTHER), peer(2, OTHER)])).toHaveLength(1);
  });

  it('never follows a ghost, even though it carries the followed user\'s id', () => {
    const peers = [peer(1, OTHER, false, false), peer(2, OTHER, true, true)];
    expect(followTarget(peers, OTHER)).toBeUndefined();
    const withReal = [peer(1, OTHER, false, true), peer(2, OTHER, true, true)];
    expect(followTarget(withReal, OTHER)?.clientId).toBe(1);
  });
});
