import assert from "node:assert/strict";
import test from "node:test";
import { verificationScope } from "./ci-scope.mjs";

const enabled = (files, options) => Object.entries(
  verificationScope(files, { event: "pull_request", ...options }),
).filter(([, value]) => value).map(([key]) => key).sort();

test("selects only relevant verification and combines checks for mixed changes", () => {
  assert.deepEqual(enabled(["docs/development.md", "scripts/check-docs.ts"]), []);
  assert.deepEqual(enabled([".github/workflows/verify.yml", "scripts/ci-scope.mjs"]), ["workflow"]);
  assert.deepEqual(enabled(["tests/unit/collection.test.ts"]), ["api", "project"]);
  assert.deepEqual(enabled(["src/modules/collection/jobs.ts"]), ["api", "postgres", "project"]);
  assert.deepEqual(enabled(["apps/web/src/new-feature.tsx"]), ["browser", "project", "web"]);
  assert.deepEqual(enabled(["src/storage/schema/066_example.sql", "apps/web/src/new-feature.tsx", "Dockerfile"]),
    ["api", "browser", "docker", "postgres", "project", "web"]);
  assert.deepEqual(enabled(["packages/contracts/src/new.ts"]), ["api", "browser", "postgres", "project", "web"]);
  assert.deepEqual(enabled(["package-lock.json"]), ["api", "postgres", "project", "web"]);
});

test("main pushes stay scoped, while manual verification and release retain the full project suite", () => {
  assert.deepEqual(enabled(["src/modules/feed/sql.ts"], { event: "push" }), ["api", "postgres", "project"]);
  const full = ["api", "browser", "postgres", "project", "web", "workflow"];
  assert.deepEqual(enabled([], { event: "workflow_dispatch", full: true }), [...full, "docker"].sort());
  assert.deepEqual(enabled([], { event: "push", full: true }), full);
});
