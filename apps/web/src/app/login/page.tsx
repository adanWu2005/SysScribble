import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Brand } from '@/components/landing/Logo';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[]; mode?: string | string[] }>;
}) {
  const searchParams = await searchParamsPromise;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/');

  const next = typeof searchParams.next === 'string' ? searchParams.next : '/';
  return (
    <main className="arc-backdrop min-h-screen px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-sm flex-col justify-center gap-6">
        <Link href="/" className="arc-btn-ghost -mb-2 w-fit !px-2 gap-1.5">
          <ArrowLeft size={16} aria-hidden />
          Back to home
        </Link>
        <h1 className="text-3xl text-white">
          <Brand />
        </h1>
        <div className="rounded-3xl bg-white p-6 shadow-2xl dark:bg-neutral-900">
          {searchParams.error ? (
            <p role="alert" className="mb-3 text-sm text-red-600">
              Sign-in failed. Please try again.
            </p>
          ) : null}
          <LoginForm next={next} initialMode={searchParams.mode === 'signup' ? 'signup' : 'signin'} />
        </div>
      </div>
    </main>
  );
}
