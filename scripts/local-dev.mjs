import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { validateManagedConfig, managedEnvironment } from './local-dev-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.join(root, 'output', 'local-dev');
const configFile = path.join(home, 'config.json');
const stateFile = path.join(home, 'processes.json');
const envFile = path.join(root, '.env.local');
const action = process.argv[2] ?? 'status';
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
fs.mkdirSync(home, { recursive: true });
const read = file => {
  if (!fs.existsSync(file)) return null;
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`Invalid JSON in ${path.relative(root, file)}; inspect the configuration. Existing files were preserved.`); }
  return file === configFile ? validateManagedConfig(value, home) : value;
};
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function freePort(preferred) {
  const attempt = port => new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => { const found = server.address().port; server.close(() => resolve(found)); });
  });
  return await attempt(preferred) ?? await attempt(0) ?? (() => { throw new Error('No bindable loopback port'); })();
}
async function run(binary, args, env = process.env, logName = 'setup.log') {
  const fd = fs.openSync(path.join(home, logName), 'a');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', fd, fd] });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Command timed out; inspect output/local-dev/${logName}`)); }, 60000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Command exited ${code}; inspect output/local-dev/${logName}`)); });
    });
  } finally { fs.closeSync(fd); }
}
function localEnv(config) {
  if (!fs.existsSync(envFile)) throw new Error('Managed .env.local is missing; restore its private configuration before proceeding');
  const values = parseEnv(fs.readFileSync(envFile, 'utf8'));
  return { ...managedEnvironment(config, values), LOCAL_ENV_FILE: envFile };
}
async function ensureDatabase(config) {
  const pg = name => path.join(config.pgBin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  const { default: driver } = await import('pg');
  const connection = { host: '127.0.0.1', port: config.pgPort, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 1500 };
  let ready = false;
  const probe = new driver.Client(connection);
  try { await probe.connect(); ready = true; } catch { /* start owned cluster */ } finally { await probe.end(); }
  if (!ready) await run(pg('pg_ctl'), ['-D', config.pgData, '-l', path.join(home, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${config.pgPort}`, '-w', 'start']);
  // Verify the service is our cluster before any database writes.
  const client = new driver.Client(connection);
  await client.connect();
  try {
    const directory = (await client.query('SHOW data_directory')).rows[0].data_directory;
    if (path.resolve(directory).toLowerCase() !== path.resolve(config.pgData).toLowerCase()) throw new Error('Port belongs to another PostgreSQL cluster');
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname='info_workbench_dev'");
    if (!exists.rowCount) await client.query('CREATE DATABASE info_workbench_dev');
  } finally { await client.end(); }
}
async function setup() {
  let config = read(configFile);
  if (!config) {
    if (fs.existsSync(envFile)) throw new Error('Existing .env.local preserved. Use its manual startup commands, or move it yourself before managed setup');
    const input = option('--pg-bin') ?? process.env.LOCAL_PG_BIN;
    if (!input) throw new Error('Provide --pg-bin <PostgreSQL bin directory> or LOCAL_PG_BIN; PostgreSQL is not downloaded automatically');
    const install = path.resolve(input, '..');
    if (!fs.existsSync(path.join(install, 'share', 'postgres.bki'))) throw new Error('Expected a complete PostgreSQL installation with bin and share');
    const destination = path.join(home, 'pgsql');
    if (!fs.existsSync(destination)) fs.cpSync(install, destination, { recursive: true, dereference: true, errorOnExist: true, force: false });
    const pgBin = path.join(destination, 'bin');
    const pgData = path.join(home, 'postgres-data');
    config = { pgBin, pgData, pgPort: await freePort(25432), apiPort: await freePort(3000), webPort: await freePort(5173), databaseUrl: null, setupComplete: false };
    config.databaseUrl = `postgresql://postgres@127.0.0.1:${config.pgPort}/info_workbench_dev`;
    await run(path.join(pgBin, process.platform === 'win32' ? 'initdb.exe' : 'initdb'), ['-D', pgData, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
    const email = 'local-owner@example.test', password = randomBytes(18).toString('base64url');
    write(path.join(home, 'account.json'), { email, password, role: 'owner', syntheticDemo: true });
    const values = { DATABASE_URL: config.databaseUrl, PORT: String(config.apiPort), LOCAL_WEB_PORT: String(config.webPort), NODE_ENV: 'development', API_BEARER_TOKEN: randomBytes(32).toString('hex'), API_SESSION_COOKIE_SECURE: 'false', VITE_API_PROXY_TARGET: `http://127.0.0.1:${config.apiPort}`, PG_POOL_MAX: '5', SOURCE_RUN_MODE: 'demo', SOURCE_NETWORK_ENABLED: 'false', BOOTSTRAP_OWNER_EMAIL: email, BOOTSTRAP_OWNER_PASSWORD: password, BOOTSTRAP_OWNER_DISPLAY_NAME: 'Local owner' };
    fs.writeFileSync(envFile, '# Managed local demo; private. Never commit.\n' + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
    write(configFile, config);
  }
  const env = localEnv(config);
  await ensureDatabase(config);
  await run(process.execPath, ['--import', 'tsx', 'src/storage/schema/run-migrations.ts'], env);
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  let count; try { count = Number((await client.query('SELECT COUNT(*) FROM app_user')).rows[0].count); } finally { await client.end(); }
  if (count === 0) await run(process.execPath, ['--import', 'tsx', 'scripts/bootstrap-first-owner.ts'], env);
  await run(process.execPath, ['--import', 'tsx', 'scripts/seed-local-demo.ts'], env);
  config.setupComplete = true; write(configFile, config);
  console.log(`Local offline demo ready. Run npm run local:start. Account: output/local-dev/account.json`);
}
function commandLine(pid) {
  if (process.platform === 'linux') { try { return fs.readFileSync(`/proc/${Number(pid)}/cmdline`, 'utf8').replaceAll('\0', ' '); } catch { return null; } }
  if (process.platform !== 'win32') return null;
  try { return execFileSync('pwsh.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}").CommandLine`], { windowsHide: true, encoding: 'utf8' }).trim(); } catch { return null; }
}
function owned(processInfo) {
  if (!processInfo || !alive(processInfo.pid)) return false;
  const command = commandLine(processInfo.pid);
  return command !== null && command.includes(processInfo.entry) && command.includes(root);
}
async function waitUrl(url) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* poll bounded local service */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Service did not become ready: ${url}; inspect output/local-dev logs`);
}
async function start() {
  const config = read(configFile);
  if (!config?.setupComplete) throw new Error('Run npm run local:setup -- --pg-bin <bin> first');
  const env = localEnv(config), state = read(stateFile) ?? {};
  await ensureDatabase(config);
  const entries = { api: ['apps/api/src/server.ts', ['--import', 'tsx']], worker: ['workers/source-content-worker.ts', ['--import', 'tsx']], web: ['apps/web/node_modules/vite/bin/vite.js', []] };
  for (const [name, [entry, prefix]] of Object.entries(entries)) {
    if (owned(state[name])) continue;
    const absolute = path.join(root, entry);
    const args = [...prefix, absolute, ...(name === 'web' ? ['--host', '127.0.0.1', '--port', String(config.webPort), '--strictPort'] : [])];
    const fd = fs.openSync(path.join(home, `${name}.log`), 'a');
    const child = spawn(process.execPath, args, { cwd: name === 'web' ? path.join(root, 'apps', 'web') : root, env, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    state[name] = { pid: child.pid, entry: absolute, startedAt: new Date().toISOString() };
    child.unref(); fs.closeSync(fd); write(stateFile, state);
  }
  await waitUrl(`http://127.0.0.1:${config.apiPort}/healthz`);
  await waitUrl(`http://127.0.0.1:${config.webPort}/login`);
  for (const [name, info] of Object.entries(state)) if (!owned(info)) throw new Error(`Managed ${name} exited or its identity changed; inspect output/local-dev/${name}.log`);
  console.log(`Offline demo: http://127.0.0.1:${config.webPort}/login (API ${config.apiPort}). Credentials: npm run local:account`);
}
async function stop() {
  const state = read(stateFile) ?? {};
  for (const [name, info] of Object.entries(state)) {
    if (owned(info)) {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(info.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else process.kill(info.pid, 'SIGTERM');
    }
    else if (alive(info.pid)) { console.log(`Preserved unverified PID ${info.pid} (${name})`); continue; }
    delete state[name];
  }
  write(stateFile, state);
  const config = read(configFile);
  if (!process.argv.includes('--keep-db') && config && fs.existsSync(path.join(config.pgData, 'postmaster.pid'))) await run(path.join(config.pgBin, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'), ['-D', config.pgData, '-m', 'fast', '-w', 'stop']);
  console.log('Managed local services stopped; data and configuration retained.');
}
try {
  if (action === 'setup') await setup();
  else if (action === 'start') await start();
  else if (action === 'stop') await stop();
  else if (action === 'account') { const account = read(path.join(home, 'account.json')); if (!account) throw new Error('No managed account; run setup'); console.log(JSON.stringify(account, null, 2)); }
  else if (action === 'status') { const config = read(configFile); console.log(JSON.stringify({ configured: !!config, webUrl: config && `http://127.0.0.1:${config.webPort}`, databasePort: config?.pgPort, services: Object.fromEntries(Object.entries(read(stateFile) ?? {}).map(([key, value]) => [key, { pid: value.pid, running: owned(value) }])) }, null, 2)); }
  else if (action === 'config-only') { const config = read(configFile); if (!config) throw new Error('No managed configuration; run local:setup first'); localEnv(config); console.log('Managed local configuration valid; no database or services were started.'); }
  else throw new Error('Expected setup, start, stop, status, account, or config-only');
} catch (error) { console.error(error.message); process.exitCode = 1; }
