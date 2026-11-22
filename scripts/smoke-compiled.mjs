import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readdir } from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL must point to an isolated PG16 validation database');
const files = (await readdir('dist/src/storage/schema')).filter(file => file.endsWith('.sql'));
assert.ok(files.length >= 43, 'Compiled artifact must contain the complete SQL chain');
const migrate = spawn(process.execPath, ['dist/src/storage/schema/run-migrations.js'], { stdio: 'inherit' });
assert.equal((await once(migrate, 'exit'))[0], 0);
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const publicOrigin = 'https://compiled-fixture.example.test';
const server = spawn(process.execPath, ['dist/apps/api/src/server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', APP_ORIGIN: publicOrigin,
    NODE_ENV: 'production', SOURCE_NETWORK_ENABLED: 'false',
    PUBLIC_REGISTRATION_ENABLED: 'true',
    SESSION_SECRET: 'compiled-smoke-fixture-secret'.repeat(2),
    ADMIN_BOOTSTRAP_EMAIL: 'compiled@example.test', ADMIN_BOOTSTRAP_PASSWORD: 'compiled-fixture-password' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', data => { logs += data; });
server.stderr.on('data', data => { logs += data; });
const exited = once(server, 'exit');
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await fetch(`${origin}/readyz`).then(r => r.ok).catch(() => false);
    if (ready) break;
    if (server.exitCode !== null) throw Error(logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  const session = await fetch(`${origin}/v1/auth/session`);
  assert.equal(session.headers.get('cache-control'), 'no-store');
  assert.equal((await session.json()).publicRegistration, false);
  const response = await fetch(`${origin}/v1/auth/login`, { method: 'POST', headers: { origin: publicOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'compiled@example.test', password: 'compiled-fixture-password' }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const sources = await fetch(`${origin}/v1/sources`, { headers: { cookie } });
  assert.equal(sources.status, 200);
  console.log(`Compiled PG16 smoke passed: ${files.length} SQL files, readyz, login and authenticated sources`);
} finally {
  server.kill('SIGTERM');
  const timer = setTimeout(() => server.kill('SIGKILL'), 16000);
  const [code, signal] = await exited;
  clearTimeout(timer);
  assert.equal(code, 0, `Shutdown failed (${signal}): ${logs}`);
}
