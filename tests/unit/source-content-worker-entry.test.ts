import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir,mkdtemp,writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("source worker loads its explicit private env before creating the runtime or using randomUUID",async()=>{
  await mkdir(join(process.cwd(),"output","validation"),{recursive:true});const directory=await mkdtemp(join(process.cwd(),"output","validation","worker-env-fixture-")),file=join(directory,"worker.env");
  // An invalid URL fails locally before any connection; this test sends no network requests.
  await writeFile(file,"DATABASE_URL=postgresql://[invalid-host]/fixture\nSOURCE_RUN_MODE=demo\nSOURCE_NETWORK_ENABLED=false\n","utf8");
  const env:NodeJS.ProcessEnv={...process.env,LOCAL_ENV_FILE:file,SOURCE_RUN_MODE:"demo",SOURCE_NETWORK_ENABLED:"false"};delete env.DATABASE_URL;
  const result=spawnSync(process.execPath,["--import","tsx","workers/source-content-worker.ts","--once"],{cwd:process.cwd(),env,encoding:"utf8",timeout:10000,windowsHide:true});assert.equal(result.status,1);const output=result.stdout+result.stderr;assert.match(output,/Invalid URL/i);assert.doesNotMatch(output,/DATABASE_URL is required|randomUUID|ReferenceError/);
});
