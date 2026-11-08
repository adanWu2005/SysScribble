import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/csp';

/**
 * Sets the per-request CSP nonce and refreshes the Supabase session cookie for pages.
 * Authorization is NOT done here: every API route and page does its own.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV !== 'production',
    supabaseUrl: url,
    wsUrl: process.env['NEXT_PUBLIC_WS_URL'] ?? '',
    livekitUrl: process.env['NEXT_PUBLIC_LIVEKIT_URL'] ?? '',
  });

  // Next.js reads the nonce from this request header and stamps it on its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const forward = (): NextResponse => {
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    next.headers.set('Content-Security-Policy', csp);
    return next;
  };

  let response = forward();
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        requestHeaders.set('cookie', request.cookies.toString());
        response = forward();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Triggers a refresh when the access token is close to expiry.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // API routes verify their own JWT, and getUser() here would be a paid call per request.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
