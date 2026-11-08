import { Y_KEYS, type Shape } from '@wb/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, bringToFront, deleteShape, readShapes, shapesRoot, updateShape } from '@/lib/whiteboard/model';

function rect(id: string): Shape {
  return { id, type: 'rect', x: 0, y: 0, rotation: 0, width: 10, height: 10, fill: '#ffffff' };
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('whiteboard model', () => {
  it('reads shapes back to front', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('a'));
    addShape(doc, rect('b'));
    expect(readShapes(doc).map((s) => s.id)).toEqual(['a', 'b']);
    bringToFront(doc, 'a');
    expect(readShapes(doc).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('skips a malicious shape instead of passing it to the renderer', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('good'));
    const evil = new Y.Map<unknown>();
    evil.set('type', 'rect');
    evil.set('fill', 'javascript:alert(1)');
    evil.set('x', 0);
    evil.set('y', 0);
    evil.set('width', 1);
    evil.set('height', 1);
    shapesRoot(doc).set('evil', evil);
    doc.getMap<unknown>(Y_KEYS.shapes).set('not-a-map', 'plain string');
    expect(readShapes(doc).map((s) => s.id)).toEqual(['good']);
  });

  it('concurrent moves on different axes both survive', () => {
    const a = new Y.Doc();
    addShape(a, rect('s'));
    const b = new Y.Doc();
    sync(a, b);
    updateShape(a, 's', { x: 5 });
    updateShape(b, 's', { y: 9 });
    sync(a, b);
    expect(readShapes(a)[0]).toMatchObject({ x: 5, y: 9 });
    expect(readShapes(b)[0]).toMatchObject({ x: 5, y: 9 });
  });

  it('concurrent bring-to-front produces one entry per shape', () => {
    const a = new Y.Doc();
    addShape(a, rect('x'));
    addShape(a, rect('y'));
    const b = new Y.Doc();
    sync(a, b);
    bringToFront(a, 'x');
    bringToFront(b, 'x');
    sync(a, b);
    expect(readShapes(a).map((s) => s.id).sort()).toEqual(['x', 'y']);
    expect(readShapes(a).map((s) => s.id)).toEqual(readShapes(b).map((s) => s.id));
  });

  it('a concurrent edit does not resurrect a deleted shape in the list', () => {
    const a = new Y.Doc();
    addShape(a, rect('s'));
    const b = new Y.Doc();
    sync(a, b);
    deleteShape(a, 's');
    updateShape(b, 's', { x: 1 });
    sync(a, b);
    expect(readShapes(a)).toEqual([]);
    expect(readShapes(b)).toEqual([]);
  });

  it('id and type can never be rewritten by a patch', () => {
    const doc = new Y.Doc();
    addShape(doc, rect('s'));
    updateShape(doc, 's', { id: 'other', type: 'ellipse', x: 3 } as Partial<Shape>);
    expect(readShapes(doc)[0]).toMatchObject({ id: 's', type: 'rect', x: 3 });
  });
});
