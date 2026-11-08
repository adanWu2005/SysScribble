import { z } from 'zod';
import { uuidSchema } from './ids';

/**
 * Comment threads live in `doc.getMap('comments')` as one nested `Y.Map` per thread, with the
 * messages in a `Y.Array` so two people replying at once both keep their reply.
 *
 * Like shapes, these schemas validate the plain JSON view when reading, so a malformed value
 * written by a hostile editor never reaches the screen. Text is rendered as text, never as HTML.
 *
 * Authorship is client-supplied: the server never reads document contents, so "you can delete your
 * own comments" is enforced in the UI only. Any editor can alter any comment by writing to the
 * document directly, the same as with shapes.
 */

export const MAX_COMMENT_CHARS = 1000;
export const MAX_THREAD_MESSAGES = 100;
export const MAX_COMMENT_THREADS = 200;

const finite = z.number().finite();
const entryId = z.string().min(1).max(64);

export const commentMessageSchema = z.object({
  id: entryId,
  authorId: uuidSchema,
  authorName: z.string().max(80),
  text: z.string().min(1).max(MAX_COMMENT_CHARS),
  createdAt: finite,
});
export type CommentMessage = z.infer<typeof commentMessageSchema>;

export const commentThreadSchema = z.object({
  id: entryId,
  /** World position of the pin. */
  x: finite,
  y: finite,
  resolved: z.boolean().default(false),
  createdAt: finite,
  messages: z.array(commentMessageSchema).min(1).max(MAX_THREAD_MESSAGES),
});
export type CommentThread = z.infer<typeof commentThreadSchema>;

/** Yjs root key for the threads. */
export const COMMENTS_KEY = 'comments';

/** The reactions on offer, in key order: press 1 to 5. */
export const REACTION_EMOJI = ['👍', '❤️', '🎉', '😂', '🤔'] as const;
export const reactionEmojiSchema = z.enum(REACTION_EMOJI);
export type ReactionEmoji = z.infer<typeof reactionEmojiSchema>;

/** Longest cursor-chat message. Short on purpose: it is a nudge, not a conversation. */
export const MAX_CURSOR_CHAT_CHARS = 80;
/** How long a reaction floats, and how long a closed chat bubble lingers. */
export const REACTION_MS = 2500;
export const CHAT_LINGER_MS = 3000;
