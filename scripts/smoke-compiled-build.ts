import { access, readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();

const requiredFiles = [
  "dist/apps/api/src/server.js",
  "dist/workers/reddit-phase1-scheduler.js",
  "dist/workers/keyword-query-live-refresh-scheduler.js",
  "dist/src/storage/schema/run-migrations.js",
  "dist/scripts/linux-provider-smoke.js",
];

const requiredScripts = [
  "build",
  "start:api",
  "start:worker:phase1:scheduler",
  "start:worker:keyword-query-live-refresh",
  "db:migrate:compiled",
  "smoke:linux-provider",
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

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "compiled_build_smoke.passed",
      files: requiredFiles,
      scripts: requiredScripts,
    }),
  );
}

void main();
