import { Mark, Node, mergeAttributes, type Extensions } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import { cleanLabel, isShapeId } from '@/lib/notes/shapeRef';
import { isSafeUrl } from '@/lib/sanitize';

/**
 * The notes schema is closed. Every node and mark below renders from a fixed element with fixed
 * attributes, and there is no node that can hold raw HTML. A document arriving over Yjs or a
 * paste can only contain what is listed here, so none of it can become markup (PRD §5.5).
 */

/** Highlighted text. It has no color attribute, because a stored color would become inline CSS. */
export const Highlight = Mark.create({
  name: 'highlight',
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: () => ['mark', 0],
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleMark(this.name) };
  },
});

/** A box that sets a block of content apart. Press Enter on an empty line to leave it. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: () => ['div', { 'data-callout': '', class: 'callout' }, 0],
});

/**
 * An inline badge that points at a shape on the whiteboard. It stores only the shape's id and a
 * short label. The label is drawn as a text child, never as HTML.
 */
export const ShapeRef = Node.create({
  name: 'shapeRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      shapeId: { default: '' },
      label: { default: 'Shape' },
    };
  },
  parseHTML: () => [
    {
      tag: 'span[data-shape-ref]',
      // A badge with an id that could not be a shape id is dropped, not repaired.
      getAttrs: (element) => {
        const id = element.getAttribute('data-shape-ref');
        if (!isShapeId(id)) return false;
        return { shapeId: id, label: cleanLabel(element.getAttribute('data-label')) };
      },
    },
  ],
  renderHTML({ node }) {
    const id: unknown = node.attrs['shapeId'];
    return [
      'span',
      mergeAttributes({
        'data-shape-ref': isShapeId(id) ? id : '',
        'data-label': cleanLabel(node.attrs['label']),
        class: 'shape-ref',
        title: 'Show on the whiteboard',
      }),
      cleanLabel(node.attrs['label']),
    ];
  },
});

/**
 * Every extension except the collaboration ones. It is a separate function so a test can build
 * the same schema the editor uses, without a Yjs document.
 */
export function notesSchemaExtensions(): Extensions {
  return [
    // Yjs owns history. The Link defaults are replaced with the allowlist below.
    StarterKit.configure({ undoRedo: false, link: false, heading: { levels: [1, 2, 3] } }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto'],
      isAllowedUri: (url) => typeof url === 'string' && isSafeUrl(url),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    ShapeRef,
  ];
}
