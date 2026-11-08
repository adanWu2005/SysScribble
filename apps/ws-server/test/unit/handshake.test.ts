import { describe, expect, it } from 'vitest';
import { extractToken, isAllowedOrigin, parseRoomPath } from '../../src/auth/handshake';
import { loadEnv } from '../../src/env';

const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';

describe('isAllowedOrigin', () => {
  const allowed = new Set(['https://app.example.com', 'http://localhost:3000']);

  it('accepts exact matches only', () => {
    expect(isAllowedOrigin('https://app.example.com', allowed)).toBe(true);
    expect(isAllowedOrigin('https://app.example.com.evil.io', allowed)).toBe(false);
    expect(isAllowedOrigin('http://app.example.com', allowed)).toBe(false);
    expect(isAllowedOrigin('null', allowed)).toBe(false);
  });

  it('rejects a missing Origin', () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
  });
});

describe('extractToken', () => {
  it('reads the bearer entry', () => {
    expect(extractToken('wb.v1, bearer.abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('requires our protocol and a non-empty token', () => {
    expect(extractToken('bearer.abc')).toBeNull();
    expect(extractToken('wb.v1')).toBeNull();
    expect(extractToken('wb.v1, bearer.')).toBeNull();
    expect(extractToken(undefined)).toBeNull();
  });
});

describe('parseRoomPath', () => {
  it('accepts only /rooms/<uuid>', () => {
    expect(parseRoomPath(`/rooms/${ROOM}`)).toBe(ROOM);
    expect(parseRoomPath(`/rooms/${ROOM}?x=1`)).toBe(ROOM);
    expect(parseRoomPath(`/rooms/${ROOM}/extra`)).toBeNull();
    expect(parseRoomPath(`/rooms/' OR 1=1 --`)).toBeNull();
    expect(parseRoomPath('/')).toBeNull();
    expect(parseRoomPath(undefined)).toBeNull();
  });
});

describe('loadEnv', () => {
  const valid = {
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    REDIS_URL: 'rediss://default:t@x.upstash.io:6379',
    ALLOWED_ORIGINS: 'http://localhost:3000, https://app.example.com',
  };

  it('parses the origin list', () => {
    expect(loadEnv(valid).ALLOWED_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('fails fast and never echoes secret values', () => {
    const run = () => loadEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: '', REDIS_URL: 'http://secret-host' });
    expect(run).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(run).not.toThrow(/secret-host/);
  });

  it.each(['*', 'https://*.example.com', 'https://app.example.com/path'])('rejects origin %s', (origin) => {
    expect(() => loadEnv({ ...valid, ALLOWED_ORIGINS: origin })).toThrow(/ALLOWED_ORIGINS/);
  });
});
