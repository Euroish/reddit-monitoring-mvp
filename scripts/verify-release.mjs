import { verifyRelease } from './release-package-lib.mjs';
if (!process.argv[2]) { console.error('Usage: verify-release.mjs output/releases/<snapshot>'); process.exitCode = 1; }
else verifyRelease(process.argv[2]).then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
