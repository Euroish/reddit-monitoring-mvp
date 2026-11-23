import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("repository policy allows flexible docs assets/modules while enforcing links, secrets, retired paths, and migration immutability", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "monitor-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  };
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  put("README.md", "# Fixture\n[Architecture](docs/architecture.md)\n");
  put("AGENTS.md", "# Flexible agent guide\n");
  put("docs/architecture.md", "# Architecture\n[Diagram](assets/arch.png)\n```md\n[ignored](missing.md)\n```\n");
  put("docs/assets/arch.png", "synthetic-png-bytes");
  put(
    "src/modules/analytics/trends/sql.ts",
    `export class AnalyticsError extends Error {}\n` + "export const row = 1;\n".repeat(460),
  );
  put("docs/research/additional/study.md", "# Additional research\n");
  put("notes.md", "# Additional notes\n");
  execFileSync("git", ["add", "--", "docs/research/additional/study.md"], { cwd: root });

  const run = (base = "") =>
    spawnSync(process.execPath, ["--import", "tsx", path.resolve("scripts/check-docs.ts"), root], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, LOCAL_ENV_FILE: "none", MIGRATION_BASE_SHA: base },
    });

  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);

  // Migration immutability and monotonic numbering
  const sql = "src/storage/schema/053_product_docs.sql";
  const commit = (message: string) => {
    execFileSync("git", ["add", "--", "src/storage/schema"], { cwd: root });
    execFileSync(
      "git",
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", message],
      { cwd: root },
    );
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  };
  put(sql, "SELECT 1;\n");
  const applied = commit("Applied migration");
  put("src/storage/schema/054_forward.sql", "SELECT 2;\n");
  const forward = run(applied);
  assert.equal(forward.status, 0, forward.stderr);
  put(sql, "SELECT 3;\n");
  commit("Rewritten applied migration");
  const rewritten = run(applied);
  assert.equal(rewritten.status, 1, rewritten.stderr);
  assert.match(rewritten.stderr, /Applied migration .*053_product_docs\.sql must not be modified/);

  // Real guardrails must still fail loudly
  put("docs/contracts.md", "# Fixture\n[bad](../README.md#missing)\n[missing](missing.md)\n");
  put("src/storage/schema/042_a.sql", "SELECT 1;\n");
  put("src/storage/schema/042_b.sql", "SELECT 2;\n");
  put(".env.local", "APIFY_API_TOKEN=synthetic_fixture_only\n");
  execFileSync("git", ["add", "--", ".env.local"], { cwd: root });
  put("src/runtime/obsolete.ts", "export const retired = true;\n");
  put("src/connectors/reddit/arctic-shift.ts", "export const retired = true;\n");

  const invalid = run();
  assert.equal(invalid.status, 1, invalid.stderr);
  for (const error of [
    /Invalid Markdown anchor/,
    /Invalid repository link/,
    /Duplicate forward migration prefix 042/,
    /Private configuration tracked/,
    /Retired architecture path/,
    /Retired online connector/,
  ]) {
    assert.match(invalid.stderr, error);
  }
});

test("web bundle guard permits charts/ECharts on any page while rejecting leaked server secrets", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "monitor-web-bundle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  };
  const run = () =>
    spawnSync(process.execPath, [path.resolve("scripts/check-web-bundle.mjs"), root], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

  put(
    "apps/web/dist/index.html",
    `<!doctype html><link rel="modulepreload" href="/assets/charts-def456.js"><script type="module" src="/assets/index-abc123.js"></script>`,
  );
  put("apps/web/dist/assets/index-abc123.js", `import "./charts-def456.js"; console.log("clean");`);
  put("apps/web/dist/assets/charts-def456.js", `console.log("echarts allowed");`);
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);

  put("apps/web/dist/assets/index-abc123.js", `const leaked = "VITE_APIFY_API_TOKEN";`);
  const bad = run();
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stderr, /forbidden server secret identifier/);
});
