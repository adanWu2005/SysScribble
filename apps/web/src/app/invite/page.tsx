'use client';

import { INVITE_TOKEN_REGEX, acceptInviteResponseSchema } from '@wb/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { ApiClientError, apiFetch } from '@/lib/fetcher';

const STORAGE_KEY = 'pending-invite-token';

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode. The user can reopen the emailed link after signing in.
  }
}

/** The token arrives in the fragment, which no server sees, and is cleared from the bar at once. */
export default function InvitePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    const token = INVITE_TOKEN_REGEX.test(fromHash) ? fromHash : readStoredToken();
    window.history.replaceState(null, '', '/invite');

    if (!token) {
      queueMicrotask(() => setError('This invite link is not valid.'));
      return;
    }

    apiFetch<z.infer<typeof acceptInviteResponseSchema>>('/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(({ roomId }) => {
        storeToken(null);
        router.replace(`/rooms/${roomId}`);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiClientError && err.status === 401) {
          // Sign in first. Keeping the token out of ?next= keeps it out of access logs.
          storeToken(token);
          router.replace('/login?next=/invite');
          return;
        }
        storeToken(null);
        setError(err instanceof ApiClientError ? err.message : 'Could not accept this invite.');
      });
  }, [router]);

  return (
    <main className="arc-backdrop flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center text-white">
      {error ? (
        <>
          <p role="alert">{error}</p>
          <Link href="/" className="arc-btn">
            Back to your workspaces
          </Link>
        </>
      ) : (
        <p role="status">Accepting your invitation…</p>
      )}
    </main>
  );
}
