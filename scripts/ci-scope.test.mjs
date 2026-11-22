import assert from "node:assert/strict";
import test from "node:test";
import { verificationScope } from "./ci-scope.mjs";

const enabled = (files, options) => Object.entries(
  verificationScope(files, { event: "pull_request", ...options }),
).filter(([, enabled]) => enabled).map(([key]) => key).sort();

test("PR checks follow risk and unknown paths use the shared-code scope", () => {
  assert.deepEqual(enabled(["docs/development.md", "README.md"]), []);
  assert.deepEqual(enabled(["tests/unit/collection.test.ts", "src/modules/collection/jobs.ts"]), ["api", "postgres", "project"]);
  assert.deepEqual(enabled(["apps/web/src/new-feature.tsx"]), ["browser", "project", "web"]);
  assert.deepEqual(enabled(["src/modules/access/session.ts"]), ["api", "browser", "postgres", "project"]);
  assert.deepEqual(enabled(["tests/browser/workbench.test.ts"]), ["api", "browser", "project"]);
  assert.deepEqual(enabled([".dockerignore"]), ["docker"]);
  assert.deepEqual(enabled(["scripts/ci-scope.mjs"]), ["api", "browser", "postgres", "project", "web", "workflow"]);
  for (const file of ["package-lock.json", "packages/contracts/src/new.ts", "new-runtime-config"]) {
    assert.deepEqual(enabled([file]), ["api", "browser", "postgres", "project", "web"]);
  }
  assert.deepEqual(enabled(["docs/status.md"], { forceBrowser: true }), ["browser", "project"]);
});

test("main checks the integrated runtime, while manual and release runs also verify packaging", () => {
  assert.deepEqual(enabled(["docs/development.md"], { event: "push" }), []);
  assert.deepEqual(enabled(["apps/web/src/new-feature.tsx"], { event: "push" }), ["api", "browser", "postgres", "project", "web"]);
  const full = ["api", "browser", "pack", "postgres", "project", "web", "workflow"];
  assert.deepEqual(enabled([], { event: "workflow_dispatch", full: true }), [...full, "docker"].sort());
  assert.deepEqual(enabled([], { event: "push", full: true, release: true }), full);
});
