import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { uuidSchema } from '../schemas/ids';

export interface VerifiedUser {
  userId: string;
  email: string | null;
  /** Supabase role claim, normally "authenticated". */
  authRole: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

export interface JwtVerifierOptions {
  /** Supabase project URL, e.g. https://abc.supabase.co */
  supabaseUrl: string;
  /** Legacy HS256 secret. When absent the project JWKS endpoint is used (asymmetric keys). */
  jwtSecret?: string | undefined;
  /** Seconds of clock skew tolerated. */
  clockToleranceSec?: number;
}

export type JwtVerifier = (token: string) => Promise<VerifiedUser>;

export class JwtVerificationError extends Error {
  override readonly name = 'JwtVerificationError';
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

/**
 * Builds a verifier for Supabase access tokens (PRD §5.4 "Verify JWT on Upgrade").
 *
 * Checks: signature, `exp`, `nbf`, `iss` = `${supabaseUrl}/auth/v1`, `aud` = authenticated,
 * and that `sub` is a UUID. Anything else throws `JwtVerificationError`.
 */
export function createSupabaseJwtVerifier(opts: JwtVerifierOptions): JwtVerifier {
  const issuer = `${trimSlash(opts.supabaseUrl)}/auth/v1`;
  const clockTolerance = opts.clockToleranceSec ?? 5;

  let key: Uint8Array | JWTVerifyGetKey;
  let algorithms: string[];
  if (opts.jwtSecret && opts.jwtSecret.length > 0) {
    key = new TextEncoder().encode(opts.jwtSecret);
    algorithms = ['HS256'];
  } else {
    key = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    algorithms = ['ES256', 'RS256'];
  }

  return async (token: string): Promise<VerifiedUser> => {
    if (typeof token !== 'string' || token.length === 0 || token.length > 8192) {
      throw new JwtVerificationError('Token missing or oversized');
    }
    let payload: JWTPayload;
    try {
      const result =
        key instanceof Uint8Array
          ? await jwtVerify(token, key, { algorithms, issuer, audience: 'authenticated', clockTolerance })
          : await jwtVerify(token, key, { algorithms, issuer, audience: 'authenticated', clockTolerance });
      payload = result.payload;
    } catch (err) {
      throw new JwtVerificationError(err instanceof Error ? err.message : 'JWT verification failed');
    }

    const sub = uuidSchema.safeParse(payload.sub);
    if (!sub.success) throw new JwtVerificationError('JWT sub is not a UUID');
    if (typeof payload.exp !== 'number') throw new JwtVerificationError('JWT has no exp');

    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    const authRole = typeof payload['role'] === 'string' ? payload['role'] : null;
    return { userId: sub.data, email, authRole, expiresAt: payload.exp };
  };
}
