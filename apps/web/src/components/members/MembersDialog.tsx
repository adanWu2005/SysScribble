'use client';

import type { AssignableRole, Invite, Member, RoomRole } from '@wb/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiClientError, apiFetch } from '@/lib/fetcher';

interface MembersDialogProps {
  roomId: string;
  currentUserId: string;
  role: RoomRole;
  /**
   * Drives the dialog from outside, with no button of its own. The dashboard opens it from a card's
   * menu this way. Left out, the dialog has its own Members button as in the room.
   */
  open?: boolean;
  onClosed?: () => void;
}

/** Hiding these controls from non-owners is convenience only. The API enforces every action. */
export function MembersDialog({ roomId, currentUserId, role, open, onClosed }: MembersDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AssignableRole>('EDITOR');
  const [message, setMessage] = useState<string | null>(null);
  const isOwner = role === 'OWNER';

  const refresh = useCallback(async () => {
    const list = await apiFetch<{ members: Member[] }>(`/api/rooms/${roomId}/members`);
    setMembers(list.members);
    if (isOwner) {
      const pending = await apiFetch<{ invites: Invite[] }>(`/api/rooms/${roomId}/invite`);
      setInvites(pending.invites);
    }
  }, [roomId, isOwner]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setMessage(null);
      try {
        await action();
        await refresh();
      } catch (err) {
        setMessage(err instanceof ApiClientError ? err.message : 'Something went wrong');
      }
    },
    [refresh],
  );

  useEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;
    const onToggle = () => {
      if (element.open) void run(async () => undefined);
    };
    element.addEventListener('toggle', onToggle);
    return () => element.removeEventListener('toggle', onToggle);
  }, [run]);

  useEffect(() => {
    const element = dialog.current;
    if (!element || open === undefined) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !onClosed) return undefined;
    element.addEventListener('close', onClosed);
    return () => element.removeEventListener('close', onClosed);
  }, [onClosed]);

  function invite(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await apiFetch(`/api/rooms/${roomId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email, role: inviteRole }),
      });
      setEmail('');
      setMessage('Invitation sent.');
    });
  }

  const memberUrl = (userId: string) => `/api/rooms/${roomId}/members/${userId}`;

  return (
    <>
      {open === undefined ? (
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700"
        >
          Members
        </button>
      ) : null}
      <dialog
        ref={dialog}
        className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-2xl p-4 backdrop:bg-black/40 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Members</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="text-sm underline">
            Close
          </button>
        </div>

        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{member.displayName ?? member.email ?? member.userId}</span>
              {isOwner && member.role !== 'OWNER' ? (
                <>
                  <select
                    aria-label={`Role for ${member.displayName ?? member.userId}`}
                    value={member.role}
                    onChange={(event) =>
                      void run(() =>
                        apiFetch(memberUrl(member.userId), {
                          method: 'PATCH',
                          body: JSON.stringify({ role: event.target.value }),
                        }),
                      )
                    }
                    className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700"
                  >
                    <option value="EDITOR">Editor</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void run(() => apiFetch(`${memberUrl(member.userId)}/kick`, { method: 'POST' }))}
                    className="underline"
                  >
                    Kick
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => apiFetch(memberUrl(member.userId), { method: 'DELETE' }))}
                    className="text-red-600 underline"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="text-xs uppercase tracking-wide text-neutral-500">
                  {member.role}
                  {member.userId === currentUserId ? ' (you)' : ''}
                </span>
              )}
            </li>
          ))}
        </ul>

        {isOwner ? (
          <>
            <form onSubmit={invite} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                aria-label="Email to invite"
                className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
              />
              <select
                aria-label="Role for the invited person"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as AssignableRole)}
                className="rounded border border-neutral-300 bg-transparent px-1 py-1 text-sm dark:border-neutral-700"
              >
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
                Invite
              </button>
            </form>

            {invites.length > 0 ? (
              <ul className="mt-3 text-sm">
                {invites.map((pending) => (
                  <li key={pending.id} className="flex items-center gap-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-neutral-500">{pending.email}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void run(() => apiFetch(`/api/rooms/${roomId}/invites/${pending.id}`, { method: 'DELETE' }))
                      }
                      className="underline"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {message ? (
          <p role="status" className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
            {message}
          </p>
        ) : null}
      </dialog>
    </>
  );
}
