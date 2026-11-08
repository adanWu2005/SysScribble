import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCsp } from '@/lib/csp';

/**
 * The 7-point checklist as tests that keep working on code written later. A new route
 * without an auth check, or a client file that imports a secret, fails here.
 */
const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(SRC).filter((file) => /\.tsx?$/.test(file));
const read = (file: string) => readFileSync(file, 'utf8');
const name = (file: string) => relative(ROOT, file).split(sep).join('/');
const apiRoutes = sources.filter((file) => name(file).startsWith('src/app/api/') && file.endsWith('route.ts'));

describe('authorization coverage (PRD §5.2, §5.3)', () => {
  it('finds the routes it claims to audit', () => {
    expect(apiRoutes.length).toBeGreaterThanOrEqual(12);
  });

  it.each(apiRoutes.map(name))('%s authenticates through the error-mapping wrapper', (route) => {
    const code = read(join(ROOT, route));
    expect(code).toMatch(/requireUser\(req\)/);
    expect(code).toMatch(/route(<\w+>)?\(async/);
    expect(code).not.toMatch(/export (async )?function (GET|POST|PATCH|PUT|DELETE)/);
  });

  it.each(apiRoutes.filter((file) => name(file).includes('[roomId]')).map(name))(
    '%s validates ids and checks room membership in every handler',
    (route) => {
      const code = read(join(ROOT, route));
      const handlers = code.split(/export const (?:GET|POST|PATCH|PUT|DELETE) = /).slice(1);
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        expect(handler).toMatch(/parseParams\(params, \w+Schema\)/);
        expect(handler).toMatch(/requireRoom(Role|Member)\(/);
      }
    },
  );

  it('the service-role client stays in server-only modules', () => {
    const importers = sources.filter((file) => read(file).includes('@/lib/supabase/admin'));
    for (const file of importers) {
      expect(name(file)).toMatch(/^src\/lib\/(db\/|supabase\/)/);
    }
  });
});

describe('injection (PRD §5.1)', () => {
  it.each(sources.map(name))('%s builds no SQL or PostgREST filter from strings', (source) => {
    const code = read(join(ROOT, source));
    expect(code).not.toMatch(/from ['"](pg|postgres|mysql2?)['"]/);
    expect(code).not.toMatch(/\.rpc\(`/);
    expect(code).not.toMatch(/\.(or|filter|textSearch)\(\s*`/);
    expect(code).not.toMatch(/\b(SELECT|UPDATE|DELETE FROM|INSERT INTO)\b[^'\n]*\$\{/);
  });
});

describe('XSS sinks (PRD §5.5)', () => {
  it.each(sources.map(name))('%s uses no raw HTML sink', (source) => {
    const code = read(join(ROOT, source));
    expect(code).not.toMatch(/dangerouslySetInnerHTML/);
    expect(code).not.toMatch(/\.innerHTML\s*=/);
    expect(code).not.toMatch(/\beval\(|new Function\(/);
  });

  it('the policy blocks injected scripts and framing', () => {
    const csp = buildCsp({
      nonce: 'abc',
      isDev: false,
      supabaseUrl: 'https://x.supabase.co',
      wsUrl: 'wss://ws.example',
      livekitUrl: 'wss://x.livekit.cloud',
    });
    const scripts = csp.split('; ').find((part) => part.startsWith('script-src')) ?? '';
    expect(scripts).toContain("'nonce-abc'");
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('dev-only relaxations never reach production', () => {
    const options = { nonce: 'n', supabaseUrl: 'https://x', wsUrl: 'ws://y', livekitUrl: 'wss://z' };
    expect(buildCsp({ ...options, isDev: false })).not.toContain('localhost');
    expect(buildCsp({ ...options, isDev: true })).toContain('unsafe-eval');
  });
});

describe('secret isolation (PRD §5.7)', () => {
  const PUBLIC_ALLOWLIST = new Set([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_WS_URL',
    'NEXT_PUBLIC_LIVEKIT_URL',
    'NEXT_PUBLIC_APP_URL',
  ]);
  const SERVER_ONLY = [
    '@/lib/env.server',
    '@/lib/supabase/admin',
    '@/lib/r2',
    '@/lib/resend',
    '@/lib/livekit',
    '@/lib/redis',
    '@/lib/ratelimit',
    '@/lib/invites',
    '@/lib/db/',
    '@wb/shared/server',
  ];

  it('only allowlisted variables are public', () => {
    const files = [...sources, join(ROOT, '..', '..', '.env.example')];
    const used = new Set(files.flatMap((file) => read(file).match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? []));
    expect(used.size).toBeGreaterThan(0);
    for (const variable of used) expect(PUBLIC_ALLOWLIST).toContain(variable);
  });

  it('no client component imports a server-only module', () => {
    const clients = sources.filter((file) => /^['"]use client['"]/.test(read(file)));
    expect(clients.length).toBeGreaterThan(5);
    for (const file of clients) {
      const code = read(file);
      for (const specifier of SERVER_ONLY) {
        expect(code, `${name(file)} imports ${specifier}`).not.toContain(`'${specifier}`);
      }
    }
  });

  it('secret-bearing modules are marked server-only', () => {
    const marked = sources.filter((file) => /src[\\/]lib[\\/](db[\\/]|r2|resend|livekit|redis|ratelimit|invites|env\.server)/.test(file));
    expect(marked.length).toBeGreaterThanOrEqual(10);
    for (const file of marked) expect(read(file), name(file)).toMatch(/^import 'server-only';/m);
  });

  it('git ignores real env files', () => {
    const ignore = read(join(ROOT, '..', '..', '.gitignore'));
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });

  it('.env.example contains no filled-in secret', () => {
    const example = read(join(ROOT, '..', '..', '.env.example'));
    for (const line of example.split('\n')) {
      const match = /^(?!NEXT_PUBLIC)[A-Z0-9_]*(SECRET|TOKEN|KEY)[A-Z0-9_]*=(.+)$/.exec(line);
      expect(match?.[2] ?? '', line).toBe('');
    }
  });
});
