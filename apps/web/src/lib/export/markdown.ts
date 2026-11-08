import { cleanLabel, isShapeId } from '@/lib/notes/shapeRef';
import { isSafeUrl } from '@/lib/sanitize';

/**
 * Turns the notes into Markdown. It works on the editor's JSON, so it needs no editor and no DOM.
 * The JSON is untrusted (any editor can write the document), so every field is checked before
 * use, unknown nodes contribute only their text, and anything that could be read as Markdown
 * structure inside plain text is escaped.
 */

export interface MarkdownOptions {
  /** Written as a top-level heading when not empty. */
  title?: string;
  /** A URL for a shape badge, or null to leave the badge as plain text. */
  linkForShape?: (shapeId: string) => string | null;
}

interface Mark {
  type: string;
  attrs: Record<string, unknown>;
}

interface PmNode {
  type: string;
  attrs: Record<string, unknown>;
  content: PmNode[];
  marks: Mark[];
  text: string;
}

const MAX_DEPTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Beyond MAX_DEPTH a node is dropped, so hostile nesting cannot exhaust the stack. */
function toNode(value: unknown, depth = 0): PmNode | null {
  if (depth > MAX_DEPTH || !isRecord(value) || typeof value['type'] !== 'string') return null;
  const content = Array.isArray(value['content'])
    ? value['content'].map((child) => toNode(child, depth + 1)).filter((n): n is PmNode => n !== null)
    : [];
  const marks: Mark[] = [];
  if (Array.isArray(value['marks'])) {
    for (const raw of value['marks']) {
      if (isRecord(raw) && typeof raw['type'] === 'string') {
        marks.push({ type: raw['type'], attrs: isRecord(raw['attrs']) ? raw['attrs'] : {} });
      }
    }
  }
  return {
    type: value['type'],
    attrs: isRecord(value['attrs']) ? value['attrs'] : {},
    content,
    marks,
    text: typeof value['text'] === 'string' ? value['text'] : '',
  };
}

/** Escapes characters that Markdown would otherwise read as formatting. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>~|]/g, '\\$&')
    .split('\n')
    .map((line) =>
      line
        // A line that starts like a heading, quote, list item or rule must read as text.
        .replace(/^(\s*)([#>+-])/, '$1\\$2')
        .replace(/^(\s*)(\d+)\./, '$1$2\\.')
        .replace(/^(\s*)(=+\s*)$/, '$1\\$2'),
    )
    .join('\n');
}

const DESTINATION_ESCAPES: Readonly<Record<string, string>> = { '(': '%28', ')': '%29', '<': '%3C', '>': '%3E' };

/** Characters that would end a Markdown link destination early are percent-encoded. */
function safeDestination(url: string): string {
  return url.replace(/[()<>\s]/g, (char) => DESTINATION_ESCAPES[char] ?? encodeURIComponent(char));
}

/** A file that leaves the app can only use absolute links, and only the safe kinds. */
function isExportableUrl(value: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(value) && isSafeUrl(value);
}

/** Markers must touch the text, so spaces at the edges move outside them. */
function wrap(text: string, open: string, close: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const lead = match?.[1] ?? '';
  const core = match?.[2] ?? text;
  const trail = match?.[3] ?? '';
  return core === '' ? text : `${lead}${open}${core}${close}${trail}`;
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function markedText(node: PmNode): string {
  const kinds = new Set(node.marks.map((mark) => mark.type));
  // Inside code nothing is formatting, so the text goes in as is.
  let out = kinds.has('code') ? codeSpan(node.text) : escapeMarkdown(node.text);

  if (kinds.has('bold')) out = wrap(out, '**', '**');
  if (kinds.has('italic')) out = wrap(out, '*', '*');
  if (kinds.has('strike')) out = wrap(out, '~~', '~~');
  if (kinds.has('highlight')) out = wrap(out, '==', '==');
  if (kinds.has('underline')) out = wrap(out, '<u>', '</u>');

  const link = node.marks.find((mark) => mark.type === 'link');
  const href = link?.attrs['href'];
  if (typeof href === 'string' && isExportableUrl(href)) out = `[${out}](${safeDestination(href)})`;
  return out;
}

function inline(nodes: readonly PmNode[], options: MarkdownOptions): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return markedText(node);
        case 'hardBreak':
          return '  \n';
        case 'shapeRef': {
          const label = escapeMarkdown(cleanLabel(node.attrs['label']));
          const id: unknown = node.attrs['shapeId'];
          const url = isShapeId(id) ? options.linkForShape?.(id) ?? null : null;
          return url && isExportableUrl(url) ? `[${label}](${safeDestination(url)})` : `[${label}]`;
        }
        default:
          // An unknown inline node still contributes whatever text it holds.
          return inline(node.content, options);
      }
    })
    .join('');
}

function indentLines(text: string, prefix: string, firstPrefix = prefix): string {
  return text
    .split('\n')
    .map((line, index) => (line === '' ? '' : `${index === 0 ? firstPrefix : prefix}${line}`))
    .join('\n');
}

/** An item's blocks are joined tightly, so a nested list sits right under its parent line. */
function listItem(node: PmNode, options: MarkdownOptions, depth: number): string {
  return node.content
    .map((child) => block(child, options, depth + 1))
    .filter((text) => text.trim() !== '')
    .join('\n');
}

function fenceFor(code: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(longest + 1);
}

function block(node: PmNode, options: MarkdownOptions, depth: number): string {
  if (depth > MAX_DEPTH) return '';

  switch (node.type) {
    case 'paragraph':
      return inline(node.content, options);
    case 'heading': {
      const level = typeof node.attrs['level'] === 'number' ? Math.min(6, Math.max(1, Math.trunc(node.attrs['level']))) : 1;
      return `${'#'.repeat(level)} ${inline(node.content, options)}`;
    }
    case 'bulletList':
      return node.content.map((item) => indentLines(listItem(item, options, depth), '  ', '- ')).join('\n');
    case 'orderedList': {
      const start = typeof node.attrs['start'] === 'number' ? Math.max(0, Math.trunc(node.attrs['start'])) : 1;
      return node.content
        .map((item, index) => {
          const marker = `${start + index}. `;
          return indentLines(listItem(item, options, depth), ' '.repeat(marker.length), marker);
        })
        .join('\n');
    }
    case 'taskList':
      return node.content
        .map((item) => {
          const done = item.attrs['checked'] === true;
          return indentLines(listItem(item, options, depth), '  ', done ? '- [x] ' : '- [ ] ');
        })
        .join('\n');
    case 'codeBlock': {
      const code = node.content.map((child) => child.text).join('');
      const language = typeof node.attrs['language'] === 'string' && /^[A-Za-z0-9_+#.-]{1,30}$/.test(node.attrs['language']) ? node.attrs['language'] : '';
      const fence = fenceFor(code);
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case 'blockquote':
      return indentLines(blocks(node.content, options, depth + 1), '> ');
    case 'callout':
      return indentLines(`[!NOTE]\n${blocks(node.content, options, depth + 1)}`, '> ');
    case 'horizontalRule':
      return '---';
    default:
      // An unknown block: keep its text, drop its structure.
      return node.content.some((child) => child.type === 'text') ? inline(node.content, options) : blocks(node.content, options, depth + 1);
  }
}

function blocks(nodes: readonly PmNode[], options: MarkdownOptions, depth: number): string {
  return nodes
    .map((node) => block(node, options, depth))
    .filter((text) => text.trim() !== '')
    .join('\n\n');
}

/** The notes as Markdown, from the editor's JSON. Anything that is not a document gives an empty note. */
export function notesToMarkdown(json: unknown, options: MarkdownOptions = {}): string {
  const root = toNode(json);
  const body = root ? blocks(root.content, options, 0) : '';
  const title = options.title?.trim();
  const heading = title ? `# ${escapeMarkdown(title.replace(/\s+/g, ' '))}` : '';
  return `${[heading, body].filter((part) => part !== '').join('\n\n')}\n`;
}
