import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DOCUMENTATION_FILES } from "../../scripts/release-package-lib.mjs";

test("repository policy accepts clean multi-helper modules and enforces AST, record SSOT, and anti-golfing boundaries", t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "monitor-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  };
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  for (const file of DOCUMENTATION_FILES) put(file, "# Fixture\n");
  put("AGENTS.md", "# Fixture\n[Dev](docs/development.md)\n[Status](docs/status.md)\n");
  put("src/modules/content/batch.ts", `// ${"reason ".repeat(60)}\nexport const message = "class Wrapper {}";\nexport const sql = \`SELECT ${"a,".repeat(130)}b\`;\n`);
  const run = (base = "") =>
    spawnSync(process.execPath, ["--import", "tsx", path.resolve("scripts/check-docs.ts"), root], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, LOCAL_ENV_FILE: "none", MIGRATION_BASE_SHA: base },
    });
  put("docs/research/additional/study.md", "# Additional research\n");
  put("notes.md", "# Additional notes\n");
  execFileSync("git", ["add", "--", "docs/research/additional/study.md"], { cwd: root });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);

  const sql = "src/storage/schema/053_product_docs.sql";
  const commit = (message: string) => {
    execFileSync("git", ["add", "--", "src/storage/schema"], { cwd: root });
    execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", message], { cwd: root });
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

  put("AGENTS.md", "# Missing SSOT pointers\n");
  put("docs/README.md", "# Fixture\n| ARC-01 | MUST | One definition | lint |\n");
  put("docs/contracts.md", "# Fixture\n| ARC-01 | MUST | Duplicate | lint |\n| ARC-02 | REQUIRED | Bad keyword | lint |\n[bad](README.md#missing)\n");
  put("docs/history/handoff.txt", "Unexpected file type\n");
  put("README.md", "line\n".repeat(61));
  put("src/modules/rogue/routes.ts", "export const value = 1;\n");
  put("src/modules/content/routes.ts", `import { old } from "../../application/services/old"; export class Wrapper {}\nexport const golf = "${"x".repeat(230)}";\n`);
  put("src/modules/content/sql.ts", "export const row = 1;\n".repeat(455));
  put("src/storage/schema/042_a.sql", "SELECT 1;\n");
  put("src/storage/schema/042_b.sql", "SELECT 2;\n");
  put(".env.local", "APIFY_API_TOKEN=synthetic_fixture_only\n");
  execFileSync("git", ["add", "--", ".env.local"], { cwd: root });
  put("src/runtime/obsolete.ts", "export const retired = true;\n");
  const invalid = run();
  assert.equal(invalid.status, 1, invalid.stderr);
  for (const error of [
    /AGENTS\.md must point explicitly/, /Duplicate rule ARC-01/, /needs a normative keyword/,
    /Invalid Markdown anchor/, /Unexpected docs entry: docs\/history\/handoff\.txt/, /60 lines/,
    /Unregistered module file/, /Legacy dependency/, /Wrapper class/,
    /Code line exceeds 220 chars/, /Oversized module file/, /Duplicate forward migration prefix 042/,
    /Private configuration tracked/, /Retired architecture path/,
  ]) assert.match(invalid.stderr, error);
});
