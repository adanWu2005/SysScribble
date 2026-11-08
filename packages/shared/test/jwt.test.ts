import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createSupabaseJwtVerifier, JwtVerificationError } from '../src/server/jwt';

const SECRET = 'super-secret-test-jwt-secret-at-least-32-bytes-long';
const SUPABASE_URL = 'http://localhost:54321';
const USER = '11111111-2222-4333-8444-555555555555';

async function sign(overrides: Partial<Record<string, unknown>> = {}, secret = SECRET, expiresIn = '1h') {
  const claims: Record<string, unknown> = { role: 'authenticated', email: 'a@b.c', ...overrides };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(typeof overrides['sub'] === 'string' ? overrides['sub'] : USER)
    .setIssuer(typeof overrides['iss'] === 'string' ? overrides['iss'] : `${SUPABASE_URL}/auth/v1`)
    .setAudience(typeof overrides['aud'] === 'string' ? overrides['aud'] : 'authenticated')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

describe('createSupabaseJwtVerifier (HS256)', () => {
  const verify = createSupabaseJwtVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: SECRET });

  it('accepts a valid token and extracts identity', async () => {
    const user = await verify(await sign());
    expect(user.userId).toBe(USER);
    expect(user.email).toBe('a@b.c');
    expect(user.authRole).toBe('authenticated');
  });

  it('rejects a token signed with another secret', async () => {
    await expect(verify(await sign({}, 'wrong-secret-wrong-secret-wrong-secret'))).rejects.toBeInstanceOf(
      JwtVerificationError,
    );
  });

  it('rejects an expired token', async () => {
    await expect(verify(await sign({}, SECRET, '-10m'))).rejects.toBeInstanceOf(JwtVerificationError);
  });

  it('rejects the wrong issuer or audience', async () => {
    await expect(verify(await sign({ iss: 'https://evil.example/auth/v1' }))).rejects.toBeInstanceOf(
      JwtVerificationError,
    );
    await expect(verify(await sign({ aud: 'anon' }))).rejects.toBeInstanceOf(JwtVerificationError);
  });

  it('rejects a non-UUID subject', async () => {
    await expect(verify(await sign({ sub: 'admin' }))).rejects.toBeInstanceOf(JwtVerificationError);
  });

  it('rejects alg=none', async () => {
    const [h, p] = (await sign()).split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    await expect(verify(`${none}.${p}.`)).rejects.toBeInstanceOf(JwtVerificationError);
    expect(h).toBeDefined();
  });
});
