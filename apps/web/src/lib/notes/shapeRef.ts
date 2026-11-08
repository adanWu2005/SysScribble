import type { Shape } from '@wb/shared';

/** Everything that links a note to a shape on the whiteboard. Pure, so it is unit-tested. */

/** Shape ids are UUIDs we generate, but a collaborator can write any id up to 64 characters. */
const SHAPE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const MAX_REF_LABEL = 60;
const MAX_SNIPPET = 40;

export function isShapeId(value: unknown): value is string {
  return typeof value === 'string' && SHAPE_ID_PATTERN.test(value);
}

const KIND: Readonly<Record<Shape['type'], string>> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  sticky: 'Sticky note',
  text: 'Text',
  image: 'Image',
  file: 'PDF',
  path: 'Drawing',
  arrow: 'Arrow',
};

/** A short name for a shape, used as the label on its badge in the notes. */
export function describeShape(shape: Shape): string {
  const kind = KIND[shape.type];
  let text = '';
  if (shape.type === 'file') text = shape.filename;
  else if ('text' in shape && typeof shape.text === 'string') text = shape.text;

  const letters = Array.from(text.replace(/\s+/g, ' ').trim());
  if (letters.length === 0) return kind;
  const snippet = letters.slice(0, MAX_SNIPPET).join('');
  return `${kind}: ${snippet}${letters.length > MAX_SNIPPET ? '…' : ''}`;
}

/** Keeps a label short and printable. Labels come from the document, so they are untrusted. */
export function cleanLabel(value: unknown): string {
  if (typeof value !== 'string') return 'Shape';
  const flat = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, MAX_REF_LABEL).join('') || 'Shape';
}

/** A link that opens the room and flies to a shape. The id sits in the fragment, so no server sees it. */
export function shapeLink(origin: string, roomId: string, shapeId: string): string {
  return `${origin}/rooms/${roomId}#shape=${encodeURIComponent(shapeId)}`;
}

/** Reads `#shape=<id>` from a location hash. Anything else, including a malformed id, is null. */
export function parseShapeHash(hash: string): string | null {
  const match = /^#shape=([^&]+)$/.exec(hash);
  if (!match?.[1]) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isShapeId(id) ? id : null;
}
