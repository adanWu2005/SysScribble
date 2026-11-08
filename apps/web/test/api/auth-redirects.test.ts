import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as callback from '../../src/app/auth/callback/route';
import * as signout from '../../src/app/auth/signout/route';

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchange, signOut: mocks.signOut },
  }),
}));

// The server behind a hosting proxy sees its own internal address, not the public one.
const INTERNAL = 'https://localhost:5084';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({});
});

describe('auth redirects use the configured public address', () => {
  it('sends a signed-in user to the public site, not the internal host', async () => {
    const res = await callback.GET(new NextRequest(`${INTERNAL}/auth/callback?code=abc&next=/rooms/x`));
    expect(res.headers.get('location')).toBe('http://localhost:3000/rooms/x');
  });

  it('sends a failed sign-in to the public login page', async () => {
    mocks.exchange.mockResolvedValue({ error: new Error('bad') });
    const res = await callback.GET(new NextRequest(`${INTERNAL}/auth/callback?code=abc`));
    expect(res.headers.get('location')).toBe('http://localhost:3000/login?error=auth');
  });

  it('still refuses open redirects', async () => {
    const res = await callback.GET(new NextRequest(`${INTERNAL}/auth/callback?code=abc&next=//evil.example`));
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });

  it('signs out to the public welcome page', async () => {
    const res = await signout.POST();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });
});
