'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { publicEnv } from '@/lib/env';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type Mode = 'signin' | 'signup';

/** Same-origin relative paths only, matching the check in the auth callback route. */
function safeNext(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

export function LoginForm({ next, initialMode = 'signin' }: { next: string; initialMode?: Mode }) {
  const router = useRouter();
  const target = safeNext(next);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const callbackUrl = `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(target)}`;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        setPending(false);
        return;
      }
      router.replace(target);
      router.refresh();
      return;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: callbackUrl },
    });
    setMessage(error ? error.message : 'Check your email to confirm your account.');
    setPending(false);
  }

  async function signInWithProvider(provider: 'github' | 'google') {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: callbackUrl } });
  }

  return (
    // Keyed by mode so switching between sign in and sign up fades the new form in.
    <div key={mode} className="page-enter flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{mode === 'signin' ? 'Sign in to your account' : 'Create your account'}</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          className="rounded-xl border border-neutral-300 bg-transparent px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700"
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          className="rounded-xl border border-neutral-300 bg-transparent px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        className="text-sm text-neutral-500 hover:underline"
      >
        {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void signInWithProvider('github')}
          className="flex-1 rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          GitHub
        </button>
        <button
          type="button"
          onClick={() => void signInWithProvider('google')}
          className="flex-1 rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Google
        </button>
      </div>

      {message ? (
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          {message}
        </p>
      ) : null}
    </div>
  );
}
