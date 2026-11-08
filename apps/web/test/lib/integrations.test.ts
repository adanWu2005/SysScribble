import { decodeJwt } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { hashInviteToken, generateInviteToken } from '@/lib/invites';
import { mintHuddleToken } from '@/lib/livekit';
import { buildObjectKey, deleteObject, presignGet, presignPut } from '@/lib/r2';
import { enforceRateLimit } from '@/lib/ratelimit';
import { getAdminClient } from '@/lib/supabase/admin';
import { escapeHtml, inviteUrl } from '@/lib/resend';

const limit = vi.hoisted(() => vi.fn());

vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = () => ({});
    limit = limit;
  }
  return { Ratelimit };
});

const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const ASSET = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER = '11111111-2222-4333-8444-555555555555';

describe('service-role client', () => {
  it('constructs on every supported Node version', () => {
    expect(() => getAdminClient()).not.toThrow();
  });
});

describe('R2 presigning (real signer, no network)', () => {
  const key = buildObjectKey(ROOM, ASSET, 'image/png');

  it('builds room-prefixed keys', () => {
    expect(key).toBe(`rooms/${ROOM}/${ASSET}.png`);
  });

  it('binds Content-Type and Content-Length into the PUT signature', async () => {
    const url = new URL(await presignPut(key, 'image/png', 2048));
    const signed = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed.split(';')).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host']));
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('adds no checksum parameter, which R2 would reject', async () => {
    const url = await presignPut(key, 'image/png', 2048);
    expect(url.toLowerCase()).not.toContain('x-amz-checksum');
    expect(url.toLowerCase()).not.toContain('x-amz-sdk-checksum');
  });

  it('forces attachment on reads', async () => {
    const url = new URL(await presignGet(key, 'image/png'));
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
    expect(url.searchParams.get('response-content-type')).toBe('image/png');
  });

  it.each(['rooms/../secrets.png', `rooms/${ROOM}/${ASSET}.svg`, 'other/key.png', ''])(
    'refuses to sign or delete the foreign key %s',
    async (bad) => {
      await expect(deleteObject(bad)).rejects.toThrow(/malformed/);
      expect(() => presignGet(bad, 'image/png')).toThrow(/malformed/);
    },
  );
});

describe('LiveKit tokens', () => {
  async function grants(role: 'OWNER' | 'EDITOR' | 'VIEWER') {
    const claims = decodeJwt(await mintHuddleToken(ROOM, USER, 'me', role));
    return { claims, video: claims['video'] as Record<string, unknown> };
  }

  it.each(['OWNER', 'EDITOR'] as const)('%s can publish', async (role) => {
    const { video } = await grants(role);
    expect(video).toMatchObject({ room: `room-${ROOM}`, roomJoin: true, canPublish: true, canPublishData: true });
  });

  it('a VIEWER can listen but publishes nothing', async () => {
    const { video } = await grants('VIEWER');
    expect(video).toMatchObject({ roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false });
  });

  it('tokens are short-lived and bound to one identity', async () => {
    const { claims } = await grants('EDITOR');
    expect(claims.sub).toBe(USER);
    expect((claims.exp ?? 0) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
  });
});

describe('invite tokens', () => {
  it('are 256-bit, unique, and stored only as a one-way hash', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashInviteToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(a)).toBe(hashInviteToken(a));
  });

  it('travel in the URL fragment so no server sees them', () => {
    const url = new URL(inviteUrl('tok'));
    expect(url.search).toBe('');
    expect(url.hash).toBe('#tok');
  });
});

describe('email rendering', () => {
  it('escapes a hostile room title', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>"\'&')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;',
    );
  });
});

describe('enforceRateLimit', () => {
  it('passes under the limit', async () => {
    limit.mockResolvedValue({ success: true, reset: Date.now() + 1000 });
    await expect(enforceRateLimit('invite', USER)).resolves.toBeUndefined();
    expect(limit).toHaveBeenCalledWith(USER);
  });

  it('returns 429 with a retry hint over the limit', async () => {
    limit.mockResolvedValue({ success: false, reset: Date.now() + 5000 });
    await expect(enforceRateLimit('invite', USER)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
  });

  it('fails closed when Upstash is unreachable', async () => {
    limit.mockRejectedValue(new Error('network'));
    await expect(enforceRateLimit('invite', USER)).rejects.toMatchObject({ status: 503 });
  });
});
