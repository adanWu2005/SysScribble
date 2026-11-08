'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { publicEnv } from '@/lib/env';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

function GithubLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3a7.2 7.2 0 0 1-10.7-3.78H1.34v3.09A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.36 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.34a12 12 0 0 0 0 10.8l4.02-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.43-3.43A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.34 6.6l4.02 3.09A7.16 7.16 0 0 1 12 4.75z" />
    </svg>
  );
}

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
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <GithubLogo />
          GitHub
        </button>
        <button
          type="button"
          onClick={() => void signInWithProvider('google')}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <GoogleLogo />
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
