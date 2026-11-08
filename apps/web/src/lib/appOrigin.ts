import { publicEnv } from '@/lib/env';

/**
 * The address people actually use to reach this app, from configuration.
 *
 * Behind a hosting proxy (Heroku, for one) the server sees its own internal address, such as
 * `localhost:5084`, in `req.url`. Redirects built from that would send people to a dead address. The
 * configured public URL is also something a request cannot spoof, unlike a forwarded Host header.
 */
export function appOrigin(): string {
  return new URL(publicEnv.NEXT_PUBLIC_APP_URL).origin;
}
