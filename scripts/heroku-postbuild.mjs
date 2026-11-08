// Runs on Heroku after `npm install`. One repo feeds two Heroku apps; APP_ROLE says which one this is.
// The realtime app needs no build step (it runs TypeScript directly). The web app builds Next.js.
import { spawnSync } from 'node:child_process';

const role = process.env.APP_ROLE;

if (role === 'web') {
  const result = spawnSync('npm', ['run', 'build', '-w', 'apps/web'], { stdio: 'inherit', shell: true });
  process.exit(result.status ?? 1);
} else if (role === 'ws') {
  console.log('APP_ROLE=ws: nothing to build.');
} else {
  console.error('Set the APP_ROLE config var to "web" or "ws" on this Heroku app.');
  process.exit(1);
}
