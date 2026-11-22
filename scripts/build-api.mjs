import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

rmSync('dist', { recursive: true, force: true });
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.build.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const source = 'src/storage/schema';
const target = `dist/${source}`;
mkdirSync(target, { recursive: true });
for (const file of readdirSync(source).filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))) {
  cpSync(`${source}/${file}`, `${target}/${file}`);
  chmodSync(`${target}/${file}`, 0o644);
}

const historySrc = 'data/ai/history/v1';
const historyDst = `dist/${historySrc}`;
const manifestPath = `${historySrc}/manifest.json`;
if (!existsSync(manifestPath)) {
  console.error(`Missing AI history dataset manifest: ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  console.error(`Invalid AI history manifest files list in ${manifestPath}`);
  process.exit(1);
}
mkdirSync(historyDst, { recursive: true });
for (const entry of manifest.files) {
  const srcFile = `${historySrc}/${entry.path}`;
  if (!existsSync(srcFile)) {
    console.error(`Missing AI history dataset file: ${srcFile}`);
    process.exit(1);
  }
  const buf = readFileSync(srcFile);
  const actualHash = createHash('sha256').update(buf).digest('hex');
  if (statSync(srcFile).size !== entry.bytes || actualHash !== entry.sha256) {
    console.error(`AI history dataset integrity check failed for ${srcFile}`);
    process.exit(1);
  }
  cpSync(srcFile, `${historyDst}/${entry.path}`);
  chmodSync(`${historyDst}/${entry.path}`, 0o644);
}
cpSync(manifestPath, `${historyDst}/manifest.json`);
chmodSync(`${historyDst}/manifest.json`, 0o644);
