import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkPullRequestQuality } from "./check-pr-quality.mjs";

const pr = (extra = {}) => ({ draft: false, labels: [], ...extra });

test("admission accepts independent PRs regardless of number, age, author or other PRs", () => {
  for (const number of [1, 32, 500]) {
    assert.deepEqual(checkPullRequestQuality(pr({ number, created_at: "2020-01-01", user: { login: "any-author" } })), []);
  }
});

test("description format, missing sections, duplicates and placeholders do not block admission", () => {
  const template = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
  for (const body of [undefined, null, "", "新增三份审计文档。", "## 价值与验收\nTODO\n## 价值与验收\n重复说明", template]) {
    assert.deepEqual(checkPullRequestQuality(pr({ body })), []);
  }
});

test("draft and explicit hold still block admission even with an absent or empty description", () => {
  for (const body of [undefined, null, "", "说明"]) {
    assert.match(checkPullRequestQuality(pr({ body, draft: true })).join(), /Draft/);
    for (const labels of [[{ name: "quality:hold" }], ["quality:hold"]]) {
      assert.match(checkPullRequestQuality(pr({ body, labels })).join(), /quality:hold/);
    }
  }
  assert.equal(checkPullRequestQuality(pr({ draft: true, labels: ["quality:hold"] })).length, 2);
  assert.deepEqual(checkPullRequestQuality(pr({ labels: [{ name: "bug" }] })), []);
  assert.match(checkPullRequestQuality(undefined).join(), /PR 事件数据缺失/);
});

test("the required CI Gate revalidates admission on metadata changes with read-only permissions", () => {
  const workflow = readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  const events = workflow.match(/types: \[([^\]]+)\]/)[1].split(",").map(value => value.trim());
  for (const event of ["opened", "edited", "synchronize", "ready_for_review", "converted_to_draft", "labeled", "unlabeled"]) {
    assert.ok(events.includes(event), event);
  }
  const policy = workflow.split("  policy:")[1].split("\n  project:")[0];
  assert.match(policy, /run: node --test scripts\/check-pr-quality\.test\.mjs/);
  assert.match(policy, /run: node scripts\/check-pr-quality\.mjs/);
  assert.match(workflow, /needs: \[policy, project, workflow, docker\]/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.ok(!workflow.includes("pull_request_target"));
});

test("CLI reads event JSON as data without git or a base SHA and propagates status rejections", () => {
  const directory = mkdtempSync(join(tmpdir(), "pr-admission-"));
  try {
    const event = join(directory, "event.json");
    const script = new URL("./check-pr-quality.mjs", import.meta.url).pathname;
    const env = { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event, MIGRATION_BASE_SHA: "" };
    const run = () => spawnSync(process.execPath, [script], { env, cwd: directory, encoding: "utf8" });
    for (const extra of [{ draft: true }, { labels: [{ name: "quality:hold" }] }]) {
      writeFileSync(event, JSON.stringify({ pull_request: pr(extra) }));
      const rejected = run();
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /Draft|quality:hold/);
    }
    for (const body of [null, "", "新增审计文档。", "$(exit 99)"]) {
      writeFileSync(event, JSON.stringify({ pull_request: pr({ body }) }));
      const accepted = run();
      assert.equal(accepted.status, 0, accepted.stderr);
      assert.match(accepted.stdout, /NOT a design approval/);
    }
    writeFileSync(event, "{}");
    assert.equal(run().status, 1);
    writeFileSync(event, "invalid json");
    assert.equal(run().status, 1);
    assert.equal(spawnSync(process.execPath, [script], { env: { ...env, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "missing" } }).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
