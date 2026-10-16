import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { packRelease } from './release-package-lib.mjs';
const at = process.argv.indexOf('--out'), version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const destination = path.resolve(at < 0 ? `output/releases/v${version}-${randomUUID().slice(0, 8)}` : process.argv[at + 1]);
packRelease({ destination }).then(manifest => console.log(JSON.stringify({ destination, version: manifest.version, files: manifest.files.length,
  sourceCommit: manifest.sourceCommit, sourceTreeDirty: manifest.sourceTreeDirty, deployed: false })))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
