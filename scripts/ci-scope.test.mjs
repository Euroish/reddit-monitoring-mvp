import assert from "node:assert/strict";
import test from "node:test";
import { verificationScope } from "./ci-scope.mjs";

const enabled = (files, options) => Object.entries(
  verificationScope(files, { event: "pull_request", ...options }),
).filter(([, value]) => value).map(([key]) => key).sort();

test("PR checks follow risk across backend, docker, and workflow files", () => {
  assert.deepEqual(enabled(["docs/development.md", "README.md"]), []);
  assert.deepEqual(enabled(["tests/unit/collection.test.ts", "src/modules/collection/jobs.ts"]), ["api", "postgres", "project"]);
  assert.deepEqual(enabled(["src/modules/access/session.ts", "apps/api/src/app.ts"]), ["api", "postgres", "project"]);
  for (const file of [".dockerignore", "scripts/verify-container-build.sh"]) {
    assert.deepEqual(enabled([file]), ["docker"]);
  }
  assert.deepEqual(enabled(["scripts/ci-scope.mjs"]), ["api", "postgres", "project", "workflow"]);
  for (const file of ["package-lock.json", "packages/contracts/src/new.ts", "new-runtime-config"]) {
    assert.deepEqual(enabled([file]), ["api", "postgres", "project"]);
  }
});

test("main push runs backend suite, while manual/release runs full suite", () => {
  assert.deepEqual(enabled(["docs/development.md"], { event: "push" }), []);
  assert.deepEqual(enabled(["src/modules/feed/sql.ts"], { event: "push" }), ["api", "postgres", "project"]);
  const full = ["api", "postgres", "project", "workflow"];
  assert.deepEqual(enabled([], { event: "workflow_dispatch", full: true }), [...full, "docker"].sort());
  assert.deepEqual(enabled([], { event: "push", full: true, release: true }), full);
});
