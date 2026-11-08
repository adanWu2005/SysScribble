import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, parseBody, route } from '@/lib/api';

function request(method: string, init: { origin?: string; body?: string; length?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.origin) headers['origin'] = init.origin;
  if (init.length) headers['content-length'] = init.length;
  return new NextRequest('http://localhost:3000/api/x', {
    method,
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

const ctx = { params: Promise.resolve({}) };

describe('route()', () => {
  it('CSRF: refuses a cross-origin write before the handler runs', async () => {
    const handler = vi.fn(async () => new Response('ok'));
    const res = await route(handler)(request('POST', { origin: 'https://evil.example' }), ctx);
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('still allows same-origin writes when the configured address has a trailing slash', async () => {
    const before = process.env['NEXT_PUBLIC_APP_URL'];
    vi.resetModules();
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://app.example.com/';
    try {
      const { route: freshRoute } = await import('@/lib/api');
      const ok = await freshRoute(async () => new Response('ok'))(request('POST', { origin: 'https://app.example.com' }), ctx);
      expect(ok.status).toBe(200);
      const bad = await freshRoute(async () => new Response('ok'))(request('POST', { origin: 'https://evil.example' }), ctx);
      expect(bad.status).toBe(403);
    } finally {
      if (before === undefined) delete process.env['NEXT_PUBLIC_APP_URL'];
      else process.env['NEXT_PUBLIC_APP_URL'] = before;
      vi.resetModules();
    }
  });

  it('allows same-origin writes and originless API clients', async () => {
    const handler = vi.fn(async () => new Response('ok'));
    expect((await route(handler)(request('POST', { origin: 'http://localhost:3000' }), ctx)).status).toBe(200);
    expect((await route(handler)(request('POST'), ctx)).status).toBe(200);
  });

  it('does not restrict reads', async () => {
    const handler = vi.fn(async () => new Response('ok'));
    expect((await route(handler)(request('GET', { origin: 'https://evil.example' }), ctx)).status).toBe(200);
  });

  it('maps ApiError to its status', async () => {
    const res = await route(async () => {
      throw new ApiError(409, 'CONFLICT', 'nope');
    })(request('GET'), ctx);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'CONFLICT', message: 'nope' } });
  });

  it('never leaks internal error text to the client', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await route(async () => {
      throw new Error('connection to db-secret-host failed');
    })(request('GET'), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('db-secret-host');
    log.mockRestore();
  });
});

describe('parseBody', () => {
  const schema = z.object({ a: z.string() });

  it('rejects an oversized body from its header', async () => {
    await expect(parseBody(request('POST', { body: '{}', length: '999999' }), schema)).rejects.toMatchObject({
      status: 413,
    });
  });

  it('rejects an oversized body that lied about its length', async () => {
    const body = JSON.stringify({ a: 'x'.repeat(70 * 1024) });
    await expect(parseBody(request('POST', { body }), schema)).rejects.toMatchObject({ status: 413 });
  });

  it('rejects invalid JSON and schema mismatches', async () => {
    await expect(parseBody(request('POST', { body: '{oops' }), schema)).rejects.toMatchObject({ status: 400 });
    await expect(parseBody(request('POST', { body: '{"a":1}' }), schema)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
  });
});
