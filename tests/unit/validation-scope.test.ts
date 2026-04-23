import assert from "node:assert/strict";
import test from "node:test";
import { classifyValidationScope } from "../../src/shared/validation-scope";

test("classifyValidationScope keeps pure web and test changes repo-side only", () => {
  const result = classifyValidationScope({
    files: [
      "apps/web/src/pages/Dashboard.tsx",
      "tests/integration/api-server-keyword-query.test.ts",
    ],
  });

  assert.equal(result.classification, "repo-side complete");
  assert.deepEqual(result.categories, []);
  assert.deepEqual(result.repoCommands, ["npm run verify:repo"]);
  assert.deepEqual(result.hostCommands, []);
});

test("classifyValidationScope defers host proof for deployment and runtime slices by default", () => {
  const result = classifyValidationScope({
    files: [
      "deploy/nginx/reddit-monitoring.conf",
      "apps/api/src/create-api-server.ts",
      "workers/reddit-phase1-scheduler.ts",
      "src/storage/schema/019_collection_job_status_constraint_cleanup.sql",
    ],
  });

  assert.equal(result.classification, "host verification deferred");
  assert.deepEqual(result.categories, [
    "deploy",
    "migration",
    "provider-runtime",
    "public-readiness",
  ]);
  assert.deepEqual(result.repoCommands, [
    "npm run verify:repo",
    "npm run verify:launch:local",
  ]);
  assert.deepEqual(result.hostCommands, [
    "npm run db:migrate:compiled",
    "npm run auth:bootstrap-owner:compiled",
    "node dist/scripts/linux-provider-smoke.js",
    "PUBLIC_BASE_URL=https://<domain> npm run smoke:public-launch",
  ]);
});

test("classifyValidationScope escalates risky slices to host verification required at milestone", () => {
  const result = classifyValidationScope({
    files: ["scripts/linux-provider-smoke.ts"],
    milestone: true,
  });

  assert.equal(result.classification, "host verification required now");
  assert.deepEqual(result.categories, ["provider-runtime"]);
});
