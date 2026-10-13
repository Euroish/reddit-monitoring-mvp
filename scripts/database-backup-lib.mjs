import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

export function backupFile(root, value) {
  const base = path.resolve(root, 'output'), file = path.resolve(root, value);
  if (!file.startsWith(base + path.sep) || path.extname(file) !== '.dump')
    throw new Error('Backup file must stay below workspace output and use .dump; existing files are preserved');
  let parent = path.dirname(file);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const actual = fs.realpathSync(parent), actualRoot = fs.realpathSync(root);
  if (actual !== actualRoot && actual !== path.join(actualRoot, 'output') && !actual.startsWith(path.join(actualRoot, 'output') + path.sep))
    throw new Error('Backup file must remain below workspace output; .dump symlink destinations are rejected');
  return file;
}

export function databaseEnvironment(connectionString, shell = process.env) {
  let url; try { url = new URL(connectionString); } catch { /* handled below */ }
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash
      || !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname))
    throw new Error('Backup tooling requires an explicit loopback PostgreSQL URL without query options');
  const env = { ...shell, PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username || 'postgres'), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1), PGSSLMODE: 'disable' };
  for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS']) delete env[key];
  return env;
}

export function restoreDatabaseName(value) {
  if (typeof value !== 'string' || value.length > 63 || !/^(?:source_validation|info_workbench_restore)_[a-z0-9][a-z0-9_]*$/.test(value))
    throw new Error('Use a fresh source_validation_* or info_workbench_restore_* restore database; the original is never overwritten');
  return value;
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function tool(pgBin, name) {
  if (!path.isAbsolute(pgBin)) throw new Error('PG_BIN must be an absolute local PostgreSQL bin directory');
  return path.join(pgBin, process.platform === 'win32' ? `${name}.exe` : name);
}

async function run(binary, args, env, diagnosticFile) {
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('PostgreSQL backup tool timed out; partial files/database are preserved for inspection')); }, 300000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('PostgreSQL backup executable could not start; check PG_BIN')); });
    child.once('exit', async code => {
      clearTimeout(timer);
      // Diagnostics may contain server/user details; do not echo credentials or URLs into logs.
      if (code === 0) resolve();
      else {
        const privateText = env.PGPASSWORD ? stderr.replaceAll(env.PGPASSWORD, '[redacted]') : stderr;
        await fsp.writeFile(diagnosticFile, privateText, { mode: 0o600 }).catch(() => {});
        reject(new Error(`${path.basename(binary)} failed (exit ${code}); archive/target may be incomplete; inspect private ${path.relative(process.cwd(), diagnosticFile)}${/version mismatch/i.test(stderr) ? ' (tool/server version mismatch)' : ''}`));
      }
    });
  });
}

export async function databaseInventory(client) {
  const names = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const tables = {};
  for (const { tablename } of names.rows) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const count = await client.query(`SELECT count(*)::text AS count FROM public.${quoted}`);
    const value = Number(count.rows[0].count);
    if (!Number.isSafeInteger(value)) throw new Error('Database row count exceeds safe inventory representation');
    tables[tablename] = value;
  }
  const migrations = tables.schema_migration === undefined ? []
    : (await client.query('SELECT filename,checksum FROM schema_migration ORDER BY filename')).rows;
  return { tables, migrations };
}

export function compareInventory(expected, actual) {
  const canonical = value => JSON.stringify({ tables: Object.entries(value.tables).sort(([a], [b]) => a.localeCompare(b)),
    migrations: [...value.migrations].sort((a, b) => a.filename.localeCompare(b.filename)) });
  if (canonical(expected) !== canonical(actual)) throw new Error('Restored database inventory differs; do not promote it');
  return true;
}

export async function backupDatabase({ root = process.cwd(), connectionString, pgBin, file }) {
  const destination = backupFile(root, file), env = databaseEnvironment(connectionString);
  const manifestPath = `${destination}.manifest.json`;
  if (fs.existsSync(destination) || fs.existsSync(manifestPath)) throw new Error('Backup output already exists; choose a new filename');
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  // Reserve the output exclusively before invoking pg_dump, so concurrent operators cannot overwrite it.
  const reserved = await fsp.open(destination, 'wx', 0o600); await reserved.close();
  const client = new pg.Client({ connectionString }); await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const inventory = await databaseInventory(client);
    await run(tool(pgBin, 'pg_dump'), ['--format=custom', '--no-owner', '--no-acl', '--schema=public', '--snapshot', snapshot, '--file', destination], env, `${destination}.dump-error.log`);
    await client.query('COMMIT');
    const manifest = { version: 1, createdAt: new Date().toISOString(), sourceDatabase: env.PGDATABASE,
      filename: path.basename(destination), bytes: (await fsp.stat(destination)).size, sha256: await digest(destination),
      consistency: 'pg_export_snapshot_repeatable_read', inventory };
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { file: destination, manifestPath, sha256: manifest.sha256, tableCount: Object.keys(inventory.tables).length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { await client.end(); }
}

export async function restoreDatabase({ root = process.cwd(), connectionString, pgBin, file, targetDatabase }) {
  const source = backupFile(root, file), name = restoreDatabaseName(targetDatabase), env = databaseEnvironment(connectionString);
  const text = await fsp.readFile(`${source}.manifest.json`, 'utf8');
  if (text.length > 1024 * 1024) throw new Error('Backup manifest is too large');
  const manifest = JSON.parse(text);
  if (manifest.version !== 1 || manifest.filename !== path.basename(source) || !/^[a-f0-9]{64}$/.test(manifest.sha256)
      || manifest.bytes !== (await fsp.stat(source)).size || manifest.sha256 !== await digest(source))
    throw new Error('Backup archive integrity check failed; no restore database was created');
  if (!manifest.inventory || typeof manifest.inventory.tables !== 'object' || manifest.inventory.tables === null
      || Array.isArray(manifest.inventory.tables) || !Array.isArray(manifest.inventory.migrations)
      || Object.values(manifest.inventory.tables).some(count => !Number.isSafeInteger(count) || count < 0)
      || manifest.inventory.migrations.some(row => !row || typeof row.filename !== 'string' || typeof row.checksum !== 'string'))
    throw new Error('Invalid backup inventory; no restore database was created');
  const adminUrl = new URL(connectionString); adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.href }); await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
    if (exists.rowCount) throw new Error('Restore database already exists; original and existing data are preserved');
    // name is strictly validated; CREATE DATABASE has no parameter form.
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  } finally { await admin.end(); }
  // This name was just created by us; clean handles template0's pre-existing public schema.
  // Existing targets were rejected above, so clean never reaches the original database.
  await run(tool(pgBin, 'pg_restore'), ['--exit-on-error', '--single-transaction', '--clean', '--if-exists', '--no-owner', '--no-acl', '--dbname', name, source], { ...env, PGDATABASE: name }, `${source}.restore-error.log`);
  const restoredUrl = new URL(connectionString); restoredUrl.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: restoredUrl.href }); await client.connect();
  try {
    compareInventory(manifest.inventory, await databaseInventory(client));
    return { database: name, archiveSha256: manifest.sha256, inventoryMatches: true,
      acceptance: 'archive_integrity_schema_and_row_counts', businessAcceptanceRequired: true };
  } finally { await client.end(); }
}
