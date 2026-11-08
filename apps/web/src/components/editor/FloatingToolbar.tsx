'use client';

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Bold, Code, Highlighter, Italic, Underline, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';

interface Anchor {
  left: number;
  top: number;
}

const BAR_HEIGHT = 40;
const HALF_WIDTH = 100;

/** Where to float the toolbar for the current selection, relative to `container`. */
function anchorFor(editor: Editor, container: HTMLElement): Anchor | null {
  const { selection } = editor.state;
  if (selection.empty || !(selection instanceof TextSelection)) return null;
  if (!editor.isEditable || !editor.view.hasFocus() || editor.isActive('codeBlock')) return null;

  const start = editor.view.coordsAtPos(selection.from);
  const end = editor.view.coordsAtPos(selection.to);
  const box = container.getBoundingClientRect();
  const middle = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2 - box.left;
  const above = Math.min(start.top, end.top) - box.top - BAR_HEIGHT - 8;
  // Below the selection when there is no room above it.
  const top = above >= 4 ? above : Math.max(start.bottom, end.bottom) - box.top + 8;
  return { left: Math.min(Math.max(middle, HALF_WIDTH), Math.max(HALF_WIDTH, box.width - HALF_WIDTH)), top };
}

interface FormatButton {
  label: string;
  shortcut: string;
  Icon: LucideIcon;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BUTTONS: readonly FormatButton[] = [
  {
    label: 'Bold',
    shortcut: 'Ctrl+B',
    Icon: Bold,
    isActive: (editor) => editor.isActive('bold'),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    label: 'Italic',
    shortcut: 'Ctrl+I',
    Icon: Italic,
    isActive: (editor) => editor.isActive('italic'),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    label: 'Underline',
    shortcut: 'Ctrl+U',
    Icon: Underline,
    isActive: (editor) => editor.isActive('underline'),
    run: (editor) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    label: 'Inline code',
    shortcut: 'Ctrl+E',
    Icon: Code,
    isActive: (editor) => editor.isActive('code'),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    label: 'Highlight',
    shortcut: 'Ctrl+Shift+H',
    Icon: Highlighter,
    isActive: (editor) => editor.isActive('highlight'),
    run: (editor) => editor.chain().focus().toggleMark('highlight').run(),
  },
];

interface FloatingToolbarProps {
  editor: Editor;
  container: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
}

/** Formatting buttons that float above selected text. Only an editable editor ever shows them. */
export function FloatingToolbar({ editor, container, scroller }: FloatingToolbarProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    const update = () => {
      const box = container.current;
      const next = box ? anchorFor(editor, box) : null;
      // A new object each time is deliberate: a toggled mark changes no position, but the
      // buttons still have to redraw their pressed state.
      setAnchor((previous) => (previous === null && next === null ? previous : next));
    };
    const hide = () => setAnchor(null);
    editor.on('transaction', update);
    editor.on('focus', update);
    editor.on('blur', hide);
    const element = scroller.current;
    element?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      editor.off('transaction', update);
      editor.off('focus', update);
      editor.off('blur', hide);
      element?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [editor, container, scroller]);

  if (!anchor) return null;

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      style={{ left: anchor.left, top: anchor.top, height: BAR_HEIGHT }}
      // Keeping the mouse-down from reaching the editor is what preserves the selection.
      onMouseDown={(event) => event.preventDefault()}
      className="absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-neutral-200 bg-white/95 px-1 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-800/95"
    >
      {BUTTONS.map(({ label, shortcut, Icon, isActive, run }) => {
        const active = isActive(editor);
        return (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={`${label} (${shortcut})`}
            onClick={() => run(editor)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
              active
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-700 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-700'
            }`}
          >
            <Icon size={16} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
