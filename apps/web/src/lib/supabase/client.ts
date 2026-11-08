'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@wb/shared';
import { publicEnv } from '@/lib/env';

/** Browser client — anon key only, RLS enforced. Used for auth flows, never for data. */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
