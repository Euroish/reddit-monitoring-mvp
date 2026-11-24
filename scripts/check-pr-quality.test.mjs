import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkPullRequestBlockers, checkPullRequestQuality, REQUIRED_SECTIONS } from "./check-pr-quality.mjs";

// Repository files are checked out with CRLF on Windows and LF on CI runners.
const readNormalized = url => readFileSync(url, "utf8").replace(/\r\n/g, "\n");

const body = REQUIRED_SECTIONS.map(title => `## ${title}\n${title === "真实依赖" ? "无" : `${title}：有可核验的行为、路径和验证结果。`}`).join("\n\n");
const pr = (extra = {}) => ({ body, draft: false, labels: [], ...extra });

test("blockers only cover merge-readiness facts, not writing style", () => {
  assert.deepEqual(checkPullRequestBlockers(pr({ number: 7, user: { login: "any-author" } })), []);
  assert.match(checkPullRequestBlockers(pr({ draft: true })).join(), /Draft/);
  for (const labels of [[{ name: "quality:hold" }], ["quality:hold"]]) {
    assert.match(checkPullRequestBlockers(pr({ labels })).join(), /quality:hold/);
  }
  assert.ok(checkPullRequestBlockers(undefined).length);
  // Missing or malformed evidence is not a blocker; it is a request for information.
  assert.deepEqual(checkPullRequestBlockers(pr({ body: "" })), []);
  assert.deepEqual(checkPullRequestBlockers(pr({ body: null })), []);
});

test("admission accepts independent PRs regardless of number, age, author or other PRs", () => {
  for (const number of [1, 32, 500]) {
    assert.deepEqual(checkPullRequestQuality(pr({ number, created_at: "2020-01-01", user: { login: "any-author" } }), []), []);
  }
  assert.deepEqual(checkPullRequestQuality(pr({ body: body.replace("\n无\n", "\n#99：需要其公开契约，否则调用无法编译。\n") }), []), []);
});

test("missing body, missing sections and duplicates are reported as evidence gaps", () => {
  assert.ok(checkPullRequestQuality(undefined, []).length);
  assert.ok(checkPullRequestQuality(pr({ body: null }), []).length);
  assert.equal(checkPullRequestQuality(pr({ body: "" }), []).length, REQUIRED_SECTIONS.length);
  assert.equal(checkPullRequestQuality(pr({ body: body + "\n## 价值与验收\n重复说明" }), []).length, 1);
});

test("unchanged template, comments, fenced headings and placeholders cannot supply evidence", () => {
  const template = readNormalized(new URL("../.github/pull_request_template.md", import.meta.url));
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

test("blocking gate keeps drafts and maintainer holds out, metadata edits use a separate advisory run", () => {
  const verify = readNormalized(new URL("../.github/workflows/verify.yml", import.meta.url));
  const admission = readNormalized(new URL("../.github/workflows/pr-admission.yml", import.meta.url));

  const verifyEvents = verify.match(/types: \[([^\]]+)\]/)[1].split(",").map(value => value.trim());
  assert.deepEqual(verifyEvents, ["opened", "synchronize", "reopened", "ready_for_review", "labeled", "unlabeled"]);
  const policy = verify.split("  policy:")[1].split("\n  project:")[0];
  assert.match(policy, /run: node --test scripts\/check-pr-quality\.test\.mjs/);
  assert.match(policy, /run: node scripts\/check-pr-quality\.mjs --blockers/);
  // Evidence review must not gate the required CI job.
  assert.ok(!policy.includes("run: node scripts/check-pr-quality.mjs\n"));

  const admissionEvents = admission.match(/types: \[([^\]]+)\]/)[1].split(",").map(value => value.trim());
  for (const event of ["opened", "edited", "reopened", "ready_for_review", "converted_to_draft"]) {
    assert.ok(admissionEvents.includes(event), event);
  }
  assert.match(admission, /run: node scripts\/check-pr-quality\.mjs\b(?! --blockers)/);
  assert.match(admission, /continue-on-error: true/);
  assert.ok(!admission.includes("npm ci"), "advisory run must not install dependencies");
  assert.ok(!admission.includes("pull_request_target"));

  assert.match(verify, /needs: \[policy, project, workflow, docker\]/);
  assert.match(verify, /permissions:\n  contents: read/);
  assert.ok(!verify.includes("pull_request_target"));
});

test("complexity ratchet reports regressions without blocking the required job", () => {
  const verify = readNormalized(new URL("../.github/workflows/verify.yml", import.meta.url));
  const step = verify.split("- name: Prevent production complexity regressions")[1].split("- name:")[0];
  assert.match(step, /continue-on-error: true/);
});

test("CLI blocks on holds, never blocks on evidence, and skips non-PR events", () => {
  const directory = mkdtempSync(join(tmpdir(), "pr-admission-"));
  try {
    const event = join(directory, "event.json");
    const script = fileURLToPath(new URL("./check-pr-quality.mjs", import.meta.url));
    const env = { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event,
      MIGRATION_BASE_SHA: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };

    writeFileSync(event, JSON.stringify({ pull_request: pr({ labels: [{ name: "quality:hold" }] }) }));
    const held = spawnSync(process.execPath, [script, "--blockers"], { env, encoding: "utf8" });
    assert.equal(held.status, 1);
    assert.match(held.stderr, /quality:hold/);

    writeFileSync(event, JSON.stringify({ pull_request: pr({ draft: true }) }));
    assert.equal(spawnSync(process.execPath, [script, "--blockers"], { env }).status, 1);

    writeFileSync(event, JSON.stringify({ pull_request: pr() }));
    assert.equal(spawnSync(process.execPath, [script, "--blockers"], { env }).status, 0);

    // Advisory mode: shell metacharacters in the body are data, and gaps never fail the run.
    writeFileSync(event, JSON.stringify({ pull_request: pr({ body: "$(exit 99)\n## 价值与验收\nTODO" }) }));
    const advisory = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
    assert.equal(advisory.status, 0);
    assert.match(advisory.stdout, /缺口/);
    assert.equal(spawnSync(process.execPath, [script], { env: { ...env, MIGRATION_BASE_SHA: "" } }).status, 0);
    assert.equal(spawnSync(process.execPath, [script], { env: { ...env, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "missing" } }).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
