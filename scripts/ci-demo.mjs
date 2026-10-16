import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, open, access } from 'node:fs/promises';
import path from 'node:path';

// CI creates its own throwaway service database. It never reads .env.local or managed local cluster configuration.
const root = process.cwd(), folder = path.join(root, 'output', 'local-dev');
const children = [], logs = [];
async function run(entry, args, env, persistent = false) {
  const log = await open(path.join(folder, `ci-${path.basename(entry)}.log`), 'a'); logs.push(log);
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, entry), ...args], { cwd: root, env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  children.push(child);
  if (!persistent) await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${entry} failed (${code}); see CI logs`))); });
  else await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
}
async function ready(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* bounded loopback readiness */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('CI demo service did not become ready; inspect output/local-dev/ci-* logs');
}
async function main() {
  if (process.env.CI !== 'true') throw new Error('ci-demo is restricted to explicit CI=true with a throwaway PostgreSQL service');
  let url; try { url = new URL(process.env.CI_DEMO_DATABASE_URL); } catch { throw new Error('CI_DEMO_DATABASE_URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/info_workbench_dev') throw new Error('CI demo requires loopback info_workbench_dev in the throwaway CI service');
  const apiPort = 3000, webPort = 5173;
  const email = 'ci-owner@example.test', password = randomBytes(24).toString('base64url');
  const env = { ...process.env, LOCAL_ENV_FILE: 'none', DATABASE_URL: url.href, NODE_ENV: 'test', PORT: String(apiPort), LOCAL_WEB_PORT: String(webPort), API_HOST: '127.0.0.1', API_CORS_ALLOW_ORIGINS: `http://127.0.0.1:${webPort}`, VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`, API_BEARER_TOKEN: randomBytes(32).toString('hex'), API_SESSION_COOKIE_SECURE: 'false', SOURCE_RUN_MODE: 'demo', SOURCE_NETWORK_ENABLED: 'false', REDDIT_RUN_MODE: 'mock', TWITTERAPI_IO_API_KEY: '', BOOTSTRAP_OWNER_EMAIL: email, BOOTSTRAP_OWNER_PASSWORD: password, BOOTSTRAP_OWNER_DISPLAY_NAME: 'Synthetic CI owner' };
  await mkdir(folder, { recursive: true });
  for (const filename of ['config.json', 'account.json']) {
    let exists = false; try { await access(path.join(folder, filename)); exists = true; } catch { /* fresh CI checkout */ }
    if (exists) throw new Error('Existing local configuration was preserved; CI E2E requires a fresh checkout/output directory');
  }
  const { default: driver } = await import('pg');
  const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
  const admin = new driver.Client({ connectionString: adminUrl.href }); await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname='info_workbench_dev'");
    if (exists.rowCount) throw new Error('CI demo database already exists; use a fresh throwaway service (existing data was preserved)');
    await admin.query('CREATE DATABASE info_workbench_dev');
  } finally { await admin.end(); }
  await writeFile(path.join(folder, 'config.json'), JSON.stringify({ apiPort, webPort, syntheticCi: true }));
  await writeFile(path.join(folder, 'account.json'), JSON.stringify({ email, password, syntheticCi: true }), { mode: 0o600 });
  try {
    await run('src/storage/schema/run-migrations.ts', [], env);
    await run('scripts/bootstrap-first-owner.ts', [], env);
    await run('scripts/seed-local-demo.ts', [], env);
    await run('apps/api/src/server.ts', [], env, true);
    await run('workers/source-content-worker.ts', [], env, true);
    // Vite resolves its project from cwd, so launch its CLI with an explicit root.
    await run('apps/web/node_modules/vite/bin/vite.js', [path.join(root, 'apps/web'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], env, true);
    await ready(`http://127.0.0.1:${apiPort}/healthz`); await ready(`http://127.0.0.1:${webPort}/login`);
    await run('scripts/smoke-local-demo.ts', [], env);
    console.log(JSON.stringify({ event: 'ci_synthetic_e2e.passed', realSourceRequestsAllowed: false }));
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); })));
    await Promise.all(logs.map(log => log.close()));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
