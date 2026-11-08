import * as decoding from 'lib0/decoding';
import { describe, expect, it } from 'vitest';
import {
  MSG_PING,
  MSG_PONG,
  awarenessStateSchema,
  encodePing,
  encodePong,
  usesMutationOnlyAwareness,
} from '../src';

const user = { id: '11111111-2222-4333-8444-555555555555', name: 'Ada', color: '#112233' };

describe('mutation-only awareness fields', () => {
  it('flags a laser or a drawing indicator that is switched on', () => {
    expect(usesMutationOnlyAwareness({ user, laser: { x: 1, y: 2 } })).toBe(true);
    expect(usesMutationOnlyAwareness({ user, drawing: true })).toBe(true);
    expect(usesMutationOnlyAwareness({ user, laser: { x: 1, y: 2 }, drawing: true })).toBe(true);
  });

  it('does not flag fields that are absent or switched off', () => {
    expect(usesMutationOnlyAwareness({ user })).toBe(false);
    expect(usesMutationOnlyAwareness({ user, laser: null, drawing: false })).toBe(false);
    expect(usesMutationOnlyAwareness({ user, laser: undefined })).toBe(false);
  });

  it('does not flag what a viewer may share', () => {
    const shared = {
      user,
      pointer: { x: 1, y: 2 },
      viewport: { cx: 1, cy: 2, scale: 1 },
      selection: ['a'],
      typing: true,
    };
    expect(usesMutationOnlyAwareness(shared)).toBe(false);
  });

  it('treats a surprising value as use, not as off', () => {
    // Only null and false mean "off". Anything else, such as 0 or '', is not an all-clear.
    expect(usesMutationOnlyAwareness({ user, laser: 0 })).toBe(true);
    expect(usesMutationOnlyAwareness({ user, drawing: '' })).toBe(true);
  });

  it('copes with input that is not an object', () => {
    for (const value of [null, undefined, 'laser', 7, true]) expect(usesMutationOnlyAwareness(value)).toBe(false);
  });
});

describe('awareness presence fields', () => {
  it('accepts a viewport, a selection and a laser', () => {
    const parsed = awarenessStateSchema.safeParse({
      user,
      viewport: { cx: -10.5, cy: 200, scale: 1.25 },
      selection: ['shape-1', 'shape-2'],
      laser: { x: 3, y: 4 },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts the cleared forms', () => {
    expect(awarenessStateSchema.safeParse({ user, laser: null, viewport: null }).success).toBe(true);
  });

  it.each([
    ['a non-finite viewport', { viewport: { cx: Number.NaN, cy: 0, scale: 1 } }],
    ['a zero zoom', { viewport: { cx: 0, cy: 0, scale: 0 } }],
    ['an enormous zoom', { viewport: { cx: 0, cy: 0, scale: 1e9 } }],
    ['65 selected ids', { selection: Array.from({ length: 65 }, (_, i) => `s${i}`) }],
    ['an over-long selected id', { selection: ['x'.repeat(65)] }],
    ['a non-string selected id', { selection: [1] }],
    ['a laser point that is a string', { laser: { x: '1', y: 2 } }],
    ['a laser with an infinite point', { laser: { x: Number.POSITIVE_INFINITY, y: 2 } }],
  ])('rejects %s', (_name, extra) => {
    expect(awarenessStateSchema.safeParse({ user, ...extra }).success).toBe(false);
  });

  it('still tolerates fields it does not know, such as the editor cursor', () => {
    expect(awarenessStateSchema.safeParse({ user, cursor: { anchor: 1, head: 2 } }).success).toBe(true);
  });
});

describe('latency probe frames', () => {
  it('encodes the type and the nonce', () => {
    for (const [encode, type] of [
      [encodePing, MSG_PING],
      [encodePong, MSG_PONG],
    ] as const) {
      const decoder = decoding.createDecoder(encode(123_456));
      expect(decoding.readVarUint(decoder)).toBe(type);
      expect(decoding.readVarUint(decoder)).toBe(123_456);
      expect(decoding.hasContent(decoder)).toBe(false);
    }
  });
});
