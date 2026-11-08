import { describe, expect, it } from 'vitest';
import {
  LASER_LIFETIME_MS,
  MAX_TRAIL_POINTS,
  appendTrail,
  followTarget,
  groupPeers,
  pruneTrail,
  sharedToView,
  smoothTo,
  trailAlpha,
  viewToShared,
  type PresencePeer,
} from '@/lib/whiteboard/presence';
import { screenToWorld } from '@/lib/whiteboard/viewport';

const size = { width: 1000, height: 600 };

function peer(clientId: number, userId: string, viewport?: PresencePeer['viewport']): PresencePeer {
  return { clientId, user: { id: userId, name: `User ${userId}`, color: '#2563eb' }, viewport };
}

describe('grouping people', () => {
  it('shows one entry per person, however many tabs they have open', () => {
    const groups = groupPeers([peer(1, 'a'), peer(2, 'b'), peer(3, 'a')]);
    expect(groups.map((group) => group.userId)).toEqual(['a', 'b']);
    expect(groups[0]?.peers.map((p) => p.clientId)).toEqual([1, 3]);
  });

  it('is empty for an empty room', () => {
    expect(groupPeers([])).toEqual([]);
  });
});

describe('following', () => {
  it('picks the most recent tab that is publishing a viewport', () => {
    const view = { cx: 1, cy: 2, scale: 1 };
    const peers = [peer(1, 'a', view), peer(2, 'a', null), peer(3, 'a', { cx: 9, cy: 9, scale: 2 }), peer(4, 'b', view)];
    expect(followTarget(peers, 'a')?.clientId).toBe(3);
  });

  it('finds nothing for someone who is absent or has no viewport', () => {
    expect(followTarget([peer(1, 'a')], 'a')).toBeUndefined();
    expect(followTarget([peer(1, 'a', { cx: 0, cy: 0, scale: 1 })], 'ghost')).toBeUndefined();
  });

  it('publishes the world point at the middle of the screen', () => {
    const shared = viewToShared({ x: -300, y: -100, scale: 2 }, size);
    expect(shared).toEqual({ cx: 400, cy: 200, scale: 2 });
  });

  it('puts the followed center in the middle of a different-sized screen', () => {
    const shared = { cx: 400, cy: 200, scale: 2 };
    const small = { width: 400, height: 300 };
    const view = sharedToView(shared, small);
    expect(view.scale).toBe(2);
    const middle = screenToWorld(view, { x: small.width / 2, y: small.height / 2 });
    expect(middle.x).toBeCloseTo(400);
    expect(middle.y).toBeCloseTo(200);
  });

  it('round-trips between two screens of the same size', () => {
    const original = { x: 120, y: -80, scale: 1.5 };
    const back = sharedToView(viewToShared(original, size), size);
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
    expect(back.scale).toBeCloseTo(original.scale);
  });
});

describe('cursor smoothing', () => {
  it('moves toward the target and never past it', () => {
    const next = smoothTo({ x: 0, y: 0 }, { x: 100, y: 50 }, 16);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
    expect(next.y).toBeGreaterThan(0);
    expect(next.y).toBeLessThan(50);
  });

  it('covers the same distance in the same time at any frame rate', () => {
    let at60 = { x: 0, y: 0 };
    for (let i = 0; i < 6; i++) at60 = smoothTo(at60, { x: 100, y: 0 }, 1000 / 60);
    const at30 = (() => {
      let p = { x: 0, y: 0 };
      for (let i = 0; i < 3; i++) p = smoothTo(p, { x: 100, y: 0 }, 1000 / 30);
      return p;
    })();
    expect(at60.x).toBeCloseTo(at30.x, 0);
  });

  it('snaps when it is close, so the animation can stop', () => {
    expect(smoothTo({ x: 99.99, y: 50 }, { x: 100, y: 50 }, 16)).toEqual({ x: 100, y: 50 });
  });

  it('stays put when no time has passed', () => {
    expect(smoothTo({ x: 5, y: 5 }, { x: 100, y: 100 }, 0)).toEqual({ x: 5, y: 5 });
    expect(smoothTo({ x: 5, y: 5 }, { x: 100, y: 100 }, -50)).toEqual({ x: 5, y: 5 });
  });
});

describe('laser trail', () => {
  it('grows with each new position and ignores a repeat', () => {
    let trail = appendTrail([], { x: 0, y: 0 }, 0);
    trail = appendTrail(trail, { x: 1, y: 1 }, 10);
    trail = appendTrail(trail, { x: 1, y: 1 }, 20);
    expect(trail.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('drops points older than its lifetime', () => {
    const trail = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 1, t: 500 },
    ];
    expect(pruneTrail(trail, LASER_LIFETIME_MS + 1).map((p) => p.t)).toEqual([500]);
    expect(pruneTrail(trail, LASER_LIFETIME_MS + 600)).toEqual([]);
  });

  it('is bounded, so a long wave cannot grow without limit', () => {
    let trail: ReturnType<typeof appendTrail> = [];
    for (let i = 0; i < 500; i++) trail = appendTrail(trail, { x: i, y: i }, i);
    expect(trail.length).toBeLessThanOrEqual(MAX_TRAIL_POINTS);
    expect(trail[trail.length - 1]).toMatchObject({ x: 499 });
  });

  it('fades from fully visible to gone', () => {
    const point = { x: 0, y: 0, t: 1000 };
    expect(trailAlpha(point, 1000)).toBe(1);
    expect(trailAlpha(point, 1000 + LASER_LIFETIME_MS / 2)).toBeGreaterThan(0);
    expect(trailAlpha(point, 1000 + LASER_LIFETIME_MS / 2)).toBeLessThan(1);
    expect(trailAlpha(point, 1000 + LASER_LIFETIME_MS)).toBe(0);
    expect(trailAlpha(point, 1000 + LASER_LIFETIME_MS * 5)).toBe(0);
  });
});
