/**
 * supabase-js builds a Realtime client in its constructor, and on Node 20 that throws
 * because there is no native WebSocket. This project never uses Supabase Realtime, since
 * sync runs on our own server, so the transport only has to exist, never to work.
 */
class RealtimeDisabled {
  constructor() {
    throw new Error('Supabase Realtime is not used in this project');
  }
}

/** Options for every service-role client. It never persists a session or refreshes one. */
export const SERVICE_CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: RealtimeDisabled as never },
} as const;
