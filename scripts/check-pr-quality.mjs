import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Description format and evidence quality are assessed by reviewers, not this gate.
export function checkPullRequestQuality(pr) {
  const errors = [];
  if (!pr) return ["PR 事件数据缺失。"];
  if (pr.draft) errors.push("Draft 尚未就绪，不可合入；补齐证据并完成自查后再 Ready for review。");
  const held = pr.labels?.some(label => (typeof label === "string" ? label : label.name) === "quality:hold");
  if (held) errors.push("quality:hold 尚未解除；请解决阻断项并由维护者确认，不得自行移除以绕过审查。");
  return errors;
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    console.log("PR admission: not a pull_request event; skipped.");
    return;
  }
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const errors = checkPullRequestQuality(payload.pull_request);
  if (errors.length) {
    for (const error of errors) console.error(`PR admission: ${error}`);
    process.exitCode = 1;
  } else {
    console.log("PR admission: no Draft or quality hold; this is NOT a design approval or a merge authorization.");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
