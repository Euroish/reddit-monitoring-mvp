import assert from "node:assert/strict";
import test from "node:test";
import { verificationScope } from "./ci-scope.mjs";

const enabled = (files, options) => Object.entries(
  verificationScope(files, { event: "pull_request", ...options }),
).filter(([, value]) => value).map(([key]) => key).sort();

test("PR checks follow risk and isolate backend PRs from slow browser E2E", () => {
  assert.deepEqual(enabled(["docs/development.md", "README.md"]), []);
  assert.deepEqual(enabled(["tests/unit/collection.test.ts", "src/modules/collection/jobs.ts"]), ["api", "postgres", "project"]);
  assert.deepEqual(enabled(["src/modules/access/session.ts", "apps/api/src/app.ts"]), ["api", "postgres", "project"]);
  assert.deepEqual(enabled(["apps/web/src/new-feature.tsx"]), ["browser", "project", "web"]);
  assert.deepEqual(enabled(["tests/browser/workbench.test.ts"]), ["api", "browser", "project"]);
  for (const file of [".dockerignore", "scripts/verify-container-build.sh"]) {
    assert.deepEqual(enabled([file]), ["docker"]);
  }
  assert.deepEqual(enabled(["scripts/ci-scope.mjs"]), ["api", "postgres", "project", "web", "workflow"]);
  for (const file of ["package-lock.json", "packages/contracts/src/new.ts", "new-runtime-config"]) {
    assert.deepEqual(enabled([file]), ["api", "postgres", "project", "web"]);
  }
  assert.deepEqual(enabled(["docs/status.md"], { forceBrowser: true }), ["browser", "project"]);
});

test("main push runs integrated browser checks, while manual/release runs full suite without legacy pack", () => {
  assert.deepEqual(enabled(["docs/development.md"], { event: "push" }), []);
  assert.deepEqual(enabled(["src/modules/feed/sql.ts"], { event: "push" }), ["api", "browser", "postgres", "project", "web"]);
  assert.deepEqual(enabled(["apps/web/src/new-feature.tsx"], { event: "push" }), ["api", "browser", "postgres", "project", "web"]);
  const full = ["api", "browser", "postgres", "project", "web", "workflow"];
  assert.deepEqual(enabled([], { event: "workflow_dispatch", full: true }), [...full.slice(0, 2), "docker", ...full.slice(2)].sort());
  assert.deepEqual(enabled([], { event: "push", full: true, release: true }), full);
});
