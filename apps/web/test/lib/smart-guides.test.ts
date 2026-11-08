import { shapeSchema, type Shape } from '@wb/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { shapeBounds, type Box } from '@/lib/whiteboard/geometry';
import { canGroup, canUngroup, expandToGroups, groupBoxes } from '@/lib/whiteboard/groups';
import {
  addShape,
  addShapes,
  createBoardUndoManager,
  duplicateShapes,
  groupShapes,
  readShapes,
  ungroupShapes,
} from '@/lib/whiteboard/model';
import { SNAP_THRESHOLD_PX, computeSnap } from '@/lib/whiteboard/snap';
import { TEMPLATES, buildTemplate } from '@/lib/whiteboard/templates';
import { keyToAction, type KeyInfo } from '@/lib/whiteboard/shortcuts';

const box = (x: number, y: number, width = 100, height = 50): Box => ({ x, y, width, height });

describe('computeSnap', () => {
  it('does nothing when nothing is near', () => {
    expect(computeSnap(box(0, 0), [box(500, 500)], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(computeSnap(box(0, 0), [], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('snaps a left edge to another left edge and draws one vertical guide', () => {
    const result = computeSnap(box(3, 200), [box(0, 0, 160, 50)], 6);
    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(0);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({ axis: 'x', at: 0, from: 0, to: 250 });
  });

  it('snaps centers, not only edges', () => {
    // A 100-wide box at x=40 has its middle at 90. The target 200-wide box at 0 has its middle at 100.
    const result = computeSnap(box(40, 300), [box(0, 0, 200, 50)], 12);
    expect(result.dx).toBe(10);
  });

  it('snaps both axes at once', () => {
    const result = computeSnap(box(4, 52), [box(0, 0, 100, 50)], 6);
    expect(result).toMatchObject({ dx: -4, dy: -2 });
    expect(result.guides.map((g) => g.axis).sort()).toEqual(['x', 'x', 'x', 'y']);
  });

  it('picks the closest of several candidates', () => {
    const result = computeSnap(box(4, 500), [box(0, 0), box(6, 100)], 6);
    expect(result.dx).toBe(2);
  });

  it('ignores anything beyond the threshold', () => {
    expect(computeSnap(box(7, 500), [box(0, 0)], 6).dx).toBe(0);
  });

  it('ignores a bad threshold', () => {
    expect(computeSnap(box(1, 1), [box(0, 0)], 0)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(computeSnap(box(1, 1), [box(0, 0)], Number.NaN).guides).toEqual([]);
  });

  it('uses a pixel threshold that the caller scales by zoom', () => {
    expect(SNAP_THRESHOLD_PX).toBeGreaterThan(0);
    // At 4x zoom, 6 px is 1.5 world units: a 3-unit gap no longer snaps.
    expect(computeSnap(box(3, 200), [box(0, 0)], SNAP_THRESHOLD_PX / 4).dx).toBe(0);
  });
});

function rect(id: string, extra: Partial<Extract<Shape, { type: 'rect' }>> = {}): Shape {
  return { id, type: 'rect', x: 0, y: 0, rotation: 0, width: 10, height: 10, fill: '#ffffff', ...extra };
}

describe('groups', () => {
  const shapes = [rect('a', { groupId: 'g1' }), rect('b', { groupId: 'g1' }), rect('c'), rect('d', { groupId: 'g2' })];

  it('selecting one member selects the whole group', () => {
    expect(expandToGroups(['a'], shapes)).toEqual(['a', 'b']);
    expect(expandToGroups(['c'], shapes)).toEqual(['c']);
    expect(expandToGroups(['a', 'd'], shapes)).toEqual(['a', 'b', 'd']);
  });

  it('drops ids that are not on the board', () => {
    expect(expandToGroups(['ghost'], shapes)).toEqual([]);
  });

  it('can group two loose shapes, but not one, nor a group that already is one', () => {
    expect(canGroup([shapes[2]!])).toBe(false);
    expect(canGroup([shapes[2]!, shapes[3]!])).toBe(true);
    expect(canGroup([shapes[0]!, shapes[1]!])).toBe(false);
    expect(canGroup([shapes[0]!, shapes[2]!])).toBe(true);
  });

  it('knows when there is something to ungroup', () => {
    expect(canUngroup([shapes[0]!])).toBe(true);
    expect(canUngroup([shapes[2]!])).toBe(false);
  });

  it('draws one box per group', () => {
    const spread = [rect('a', { groupId: 'g', x: 0 }), rect('b', { groupId: 'g', x: 100 }), rect('c', { x: 500 })];
    expect(groupBoxes(spread)).toEqual([{ x: 0, y: 0, width: 110, height: 10 }]);
  });
});

describe('grouping in the document', () => {
  it('groups, ungroups and keeps it to one undo step', () => {
    const doc = new Y.Doc();
    addShapes(doc, [rect('a'), rect('b'), rect('c')]);
    const undo = createBoardUndoManager(doc);
    undo.stopCapturing();

    const groupId = groupShapes(doc, ['a', 'b']);
    expect(groupId).not.toBeNull();
    expect(readShapes(doc).map((s) => s.groupId)).toEqual([groupId, groupId, undefined]);

    undo.stopCapturing();
    ungroupShapes(doc, ['a']);
    expect(readShapes(doc).map((s) => s.groupId)).toEqual([undefined, undefined, undefined]);

    undo.undo();
    expect(readShapes(doc).map((s) => s.groupId)).toEqual([groupId, groupId, undefined]);
  });

  it('refuses a group of fewer than two real shapes', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('a'));
    expect(groupShapes(doc, ['a'])).toBeNull();
    expect(groupShapes(doc, ['a', 'a'])).toBeNull();
    expect(groupShapes(doc, ['a', 'missing'])).toBeNull();
    expect(readShapes(doc)[0]?.groupId).toBeUndefined();
  });

  it('moves a shape from its old group into the new one', () => {
    const doc = new Y.Doc();
    addShapes(doc, [rect('a'), rect('b'), rect('c')]);
    const first = groupShapes(doc, ['a', 'b']);
    const second = groupShapes(doc, ['b', 'c']);
    const byId = new Map(readShapes(doc).map((s) => [s.id, s.groupId]));
    expect(byId.get('a')).toBe(first);
    expect(byId.get('b')).toBe(second);
    expect(byId.get('c')).toBe(second);
  });

  it('gives a duplicated group a group of its own', () => {
    const doc = new Y.Doc();
    addShapes(doc, [rect('a'), rect('b'), rect('c')]);
    const original = groupShapes(doc, ['a', 'b']);
    const copies = duplicateShapes(doc, ['a', 'b', 'c']);
    const shapes = readShapes(doc);
    const copyGroups = shapes.filter((s) => copies.includes(s.id)).map((s) => s.groupId);
    expect(copyGroups[0]).toBeDefined();
    expect(copyGroups[0]).not.toBe(original);
    expect(copyGroups[0]).toBe(copyGroups[1]);
    expect(copyGroups[2]).toBeUndefined();
  });

  it('rejects an oversized group id from a hostile client', () => {
    expect(shapeSchema.safeParse({ ...rect('a'), groupId: 'x'.repeat(65) }).success).toBe(false);
    expect(shapeSchema.safeParse({ ...rect('a'), groupId: 7 }).success).toBe(false);
  });
});

describe('group shortcuts', () => {
  const key = (k: string, mods: Partial<KeyInfo> = {}): KeyInfo => ({
    key: k,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it('maps Ctrl+G and Ctrl+Shift+G for editors only', () => {
    expect(keyToAction(key('g'), { canEdit: true })).toEqual({ type: 'group' });
    expect(keyToAction(key('G', { shiftKey: true }), { canEdit: true })).toEqual({ type: 'ungroup' });
    expect(keyToAction(key('g', { ctrlKey: false, metaKey: true }), { canEdit: true })).toEqual({ type: 'group' });
    expect(keyToAction(key('g'), { canEdit: false })).toBeNull();
  });
});

describe('templates', () => {
  const center = { x: 1000, y: -400 };

  for (const info of TEMPLATES) {
    describe(info.name, () => {
      const shapes = buildTemplate(info.id, center, 'Ada');

      it('is made only of valid shapes with unique ids', () => {
        expect(shapes.length).toBeGreaterThan(3);
        expect(shapes.length).toBeLessThanOrEqual(40);
        for (const shape of shapes) expect(shapeSchema.safeParse(shape).success).toBe(true);
        expect(new Set(shapes.map((s) => s.id)).size).toBe(shapes.length);
      });

      it('is centered where it was asked to be', () => {
        const solid = shapes.filter((s) => s.type !== 'arrow').map(shapeBounds);
        const minX = Math.min(...solid.map((b) => b.x));
        const maxX = Math.max(...solid.map((b) => b.x + b.width));
        const minY = Math.min(...solid.map((b) => b.y));
        const maxY = Math.max(...solid.map((b) => b.y + b.height));
        expect((minX + maxX) / 2).toBeCloseTo(center.x);
        expect((minY + maxY) / 2).toBeCloseTo(center.y);
      });

      it('attaches connectors only to shapes that are in the template', () => {
        const ids = new Set(shapes.map((s) => s.id));
        for (const shape of shapes) {
          if (shape.type !== 'arrow') continue;
          if (shape.startShapeId !== undefined) expect(ids.has(shape.startShapeId)).toBe(true);
          if (shape.endShapeId !== undefined) expect(ids.has(shape.endShapeId)).toBe(true);
        }
      });

      it('lands in the document as a single transaction and a single undo step', () => {
        const doc = new Y.Doc();
        addShape(doc, rect('existing'));
        const undo = createBoardUndoManager(doc);
        undo.stopCapturing();
        let updates = 0;
        doc.on('update', () => {
          updates += 1;
        });
        addShapes(doc, shapes);
        expect(updates).toBe(1);
        expect(readShapes(doc)).toHaveLength(shapes.length + 1);
        undo.undo();
        expect(readShapes(doc).map((s) => s.id)).toEqual(['existing']);
      });
    });
  }

  it('gives every insertion fresh ids', () => {
    const a = buildTemplate('kanban', center, 'Ada').map((s) => s.id);
    const b = buildTemplate('kanban', center, 'Ada').map((s) => s.id);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });

  it('keeps a long author name within the schema limit', () => {
    const shapes = buildTemplate('kanban', center, 'x'.repeat(500));
    for (const shape of shapes) expect(shapeSchema.safeParse(shape).success).toBe(true);
  });
});

describe('shapes dragged out to a size', () => {
  it('fills the dragged box, with an ellipse placed by its center', async () => {
    const { createShapeInBox } = await import('@/lib/whiteboard/factory');
    const box = { x: 100, y: 200, width: 300, height: 150 };
    expect(createShapeInBox('rect', box, 'Ada')).toMatchObject({ type: 'rect', x: 100, y: 200, width: 300, height: 150 });
    expect(createShapeInBox('sticky', box, 'Ada')).toMatchObject({ type: 'sticky', x: 100, y: 200, width: 300, height: 150 });
    expect(createShapeInBox('ellipse', box, 'Ada')).toMatchObject({ type: 'ellipse', x: 250, y: 275, width: 300, height: 150 });
  });

  it('never makes something too small to grab, and always a valid shape', async () => {
    const { createShapeInBox } = await import('@/lib/whiteboard/factory');
    for (const tool of ['rect', 'ellipse', 'sticky'] as const) {
      const shape = createShapeInBox(tool, { x: 0, y: 0, width: 1, height: 0 }, 'Ada');
      expect(shapeSchema.safeParse(shape).success).toBe(true);
      expect('width' in shape && shape.width).toBeGreaterThanOrEqual(16);
      expect('height' in shape && shape.height).toBeGreaterThanOrEqual(16);
    }
  });
});
