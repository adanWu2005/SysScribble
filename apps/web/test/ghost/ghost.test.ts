import { Y_KEYS, awarenessStateSchema, type RoomRole } from '@wb/shared';
import type { SocketLike } from '@wb/shared/client';
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  GHOST_COLORS,
  MAX_GHOSTS,
  MAX_GHOST_CHARS,
  MAX_GHOST_STICKIES,
  between,
  easeInOut,
  figureEight,
  freeGhostIndex,
  ghostColor,
  ghostName,
  lerpPoint,
  pick,
} from '@/lib/ghost/behavior';
import { GhostClient } from '@/lib/ghost/GhostClient';
import { notesSchema } from '@/lib/notes/schema';
import { addShape, readShapes } from '@/lib/whiteboard/model';

const USER = '11111111-2222-4333-8444-555555555555';

/** A small seeded generator, so the ghost's choices are the same on every run. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function neverCalled(): SocketLike {
  throw new Error('a ghost under test must not open a socket');
}

function ghost(role: RoomRole | null, index = 1, seed = 7): GhostClient {
  const created = new GhostClient({
    index,
    userId: USER,
    roomId: '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f',
    url: 'ws://localhost:1',
    getToken: async () => 'unused',
    createSocket: neverCalled,
    getAnchor: () => ({ x: 500, y: 300, scale: 1 }),
    random: seeded(seed),
    connect: false,
  });
  created.provider.role = role;
  return created;
}

/** Runs the ghost for `seconds` of fake time, one beat every 50 ms. */
function run(client: GhostClient, seconds: number): void {
  const beats = Math.round((seconds * 1000) / 50);
  for (let i = 0; i < beats; i++) {
    vi.advanceTimersByTime(50);
    client.step(Date.now());
  }
}

const notesText = (doc: Y.Doc): string => {
  const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(Y_KEYS.notes), notesSchema());
  return root.textContent;
};

describe('ghost behavior helpers', () => {
  it('traces a closed figure-eight inside its box', () => {
    const center = { x: 100, y: 50 };
    const points = Array.from({ length: 400 }, (_, i) => figureEight(i * 0.05, center, 100));
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(200);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
    // It crosses the centre line horizontally twice per loop, which is what makes it an eight.
    const crossings = points.filter((p, i) => i > 0 && Math.sign(p.y - 50) !== Math.sign((points[i - 1]?.y ?? 0) - 50)).length;
    expect(crossings).toBeGreaterThanOrEqual(4);
  });

  it('offsets each ghost, so several do not share one path', () => {
    const a = figureEight(3, { x: 0, y: 0 }, 100, 0);
    const b = figureEight(3, { x: 0, y: 0 }, 100, (2 * Math.PI) / 3);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(10);
  });

  it('gives each ghost a name, a color and the lowest free number', () => {
    expect(ghostName(2)).toBe('Ghost 2');
    for (const color of GHOST_COLORS) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ghostColor(1)).toBe(GHOST_COLORS[0]);
    expect(freeGhostIndex([])).toBe(1);
    expect(freeGhostIndex([1, 3])).toBe(2);
    expect(freeGhostIndex([2])).toBe(1);
    expect(freeGhostIndex([1, 2, 3])).toBeNull();
    expect(MAX_GHOSTS).toBe(3);
  });

  it('eases from 0 to 1 and clamps outside', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(9)).toBe(1);
    expect(lerpPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });

  it('chooses within range and from the list', () => {
    const random = seeded(1);
    for (let i = 0; i < 100; i++) {
      const value = between(random, 5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThan(10);
    }
    expect(['a', 'b']).toContain(pick(seeded(3), ['a', 'b']));
    expect(() => pick(seeded(3), [])).toThrow();
  });
});

describe('GhostClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('identity', () => {
    it('presents as a ghost under the real user, which the server accepts', () => {
      const client = ghost('EDITOR', 2);
      const state = client.awareness.getLocalState();
      expect(awarenessStateSchema.safeParse(state).success).toBe(true);
      expect(state).toMatchObject({ ghost: true, user: { id: USER, name: 'Ghost 2' } });
      expect(client.doc.clientID).not.toBe(0);
    });

    it('is an independent replica, not the user\'s own document', () => {
      const a = ghost('EDITOR', 1);
      const b = ghost('EDITOR', 2);
      expect(a.doc).not.toBe(b.doc);
      expect(a.doc.clientID).not.toBe(b.doc.clientID);
    });
  });

  describe('cursor', () => {
    it('moves a figure-eight around the anchor', () => {
      const client = ghost('EDITOR');
      const seen: { x: number; y: number }[] = [];
      for (let i = 0; i < 60; i++) {
        vi.advanceTimersByTime(50);
        client.step(Date.now());
        const pointer = (client.awareness.getLocalState() as { pointer?: { x: number; y: number } } | null)?.pointer;
        if (pointer) seen.push(pointer);
      }
      expect(seen).toHaveLength(60);
      for (const p of seen) {
        expect(Math.abs(p.x - 500)).toBeLessThanOrEqual(160.001);
        expect(Math.abs(p.y - 300)).toBeLessThanOrEqual(80.001);
      }
      expect(new Set(seen.map((p) => p.x)).size).toBeGreaterThan(30);
    });

    it('shows a cursor for every role, including a viewer or an unconfirmed role', () => {
      for (const role of ['OWNER', 'EDITOR', 'VIEWER', null] as const) {
        const client = ghost(role);
        run(client, 1);
        expect((client.awareness.getLocalState() as { pointer?: unknown } | null)?.pointer).toBeDefined();
      }
    });

    it('scales its loop with the user\'s zoom', () => {
      const zoomedIn = new GhostClient({
        index: 1,
        userId: USER,
        roomId: '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f',
        url: 'ws://localhost:1',
        getToken: async () => 'x',
        createSocket: neverCalled,
        getAnchor: () => ({ x: 0, y: 0, scale: 4 }),
        random: seeded(1),
        connect: false,
      });
      let widest = 0;
      for (let i = 0; i < 200; i++) {
        vi.advanceTimersByTime(50);
        zoomedIn.step(Date.now());
        const p = (zoomedIn.awareness.getLocalState() as { pointer?: { x: number } } | null)?.pointer;
        widest = Math.max(widest, Math.abs(p?.x ?? 0));
      }
      expect(widest).toBeLessThanOrEqual(40.001);
    });
  });

  describe('a viewer\'s ghost', () => {
    it.each(['VIEWER', null] as const)('adds nothing to the room when the role is %s', (role) => {
      const client = ghost(role);
      run(client, 120);
      expect(readShapes(client.doc)).toEqual([]);
      expect(client.doc.getXmlFragment(Y_KEYS.notes).length).toBe(0);
      expect(client.stickyCount).toBe(0);
      expect(client.typedChars).toBe(0);
      expect(client.canEdit).toBe(false);
    });

    it('stops editing the moment its role is taken away', () => {
      const client = ghost('EDITOR');
      run(client, 30);
      const shapesBefore = readShapes(client.doc).length;
      const charsBefore = client.typedChars;
      expect(shapesBefore).toBeGreaterThan(0);

      client.provider.role = 'VIEWER';
      run(client, 120);
      expect(readShapes(client.doc)).toHaveLength(shapesBefore);
      expect(client.typedChars).toBe(charsBefore);
    });
  });

  describe('an editor\'s ghost', () => {
    it('creates sticky notes that are valid shapes, signed with its name', () => {
      const client = ghost('EDITOR', 2);
      run(client, 40);
      const shapes = readShapes(client.doc);
      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.type).toBe('sticky');
        if (shape.type === 'sticky') {
          expect(shape.authorName).toBe('Ghost 2');
          expect(shape.text.length).toBeGreaterThan(0);
          expect(shape.fill).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    });

    it('moves its notes, selecting the one it moves and then letting go', () => {
      const client = ghost('EDITOR');
      let moved = false;
      let selectedWhileMoving = false;
      let cleared = false;
      const startPositions = new Map<string, { x: number; y: number }>();
      for (let i = 0; i < 1200 && !cleared; i++) {
        vi.advanceTimersByTime(50);
        client.step(Date.now());
        for (const shape of readShapes(client.doc)) {
          const start = startPositions.get(shape.id);
          if (!start) startPositions.set(shape.id, { x: shape.x, y: shape.y });
          else if (start.x !== shape.x || start.y !== shape.y) moved = true;
        }
        const selection = (client.awareness.getLocalState() as { selection?: string[] } | null)?.selection ?? [];
        if (selection.length > 0) selectedWhileMoving = true;
        else if (selectedWhileMoving) cleared = true;
      }
      expect(moved).toBe(true);
      expect(selectedWhileMoving).toBe(true);
      expect(cleared).toBe(true);
    });

    it('types into its own paragraphs, which pass the notes schema', () => {
      const client = ghost('EDITOR');
      run(client, 60);
      expect(client.typedChars).toBeGreaterThan(20);
      const text = notesText(client.doc);
      expect(text.length).toBe(client.typedChars);
      expect(text).toMatch(/\w/);
      // Every character it typed is plain text from its fixed phrases. Nothing else is ever written.
      expect(text).toMatch(/^[A-Za-z .,']+$/);
    });

    it('stays within its limits however long it runs', () => {
      const client = ghost('EDITOR');
      run(client, 600);
      expect(client.stickyCount).toBeLessThanOrEqual(MAX_GHOST_STICKIES);
      expect(readShapes(client.doc).length).toBeLessThanOrEqual(MAX_GHOST_STICKIES);
      expect(client.typedChars).toBeLessThanOrEqual(MAX_GHOST_CHARS);
      expect(notesText(client.doc).length).toBeLessThanOrEqual(MAX_GHOST_CHARS);
    });

    it('wraps long text onto new lines instead of growing one forever', () => {
      const client = ghost('EDITOR');
      run(client, 600);
      expect(client.doc.getXmlFragment(Y_KEYS.notes).length).toBeGreaterThan(1);
    });

    it('is deterministic for a given seed', () => {
      const a = ghost('EDITOR', 1, 42);
      const b = ghost('EDITOR', 1, 42);
      run(a, 30);
      vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
      run(b, 30);
      expect(a.stickyCount).toBe(b.stickyCount);
      expect(a.typedChars).toBe(b.typedChars);
    });

    it('forgets a note somebody else deleted instead of moving a ghost', () => {
      const client = ghost('EDITOR');
      run(client, 12);
      const first = readShapes(client.doc)[0];
      expect(first).toBeDefined();
      client.doc.getMap(Y_KEYS.shapes).delete(first?.id ?? '');
      expect(() => run(client, 60)).not.toThrow();
    });
  });

  describe('removing what it added', () => {
    it('deletes its stickies and paragraphs and leaves everyone else\'s work alone', () => {
      const client = ghost('EDITOR');
      addShape(client.doc, { id: 'theirs', type: 'rect', x: 0, y: 0, rotation: 0, width: 10, height: 10, fill: '#ffffff' });
      const fragment = client.doc.getXmlFragment(Y_KEYS.notes);
      const theirs = new Y.XmlElement('paragraph');
      theirs.insert(0, [new Y.XmlText('human text')]);
      fragment.insert(0, [theirs]);

      run(client, 60);
      expect(readShapes(client.doc).length).toBeGreaterThan(1);
      expect(fragment.length).toBeGreaterThan(1);

      const removed = client.removeContent();
      expect(removed).toBeGreaterThan(0);
      expect(readShapes(client.doc).map((s) => s.id)).toEqual(['theirs']);
      expect(notesText(client.doc)).toBe('human text');
      expect(client.stickyCount).toBe(0);
    });

    it('removes nothing, and does not fail, when it never added anything', () => {
      const client = ghost('EDITOR');
      expect(client.removeContent()).toBe(0);
    });

    it('can start again after being cleaned up', () => {
      const client = ghost('EDITOR');
      run(client, 30);
      client.removeContent();
      run(client, 60);
      expect(client.stickyCount).toBeGreaterThan(0);
    });
  });

  describe('stopping', () => {
    it('is safe to call twice, and stops all activity', async () => {
      const client = ghost('EDITOR');
      run(client, 20);
      const stopping = client.stop(false);
      await vi.advanceTimersByTimeAsync(10);
      await stopping;
      await client.stop(false);
      expect(() => client.step(Date.now())).not.toThrow();
    });

    it('tidies up first when asked, and gives the provider time to send it', async () => {
      const client = ghost('EDITOR');
      run(client, 30);
      const sticky = readShapes(client.doc).length;
      expect(sticky).toBeGreaterThan(0);
      const doc = client.doc;
      const stopping = client.stop(true);
      // The cleanup happens at once...
      expect(readShapes(doc)).toEqual([]);
      // ...and the socket is only closed after a short grace period.
      await vi.advanceTimersByTimeAsync(200);
      await stopping;
    });

    it('does not try to tidy up when it was never allowed to edit', async () => {
      const client = ghost('VIEWER');
      run(client, 5);
      const stopping = client.stop(true);
      await vi.advanceTimersByTimeAsync(10);
      await expect(stopping).resolves.toBeUndefined();
    });
  });
});
