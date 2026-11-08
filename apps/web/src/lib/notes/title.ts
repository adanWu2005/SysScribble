import { Y_KEYS } from '@wb/shared';
import type * as Y from 'yjs';

/** The notes document's title lives in the shared `meta` map, so everyone sees it change. */

export const NOTES_TITLE_KEY = 'notesTitle';
export const MAX_NOTES_TITLE = 200;

function clean(value: string): string {
  // A title is one line. Pasted newlines and control characters are dropped.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_NOTES_TITLE);
}

/** The stored title, or empty. The value is untrusted, since any editor can write the map. */
export function readNotesTitle(doc: Y.Doc): string {
  const value: unknown = doc.getMap(Y_KEYS.meta).get(NOTES_TITLE_KEY);
  return typeof value === 'string' ? clean(value) : '';
}

export function writeNotesTitle(doc: Y.Doc, title: string): void {
  doc.getMap(Y_KEYS.meta).set(NOTES_TITLE_KEY, clean(title));
}
