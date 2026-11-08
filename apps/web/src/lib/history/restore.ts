import { Y_KEYS, type Shape } from '@wb/shared';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
  yXmlFragmentToProsemirrorJSON,
} from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { notesToMarkdown } from '@/lib/export/markdown';
import { notesSchema } from '@/lib/notes/schema';
import { readNotesTitle, writeNotesTitle } from '@/lib/notes/title';
import { orderRoot, readShapes, shapesRoot } from '@/lib/whiteboard/model';

/**
 * Previewing and restoring an older version of a room.
 *
 * A snapshot is read into a throwaway Y.Doc and nothing from it is trusted: shapes go through the
 * same schema check as live ones, and the notes go through the editor's closed schema. A restore
 * is then an ordinary Yjs transaction on the live document, so the server applies it only if the
 * sender is an owner or editor, exactly as for any other edit.
 */

/** The server keeps at most 2 MiB. Anything much larger is not a snapshot we wrote. */
const MAX_SNAPSHOT_READ_BYTES = 4 * 1024 * 1024;

/** Not the board's origin, so a restore is not an undo step for the whiteboard alone. */
export const RESTORE_ORIGIN = 'history-restore';

export class SnapshotError extends Error {
  override readonly name = 'SnapshotError';
}

/** Loads saved bytes into a new document. Throws SnapshotError for anything unreadable. */
export function openSnapshot(bytes: Uint8Array): Y.Doc {
  if (bytes.byteLength > MAX_SNAPSHOT_READ_BYTES) throw new SnapshotError('This version is too large to open.');
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
  } catch {
    doc.destroy();
    throw new SnapshotError('This version could not be read.');
  }
  return doc;
}

export interface SnapshotPreview {
  /** Only shapes that pass validation, back to front. */
  shapes: Shape[];
  title: string;
  /** The notes as Markdown text. Shown as plain text, never as HTML. */
  markdown: string;
}

export function previewSnapshot(snapshot: Y.Doc): SnapshotPreview {
  let markdown = '';
  try {
    markdown = notesToMarkdown(yXmlFragmentToProsemirrorJSON(snapshot.getXmlFragment(Y_KEYS.notes)));
  } catch {
    // Notes that cannot be read are shown as empty. The board preview is still useful.
  }
  return { shapes: readShapes(snapshot), title: readNotesTitle(snapshot), markdown };
}

/**
 * Makes the live document match the snapshot: shapes, their order, the notes and the notes title.
 * Everything happens in one transaction, so collaborators see a single change and the document
 * is never half restored. Throws SnapshotError, before changing anything, when the notes in the
 * snapshot cannot be read.
 */
export function restoreSnapshot(live: Y.Doc, snapshot: Y.Doc): void {
  // Validate first, so a failure leaves the live document untouched.
  let notes;
  try {
    notes = yXmlFragmentToProseMirrorRootNode(snapshot.getXmlFragment(Y_KEYS.notes), notesSchema());
  } catch {
    throw new SnapshotError('The notes in this version could not be read.');
  }
  const shapes = readShapes(snapshot);
  const title = readNotesTitle(snapshot);

  live.transact(() => {
    const shapeMap = shapesRoot(live);
    const wanted = new Set(shapes.map((shape) => shape.id));
    for (const id of Array.from(shapeMap.keys())) if (!wanted.has(id)) shapeMap.delete(id);

    for (const shape of shapes) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(shape)) if (value !== undefined) map.set(key, value);
      shapeMap.set(shape.id, map);
    }

    const order = orderRoot(live);
    order.delete(0, order.length);
    order.push(shapes.map((shape) => shape.id));

    prosemirrorToYXmlFragment(notes, live.getXmlFragment(Y_KEYS.notes));
    writeNotesTitle(live, title);
  }, RESTORE_ORIGIN);
}
