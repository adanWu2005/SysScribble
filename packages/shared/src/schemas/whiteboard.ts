import { z } from 'zod';
import { MAX_CURSOR_CHAT_CHARS, reactionEmojiSchema } from './comments';
import { uuidSchema } from './ids';

/**
 * Whiteboard shapes live in `doc.getMap('shapes')` as nested `Y.Map`s (one per shape)
 * so concurrent edits to different properties of the same shape merge property-wise.
 * `doc.getArray('order')` holds shape ids back-to-front for z-ordering.
 *
 * These schemas validate the *plain JSON view* of a shape when reading from Yjs,
 * so a malformed value injected by a client can never reach the renderer.
 *
 * Every field added after the first release is optional, so documents written by older
 * clients keep parsing.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const finite = z.number().finite();
const shapeId = z.string().min(1).max(64);

/** Rendered as a text node only — never as HTML (PRD §5.5). */
const label = z.string().max(2000);

const shapeBase = z.object({
  id: shapeId,
  x: finite,
  y: finite,
  rotation: finite.default(0),
  /** Absent means fully opaque. */
  opacity: finite.min(0.05).max(1).optional(),
  /**
   * Shapes sharing a group id are selected, moved and copied together. Groups are flat, one level.
   * Absent means ungrouped.
   */
  groupId: shapeId.optional(),
});

/** Optional border for filled shapes. Absent means no border. */
const outline = {
  stroke: hexColor.optional(),
  strokeWidth: finite.min(0).max(40).optional(),
};

export const rectShapeSchema = shapeBase.extend({
  type: z.literal('rect'),
  width: finite.positive(),
  height: finite.positive(),
  fill: hexColor,
  ...outline,
  text: label.optional(),
});

export const ellipseShapeSchema = shapeBase.extend({
  type: z.literal('ellipse'),
  width: finite.positive(),
  height: finite.positive(),
  fill: hexColor,
  ...outline,
  text: label.optional(),
});

export const stickyShapeSchema = shapeBase.extend({
  type: z.literal('sticky'),
  width: finite.positive(),
  height: finite.positive(),
  fill: hexColor,
  ...outline,
  text: label,
  /** Display name of whoever created the note. Client-supplied, so cosmetic only. */
  authorName: z.string().max(80).optional(),
});

export const textShapeSchema = shapeBase.extend({
  type: z.literal('text'),
  text: label,
  fontSize: finite.min(8).max(200).default(20),
  fill: hexColor,
  /** Absent means the text sizes itself to its content. */
  width: finite.positive().optional(),
});

export const imageShapeSchema = shapeBase.extend({
  type: z.literal('image'),
  width: finite.positive(),
  height: finite.positive(),
  /** Only the asset id is shared; the URL is fetched (presigned) per viewer. */
  assetId: uuidSchema,
});

/** A PDF on the board. Double-click fetches a presigned download link. */
export const fileShapeSchema = shapeBase.extend({
  type: z.literal('file'),
  width: finite.positive(),
  height: finite.positive(),
  assetId: uuidSchema,
  filename: z.string().max(200),
});

export const pathShapeSchema = shapeBase.extend({
  type: z.literal('path'),
  /** Flat [x0, y0, x1, y1, ...] relative to (x, y). */
  points: z.array(finite).max(4000),
  stroke: hexColor,
  strokeWidth: finite.min(1).max(40),
});

/**
 * A connector. `points` is [x0, y0, x1, y1] relative to (x, y) and is the fallback for an
 * end that is not attached. An attached end follows the shape named by its id, so a dangling
 * id (the shape was deleted by a concurrent edit) simply falls back to the free point.
 */
export const arrowShapeSchema = shapeBase.extend({
  type: z.literal('arrow'),
  points: z.tuple([finite, finite, finite, finite]),
  stroke: hexColor,
  strokeWidth: finite.min(1).max(40),
  startShapeId: shapeId.optional(),
  endShapeId: shapeId.optional(),
});

export const shapeSchema = z.discriminatedUnion('type', [
  rectShapeSchema,
  ellipseShapeSchema,
  stickyShapeSchema,
  textShapeSchema,
  imageShapeSchema,
  fileShapeSchema,
  pathShapeSchema,
  arrowShapeSchema,
]);
export type Shape = z.infer<typeof shapeSchema>;
export type ShapeType = Shape['type'];

/** Yjs root keys. Both apps must agree on these. */
export const Y_KEYS = {
  notes: 'notes', // Y.XmlFragment for TipTap
  shapes: 'shapes', // Y.Map<Y.Map<shape props>>
  order: 'order', // Y.Array<string> of shape ids, back → front
  meta: 'meta', // Y.Map for misc document metadata
} as const;

/** Ephemeral awareness state (PRD §3.2). Never persisted. */
export const awarenessUserSchema = z.object({
  id: uuidSchema,
  name: z.string().max(80),
  color: hexColor,
});

/**
 * Loose because y-prosemirror adds its own `cursor` field (text selection).
 * The whiteboard pointer therefore lives under `pointer`.
 */
export const awarenessStateSchema = z.looseObject({
  user: awarenessUserSchema,
  pointer: z.object({ x: finite, y: finite }).nullable().optional(),
  typing: z.boolean().optional(),
  drawing: z.boolean().optional(),
  /**
   * Where this user is looking, for Follow mode: the world point at the middle of their
   * screen and their zoom. It is a center, not an offset, so it fits any screen size.
   */
  viewport: z.object({ cx: finite, cy: finite, scale: finite.min(0.05).max(10) }).nullable().optional(),
  /** Ids of the shapes this user has selected, drawn as a ring in their color. */
  selection: z.array(shapeId).max(64).optional(),
  /** The laser pointer's current head. Receivers build the fading trail themselves. */
  laser: z.object({ x: finite, y: finite }).nullable().optional(),
  /**
   * Set by a Chaos Lab ghost. A ghost is a second socket of the same user under another display
   * name, so the roster lists it as its own participant instead of folding it into the user.
   * It grants nothing: the server judges a ghost by its user's role like any other socket.
   */
  ghost: z.literal(true).optional(),
  /**
   * Cursor chat: what this person is typing next to their pointer. Ephemeral and short. Unlike a
   * laser it is allowed for viewers, because it never touches the document.
   */
  chat: z.object({ text: z.string().max(MAX_CURSOR_CHAT_CHARS) }).nullable().optional(),
  /** A reaction burst. `n` changes on every press so the same emoji twice still animates twice. */
  reaction: z.object({ emoji: reactionEmojiSchema, n: z.number().int().min(0).max(1_000_000_000) }).nullable().optional(),
});
export type AwarenessState = z.infer<typeof awarenessStateSchema>;

/**
 * Awareness fields only a user who may edit can publish. A viewer's frame carrying any of them
 * is dropped by the server, so a viewer cannot broadcast a laser or a drawing indicator.
 */
export const MUTATION_ONLY_AWARENESS_FIELDS = ['laser', 'drawing'] as const;

/** True when a raw (untrusted) awareness state is actively using a mutation-only field. */
export function usesMutationOnlyAwareness(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  const record = state as Record<string, unknown>;
  // null and false are the "cleared" values, so a downgraded user can still switch them off.
  return MUTATION_ONLY_AWARENESS_FIELDS.some((field) => {
    const value = record[field];
    return value !== undefined && value !== null && value !== false;
  });
}
