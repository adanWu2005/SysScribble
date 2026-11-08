import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireUser } from '@/lib/auth/requireUser';

const session = vi.hoisted(() => ({ accessToken: null as string | null }));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: session.accessToken ? { access_token: session.accessToken } : null },
      }),
    },
  }),
}));

const USER = '11111111-2222-4333-8444-555555555555';

function sign(secret = process.env['SUPABASE_JWT_SECRET'] ?? '') {
  return new SignJWT({ role: 'authenticated', email: 'a@b.c' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER)
    .setIssuer(`${process.env['NEXT_PUBLIC_SUPABASE_URL']}/auth/v1`)
    .setAudience('authenticated')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

function request(authorization?: string) {
  return new NextRequest('http://localhost:3000/api/rooms', authorization ? { headers: { authorization } } : {});
}

describe('requireUser', () => {
  beforeEach(() => {
    session.accessToken = null;
  });

  it('401s with no token at all', async () => {
    await expect(requireUser(request())).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('accepts a valid bearer token', async () => {
    await expect(requireUser(request(`Bearer ${await sign()}`))).resolves.toEqual({ userId: USER, email: 'a@b.c' });
  });

  it('accepts a valid cookie session', async () => {
    session.accessToken = await sign();
    await expect(requireUser(request())).resolves.toMatchObject({ userId: USER });
  });

  it('rejects a forged token and does not fall back to the cookie session', async () => {
    session.accessToken = await sign();
    const forged = await sign('attacker-controlled-secret-attacker-controlled');
    await expect(requireUser(request(`Bearer ${forged}`))).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a malformed authorization header', async () => {
    await expect(requireUser(request('Basic abc'))).rejects.toMatchObject({ status: 401 });
  });
});
