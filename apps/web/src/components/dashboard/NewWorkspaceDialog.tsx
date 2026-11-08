'use client';

import { ROOM_TITLE_MAX, type Room } from '@wb/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiClientError, apiFetch } from '@/lib/fetcher';
import type { TemplateCard } from './TemplateGallery';

interface NewWorkspaceDialogProps {
  template: TemplateCard;
  onClose: () => void;
}

/** Names the workspace, creates it from the chosen template, and opens it. */
export function NewWorkspaceDialog({ template, onClose }: NewWorkspaceDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const defaultTitle = template.id === 'blank' ? 'Untitled Workspace' : template.name;

  // Focus returns to the card that opened the dialog.
  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { room } = await apiFetch<{ room: Room }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim() || defaultTitle, template: template.id }),
      });
      router.push(`/rooms/${room.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not create the workspace');
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <h2 id={headingId} className="text-lg font-semibold">
          New workspace
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {template.name}: {template.description}
        </p>
        <label className="mt-4 block text-sm font-medium">
          Name
          <input
            ref={input}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={ROOM_TITLE_MAX}
            placeholder={defaultTitle}
            className="mt-1 h-10 w-full rounded-md border border-neutral-300 bg-transparent px-3 text-sm font-normal outline-none focus:border-blue-500 dark:border-neutral-700"
          />
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {pending ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </form>
    </div>
  );
}
