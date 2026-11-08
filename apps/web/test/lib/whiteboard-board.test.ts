import { Y_KEYS, shapeSchema, type Shape } from '@wb/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addShape,
  createBoardUndoManager,
  deleteShapes,
  duplicateShapes,
  moveToBack,
  moveToFront,
  orderRoot,
  readShapes,
  shapesRoot,
  updateShape,
  updateShapes,
} from '@/lib/whiteboard/model';

type Arrow = Extract<Shape, { type: 'arrow' }>;

function rect(id: string, x = 0, y = 0): Shape {
  return { id, type: 'rect', x, y, rotation: 0, width: 100, height: 50, fill: '#ffffff' };
}

function arrow(id: string, partial: Partial<Arrow> = {}): Arrow {
  return {
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    rotation: 0,
    points: [0, 0, 10, 10],
    stroke: '#111827',
    strokeWidth: 3,
    ...partial,
  };
}

/** Delivers each side's changes to the other the way a provider does: not as a local edit. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'remote');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'remote');
}

const ids = (doc: Y.Doc) => readShapes(doc).map((shape) => shape.id);

describe('batch updates', () => {
  it('apply as one document update', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('a'));
    addShape(doc, rect('b'));
    let updates = 0;
    doc.on('update', () => (updates += 1));
    updateShapes(doc, { a: { x: 5 }, b: { x: 7, y: 9 } });
    expect(updates).toBe(1);
    expect(readShapes(doc).map((shape) => shape.x)).toEqual([5, 7]);
  });

  it('clear an optional property when given undefined', () => {
    const doc = new Y.Doc();
    addShape(doc, { ...rect('a'), stroke: '#111827', strokeWidth: 4 } as Shape);
    updateShape(doc, 'a', { stroke: undefined });
    expect(readShapes(doc)[0]).not.toHaveProperty('stroke');
  });

  it('ignore a shape that does not exist', () => {
    const doc = new Y.Doc();
    updateShapes(doc, { ghost: { x: 1 } });
    expect(readShapes(doc)).toEqual([]);
  });
});

describe('deleting shapes with connectors', () => {
  it('leaves an arrow in place, unattached, when its shape is deleted', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('a', 0, 0));
    addShape(doc, rect('b', 300, 0));
    addShape(doc, arrow('link', { startShapeId: 'a', endShapeId: 'b' }));

    deleteShapes(doc, ['b']);

    const link = readShapes(doc).find((shape) => shape.id === 'link');
    expect(link?.type).toBe('arrow');
    if (link?.type !== 'arrow') return;
    expect(link.startShapeId).toBe('a');
    expect(link.endShapeId).toBeUndefined();
    // The free end stays where the attached end was: on the left edge of the deleted shape.
    expect(link.x + link.points[2]).toBeCloseTo(300);
    expect(link.y + link.points[3]).toBeCloseTo(25);
  });

  it('removes the shapes and their z-order entries', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('a'));
    addShape(doc, rect('b'));
    deleteShapes(doc, ['a', 'b']);
    expect(ids(doc)).toEqual([]);
    expect(orderRoot(doc).length).toBe(0);
  });

  it('is one update however many shapes go', () => {
    const doc = new Y.Doc();
    for (const id of ['a', 'b', 'c']) addShape(doc, rect(id));
    let updates = 0;
    doc.on('update', () => (updates += 1));
    deleteShapes(doc, ['a', 'b', 'c']);
    expect(updates).toBe(1);
  });
});

describe('duplicating shapes', () => {
  it('copies shapes nudged, on top, with new ids', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('a', 10, 10));
    const [copy] = duplicateShapes(doc, ['a']);
    expect(copy).toBeDefined();
    expect(copy).not.toBe('a');
    const shapes = readShapes(doc);
    expect(shapes.map((shape) => shape.id)).toEqual(['a', copy]);
    expect(shapes[1]).toMatchObject({ x: 34, y: 34 });
  });

  it('keeps a connector attached only to copies of shapes inside the selection', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('a', 0, 0));
    addShape(doc, rect('b', 300, 0));
    addShape(doc, arrow('link', { startShapeId: 'a', endShapeId: 'b' }));

    const created = duplicateShapes(doc, ['a', 'link']);
    const copies = readShapes(doc).filter((shape) => created.includes(shape.id));
    const copiedRect = copies.find((shape) => shape.type === 'rect');
    const copiedArrow = copies.find((shape) => shape.type === 'arrow');
    expect(copiedArrow?.type === 'arrow' && copiedArrow.startShapeId).toBe(copiedRect?.id);
    // `b` was not copied, so the copy must not stay glued to the original `b`.
    expect(copiedArrow?.type === 'arrow' && copiedArrow.endShapeId).toBeUndefined();
  });

  it('returns nothing for ids that do not exist', () => {
    expect(duplicateShapes(new Y.Doc(), ['nope'])).toEqual([]);
  });
});

describe('layering', () => {
  it('moves a group to the front and back, keeping its internal order', () => {
    const doc = new Y.Doc();
    for (const id of ['a', 'b', 'c', 'd']) addShape(doc, rect(id));
    moveToFront(doc, ['b', 'a']);
    expect(ids(doc)).toEqual(['c', 'd', 'a', 'b']);
    // `d` is already behind `b`, so a group sent to the back keeps that order.
    moveToBack(doc, ['b', 'd']);
    expect(ids(doc)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('undo', () => {
  it('undoes my own edit and redoes it', () => {
    const doc = new Y.Doc();
    const undo = createBoardUndoManager(doc);
    addShape(doc, rect('a'));
    expect(ids(doc)).toEqual(['a']);
    undo.undo();
    expect(ids(doc)).toEqual([]);
    undo.redo();
    expect(ids(doc)).toEqual(['a']);
  });

  it('never reverts a collaborator', () => {
    const mine = new Y.Doc();
    const theirs = new Y.Doc();
    const undo = createBoardUndoManager(mine);

    addShape(mine, rect('mine'));
    addShape(theirs, rect('theirs'));
    sync(mine, theirs);
    expect(ids(mine).sort()).toEqual(['mine', 'theirs']);

    undo.undo();
    sync(mine, theirs);
    expect(ids(mine)).toEqual(['theirs']);
    expect(ids(theirs)).toEqual(['theirs']);
  });

  it('undoing my move keeps a collaborator edit to another property', () => {
    const mine = new Y.Doc();
    const theirs = new Y.Doc();
    addShape(mine, rect('s'));
    sync(mine, theirs);

    const undo = createBoardUndoManager(mine);
    updateShape(mine, 's', { x: 50 });
    updateShape(theirs, 's', { y: 80 });
    sync(mine, theirs);

    undo.undo();
    sync(mine, theirs);
    expect(readShapes(theirs)[0]).toMatchObject({ x: 0, y: 80 });
    expect(readShapes(mine)[0]).toMatchObject({ x: 0, y: 80 });
  });

  it('merges a quick drag into one step and splits steps at stopCapturing', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('s'));
    const undo = createBoardUndoManager(doc);
    undo.stopCapturing();
    for (let x = 1; x <= 20; x++) updateShape(doc, 's', { x });
    undo.stopCapturing();
    updateShape(doc, 's', { y: 40 });

    undo.undo();
    expect(readShapes(doc)[0]).toMatchObject({ x: 20, y: 0 });
    undo.undo();
    expect(readShapes(doc)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('does not track changes that arrive from the network', () => {
    const mine = new Y.Doc();
    const theirs = new Y.Doc();
    const undo = createBoardUndoManager(mine);
    addShape(theirs, rect('theirs'));
    sync(mine, theirs);
    undo.undo();
    expect(ids(mine)).toEqual(['theirs']);
  });

  it('restores a shape that I deleted, connectors included', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('a', 0, 0));
    addShape(doc, rect('b', 300, 0));
    addShape(doc, arrow('link', { startShapeId: 'a', endShapeId: 'b' }));
    const undo = createBoardUndoManager(doc);
    deleteShapes(doc, ['b']);
    undo.undo();
    expect(ids(doc).sort()).toEqual(['a', 'b', 'link']);
    const link = readShapes(doc).find((shape) => shape.id === 'link');
    expect(link?.type === 'arrow' && link.endShapeId).toBe('b');
  });
});

describe('shape schema', () => {
  it('still accepts shapes written before the new fields existed', () => {
    const old = { id: 'x', type: 'sticky', x: 1, y: 2, width: 160, height: 160, fill: '#fde68a', text: 'hi' };
    const parsed = shapeSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.rotation).toBe(0);
  });

  it('accepts the new fields', () => {
    expect(
      shapeSchema.safeParse({ ...rect('r'), stroke: '#111827', strokeWidth: 2, opacity: 0.5, text: 'label' }).success,
    ).toBe(true);
    expect(shapeSchema.safeParse(arrow('a', { startShapeId: 'r' })).success).toBe(true);
    expect(
      shapeSchema.safeParse({ id: 't', type: 'text', x: 0, y: 0, text: 'hello', fill: '#111827' }),
    ).toMatchObject({ success: true, data: { fontSize: 20 } });
  });

  it('rejects hostile values in the new fields', () => {
    const bad = [
      { ...rect('r'), stroke: 'javascript:alert(1)' },
      { ...rect('r'), stroke: 'red' },
      { ...rect('r'), opacity: 5 },
      { ...rect('r'), opacity: 0 },
      { ...rect('r'), opacity: Number.NaN },
      { ...rect('r'), strokeWidth: 9999 },
      { ...rect('r'), text: 'x'.repeat(2001) },
      { ...arrow('a'), points: [0, 0, 1] },
      { ...arrow('a'), points: ['0', 0, 1, 1] },
      { ...arrow('a'), points: [0, 0, Number.POSITIVE_INFINITY, 1] },
      { ...arrow('a'), startShapeId: 'x'.repeat(65) },
      { id: 't', type: 'text', x: 0, y: 0, text: 'x', fill: '#111827', fontSize: 5000 },
      { id: 's', type: 'sticky', x: 0, y: 0, width: 1, height: 1, fill: '#fde68a', text: '', authorName: 'x'.repeat(81) },
    ];
    for (const shape of bad) expect(shapeSchema.safeParse(shape).success).toBe(false);
  });

  it('skips a hostile arrow or text shape that arrives over the network', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('good'));
    const evil = new Y.Map<unknown>();
    evil.set('type', 'arrow');
    evil.set('x', 0);
    evil.set('y', 0);
    evil.set('points', [0, 0, 'boom', 1]);
    evil.set('stroke', 'url(javascript:alert(1))');
    evil.set('strokeWidth', 3);
    shapesRoot(doc).set('evil', evil);
    doc.getMap<unknown>(Y_KEYS.shapes).set('also-evil', new Y.Map<unknown>());
    expect(ids(doc)).toEqual(['good']);
  });
});
