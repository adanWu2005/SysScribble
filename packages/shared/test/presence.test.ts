import { describe, expect, it } from 'vitest';
import { PRESENCE_STALE_MS, encodePresence, presenceKey, sumPresence } from '../src';

const NOW = 1_800_000_000_000;

describe('presence counts', () => {
  it('names one key per room', () => {
    expect(presenceKey('abc')).toBe('presence:room:abc');
  });

  it('adds up the instances that reported recently', () => {
    const fields = { a: encodePresence(2, NOW - 5000), b: encodePresence(3, NOW - 1000) };
    expect(sumPresence(fields, NOW)).toBe(5);
  });

  it('stops counting an instance that went quiet', () => {
    const fields = { live: encodePresence(2, NOW), dead: encodePresence(9, NOW - PRESENCE_STALE_MS - 1) };
    expect(sumPresence(fields, NOW)).toBe(2);
  });

  it('ignores a timestamp from the future', () => {
    expect(sumPresence({ x: encodePresence(4, NOW + PRESENCE_STALE_MS + 5000) }, NOW)).toBe(0);
  });

  it('survives anything Redis could hand back', () => {
    expect(sumPresence(null, NOW)).toBe(0);
    expect(sumPresence(undefined, NOW)).toBe(0);
    expect(sumPresence({ a: 5, b: null, c: {}, d: 'oops', e: '-3:1', f: '1:2:3', g: `99999999:${NOW}` }, NOW)).toBe(0);
  });

  it('clamps what it writes and what it reads', () => {
    expect(encodePresence(-4, NOW)).toBe(`0:${NOW}`);
    expect(encodePresence(Number.NaN, NOW)).toBe(`0:${NOW}`);
    expect(encodePresence(2.9, NOW)).toBe(`2:${NOW}`);
    expect(sumPresence({ a: encodePresence(1_000_000, NOW) }, NOW)).toBe(10_000);
  });
});
