import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { complexityViolations, complexityRegressions } from "./check-complexity.mjs";

const source = count => `export function choose(x: number) { ${Array.from({ length: count }, (_, i) => `if (x === ${i}) return ${i};`).join("\n")} return -1; }`;

test("native ESLint measures TS/TSX branches and ignores inline suppression", () => {
  assert.deepEqual(complexityViolations(source(24), "src/example.ts"), []);
  const violations = complexityViolations("/* eslint-disable complexity */\n" + source(25), "src/example.ts");
  assert.equal(violations[0].complexity, 26);
  assert.deepEqual(complexityViolations("export const Card = () => <div>content</div>;", "apps/web/src/Card.tsx"), []);
  assert.throws(() => complexityViolations("function {", "src/broken.ts"), /Parsing error/);
});

test("ratchet rejects new high complexity and existing regressions without freezing improvements", () => {
  const old = complexityViolations(source(30), "src/example.ts");
  assert.equal(complexityRegressions([], old).length, 1);
  assert.deepEqual(complexityRegressions(old, old), []);
  assert.deepEqual(complexityRegressions(old, complexityViolations(source(29), "src/example.ts")), []);
  assert.equal(complexityRegressions(old, complexityViolations(source(31), "src/example.ts")).length, 1);
  assert.deepEqual(complexityRegressions(old, []), []);
});

test("anonymous budgets cannot be expanded by reordering, duplication, or line moves", () => {
  const item = complexity => ({ name: "Arrow function", complexity, line: 1 });
  assert.deepEqual(complexityRegressions([item(30), item(40)], [item(39), item(29)]), []);
  assert.equal(complexityRegressions([item(30), item(40)], [item(41), item(28)]).length, 1);
  assert.equal(complexityRegressions([item(30)], [item(30), item(30)]).length, 1);
});

test("CLI compares committed production TS with the pinned base, not dirty working files", () => {
  const cwd = mkdtempSync(join(tmpdir(), "complexity-gate-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const script = fileURLToPath(new URL("./check-complexity.mjs", import.meta.url));
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    mkdirSync(join(cwd, "src"));
    const file = join(cwd, "src/example.ts");
    writeFileSync(file, source(30));
    git("add", "."); git("commit", "-qm", "baseline");
    const base = git("rev-parse", "HEAD").trim();
    const run = () => spawnSync(process.execPath, [script], {
      cwd, encoding: "utf8", env: { ...process.env, MIGRATION_BASE_SHA: base },
    });
    writeFileSync(file, source(31));
    git("add", "."); git("commit", "-qm", "regression");
    writeFileSync(file, source(2));
    assert.equal(run().status, 1, "uncommitted simplification must not hide a committed regression");
    git("add", "."); git("commit", "-qm", "simplify");
    assert.equal(run().status, 0);
    git("mv", "src/example.ts", "src/renamed.ts");
    writeFileSync(join(cwd, "src/renamed.ts"), source(31));
    git("add", "."); git("commit", "-qm", "move high complexity");
    assert.equal(run().status, 1, "new file does not inherit another file's allowance");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
