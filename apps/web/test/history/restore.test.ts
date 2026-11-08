import { Y_KEYS, type Shape } from '@wb/shared';
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { formatAgo, formatBytes, entryTitle } from '@/lib/history/format';
import {
  RESTORE_ORIGIN,
  SnapshotError,
  openSnapshot,
  previewSnapshot,
  restoreSnapshot,
} from '@/lib/history/restore';
import { notesSchema } from '@/lib/notes/schema';
import { readNotesTitle, writeNotesTitle } from '@/lib/notes/title';
import { addShape, createBoardUndoManager, orderRoot, readShapes, shapesRoot, updateShape } from '@/lib/whiteboard/model';

const rect = (id: string, x = 0, extra: Partial<Shape> = {}): Shape =>
  ({ id, type: 'rect', x, y: 0, rotation: 0, width: 100, height: 50, fill: '#ffffff', ...extra }) as Shape;

function setNotes(doc: Y.Doc, ...paragraphs: string[]): void {
  const node = notesSchema().nodeFromJSON({
    type: 'doc',
    content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  });
  prosemirrorToYXmlFragment(node, doc.getXmlFragment(Y_KEYS.notes));
}

function roundTrip(doc: Y.Doc): Y.Doc {
  return openSnapshot(Y.encodeStateAsUpdate(doc));
}

const ids = (doc: Y.Doc) => readShapes(doc).map((shape) => shape.id);
const notesText = (doc: Y.Doc) => previewSnapshot(doc).markdown.trim();

describe('openSnapshot', () => {
  it('reads saved bytes back into a document', () => {
    const source = new Y.Doc();
    addShape(source, rect('a', 5));
    writeNotesTitle(source, 'Old title');
    setNotes(source, 'old text');

    const opened = roundTrip(source);
    expect(ids(opened)).toEqual(['a']);
    expect(readNotesTitle(opened)).toBe('Old title');
    expect(notesText(opened)).toBe('old text');
  });

  it('turns unreadable bytes into a clear error', () => {
    for (const junk of [new Uint8Array([255, 255, 255, 255, 1, 2, 3]), new Uint8Array([9, 9, 9])]) {
      expect(() => openSnapshot(junk)).toThrow(SnapshotError);
    }
  });

  it('refuses something far bigger than the server would ever keep', () => {
    expect(() => openSnapshot(new Uint8Array(5 * 1024 * 1024))).toThrow(SnapshotError);
  });

  it('opens an empty snapshot as an empty room', () => {
    const opened = roundTrip(new Y.Doc());
    expect(ids(opened)).toEqual([]);
    expect(readNotesTitle(opened)).toBe('');
  });
});

describe('previewSnapshot', () => {
  it('summarizes the board, the title and the notes', () => {
    const source = new Y.Doc();
    addShape(source, rect('a'));
    addShape(source, rect('b', 200));
    writeNotesTitle(source, 'Plan');
    setNotes(source, 'first', 'second');
    const preview = previewSnapshot(roundTrip(source));
    expect(preview.shapes.map((shape) => shape.id)).toEqual(['a', 'b']);
    expect(preview.title).toBe('Plan');
    expect(preview.markdown).toBe('first\n\nsecond\n');
  });

  it('leaves out a shape that fails validation', () => {
    const source = new Y.Doc();
    addShape(source, rect('good'));
    const evil = new Y.Map<unknown>();
    evil.set('type', 'rect');
    evil.set('fill', 'javascript:alert(1)');
    shapesRoot(source).set('evil', evil);
    expect(previewSnapshot(roundTrip(source)).shapes.map((shape) => shape.id)).toEqual(['good']);
  });

  it('shows notes it cannot read as empty rather than failing', () => {
    const source = new Y.Doc();
    addShape(source, rect('a'));
    const evil = new Y.XmlElement('script');
    evil.insert(0, [new Y.XmlText('alert(1)')]);
    source.getXmlFragment(Y_KEYS.notes).insert(0, [evil]);
    const preview = previewSnapshot(roundTrip(source));
    expect(preview.shapes).toHaveLength(1);
    expect(preview.markdown).not.toContain('<script');
  });
});

describe('restoreSnapshot', () => {
  function pair() {
    const past = new Y.Doc();
    addShape(past, rect('keep', 10));
    addShape(past, rect('revert', 20, { fill: '#93c5fd' }));
    addShape(past, rect('removed-since', 30));
    writeNotesTitle(past, 'Old title');
    setNotes(past, 'old one', 'old two');
    const snapshot = roundTrip(past);

    // The live room started as the same document and has moved on since.
    const live = new Y.Doc();
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past));
    shapesRoot(live).delete('removed-since');
    orderRoot(live).delete(2, 1);
    updateShape(live, 'revert', { fill: '#dc2626', x: 999 });
    addShape(live, rect('added-since', 40));
    writeNotesTitle(live, 'New title');
    const fragment = live.getXmlFragment(Y_KEYS.notes);
    fragment.delete(0, fragment.length);
    setNotes(live, 'new text');
    return { snapshot, live };
  }

  it('makes the live board, title and notes match the snapshot', () => {
    const { snapshot, live } = pair();
    restoreSnapshot(live, snapshot);

    expect(ids(live)).toEqual(['keep', 'revert', 'removed-since']);
    expect(readShapes(live).find((shape) => shape.id === 'revert')).toMatchObject({ fill: '#93c5fd', x: 20 });
    expect(readNotesTitle(live)).toBe('Old title');
    expect(notesText(live)).toBe('old one\n\nold two');
  });

  it('removes shapes that did not exist then, including from the z-order', () => {
    const { snapshot, live } = pair();
    restoreSnapshot(live, snapshot);
    expect(shapesRoot(live).has('added-since')).toBe(false);
    expect(orderRoot(live).toArray()).not.toContain('added-since');
    expect(new Set(orderRoot(live).toArray()).size).toBe(orderRoot(live).length);
  });

  it('keeps the stacking order of the snapshot', () => {
    const past = new Y.Doc();
    for (const id of ['back', 'middle', 'front']) addShape(past, rect(id));
    const snapshot = roundTrip(past);
    const live = new Y.Doc();
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past));
    // Scramble the live order, then restore.
    orderRoot(live).delete(0, 3);
    orderRoot(live).push(['front', 'back', 'middle']);
    restoreSnapshot(live, snapshot);
    expect(ids(live)).toEqual(['back', 'middle', 'front']);
  });

  it('is one transaction, so collaborators see a single change', () => {
    const { snapshot, live } = pair();
    let updates = 0;
    let origin: unknown;
    live.on('update', (_update: Uint8Array, source: unknown) => {
      updates += 1;
      origin = source;
    });
    restoreSnapshot(live, snapshot);
    expect(updates).toBe(1);
    expect(origin).toBe(RESTORE_ORIGIN);
  });

  it('reaches a collaborator, who ends up with the same room', () => {
    const { snapshot, live } = pair();
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(live));
    live.on('update', (update: Uint8Array) => Y.applyUpdate(other, update, 'remote'));

    restoreSnapshot(live, snapshot);
    expect(ids(other)).toEqual(ids(live));
    expect(readNotesTitle(other)).toBe('Old title');
    expect(notesText(other)).toBe('old one\n\nold two');
  });

  it('is harmless to run twice, or on a room that already matches', () => {
    const { snapshot, live } = pair();
    restoreSnapshot(live, snapshot);
    const once = JSON.stringify(readShapes(live));
    restoreSnapshot(live, snapshot);
    expect(JSON.stringify(readShapes(live))).toBe(once);
    expect(notesText(live)).toBe('old one\n\nold two');
  });

  it('keeps connectors attached to the shapes that come back', () => {
    const past = new Y.Doc();
    addShape(past, rect('a', 0));
    addShape(past, rect('b', 300));
    addShape(past, {
      id: 'link',
      type: 'arrow',
      x: 0,
      y: 0,
      rotation: 0,
      points: [0, 0, 1, 1],
      stroke: '#111827',
      strokeWidth: 3,
      startShapeId: 'a',
      endShapeId: 'b',
    });
    const snapshot = roundTrip(past);
    const live = new Y.Doc();
    restoreSnapshot(live, snapshot);
    const link = readShapes(live).find((shape) => shape.id === 'link');
    expect(link?.type === 'arrow' && [link.startShapeId, link.endShapeId]).toEqual(['a', 'b']);
  });

  it('restores an empty snapshot by clearing the room', () => {
    const { live } = pair();
    restoreSnapshot(live, roundTrip(new Y.Doc()));
    expect(ids(live)).toEqual([]);
    expect(notesText(live)).toBe('');
  });

  it('is not a step the whiteboard undo can take back, and does not disturb it', () => {
    const { snapshot, live } = pair();
    const undo = createBoardUndoManager(live);
    restoreSnapshot(live, snapshot);
    expect(undo.undoStack).toHaveLength(0);
  });
});

describe('restoreSnapshot against a hostile snapshot', () => {
  it('leaves the live room untouched when the notes cannot be read', () => {
    const live = new Y.Doc();
    addShape(live, rect('mine'));
    writeNotesTitle(live, 'Mine');
    setNotes(live, 'my notes');

    const evil = new Y.Doc();
    addShape(evil, rect('theirs'));
    const script = new Y.XmlElement('script');
    script.insert(0, [new Y.XmlText('alert(1)')]);
    evil.getXmlFragment(Y_KEYS.notes).insert(0, [script]);

    let changed = false;
    live.on('update', () => (changed = true));
    try {
      restoreSnapshot(live, roundTrip(evil));
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotError);
      expect(changed).toBe(false);
      expect(ids(live)).toEqual(['mine']);
      expect(notesText(live)).toBe('my notes');
      return;
    }
    // If the editor schema simply dropped the unknown node, the result must still be clean.
    expect(JSON.stringify(live.getXmlFragment(Y_KEYS.notes).toJSON())).not.toContain('script');
  });

  it('never carries a malformed shape into the live room', () => {
    const live = new Y.Doc();
    const evil = new Y.Doc();
    addShape(evil, rect('good'));
    const bad = new Y.Map<unknown>();
    bad.set('type', 'rect');
    bad.set('fill', 'url(javascript:alert(1))');
    bad.set('width', -5);
    shapesRoot(evil).set('bad', bad);
    orderRoot(evil).push(['bad']);

    restoreSnapshot(live, roundTrip(evil));
    expect(ids(live)).toEqual(['good']);
    expect(shapesRoot(live).has('bad')).toBe(false);
    expect(orderRoot(live).toArray()).toEqual(['good']);
  });

  it('keeps a hostile title to one clean line', () => {
    const live = new Y.Doc();
    const evil = new Y.Doc();
    evil.getMap(Y_KEYS.meta).set('notesTitle', 'a\u0000b\nc');
    restoreSnapshot(live, roundTrip(evil));
    expect(readNotesTitle(live)).toBe('a b c');
  });
});

describe('history labels', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('says how long ago an entry was saved', () => {
    expect(formatAgo(ago(10_000), now)).toBe('Just now');
    expect(formatAgo(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(formatAgo(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(formatAgo(ago(24 * 3_600_000), now)).toBe('Yesterday');
    expect(formatAgo(ago(4 * 24 * 3_600_000), now)).toBe('4 days ago');
  });

  it('copes with a bad date or a clock that is behind', () => {
    expect(formatAgo('not a date', now)).toBe('');
    expect(formatAgo(ago(-60_000), now)).toBe('Just now');
  });

  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(50 * 1024)).toBe('50 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(-1)).toBe('');
  });

  it('names automatic and checkpoint entries', () => {
    expect(entryTitle(null)).toBe('Autosave');
    expect(entryTitle('Before restore')).toBe('Before restore');
  });
});
