import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/limits/TokenBucket';

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refuses', () => {
    let now = 0;
    const bucket = new TokenBucket(60, 60, () => now);
    for (let i = 0; i < 60; i++) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now += 0;
    expect(bucket.take()).toBe(false);
  });

  it('refills at the configured rate and never above capacity', () => {
    let now = 0;
    const bucket = new TokenBucket(60, 60, () => now);
    for (let i = 0; i < 60; i++) bucket.take();
    now += 500;
    for (let i = 0; i < 30; i++) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);

    now += 60_000;
    for (let i = 0; i < 60; i++) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it('sustains exactly the configured rate indefinitely', () => {
    let now = 0;
    const bucket = new TokenBucket(60, 60, () => now);
    for (let i = 0; i < 600; i++) {
      now += 1000 / 60;
      expect(bucket.take()).toBe(true);
    }
  });
});
