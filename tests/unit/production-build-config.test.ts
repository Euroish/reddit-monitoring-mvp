import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production scripts use compiled node entrypoints", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.equal(packageJson.scripts.build, "npm run build:api && npm run build:web");
  assert.equal(packageJson.scripts["build:api"], "tsc --project tsconfig.build.json");
  assert.equal(packageJson.scripts["build:web"], "npm --prefix apps/web run build");
  assert.equal(packageJson.scripts["lint:web"], "npm --prefix apps/web run lint");
  assert.equal(packageJson.scripts["start:api"], "node dist/apps/api/src/server.js");
  assert.equal(
    packageJson.scripts["start:worker:phase1:scheduler"],
    "node dist/workers/reddit-phase1-scheduler.js",
  );
  assert.equal(
    packageJson.scripts["start:worker:keyword-query-live-refresh"],
    "node dist/workers/keyword-query-live-refresh-scheduler.js",
  );
  assert.equal(packageJson.scripts["db:migrate:compiled"], "node dist/src/storage/schema/run-migrations.js");
  assert.equal(packageJson.scripts["smoke:compiled"], "node dist/scripts/smoke-compiled-build.js");
});

test("build tsconfig emits runtime files and excludes tests", async () => {
  const buildConfig = JSON.parse(await readFile("tsconfig.build.json", "utf8")) as {
    compilerOptions: { noEmit: boolean; outDir: string; rootDir: string };
    include: string[];
    exclude: string[];
  };

  assert.equal(buildConfig.compilerOptions.noEmit, false);
  assert.equal(buildConfig.compilerOptions.outDir, "dist");
  assert.equal(buildConfig.compilerOptions.rootDir, ".");
  assert.ok(buildConfig.include.includes("apps/**/*.ts"));
  assert.ok(buildConfig.include.includes("workers/**/*.ts"));
  assert.ok(buildConfig.include.includes("scripts/**/*.ts"));
  assert.ok(buildConfig.exclude.includes("tests/**/*.ts"));
});
