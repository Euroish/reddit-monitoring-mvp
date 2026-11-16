import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DOCUMENTATION_FILES } from "../../scripts/release-package-lib.mjs";

test("repository policy accepts the compact layout and reports independent boundary regressions", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "monitor-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  };
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  for (const file of DOCUMENTATION_FILES) put(file, "# Fixture\n");
  put(
    "src/modules/content/routes.ts",
    'export const message = "class Wrapper {}";\n',
  );
  const run = () =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", path.resolve("scripts/check-docs.ts"), root],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, LOCAL_ENV_FILE: "none" },
      },
    );
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);

  put(
    "docs/README.md",
    "# Fixture\n| ARC-01 | MUST | One definition | lint |\n",
  );
  put(
    "docs/contracts.md",
    "# Fixture\n| ARC-01 | MUST | Duplicate | lint |\n| ARC-02 | REQUIRED | Bad keyword | lint |\n[bad](README.md#missing)\n",
  );
  put("docs/extra.md", "# More rules\n");
  put("README.md", "line\n".repeat(61));
  put("src/modules/content/service.ts", "export const value = 1;\n");
  put(
    "src/modules/content/routes.ts",
    `/*${"x".repeat(301)}*/\nimport { old } from "../../application/services/old"; export class Wrapper {}\n`,
  );
  put(".env.local", "APIFY_API_TOKEN=synthetic_fixture_only\n");
  execFileSync("git", ["add", "--", ".env.local"], { cwd: root });
  put("src/runtime/obsolete.ts", "export const retired = true;\n");
  const invalid = run();
  assert.equal(invalid.status, 1, invalid.stderr);
  for (const error of [
    /Duplicate rule ARC-01/,
    /needs a normative keyword/,
    /Invalid Markdown anchor/,
    /Unexpected documentation/,
    /60 lines/,
    /Unregistered module file/,
    /Legacy dependency/,
    /Wrapper class/,
    /Oversized module comment/,
    /Private configuration tracked/,
    /Retired architecture path/,
  ])
    assert.match(invalid.stderr, error);
});
