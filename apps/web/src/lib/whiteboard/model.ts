import { Y_KEYS, shapeSchema, type Shape } from '@wb/shared';
import * as Y from 'yjs';
import { arrowEndpoints } from './geometry';

/** The only code that reads or writes whiteboard shapes in the Y.Doc. */

type ShapeMap = Y.Map<unknown>;
type ArrowShape = Extract<Shape, { type: 'arrow' }>;

/**
 * Every local write carries this origin. The undo manager tracks only this origin, so a
 * collaborator's edits (which arrive with the provider as origin) are never undone by me.
 */
export const BOARD_ORIGIN = 'board-local';

/** How far a duplicate is nudged from its original, in world units. */
const DUPLICATE_OFFSET = 24;

export function shapesRoot(doc: Y.Doc): Y.Map<ShapeMap> {
  return doc.getMap<ShapeMap>(Y_KEYS.shapes);
}

export function orderRoot(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>(Y_KEYS.order);
}

/**
 * Plain view of the board, back to front. Everything from the document is untrusted:
 * a hostile editor can write any value, so anything failing the schema is skipped.
 */
export function readShapes(doc: Y.Doc): Shape[] {
  const root = shapesRoot(doc);
  // Concurrent bring-to-front can duplicate an id, so the last occurrence wins.
  const position = new Map<string, number>();
  orderRoot(doc)
    .toArray()
    .forEach((id, index) => position.set(id, index));

  const shapes: { shape: Shape; index: number }[] = [];
  root.forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const parsed = shapeSchema.safeParse({ ...value.toJSON(), id });
    if (parsed.success) {
      shapes.push({ shape: parsed.data, index: position.get(id) ?? Number.MAX_SAFE_INTEGER });
    }
  });
  return shapes.sort((a, b) => a.index - b.index).map((entry) => entry.shape);
}

function writeShape(doc: Y.Doc, shape: Shape): void {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(shape)) {
    if (value !== undefined) map.set(key, value);
  }
  shapesRoot(doc).set(shape.id, map);
  orderRoot(doc).push([shape.id]);
}

export function addShape(doc: Y.Doc, shape: Shape): void {
  doc.transact(() => writeShape(doc, shape), BOARD_ORIGIN);
}

/** Adds several shapes as one transaction: one network update and one undo step. */
export function addShapes(doc: Y.Doc, shapes: readonly Shape[]): void {
  if (shapes.length === 0) return;
  doc.transact(() => {
    for (const shape of shapes) writeShape(doc, shape);
  }, BOARD_ORIGIN);
}

function applyPatch(doc: Y.Doc, id: string, patch: Partial<Shape>): void {
  const map = shapesRoot(doc).get(id);
  if (!(map instanceof Y.Map)) return;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id' || key === 'type') continue;
    // `undefined` clears an optional property, such as a border.
    if (value === undefined) map.delete(key);
    else map.set(key, value);
  }
}

/**
 * Applies several patches as one transaction, so a multi-shape drag or a style change is one
 * network update and one undo step. Each property is written separately, so concurrent edits
 * to different properties of the same shape both survive.
 */
export function updateShapes(doc: Y.Doc, patches: Readonly<Record<string, Partial<Shape>>>): void {
  const entries = Object.entries(patches);
  if (entries.length === 0) return;
  doc.transact(() => {
    for (const [id, patch] of entries) applyPatch(doc, id, patch);
  }, BOARD_ORIGIN);
}

export function updateShape(doc: Y.Doc, id: string, patch: Partial<Shape>): void {
  updateShapes(doc, { [id]: patch });
}

function removeFromOrder(doc: Y.Doc, id: string): void {
  const order = orderRoot(doc);
  for (let i = order.length - 1; i >= 0; i--) {
    if (order.get(i) === id) order.delete(i, 1);
  }
}

/** A connector whose shape is being removed keeps its end where it was, now unattached. */
function detachConnector(doc: Y.Doc, arrow: ArrowShape, byId: ReadonlyMap<string, Shape>, removing: ReadonlySet<string>): void {
  const startGone = arrow.startShapeId !== undefined && removing.has(arrow.startShapeId);
  const endGone = arrow.endShapeId !== undefined && removing.has(arrow.endShapeId);
  if (!startGone && !endGone) return;

  const { start, end } = arrowEndpoints(arrow, byId);
  applyPatch(doc, arrow.id, {
    points: [start.x - arrow.x, start.y - arrow.y, end.x - arrow.x, end.y - arrow.y],
    startShapeId: startGone ? undefined : arrow.startShapeId,
    endShapeId: endGone ? undefined : arrow.endShapeId,
  } satisfies Partial<ArrowShape>);
}

export function deleteShapes(doc: Y.Doc, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const removing = new Set(ids);
  const shapes = readShapes(doc);
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  doc.transact(() => {
    for (const shape of shapes) {
      if (shape.type === 'arrow' && !removing.has(shape.id)) detachConnector(doc, shape, byId, removing);
    }
    for (const id of removing) {
      shapesRoot(doc).delete(id);
      removeFromOrder(doc, id);
    }
  }, BOARD_ORIGIN);
}

export function deleteShape(doc: Y.Doc, id: string): void {
  deleteShapes(doc, [id]);
}

/** Copies shapes, nudged, and returns the new ids. Connectors keep only links inside the copy. */
export function duplicateShapes(doc: Y.Doc, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const shapes = readShapes(doc);
  const chosen = shapes.filter((shape) => wanted.has(shape.id));
  if (chosen.length === 0) return [];
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const idMap = new Map(chosen.map((shape) => [shape.id, newId()]));
  // A copied group is a new group, so editing the copy never drags the original along.
  const groupMap = new Map<string, string>();
  const groupFor = (groupId: string): string => {
    const existing = groupMap.get(groupId);
    if (existing !== undefined) return existing;
    const created = newId();
    groupMap.set(groupId, created);
    return created;
  };

  const copies = chosen.map((shape): Shape => {
    const id = idMap.get(shape.id) ?? newId();
    const moved = { x: shape.x + DUPLICATE_OFFSET, y: shape.y + DUPLICATE_OFFSET };
    const group = shape.groupId !== undefined ? { groupId: groupFor(shape.groupId) } : {};
    if (shape.type !== 'arrow') return { ...shape, ...moved, ...group, id };

    const { start, end } = arrowEndpoints(shape, byId);
    const copy: ArrowShape = {
      ...shape,
      ...moved,
      ...group,
      id,
      points: [start.x - shape.x, start.y - shape.y, end.x - shape.x, end.y - shape.y],
    };
    const startId = shape.startShapeId !== undefined ? idMap.get(shape.startShapeId) : undefined;
    const endId = shape.endShapeId !== undefined ? idMap.get(shape.endShapeId) : undefined;
    if (startId) copy.startShapeId = startId;
    else delete copy.startShapeId;
    if (endId) copy.endShapeId = endId;
    else delete copy.endShapeId;
    return copy;
  });

  doc.transact(() => {
    for (const copy of copies) writeShape(doc, copy);
  }, BOARD_ORIGIN);
  return copies.map((copy) => copy.id);
}

function newId(): string {
  return crypto.randomUUID();
}

/** The given ids as they appear in the z-order, back to front, each once. */
function inOrder(doc: Y.Doc, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of orderRoot(doc).toArray()) {
    if (wanted.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

export function moveToFront(doc: Y.Doc, ids: readonly string[]): void {
  doc.transact(() => {
    const picked = inOrder(doc, ids);
    for (const id of picked) removeFromOrder(doc, id);
    orderRoot(doc).push(picked);
  }, BOARD_ORIGIN);
}

export function moveToBack(doc: Y.Doc, ids: readonly string[]): void {
  doc.transact(() => {
    const picked = inOrder(doc, ids);
    for (const id of picked) removeFromOrder(doc, id);
    orderRoot(doc).insert(0, picked);
  }, BOARD_ORIGIN);
}

/**
 * Puts the shapes in one new group and returns its id, or null when fewer than two exist.
 * Shapes leave any group they were in, so a shape is never in two.
 */
export function groupShapes(doc: Y.Doc, ids: readonly string[]): string | null {
  const present = ids.filter((id) => shapesRoot(doc).get(id) instanceof Y.Map);
  if (new Set(present).size < 2) return null;
  const groupId = newId();
  const patches: Record<string, Partial<Shape>> = {};
  for (const id of new Set(present)) patches[id] = { groupId };
  updateShapes(doc, patches);
  return groupId;
}

/** Releases every shape in the groups the given shapes belong to. */
export function ungroupShapes(doc: Y.Doc, ids: readonly string[]): void {
  const shapes = readShapes(doc);
  const groups = new Set<string>();
  for (const shape of shapes) {
    if (ids.includes(shape.id) && shape.groupId !== undefined) groups.add(shape.groupId);
  }
  if (groups.size === 0) return;
  const patches: Record<string, Partial<Shape>> = {};
  for (const shape of shapes) {
    if (shape.groupId !== undefined && groups.has(shape.groupId)) patches[shape.id] = { groupId: undefined };
  }
  updateShapes(doc, patches);
}

export function bringToFront(doc: Y.Doc, id: string): void {
  moveToFront(doc, [id]);
}

export function newShapeId(): string {
  return newId();
}

/**
 * Undo and redo for the local user's board edits. Remote edits arrive with the provider as
 * their origin, which is not tracked, so undo can never revert a collaborator's work.
 */
export function createBoardUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager([shapesRoot(doc), orderRoot(doc)], {
    trackedOrigins: new Set([BOARD_ORIGIN]),
    // Edits within this window merge, so a drag is one step. Gesture ends call stopCapturing().
    captureTimeout: 500,
  });
}
