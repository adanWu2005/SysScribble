'use client';

import { ROOM_TITLE_MAX, type RoomWithRole } from '@wb/shared';
import { useState, type FormEvent } from 'react';
import { ApiClientError, apiFetch } from '@/lib/fetcher';
import { Modal } from './Modal';

const cancelClass =
  'rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800';

interface DialogProps {
  room: RoomWithRole;
  onClose: () => void;
  /** Runs after the server accepted the change, with a message to show. */
  onDone: (message: string) => void;
}

/** Changes a workspace's name. The server allows owners and editors; others never see this. */
export function RenameDialog({ room, onClose, onDone }: DialogProps) {
  const [title, setTitle] = useState(room.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (pending || next === '') return;
    if (next === room.title) {
      onClose();
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify({ title: next }) });
      onDone('Workspace renamed.');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not rename the workspace');
      setPending(false);
    }
  }

  return (
    <Modal
      title="Rename workspace"
      busy={pending}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={cancelClass}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || title.trim() === ''}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <label className="mt-4 block text-sm font-medium">
        Name
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={ROOM_TITLE_MAX}
          className="mt-1 h-10 w-full rounded-md border border-neutral-300 bg-transparent px-3 text-sm font-normal outline-none focus:border-blue-500 dark:border-neutral-700"
        />
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

/** Confirms before deleting. The server only allows the owner, whatever this dialog shows. */
export function DeleteDialog({ room, onClose, onDone }: DialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/rooms/${room.id}`, { method: 'DELETE' });
      onDone('Workspace deleted.');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not delete the workspace');
      setPending(false);
    }
  }

  return (
    <Modal
      title="Delete workspace?"
      description="This removes the notes, the whiteboard and every uploaded file for everyone. It cannot be undone."
      busy={pending}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={cancelClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {pending ? 'Deleting…' : 'Delete workspace'}
          </button>
        </>
      }
    >
      <p className="mt-3 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium dark:bg-neutral-800">
        <span className="line-clamp-2 break-words">{room.title}</span>
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
