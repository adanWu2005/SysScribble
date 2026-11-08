// Builds the web app with unique sentinel secrets, then fails if any reaches the browser
// bundle (PRD §5.7). A static grep cannot prove this; only the compiled output can.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'UPSTASH_REDIS_REST_TOKEN',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'RESEND_API_KEY',
];

const sentinel = (name) => `SENTINEL_${name}_a1b2c3d4`;
const secrets = Object.fromEntries(SECRET_NAMES.map((name) => [name, sentinel(name)]));

const webDir = join(process.cwd(), 'apps', 'web');
const build = spawnSync('npx', ['next', 'build'], {
  cwd: webDir,
  shell: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...secrets,
    NEXT_PUBLIC_SUPABASE_URL: 'https://audit.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'audit-anon-key',
    NEXT_PUBLIC_WS_URL: 'wss://ws.audit.example',
    NEXT_PUBLIC_LIVEKIT_URL: 'wss://audit.livekit.cloud',
    NEXT_PUBLIC_APP_URL: 'https://audit.example',
    UPSTASH_REDIS_REST_URL: 'https://audit.upstash.io',
    R2_ACCOUNT_ID: 'audit',
    R2_BUCKET: 'audit',
    RESEND_FROM: 'Audit <audit@example.com>',
  },
});
if (build.status !== 0) {
  console.error('Build failed');
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const staticDir = join(webDir, '.next', 'static');
const leaks = [];
let scanned = 0;
for (const file of walk(staticDir)) {
  scanned += 1;
  const content = readFileSync(file, 'latin1');
  for (const name of SECRET_NAMES) {
    if (content.includes(sentinel(name))) leaks.push(`${name} value in ${file}`);
    // A secret's name in the bundle usually means server code was pulled into the client.
    if (content.includes(name)) leaks.push(`${name} name in ${file}`);
  }
}

if (leaks.length > 0) {
  console.error(`LEAK: ${leaks.length} finding(s)\n${leaks.join('\n')}`);
  process.exit(1);
}
console.log(`OK: scanned ${scanned} client files, no server secret values or names found`);
