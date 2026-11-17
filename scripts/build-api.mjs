import { chmodSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
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
