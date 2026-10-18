import fs from 'node:fs';
import { promises as fsp, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

async function entries(root, prefix = '') {
  const files = [];
  for (const entry of await fsp.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Release symlinks are not supported');
    if (entry.isDirectory()) files.push(...await entries(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}
async function digest(filename) {
  const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(filename)) hash.update(chunk); return hash.digest('hex');
}
const safeName = value => typeof value === 'string' && !path.posix.isAbsolute(value) && !value.includes('\\')
  && !value.split('/').some(part => !part || part === '.' || part === '..');
const allowed = file => !file.split('/').some(part => part.startsWith('.') || part === 'node_modules' || part === 'output') && (
  /^dist\/.*\.(js|map)$/.test(file)
  || /^apps\/web\/dist\/.*\.(html|js|css|map|svg|png|jpe?g|webp|ico|woff2?|ttf|webmanifest)$/.test(file)
  || /^src\/storage\/schema\/\d{3}_[a-z0-9_]+\.sql$/.test(file)
  || /^deploy\/.*\.(service|conf|example)$/.test(file)
  || ['package.json', 'package-lock.json', 'README.md', 'AGENTS.md', 'docs/README.md', 'docs/development.md', 'docs/architecture.md', 'docs/status.md', 'docs/handoff.md', 'docs/development-log.md', // Retain validation of existing release manifests.
    'docs/history/handoff.md', 'docs/history/development-log.md', 'docs/research/data-sources.md', 'docs/plans/source-expansion.md',
    'scripts/database-backup.mjs', 'scripts/database-backup-lib.mjs', 'scripts/verify-release.mjs', 'scripts/release-package-lib.mjs'].includes(file));

export async function packRelease({ root = process.cwd(), destination }) {
  root = path.resolve(root); destination = path.resolve(destination);
  const output = path.join(root, 'output');
  if (!destination.startsWith(output + path.sep)) throw new Error('Release destination must be below workspace output');
  if (fs.existsSync(destination)) throw new Error('Release destination already exists; immutable snapshots are never overwritten');
  let parent = path.dirname(destination); while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const actualParent = fs.realpathSync(parent), actualRoot = fs.realpathSync(root);
  if (actualParent !== actualRoot && actualParent !== path.join(actualRoot, 'output') && !actualParent.startsWith(path.join(actualRoot, 'output') + path.sep)) throw new Error('Release output symlink escape refused');
  const required = ['dist/apps/api/src/server.js', 'dist/workers/source-content-worker.js', 'apps/web/dist/index.html', 'package.json', 'package-lock.json'];
  for (const file of required) await fsp.access(path.join(root, file)).catch(() => { throw new Error(`Missing release input ${file}; run build and compiled smoke first`); });
  const inputs = [];
  for (const directory of ['dist', 'apps/web/dist', 'src/storage/schema', 'deploy', 'docs'])
    if (fs.existsSync(path.join(root, directory))) inputs.push(...(await entries(path.join(root, directory))).map(file => `${directory}/${file}`).filter(allowed));
  for (const file of ['package.json', 'package-lock.json', 'README.md', 'AGENTS.md', 'scripts/database-backup.mjs', 'scripts/database-backup-lib.mjs', 'scripts/verify-release.mjs', 'scripts/release-package-lib.mjs'])
    if (fs.existsSync(path.join(root, file))) inputs.push(file);
  await fsp.mkdir(path.dirname(destination), { recursive: true }); await fsp.mkdir(destination);
  const files = [];
  for (const file of [...new Set(inputs)].sort()) {
    if (!safeName(file) || !allowed(file)) throw new Error('Unsafe release input');
    const target = path.join(destination, file); await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(path.join(root, file), target, constants.COPYFILE_EXCL);
    files.push({ path: file, bytes: (await fsp.stat(target)).size, sha256: await digest(target) });
  }
  const packageJson = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
  let sourceCommit = null, dirty = null;
  try {
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (fs.realpathSync(gitRoot) === actualRoot) {
      sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
    }
  } catch { /* inspectable fixture/artifact without Git provenance */ }
  const manifest = { formatVersion: 1, application: packageJson.name, version: packageJson.version,
    createdAt: new Date().toISOString(), sourceCommit, sourceTreeDirty: dirty, buildNode: process.versions.node,
    nodeRequirement: '>=22', credentialsIncluded: false, databaseIncluded: false, signature: 'none_sha256_integrity_only',
    install: 'npm ci --omit=dev --ignore-scripts', files };
  await fsp.writeFile(path.join(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await verifyRelease(destination);
  return manifest;
}

export async function verifyRelease(root) {
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'release-manifest.json'), 'utf8'));
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 100000) throw new Error('Invalid release manifest');
  const listed = manifest.files.map(file => file.path);
  if (new Set(listed).size !== listed.length || listed.some(file => !safeName(file) || !allowed(file))) throw new Error('Invalid release manifest inventory');
  const actual = (await entries(root)).filter(file => file !== 'release-manifest.json');
  if (JSON.stringify([...listed].sort()) !== JSON.stringify(actual)) throw new Error('Release inventory differs: missing or unlisted file');
  for (const file of manifest.files) {
    const target = path.join(root, file.path);
    if ((await fsp.stat(target)).size !== file.bytes || await digest(target) !== file.sha256) throw new Error(`Release integrity failed: ${file.path}`);
  }
  return { verified: true, version: manifest.version, files: listed.length, sourceCommit: manifest.sourceCommit,
    sourceTreeDirty: manifest.sourceTreeDirty, signed: false };
}
