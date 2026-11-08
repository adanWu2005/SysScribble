// What `npm start` runs on Heroku. One repo feeds two Heroku apps; APP_ROLE says which one this is.
// This works whether or not a Procfile is picked up, so a buildpack or PROCFILE mix-up cannot leave
// the dyno with nothing to run.
import { spawn } from 'node:child_process';

const role = process.env.APP_ROLE;
const port = process.env.PORT ?? '3000';

const commands = {
  web: { command: `npx next start -p ${port}`, cwd: 'apps/web' },
  ws: { command: 'npm run start -w apps/ws-server', cwd: '.' },
};

const entry = role === 'web' || role === 'ws' ? commands[role] : undefined;
if (!entry) {
  console.error('Set the APP_ROLE config var to "web" or "ws" on this Heroku app.');
  process.exit(1);
}

console.log(`Starting ${role} (port ${port})`);
const child = spawn(entry.command, { cwd: entry.cwd, stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
