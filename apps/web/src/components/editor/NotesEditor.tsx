'use client';

import { Y_KEYS } from '@wb/shared';
import type { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Placeholder from '@tiptap/extension-placeholder';
import { NodeSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { RoomSession, RoomUser } from '@/hooks/useRoomDoc';
import { cleanLabel, isShapeId } from '@/lib/notes/shapeRef';
import { filterSlashItems, matchSlashTrigger, type SlashCommandId } from '@/lib/notes/slash';
import { notesSchemaExtensions } from './extensions';
import { FloatingToolbar } from './FloatingToolbar';
import { NotesTitle } from './NotesTitle';
import { SlashMenu, type SlashAnchor } from './SlashMenu';

/** What the rest of the room can ask of the notes. */
export interface NotesApi {
  /** Inserts a badge pointing at a shape. False when the notes cannot be edited. */
  insertShapeRef: (ref: { shapeId: string; label: string }) => boolean;
  /** The notes as editor JSON, for export. */
  getJSON: () => unknown;
}

interface NotesEditorProps {
  session: RoomSession;
  user: RoomUser;
  canEdit: boolean;
  /** A badge was clicked. The room decides how to show that shape. */
  onOpenShape: (shapeId: string) => void;
  onApiReady?: (api: NotesApi | null) => void;
}

interface SlashState {
  from: number;
  to: number;
  query: string;
  anchor: SlashAnchor;
}

const MENU_ROOM = 300;

/** The slash command in progress at the cursor, or null. Only a collapsed cursor in plain text counts. */
function readSlash(editor: Editor, container: HTMLElement): SlashState | null {
  if (!editor.isEditable || !editor.view.hasFocus()) return null;
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') return null;

  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const trigger = matchSlashTrigger(before);
  if (!trigger) return null;

  const coords = editor.view.coordsAtPos(selection.from);
  const box = container.getBoundingClientRect();
  const flip = box.bottom - coords.bottom < MENU_ROOM;
  return {
    from: selection.from - trigger.length,
    to: selection.from,
    query: trigger.query,
    anchor: {
      left: Math.min(Math.max(coords.left - box.left, 8), Math.max(8, box.width - 264)),
      top: flip ? box.bottom - coords.top + 6 : coords.bottom - box.top + 6,
      flip,
    },
  };
}

function runSlashCommand(editor: Editor, range: { from: number; to: number }, id: SlashCommandId): void {
  const chain = editor.chain().focus().deleteRange(range);
  switch (id) {
    case 'h1':
      chain.setNode('heading', { level: 1 }).run();
      return;
    case 'h2':
      chain.setNode('heading', { level: 2 }).run();
      return;
    case 'h3':
      chain.setNode('heading', { level: 3 }).run();
      return;
    case 'bullet':
      chain.toggleBulletList().run();
      return;
    case 'task':
      chain.toggleTaskList().run();
      return;
    case 'code':
      chain.setCodeBlock().run();
      return;
    case 'callout':
      chain.wrapIn('callout').run();
      return;
    case 'divider':
      chain.setHorizontalRule().run();
      return;
  }
}

/**
 * The shared notes. The schema is closed (see extensions.ts): a raw HTML block cannot be
 * represented, and unknown nodes arriving over Yjs do not render (PRD §5.5).
 */
export function NotesEditor({ session, user, canEdit, onOpenShape, onApiReady }: NotesEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The editor is built once per session, so its key handlers read the latest state through refs.
  const slashKeys = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const openShape = useRef(onOpenShape);
  const dismissedAt = useRef<number | null>(null);
  const lastSlashKey = useRef('');

  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: canEdit,
      extensions: [
        ...notesSchemaExtensions(),
        Placeholder.configure({
          includeChildren: true,
          showOnlyCurrent: false,
          placeholder: ({ editor: current, node, hasAnchor }) => {
            if (!current.isEditable) return current.isEmpty ? 'Nothing has been written yet.' : '';
            if (node.type.name === 'heading') return `Heading ${String(node.attrs['level'])}`;
            if (node.type.name !== 'paragraph') return '';
            // The empty page always shows the prompt. Otherwise only the line being edited does.
            return current.isEmpty || hasAnchor ? "Type '/' for commands, or just start writing…" : '';
          },
        }),
        Collaboration.configure({ fragment: session.doc.getXmlFragment(Y_KEYS.notes) }),
        // The full user goes in: the server refuses awareness without the matching id.
        CollaborationCaret.configure({ provider: session.provider, user }),
      ],
      editorProps: {
        attributes: { class: 'notes-prose', 'aria-label': 'Shared notes' },
        handleKeyDown: (view, event) => {
          if (slashKeys.current(event)) return true;
          const { selection } = view.state;
          if (event.key === 'Enter' && selection instanceof NodeSelection && selection.node.type.name === 'shapeRef') {
            const id: unknown = selection.node.attrs['shapeId'];
            if (isShapeId(id)) {
              openShape.current(id);
              return true;
            }
          }
          return false;
        },
      },
    },
    [session],
  );

  useEffect(() => {
    openShape.current = onOpenShape;
  }, [onOpenShape]);

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  // ---- slash menu: open, narrow and close as the text changes ----

  useEffect(() => {
    if (!editor) return undefined;
    const update = () => {
      const box = container.current;
      const next = box ? readSlash(editor, box) : null;
      if (next === null) dismissedAt.current = null;
      // Escape hides the menu for this slash only. Typing another slash opens it again.
      const shown = next !== null && next.from !== dismissedAt.current ? next : null;
      setSlash((previous) => {
        if (shown === null) return previous === null ? previous : null;
        if (previous && previous.from === shown.from && previous.query === shown.query) return previous;
        return shown;
      });
      // Back to the first item only when the typed query changed, not on a collaborator's edit.
      const key = shown ? `${shown.from}:${shown.query}` : '';
      if (key !== lastSlashKey.current) {
        lastSlashKey.current = key;
        setSlashIndex(0);
      }
    };
    const hide = () => setSlash(null);
    editor.on('transaction', update);
    editor.on('blur', hide);
    return () => {
      editor.off('transaction', update);
      editor.off('blur', hide);
    };
  }, [editor]);

  const items = useMemo(() => (slash ? filterSlashItems(slash.query) : []), [slash]);
  const menuOpen = slash !== null && items.length > 0;
  const activeIndex = Math.min(slashIndex, Math.max(0, items.length - 1));

  function pick(id: SlashCommandId) {
    if (!editor || !slash) return;
    runSlashCommand(editor, { from: slash.from, to: slash.to }, id);
    setSlash(null);
  }

  useEffect(() => {
    slashKeys.current = (event) => {
      if (!menuOpen || !slash) return false;
      const count = items.length;
      switch (event.key) {
        case 'ArrowDown':
          setSlashIndex((activeIndex + 1) % count);
          return true;
        case 'ArrowUp':
          setSlashIndex((activeIndex - 1 + count) % count);
          return true;
        case 'Enter':
        case 'Tab': {
          const item = items[activeIndex];
          if (item) pick(item.id);
          return true;
        }
        case 'Escape':
          dismissedAt.current = slash.from;
          setSlash(null);
          return true;
        default:
          return false;
      }
    };
  });

  // ---- what the rest of the room can ask of the notes ----

  const api = useMemo<NotesApi | null>(() => {
    if (!editor) return null;
    return {
      getJSON: () => editor.getJSON(),
      insertShapeRef: ({ shapeId, label }) => {
        if (!editor.isEditable || !isShapeId(shapeId)) return false;
        const chain = editor.chain();
        // Where the cursor was, or the end of the notes when the user has been on the whiteboard.
        (editor.isFocused ? chain.focus() : chain.focus('end'))
          .insertContent([
            { type: 'shapeRef', attrs: { shapeId, label: cleanLabel(label) } },
            { type: 'text', text: ' ' },
          ])
          .run();
        return true;
      },
    };
  }, [editor]);

  useEffect(() => {
    onApiReady?.(api);
    return () => onApiReady?.(null);
  }, [api, onApiReady]);

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const badge = target.closest('[data-shape-ref]');
    if (!badge) return;
    const id = badge.getAttribute('data-shape-ref');
    if (isShapeId(id)) onOpenShape(id);
  }

  return (
    <div ref={container} className="relative flex h-full flex-col" onClick={onClick}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10">
          <NotesTitle doc={session.doc} canEdit={canEdit} onEnter={() => editor?.commands.focus('start')} />
          <EditorContent editor={editor} />
        </div>
      </div>
      {editor ? <FloatingToolbar editor={editor} container={container} scroller={scroller} /> : null}
      {menuOpen && slash ? (
        <SlashMenu items={items} index={activeIndex} anchor={slash.anchor} onPick={pick} onHover={setSlashIndex} />
      ) : null}
    </div>
  );
}
