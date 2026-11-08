import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@wb/shared';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

/**
 * Cookie-bound Supabase client for Server Components and Route Handlers.
 * Anon key + the user's session cookie, so RLS applies. Used for auth/session only.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies are read-only; the proxy refreshes instead.
        }
      },
    },
  });
}
