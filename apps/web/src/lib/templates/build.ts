import { Y_KEYS, type RoomTemplateId, type Shape } from '@wb/shared';
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { notesSchema } from '@/lib/notes/schema';
import { writeNotesTitle } from '@/lib/notes/title';
import { shapeBounds, unionBounds } from '@/lib/whiteboard/geometry';
import { addShapes } from '@/lib/whiteboard/model';
import { buildTemplate, type TemplateId } from '@/lib/whiteboard/templates';
import { templateNotes } from './notes';

/**
 * Builds the starting document for a new workspace. It runs on the server when a room is created,
 * and the result is stored as the room's first snapshot, so nothing a client sends becomes document
 * content. A blank room has no snapshot at all.
 */

/** Which whiteboard layout each template uses. */
const CANVAS_FOR: Readonly<Record<Exclude<RoomTemplateId, 'blank'>, TemplateId>> = {
  rfc: 'architecture',
  kanban: 'kanban',
  retro: 'retro',
};

/** Top-left of the layout, in world units, so it opens inside the default view. */
const ORIGIN = { x: 80, y: 80 };

function layout(id: TemplateId, authorName: string): Shape[] {
  const built = buildTemplate(id, { x: 0, y: 0 }, authorName);
  const bounds = unionBounds(built.filter((shape) => shape.type !== 'arrow').map(shapeBounds));
  if (!bounds) return built;
  const dx = ORIGIN.x - bounds.x;
  const dy = ORIGIN.y - bounds.y;
  return built.map((shape) => ({ ...shape, x: shape.x + dx, y: shape.y + dy }));
}

/** The encoded Y.Doc for a template, or null when the room should start empty. */
export function buildTemplateSnapshot(id: RoomTemplateId, title: string, authorName: string): Uint8Array | null {
  if (id === 'blank') return null;
  const doc = new Y.Doc();
  doc.transact(() => {
    writeNotesTitle(doc, title);
    const notes = templateNotes(id);
    if (notes) prosemirrorToYXmlFragment(notesSchema().nodeFromJSON(notes), doc.getXmlFragment(Y_KEYS.notes));
    addShapes(doc, layout(CANVAS_FOR[id], authorName));
  });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}
