import {
  COMMENTS_KEY,
  MAX_COMMENT_CHARS,
  MAX_COMMENT_THREADS,
  MAX_THREAD_MESSAGES,
  commentThreadSchema,
  type CommentThread,
} from '@wb/shared';
import * as Y from 'yjs';

/**
 * The only code that reads or writes comment threads in the Y.Doc. Writes carry their own origin,
 * so they are not part of the board's undo stack: Ctrl+Z never silently deletes a comment.
 */

export const COMMENT_ORIGIN = 'comment-local';

type ThreadMap = Y.Map<unknown>;

export interface CommentAuthor {
  id: string;
  name: string;
}

export function commentsRoot(doc: Y.Doc): Y.Map<ThreadMap> {
  return doc.getMap<ThreadMap>(COMMENTS_KEY);
}

/** Trims, and refuses empty or oversized text. Returns null when the text cannot be posted. */
export function cleanCommentText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > MAX_COMMENT_CHARS) return null;
  return trimmed;
}

/** Threads oldest first. Anything in the document that fails the schema is skipped. */
export function readThreads(doc: Y.Doc): CommentThread[] {
  const threads: CommentThread[] = [];
  commentsRoot(doc).forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const parsed = commentThreadSchema.safeParse({ ...value.toJSON(), id });
    if (parsed.success) threads.push(parsed.data);
  });
  return threads.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function messageEntry(author: CommentAuthor, text: string, now: number) {
  return { id: crypto.randomUUID(), authorId: author.id, authorName: author.name.slice(0, 80), text, createdAt: now };
}

/** Starts a thread with its first message. Returns its id, or null if it cannot be posted. */
export function addThread(
  doc: Y.Doc,
  at: { x: number; y: number },
  author: CommentAuthor,
  text: string,
  now: number = Date.now(),
): string | null {
  const clean = cleanCommentText(text);
  if (clean === null || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  if (commentsRoot(doc).size >= MAX_COMMENT_THREADS) return null;

  const id = crypto.randomUUID();
  doc.transact(() => {
    const thread = new Y.Map<unknown>();
    thread.set('x', at.x);
    thread.set('y', at.y);
    thread.set('resolved', false);
    thread.set('createdAt', now);
    const messages = new Y.Array<unknown>();
    messages.push([messageEntry(author, clean, now)]);
    thread.set('messages', messages);
    commentsRoot(doc).set(id, thread);
  }, COMMENT_ORIGIN);
  return id;
}

function messagesOf(doc: Y.Doc, threadId: string): Y.Array<unknown> | null {
  const thread = commentsRoot(doc).get(threadId);
  const messages = thread?.get('messages');
  return messages instanceof Y.Array ? messages : null;
}

/** Adds a reply. Returns false when the thread is gone, full, or the text is not postable. */
export function addReply(doc: Y.Doc, threadId: string, author: CommentAuthor, text: string, now: number = Date.now()): boolean {
  const clean = cleanCommentText(text);
  const messages = messagesOf(doc, threadId);
  if (clean === null || !messages || messages.length >= MAX_THREAD_MESSAGES) return false;
  doc.transact(() => messages.push([messageEntry(author, clean, now)]), COMMENT_ORIGIN);
  return true;
}

export function setResolved(doc: Y.Doc, threadId: string, resolved: boolean): void {
  const thread = commentsRoot(doc).get(threadId);
  if (!thread) return;
  doc.transact(() => thread.set('resolved', resolved), COMMENT_ORIGIN);
}

/**
 * Deletes one of the caller's own messages; deleting the first message of a thread removes the
 * thread. Someone else's message is refused. This is a courtesy in the interface, not a security
 * control: the server never inspects document contents.
 */
export function deleteOwnMessage(doc: Y.Doc, threadId: string, messageId: string, userId: string): boolean {
  const messages = messagesOf(doc, threadId);
  if (!messages) return false;
  const list = messages.toJSON() as { id?: unknown; authorId?: unknown }[];
  const index = list.findIndex((entry) => entry.id === messageId);
  const target = list[index];
  if (index < 0 || !target || target.authorId !== userId) return false;

  doc.transact(() => {
    if (index === 0) commentsRoot(doc).delete(threadId);
    else messages.delete(index, 1);
  }, COMMENT_ORIGIN);
  return true;
}
