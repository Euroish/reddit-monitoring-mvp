import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();

const requiredFiles = [
  "dist/apps/api/src/server.js",
  "dist/workers/reddit-phase1-scheduler.js",
  "dist/workers/keyword-query-live-refresh-scheduler.js",
  "dist/workers/source-content-worker.js",
  "dist/src/runtime/environment-config.js",
  "dist/src/runtime/load-local-env.js",
  "dist/src/runtime/source-content-runtime.js",
  "dist/src/storage/schema/run-migrations.js",
  "dist/scripts/bootstrap-first-owner.js",
  "dist/scripts/linux-provider-smoke.js",
  "dist/scripts/smoke-public-launch.js",
];

const requiredScripts = [
  "build",
  "start:api",
  "start:worker:phase1:scheduler",
  "start:worker:keyword-query-live-refresh",
  "start:worker:sources",
  "db:migrate:compiled",
  "auth:bootstrap-owner:compiled",
  "smoke:linux-provider",
  "smoke:public-launch",
];

async function main(): Promise<void> {
  const missingFiles: string[] = [];
  for (const file of requiredFiles) {
    try {
      await access(path.join(rootDir, file));
    } catch {
      missingFiles.push(file);
    }
  }

  const packageJson = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const missingScripts = requiredScripts.filter((script) => !packageJson.scripts?.[script]);

  if (missingFiles.length > 0 || missingScripts.length > 0) {
    throw new Error(
      JSON.stringify({
        event: "compiled_build_smoke.failed",
        missingFiles,
        missingScripts,
      }),
    );
  }

  if (packageJson.scripts?.["start:worker:sources"] !== "node dist/workers/source-content-worker.js") throw new Error("start:worker:sources must use the compiled source worker entrypoint");
  // Load the compiled source graph and inspect capabilities with rejecting I/O stubs.
  // This proves module loading/registration, not worker/SQL/provider execution.
  const runtime = path.join(rootDir, "dist/src/runtime/source-content-runtime.js");
  const program = `global.fetch = () => { throw new Error('Unexpected network request in compiled smoke'); };
    const { createSourceContentService } = require(${JSON.stringify(runtime)});
    const service = createSourceContentService({ query() { throw new Error('Unexpected database access in compiled smoke'); } });
    const rows = service.capabilities();
    if (!rows.some(row => row.provider === 'demo_reddit' && row.enabled) || !rows.some(row => row.provider === 'demo_x' && row.enabled) || rows.some(row => !row.provider.startsWith('demo_') && row.enabled)) throw new Error('Compiled demo provider registration/gates invalid');`;
  execFileSync(process.execPath, ["-e", program], { env: { ...process.env, LOCAL_ENV_FILE: "none", NODE_ENV: "test", SOURCE_RUN_MODE: "demo", SOURCE_NETWORK_ENABLED: "false", REDDIT_RUN_MODE: "mock", TWITTERAPI_IO_API_KEY: "" }, windowsHide: true, stdio: "pipe" });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "compiled_build_smoke.passed",
      files: requiredFiles,
      scripts: requiredScripts,
      compiledSourceGraph: "loaded with rejecting database/network stubs; demo capabilities only",
    }),
  );
}

void main();
