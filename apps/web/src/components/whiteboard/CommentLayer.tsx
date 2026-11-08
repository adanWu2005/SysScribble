'use client';

import { MAX_COMMENT_CHARS, type CommentThread } from '@wb/shared';
import { Check, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type * as Y from 'yjs';
import type { RoomUser } from '@/hooks/useRoomDoc';
import { addReply, addThread, deleteOwnMessage, setResolved } from '@/lib/comments/model';
import type { Point } from '@/lib/whiteboard/geometry';
import type { Size, View } from '@/lib/whiteboard/viewport';

const POPOVER_WIDTH = 288;
const OFFSCREEN_MARGIN = 40;

interface CommentLayerProps {
  doc: Y.Doc;
  threads: readonly CommentThread[];
  view: View;
  size: Size;
  canEdit: boolean;
  user: RoomUser;
  /** Where a new thread is being started, in world units, or null. */
  draft: Point | null;
  openId: string | null;
  showResolved: boolean;
  onOpen: (id: string | null) => void;
  onDraftDone: () => void;
  onToggleResolved: () => void;
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

interface ComposerProps {
  label: string;
  submitLabel: string;
  autoFocus?: boolean;
  error?: string | null;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}

function Composer({ label, submitLabel, autoFocus, error, onSubmit, onCancel }: ComposerProps) {
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim() === '') return;
    onSubmit(text);
    setText('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        aria-label={label}
        value={text}
        autoFocus={autoFocus}
        rows={2}
        maxLength={MAX_COMMENT_CHARS}
        placeholder="Write a comment…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel?.();
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
        className="w-full resize-none rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
      />
      {error ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="flex justify-end gap-1.5">
        {onCancel ? (
          <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={text.trim() === ''}
          onClick={send}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface PopoverProps {
  left: number;
  top: number;
  children: React.ReactNode;
  label: string;
}

function Popover({ left, top, children, label }: PopoverProps) {
  return (
    <div
      role="dialog"
      aria-label={label}
      style={{ left, top, width: POPOVER_WIDTH }}
      className="pointer-events-auto absolute z-30 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
    >
      {children}
    </div>
  );
}

/**
 * Comment pins and their threads, as plain DOM above the canvas so they stay readable at any zoom.
 * Every name and message renders as a text node. A viewer can read threads but not write.
 */
export function CommentLayer({
  doc,
  threads,
  view,
  size,
  canEdit,
  user,
  draft,
  openId,
  showResolved,
  onOpen,
  onDraftDone,
  onToggleResolved,
}: CommentLayerProps) {
  const [error, setError] = useState<string | null>(null);
  const author = { id: user.id, name: user.name };

  const screenOf = (point: Point): Point => ({ x: point.x * view.scale + view.x, y: point.y * view.scale + view.y });
  const popoverAt = (pin: Point): { left: number; top: number } => {
    const fitsRight = pin.x + 20 + POPOVER_WIDTH <= size.width;
    const left = fitsRight ? pin.x + 20 : Math.max(8, pin.x - 20 - POPOVER_WIDTH);
    return { left, top: Math.max(8, Math.min(pin.y - 30, size.height - 260)) };
  };

  const open = threads.find((thread) => thread.id === openId);
  const visible = threads.filter((thread) => showResolved || !thread.resolved || thread.id === openId);
  const unresolvedCount = threads.filter((thread) => !thread.resolved).length;
  const resolvedCount = threads.length - unresolvedCount;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {threads.length > 0 ? (
        <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3 py-1 text-xs shadow dark:border-neutral-700 dark:bg-neutral-800/95">
          <span>{unresolvedCount} open</span>
          {resolvedCount > 0 ? (
            <label className="flex cursor-pointer items-center gap-1 text-neutral-600 dark:text-neutral-300">
              <input type="checkbox" checked={showResolved} onChange={onToggleResolved} />
              Show {resolvedCount} resolved
            </label>
          ) : null}
        </div>
      ) : null}

      {visible.map((thread) => {
        const pin = screenOf(thread);
        if (pin.x < -OFFSCREEN_MARGIN || pin.y < -OFFSCREEN_MARGIN || pin.x > size.width + OFFSCREEN_MARGIN || pin.y > size.height + OFFSCREEN_MARGIN) {
          return null;
        }
        const first = thread.messages[0];
        const active = thread.id === openId;
        return (
          <button
            key={thread.id}
            type="button"
            aria-label={`Comment by ${first?.authorName ?? 'someone'}, ${thread.messages.length} message${thread.messages.length === 1 ? '' : 's'}${thread.resolved ? ', resolved' : ''}`}
            aria-expanded={active}
            onClick={() => {
              setError(null);
              onOpen(active ? null : thread.id);
            }}
            style={{ left: pin.x, top: pin.y }}
            className={`pointer-events-auto absolute flex h-7 min-w-7 -translate-x-1/2 -translate-y-full items-center justify-center gap-0.5 rounded-full rounded-bl-none border-2 border-white px-1.5 text-xs font-semibold text-white shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
              thread.resolved ? 'bg-neutral-400 dark:border-neutral-900' : 'bg-blue-600 dark:border-neutral-900'
            } ${active ? 'ring-2 ring-blue-300' : ''}`}
          >
            {thread.resolved ? <Check size={13} aria-hidden /> : <MessageSquare size={13} aria-hidden />}
            {thread.messages.length > 1 ? <span>{thread.messages.length}</span> : null}
          </button>
        );
      })}

      {draft && canEdit ? (
        <>
          <span
            aria-hidden
            style={{ left: screenOf(draft).x, top: screenOf(draft).y }}
            className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 border-white bg-blue-600 text-white shadow-md"
          >
            <MessageSquare size={13} />
          </span>
          <Popover label="New comment" {...popoverAt(screenOf(draft))}>
            <Composer
              label="New comment"
              submitLabel="Comment"
              autoFocus
              error={error}
              onCancel={() => {
                setError(null);
                onDraftDone();
              }}
              onSubmit={(text) => {
                const id = addThread(doc, draft, author, text);
                if (id === null) {
                  setError('This board has too many comment threads.');
                  return;
                }
                setError(null);
                onDraftDone();
                onOpen(id);
              }}
            />
          </Popover>
        </>
      ) : null}

      {open && !draft ? (
        <Popover label="Comment thread" {...popoverAt(screenOf(open))}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">{open.resolved ? 'Resolved' : 'Open'}</span>
            <div className="flex items-center gap-1">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setResolved(doc, open.id, !open.resolved)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  {open.resolved ? <RotateCcw size={12} aria-hidden /> : <Check size={12} aria-hidden />}
                  {open.resolved ? 'Reopen' : 'Resolve'}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Close thread"
                onClick={() => onOpen(null)}
                className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          </div>
          <ul className="mb-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
            {open.messages.map((message) => (
              <li key={message.id} className="rounded-md bg-neutral-50 p-2 dark:bg-neutral-900">
                <div className="mb-0.5 flex items-center justify-between gap-2 text-xs text-neutral-500">
                  <span className="truncate font-medium text-neutral-700 dark:text-neutral-200">{message.authorName}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {formatTime(message.createdAt)}
                    {canEdit && message.authorId === user.id ? (
                      <button
                        type="button"
                        aria-label="Delete my comment"
                        onClick={() => deleteOwnMessage(doc, open.id, message.id, user.id)}
                        className="rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                    ) : null}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words">{message.text}</p>
              </li>
            ))}
          </ul>
          {canEdit ? (
            <Composer
              key={open.id}
              label="Reply"
              submitLabel="Reply"
              error={error}
              onCancel={() => onOpen(null)}
              onSubmit={(text) => setError(addReply(doc, open.id, author, text) ? null : 'This thread is full.')}
            />
          ) : (
            <p className="text-xs text-neutral-500">View only: you can read comments but not add them.</p>
          )}
        </Popover>
      ) : null}
    </div>
  );
}
