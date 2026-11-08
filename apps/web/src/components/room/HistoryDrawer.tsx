'use client';

import {
  HISTORY_MAX_ENTRIES,
  HISTORY_MIN_INTERVAL_MS,
  snapshotListResponseSchema,
  type SnapshotSummary,
} from '@wb/shared';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { boardToSvg } from '@/lib/export/svg';
import { ApiClientError, apiFetch } from '@/lib/fetcher';
import { entryTitle, formatAgo, formatBytes } from '@/lib/history/format';
import {
  SnapshotError,
  openSnapshot,
  previewSnapshot,
  restoreSnapshot,
  type SnapshotPreview,
} from '@/lib/history/restore';

class LoadError extends Error {
  override readonly name = 'LoadError';
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: SnapshotSummary[] };

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  | { status: 'error'; id: string; message: string }
  | { status: 'ready'; id: string; doc: Y.Doc; preview: SnapshotPreview };

type RestoreState = 'idle' | 'confirm' | 'working';

const NOTES_EXCERPT_CHARS = 1500;
const MINUTES = HISTORY_MIN_INTERVAL_MS / 60_000;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface HistoryDrawerProps {
  roomId: string;
  /** The live document that a restore writes into. */
  doc: Y.Doc;
  onClose: () => void;
  onNotice: (message: string) => void;
}

/**
 * Older saved versions of the room. Only owners and editors get here, and the server checks that
 * again on every request. A version is read into a throwaway document for the preview, and a
 * restore writes into the live document like any other edit, so the realtime server applies it
 * only for someone who may edit.
 */
export function HistoryDrawer({ roomId, doc, onClose, onNotice }: HistoryDrawerProps) {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [restoring, setRestoring] = useState<RestoreState>('idle');
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    apiFetch<unknown>(`/api/rooms/${roomId}/snapshots`)
      .then((raw) => {
        if (!active) return;
        const parsed = snapshotListResponseSchema.safeParse(raw);
        setList(parsed.success ? { status: 'ready', items: parsed.data.snapshots } : { status: 'error', message: 'The history could not be read.' });
      })
      .catch((cause: unknown) => {
        if (active) {
          setList({ status: 'error', message: cause instanceof ApiClientError ? cause.message : 'The history could not be loaded.' });
        }
      });
    return () => {
      active = false;
    };
  }, [roomId]);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  // A previewed version is a whole Y.Doc. Release it when another is chosen or the drawer closes.
  useEffect(() => {
    if (preview.status !== 'ready') return undefined;
    const previewed = preview.doc;
    return () => previewed.destroy();
  }, [preview]);

  const boardImage = useMemo(() => {
    if (preview.status !== 'ready') return null;
    const picture = boardToSvg(preview.preview.shapes, { padding: 24 });
    // A data URI in an <img>: the picture can show shapes but can never run anything.
    return picture ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}` : null;
  }, [preview]);

  async function choose(id: string) {
    const mine = ++request.current;
    setPreview({ status: 'loading', id });
    setRestoring('idle');
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/snapshots/${id}`, { credentials: 'same-origin' });
      if (!response.ok) {
        throw new LoadError(
          response.status === 404
            ? 'That version no longer exists.'
            : response.status === 429
              ? 'Too many requests. Try again in a little while.'
              : 'This version could not be loaded.',
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (mine !== request.current) return;
      const opened = openSnapshot(bytes);
      setPreview({ status: 'ready', id, doc: opened, preview: previewSnapshot(opened) });
    } catch (cause) {
      if (mine !== request.current) return;
      setPreview({
        status: 'error',
        id,
        message: cause instanceof LoadError || cause instanceof SnapshotError ? cause.message : 'This version could not be loaded.',
      });
    }
  }

  async function restore(entry: SnapshotSummary) {
    if (preview.status !== 'ready' || restoring === 'working') return;
    setRestoring('working');
    setError(null);
    try {
      // The server copies what is saved now into history, so this restore can itself be undone
      // by restoring the "Before restore" entry. Nothing changes if that step fails.
      await apiFetch<unknown>(`/api/rooms/${roomId}/snapshots`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'before_restore' }),
      });
      restoreSnapshot(doc, preview.doc);
      onNotice(`Restored the version from ${formatWhen(entry.createdAt)}.`);
      onClose();
    } catch (cause) {
      setRestoring('idle');
      setError(
        cause instanceof ApiClientError
          ? cause.status === 413
            ? 'This workspace is too large to keep a restore point, so it cannot be restored from here. Nothing was changed.'
            : `${cause.message} Nothing was changed.`
          : cause instanceof SnapshotError
            ? `${cause.message} Nothing was changed.`
            : 'The restore failed. Nothing was changed.',
      );
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep Tab inside the drawer while it is open.
    const focusable = Array.from(
      panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [],
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  }

  const items = list.status === 'ready' ? list.items : [];
  const selected = preview.status === 'idle' ? undefined : items.find((entry) => entry.id === preview.id);

  return (
    <div className="fixed inset-0 z-40" onKeyDown={onKeyDown}>
      <button type="button" aria-label="Close history" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/30" />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        className="drawer-panel absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <History size={18} aria-hidden />
          <h2 id="history-title" className="flex-1 text-base font-semibold">
            Version history
          </h2>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-neutral-800"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-4 pt-3 text-xs text-neutral-500 dark:text-neutral-400">
            A version is saved about every {MINUTES} minutes while the workspace is being edited. The last {HISTORY_MAX_ENTRIES} are kept.
          </p>

          {list.status === 'loading' ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-neutral-500">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Loading versions…
            </p>
          ) : null}
          {list.status === 'error' ? (
            <p role="alert" className="px-4 py-6 text-sm text-red-600">
              {list.message}
            </p>
          ) : null}
          {list.status === 'ready' && items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-neutral-500">No saved versions yet. Keep working and one will appear here.</p>
          ) : null}

          {items.length > 0 ? (
            <ul aria-label="Saved versions" className="mt-2 divide-y divide-neutral-100 border-y border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
              {items.map((entry) => {
                const active = selected?.id === entry.id;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={active}
                      onClick={() => void choose(entry.id)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500 ${
                        active ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{entryTitle(entry.label)}</span>
                        <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{formatWhen(entry.createdAt)}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="block">{formatAgo(entry.createdAt)}</span>
                        <span className="block">{formatBytes(entry.sizeBytes)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {preview.status === 'loading' ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-neutral-500">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Opening version…
            </p>
          ) : null}
          {preview.status === 'error' ? (
            <p role="alert" className="px-4 py-6 text-sm text-red-600">
              {preview.message}
            </p>
          ) : null}

          {preview.status === 'ready' ? (
            <section aria-label="Preview" className="space-y-3 px-4 py-4">
              <h3 className="text-sm font-semibold">Preview</h3>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                {boardImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a generated data URI, not a file to optimize
                  <img
                    src={boardImage}
                    alt={`Whiteboard in this version, with ${preview.preview.shapes.length} shape${preview.preview.shapes.length === 1 ? '' : 's'}`}
                    className="max-h-56 w-full object-contain"
                  />
                ) : (
                  <p className="px-3 py-8 text-center text-sm text-neutral-500">The whiteboard was empty.</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Notes</p>
                <p className="mt-1 text-sm font-semibold">{preview.preview.title || 'Untitled'}</p>
                {preview.preview.markdown.trim() === '' ? (
                  <p className="mt-1 text-sm text-neutral-500">The notes were empty.</p>
                ) : (
                  // Plain text in a <pre>, never HTML.
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-sans text-xs leading-relaxed dark:border-neutral-700 dark:bg-neutral-800">
                    {preview.preview.markdown.length > NOTES_EXCERPT_CHARS
                      ? `${preview.preview.markdown.slice(0, NOTES_EXCERPT_CHARS)}…`
                      : preview.preview.markdown}
                  </pre>
                )}
              </div>
            </section>
          ) : null}
        </div>

        {preview.status === 'ready' && selected ? (
          <footer className="space-y-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
            {restoring === 'idle' ? (
              <button
                type="button"
                onClick={() => setRestoring('confirm')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                <RotateCcw size={15} aria-hidden /> Restore this version
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">
                  This replaces the whiteboard and notes for everyone. The current version is saved to history first, though changes from the last few seconds may not be in it.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={restoring === 'working'}
                    onClick={() => void restore(selected)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60"
                  >
                    {restoring === 'working' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
                    {restoring === 'working' ? 'Restoring…' : 'Yes, restore'}
                  </button>
                  <button
                    type="button"
                    disabled={restoring === 'working'}
                    onClick={() => setRestoring('idle')}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60 dark:border-neutral-600 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
