import { describe, expect, it } from 'vitest';
import { byteaToBytes, bytesToBytea } from '../src/server/bytea';

describe('bytea', () => {
  it('round-trips bytes through the PostgREST hex form', () => {
    const input = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const hex = bytesToBytea(input);
    expect(hex).toBe('\\x0001027f80feff');
    expect(Array.from(byteaToBytes(hex) ?? [])).toEqual(Array.from(input));
  });

  it('returns null for empty values', () => {
    expect(byteaToBytes(null)).toBeNull();
    expect(byteaToBytes('')).toBeNull();
  });
});
