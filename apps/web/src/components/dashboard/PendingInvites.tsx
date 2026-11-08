'use client';

import type { PendingInvite } from '@wb/shared';
import { MailPlus } from 'lucide-react';
import { useState } from 'react';
import { ApiClientError, apiFetch } from '@/lib/fetcher';
import { RoleBadge } from './RoleBadge';

interface PendingInvitesProps {
  invites: readonly PendingInvite[];
  /** Runs after the server accepted or declined one, to refetch the workspace list. */
  onChanged: (message: string) => void;
}

/**
 * Invitations sent to your email, at the top of the dashboard. Accept joins the workspace with the
 * role shown; Decline removes the invitation. Room names and sender names are user text and render
 * as text nodes only. The server checks that each invitation really is addressed to you.
 */
export function PendingInvites({ invites, onChanged }: PendingInvitesProps) {
  // Handled invitations disappear at once; the refetch then confirms it.
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = invites.filter((invite) => !handled.has(invite.inviteId));
  if (open.length === 0) return null;

  async function respond(invite: PendingInvite, action: 'accept' | 'decline') {
    if (busy !== null) return;
    setBusy(invite.inviteId);
    setError(null);
    try {
      await apiFetch(`/api/invites/${invite.inviteId}/${action}`, { method: 'POST' });
      setHandled((current) => new Set(current).add(invite.inviteId));
      onChanged(action === 'accept' ? `You joined “${invite.roomTitle}”.` : 'Invitation declined.');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="pending-heading"
      className="mb-8 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10"
    >
      <h2 id="pending-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-indigo-900 dark:text-indigo-200">
        <MailPlus size={16} aria-hidden />
        Pending workspace invitations
        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">{open.length}</span>
      </h2>

      <ul className="flex flex-col gap-2">
        {open.map((invite) => {
          const working = busy === invite.inviteId;
          return (
            <li
              key={invite.inviteId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-white p-3 shadow-sm dark:bg-neutral-900"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{invite.roomTitle}</p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                  <span className="truncate">Invited by {invite.invitedBy}</span>
                  <RoleBadge role={invite.role} />
                  <span>Expires {invite.expiresAt.slice(0, 10)}</span>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void respond(invite, 'decline')}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  Decline
                  <span className="sr-only"> invitation to {invite.roomTitle}</span>
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void respond(invite, 'accept')}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {working ? 'Working…' : 'Accept'}
                  <span className="sr-only"> invitation to {invite.roomTitle}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
