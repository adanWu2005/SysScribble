'use client';

import { Y_KEYS } from '@wb/shared';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { MAX_NOTES_TITLE, readNotesTitle, writeNotesTitle } from '@/lib/notes/title';

interface NotesTitleProps {
  doc: Y.Doc;
  canEdit: boolean;
  /** Called when Enter is pressed, to move into the body. */
  onEnter: () => void;
}

/**
 * The document title. It is stored in the shared document, so a rename shows up for everyone.
 * It renders as an input value, which is text and never markup.
 */
export function NotesTitle({ doc, canEdit, onEnter }: NotesTitleProps) {
  const [title, setTitle] = useState(() => readNotesTitle(doc));

  useEffect(() => {
    const meta = doc.getMap(Y_KEYS.meta);
    const sync = () => setTitle(readNotesTitle(doc));
    meta.observe(sync);
    // The document may have synced between the first render and now.
    sync();
    return () => meta.unobserve(sync);
  }, [doc]);

  return (
    <input
      type="text"
      value={title}
      readOnly={!canEdit}
      maxLength={MAX_NOTES_TITLE}
      placeholder="Untitled"
      aria-label="Notes title"
      onChange={(event) => {
        setTitle(event.target.value);
        writeNotesTitle(doc, event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onEnter();
        }
      }}
      className="mb-4 block w-full truncate font-display border-0 bg-transparent p-0 text-3xl font-bold tracking-tight text-neutral-900 placeholder:text-neutral-300 focus:outline-none dark:text-neutral-50 dark:placeholder:text-neutral-600"
    />
  );
}
