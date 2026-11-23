import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkPullRequestQuality, REQUIRED_SECTIONS } from "./check-pr-quality.mjs";

const body = REQUIRED_SECTIONS.map(title => `## ${title}\n${title === "真实依赖" ? "无" : `${title}：有可核验的行为、路径和验证结果。`}`).join("\n\n");
const pr = (extra = {}) => ({ body, draft: false, labels: [], ...extra });

test("admission accepts independent PRs regardless of number, age, author or other PRs", () => {
  for (const number of [1, 32, 500]) {
    assert.deepEqual(checkPullRequestQuality(pr({ number, created_at: "2020-01-01", user: { login: "any-author" } }), []), []);
  }
  assert.deepEqual(checkPullRequestQuality(pr({ body: body.replace("\n无\n", "\n#99：需要其公开契约，否则调用无法编译。\n") }), []), []);
});

test("draft, explicit hold, missing body and missing sections block admission", () => {
  assert.match(checkPullRequestQuality(pr({ draft: true }), []).join(), /Draft/);
  for (const labels of [[{ name: "quality:hold" }], ["quality:hold"]]) {
    assert.match(checkPullRequestQuality(pr({ labels }), []).join(), /quality:hold/);
  }
  assert.ok(checkPullRequestQuality(undefined, []).length);
  assert.ok(checkPullRequestQuality(pr({ body: null }), []).length);
  assert.equal(checkPullRequestQuality(pr({ body: "" }), []).length, REQUIRED_SECTIONS.length);
  assert.equal(checkPullRequestQuality(pr({ body: body + "\n## 价值与验收\n重复说明" }), []).length, 1);
});

test("unchanged template, comments, fenced headings and placeholders cannot supply evidence", () => {
  const template = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
  assert.ok(checkPullRequestQuality(pr({ body: template }), ["apps/web/src/App.tsx"]).length);
  for (const content of ["<!-- evidence -->", "- TODO", "TODO add evidence", "TBD", "待填写", "请填写具体证据", "无", "N/A", "不适用"]) {
    const replaced = body.replace("价值与验收：有可核验的行为、路径和验证结果。", content);
    assert.ok(checkPullRequestQuality(pr({ body: replaced }), []).length, content);
  }
  assert.equal(checkPullRequestQuality(pr({ body: `\`\`\`md\n${body}\n\`\`\`` }), []).length, REQUIRED_SECTIONS.length);
  const commands = body.replace("验证证据：有可核验的行为、路径和验证结果。", "```sh\nnode --test scripts/check-pr-quality.test.mjs\n```\n退出码 0，测试通过。");
  assert.deepEqual(checkPullRequestQuality(pr({ body: commands }), []), []);
});

test("web source changes require rendered evidence or a justified nonvisual scope", () => {
  for (const file of ["apps/web/src/App.tsx", "apps/web/src/styles/main.css", "apps/web/src/api/client.ts"]) {
    assert.match(checkPullRequestQuality(pr(), [file]).join(), /界面证据/);
    assert.deepEqual(checkPullRequestQuality(pr({ body: body + "\n## 界面证据\n不适用：仅修改请求取消逻辑，验证证据中已提供回归测试。" }), [file]), []);
    assert.deepEqual(checkPullRequestQuality(pr({ body: body + "\n## 界面证据\noutput/screenshots/mobile.png，390×844；键盘与失败重试旅程已验证。" }), [file]), []);
  }
  assert.deepEqual(checkPullRequestQuality(pr(), ["docs/design.md", "src/modules/content/sql.ts"]), []);
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

test("CLI reads event JSON as data, fails closed for missing base, and propagates rejection", () => {
  const directory = mkdtempSync(join(tmpdir(), "pr-admission-"));
  try {
    const event = join(directory, "event.json");
    writeFileSync(event, JSON.stringify({ pull_request: pr({ labels: [{ name: "quality:hold" }] }) }));
    const script = new URL("./check-pr-quality.mjs", import.meta.url).pathname;
    const env = { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event,
      MIGRATION_BASE_SHA: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
    const held = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
    assert.equal(held.status, 1);
    assert.match(held.stderr, /quality:hold/);
    writeFileSync(event, JSON.stringify({ pull_request: pr({ body: body + "\n$(exit 99)\n" }) }));
    assert.equal(spawnSync(process.execPath, [script], { env }).status, 0);
    assert.equal(spawnSync(process.execPath, [script], { env: { ...env, MIGRATION_BASE_SHA: "" } }).status, 1);
    assert.equal(spawnSync(process.execPath, [script], { env: { ...env, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "missing" } }).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
