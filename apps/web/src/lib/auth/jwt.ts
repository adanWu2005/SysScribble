import 'server-only';
import { createSupabaseJwtVerifier, type JwtVerifier, type VerifiedUser } from '@wb/shared/server';
import { publicEnv } from '@/lib/env';
import { getServerEnv } from '@/lib/env.server';

let verifier: JwtVerifier | null = null;

/** Verifies a Supabase access token locally (signature, exp, iss, aud). */
export function verifyAccessToken(token: string): Promise<VerifiedUser> {
  if (!verifier) {
    verifier = createSupabaseJwtVerifier({
      supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      jwtSecret: getServerEnv().SUPABASE_JWT_SECRET,
    });
  }
  return verifier(token);
}
