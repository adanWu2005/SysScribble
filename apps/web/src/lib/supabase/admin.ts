import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@wb/shared';
import { SERVICE_CLIENT_OPTIONS } from '@wb/shared/server';
import { publicEnv } from '@/lib/env';
import { getServerEnv } from '@/lib/env.server';

export type AdminClient = SupabaseClient<Database>;

let client: AdminClient | null = null;

/**
 * Service-role client. Bypasses RLS, therefore it is only ever used AFTER an explicit
 * requireUser + requireRoomRole check in the same handler. Never import from client code.
 */
export function getAdminClient(): AdminClient {
  if (client) return client;
  const env = getServerEnv();
  client = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    SERVICE_CLIENT_OPTIONS,
  );
  return client;
}
