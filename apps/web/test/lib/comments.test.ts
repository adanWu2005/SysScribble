import {
  MAX_COMMENT_CHARS,
  MAX_COMMENT_THREADS,
  MAX_CURSOR_CHAT_CHARS,
  MAX_THREAD_MESSAGES,
  REACTION_EMOJI,
  awarenessStateSchema,
  usesMutationOnlyAwareness,
} from '@wb/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addReply,
  addThread,
  cleanCommentText,
  commentsRoot,
  deleteOwnMessage,
  readThreads,
  setResolved,
} from '@/lib/comments/model';
import { addShape, createBoardUndoManager } from '@/lib/whiteboard/model';
import { keyToAction, type KeyInfo } from '@/lib/whiteboard/shortcuts';

const ADA = { id: '11111111-2222-4333-8444-555555555555', name: 'Ada' };
const BOB = { id: '99999999-8888-4777-8666-555555555555', name: 'Bob' };

describe('comment threads', () => {
  it('starts a thread with its first message', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { x: 10, y: 20 }, ADA, '  Looks good  ', 1000);
    expect(id).not.toBeNull();
    const [thread] = readThreads(doc);
    expect(thread).toMatchObject({ id, x: 10, y: 20, resolved: false, createdAt: 1000 });
    expect(thread?.messages).toHaveLength(1);
    expect(thread?.messages[0]).toMatchObject({ authorId: ADA.id, authorName: 'Ada', text: 'Looks good' });
  });

  it('refuses empty, oversized and badly placed comments', () => {
    const doc = new Y.Doc();
    expect(addThread(doc, { x: 0, y: 0 }, ADA, '   ')).toBeNull();
    expect(addThread(doc, { x: 0, y: 0 }, ADA, 'x'.repeat(MAX_COMMENT_CHARS + 1))).toBeNull();
    expect(addThread(doc, { x: Number.NaN, y: 0 }, ADA, 'hi')).toBeNull();
    expect(addThread(doc, { x: 0, y: Number.POSITIVE_INFINITY }, ADA, 'hi')).toBeNull();
    expect(cleanCommentText('x'.repeat(MAX_COMMENT_CHARS))).not.toBeNull();
    expect(readThreads(doc)).toEqual([]);
  });

  it('caps the number of threads', () => {
    const doc = new Y.Doc();
    for (let i = 0; i < MAX_COMMENT_THREADS; i++) addThread(doc, { x: i, y: 0 }, ADA, 'hi');
    expect(addThread(doc, { x: 0, y: 0 }, ADA, 'one too many')).toBeNull();
    expect(readThreads(doc)).toHaveLength(MAX_COMMENT_THREADS);
  });

  it('adds replies in order and caps the thread length', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { x: 0, y: 0 }, ADA, 'first', 1) ?? '';
    expect(addReply(doc, id, BOB, 'second', 2)).toBe(true);
    expect(readThreads(doc)[0]?.messages.map((m) => m.text)).toEqual(['first', 'second']);
    for (let i = 2; i < MAX_THREAD_MESSAGES; i++) addReply(doc, id, BOB, `r${i}`);
    expect(addReply(doc, id, BOB, 'too many')).toBe(false);
    expect(addReply(doc, 'no-such-thread', BOB, 'hi')).toBe(false);
    expect(addReply(doc, id, BOB, '  ')).toBe(false);
  });

  it('resolves and reopens', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { x: 0, y: 0 }, ADA, 'hi') ?? '';
    setResolved(doc, id, true);
    expect(readThreads(doc)[0]?.resolved).toBe(true);
    setResolved(doc, id, false);
    expect(readThreads(doc)[0]?.resolved).toBe(false);
    expect(() => setResolved(doc, 'missing', true)).not.toThrow();
  });

  it('lets people delete their own messages only', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { x: 0, y: 0 }, ADA, 'mine', 1) ?? '';
    addReply(doc, id, BOB, 'his', 2);
    const [first, second] = readThreads(doc)[0]?.messages ?? [];

    expect(deleteOwnMessage(doc, id, second?.id ?? '', ADA.id)).toBe(false);
    expect(deleteOwnMessage(doc, id, first?.id ?? '', BOB.id)).toBe(false);
    expect(readThreads(doc)[0]?.messages).toHaveLength(2);

    expect(deleteOwnMessage(doc, id, second?.id ?? '', BOB.id)).toBe(true);
    expect(readThreads(doc)[0]?.messages.map((m) => m.text)).toEqual(['mine']);
  });

  it('removes the whole thread when its first message is deleted', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { x: 0, y: 0 }, ADA, 'mine') ?? '';
    addReply(doc, id, BOB, 'reply');
    const first = readThreads(doc)[0]?.messages[0];
    expect(deleteOwnMessage(doc, id, first?.id ?? '', ADA.id)).toBe(true);
    expect(readThreads(doc)).toEqual([]);
    expect(deleteOwnMessage(doc, id, first?.id ?? '', ADA.id)).toBe(false);
  });

  it('keeps both replies when two people answer at once', () => {
    const a = new Y.Doc();
    const id = addThread(a, { x: 0, y: 0 }, ADA, 'question') ?? '';
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    addReply(a, id, ADA, 'from a');
    addReply(b, id, BOB, 'from b');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const texts = (doc: Y.Doc) => readThreads(doc)[0]?.messages.map((m) => m.text).sort();
    expect(texts(a)).toEqual(['from a', 'from b', 'question']);
    expect(texts(b)).toEqual(texts(a));
  });

  it('is not part of the board undo stack', () => {
    const doc = new Y.Doc();
    const undo = createBoardUndoManager(doc);
    addShape(doc, { id: 's', type: 'rect', x: 0, y: 0, rotation: 0, width: 5, height: 5, fill: '#ffffff' });
    undo.stopCapturing();
    addThread(doc, { x: 0, y: 0 }, ADA, 'stay');
    undo.undo();
    undo.undo();
    expect(readThreads(doc)).toHaveLength(1);
  });

  it('skips anything a hostile editor wrote that fails the schema', () => {
    const doc = new Y.Doc();
    addThread(doc, { x: 0, y: 0 }, ADA, 'fine');
    const evil = (build: (thread: Y.Map<unknown>) => void) => {
      const thread = new Y.Map<unknown>();
      build(thread);
      commentsRoot(doc).set(crypto.randomUUID(), thread);
    };
    const message = (text: unknown, authorId: unknown = ADA.id) => ({ id: 'm', authorId, authorName: 'x', text, createdAt: 1 });

    evil((t) => void t.set('x', 'not a number'));
    evil((t) => {
      t.set('x', 1);
      t.set('y', 1);
      t.set('createdAt', 1);
      t.set('messages', Y.Array.from([message('x'.repeat(MAX_COMMENT_CHARS + 1))]));
    });
    evil((t) => {
      t.set('x', 1);
      t.set('y', 1);
      t.set('createdAt', 1);
      t.set('messages', Y.Array.from([message('<script>alert(1)</script>', 'not-a-uuid')]));
    });
    evil((t) => {
      t.set('x', 1);
      t.set('y', 1);
      t.set('createdAt', 1);
      t.set('messages', new Y.Array<unknown>());
    });
    commentsRoot(doc).set('not-a-map', 5 as never);

    expect(readThreads(doc)).toHaveLength(1);
  });

  it('hands markup back as plain text for the interface to render as text', () => {
    const doc = new Y.Doc();
    addThread(doc, { x: 0, y: 0 }, ADA, '<img src=x onerror=alert(1)>');
    expect(readThreads(doc)[0]?.messages[0]?.text).toBe('<img src=x onerror=alert(1)>');
  });
});

const key = (k: string, mods: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('shortcuts for comments, chat and reactions', () => {
  it('opens the comment tool for editors only', () => {
    expect(keyToAction(key('c'), { canEdit: true })).toEqual({ type: 'tool', tool: 'comment' });
    expect(keyToAction(key('c'), { canEdit: false })).toBeNull();
  });

  it('lets a viewer chat and react, because neither changes the document', () => {
    for (const canEdit of [true, false]) {
      expect(keyToAction(key('/'), { canEdit })).toEqual({ type: 'chat' });
      expect(keyToAction(key('1'), { canEdit })).toEqual({ type: 'reaction', index: 0 });
      expect(keyToAction(key('5'), { canEdit })).toEqual({ type: 'reaction', index: 4 });
    }
  });

  it('ignores digits outside 1 to 5 and any digit with a modifier', () => {
    expect(keyToAction(key('0'), { canEdit: true })).toBeNull();
    expect(keyToAction(key('6'), { canEdit: true })).toBeNull();
    expect(keyToAction(key('1', { ctrlKey: true }), { canEdit: true })).toBeNull();
    expect(keyToAction(key('1', { altKey: true }), { canEdit: true })).toBeNull();
  });
});

describe('cursor chat and reaction awareness', () => {
  const user = { id: ADA.id, name: 'Ada', color: '#112233' };

  it('accepts a short message and every offered emoji', () => {
    expect(awarenessStateSchema.safeParse({ user, chat: { text: 'hi' } }).success).toBe(true);
    expect(awarenessStateSchema.safeParse({ user, chat: null, reaction: null }).success).toBe(true);
    for (const emoji of REACTION_EMOJI) {
      expect(awarenessStateSchema.safeParse({ user, reaction: { emoji, n: 3 } }).success).toBe(true);
    }
  });

  it('rejects a long message, an unlisted emoji, and a bad counter', () => {
    expect(awarenessStateSchema.safeParse({ user, chat: { text: 'x'.repeat(MAX_CURSOR_CHAT_CHARS + 1) } }).success).toBe(false);
    expect(awarenessStateSchema.safeParse({ user, reaction: { emoji: '💣', n: 1 } }).success).toBe(false);
    expect(awarenessStateSchema.safeParse({ user, reaction: { emoji: '🎉', n: -1 } }).success).toBe(false);
    expect(awarenessStateSchema.safeParse({ user, reaction: { emoji: '🎉', n: 1.5 } }).success).toBe(false);
  });

  it('is not a mutation-only field, so a viewer may send it', () => {
    expect(usesMutationOnlyAwareness({ user, chat: { text: 'hi' }, reaction: { emoji: '🎉', n: 1 } })).toBe(false);
  });
});
