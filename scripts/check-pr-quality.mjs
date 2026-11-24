import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REQUIRED_SECTIONS = ["价值与验收", "真实依赖", "设计与复杂度", "简化与兼容复核", "验证证据", "风险与回退"];

// Evidence presence is machine-checkable. Its truth and design quality require independent review.
function sectionsFrom(body) {
  const sections = new Map();
  let current;
  let fence;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    const heading = !fence && line.match(/^##\s+(.+?)\s*$/)?.[1];
    if (heading) {
      current = heading;
      const values = sections.get(current) ?? [];
      values.push("");
      sections.set(current, values);
    } else if (current) {
      const values = sections.get(current);
      values[values.length - 1] += line + "\n";
    }
  }
  return sections;
}

// Hard blockers are merge-readiness facts, not writing style: a draft must not enter the queue,
// and a maintainer hold must be cleared by a maintainer. Both are cheap and deterministic.
export function checkPullRequestBlockers(pr) {
  if (!pr || typeof pr !== "object") return ["无法读取 PR 事件；请确认仓库 PR 模板存在。"];
  const errors = [];
  if (pr.draft) errors.push("Draft 尚未就绪，不可合入；补齐证据并完成自查后再 Ready for review。");
  const held = pr.labels?.some(label => (typeof label === "string" ? label : label.name) === "quality:hold");
  if (held) errors.push("quality:hold 尚未解除；请解决阻断项并由维护者确认，不得自行移除以绕过审查。");
  return errors;
}

export function checkPullRequestQuality(pr, files) {
  const errors = [];
  if (!pr || typeof pr.body !== "string") return ["PR 描述缺失；请使用仓库 PR 模板。"];
  const required = [...REQUIRED_SECTIONS];
  if (files.some(file => file.startsWith("apps/web/src/"))) required.push("界面证据");
  const sections = sectionsFrom(pr.body);
  for (const title of required) {
    const values = sections.get(title);
    if (values?.length !== 1) {
      errors.push(`必须且只能填写一次「## ${title}」。`);
      continue;
    }
    const content = values[0].replace(/^\s*[-*>]\s*/gm, "").trim();
    const unsupportedClaim = /^(?:无|none|n\/?a|不适用)[。.!！]?$/i.test(content) && title !== "真实依赖";
    const placeholder = /^(?:TODO\b|TBD\b|待填写|待补充|待验证|请填写|PLACEHOLDER\b)/im.test(content);
    if (!content || unsupportedClaim || placeholder) {
      errors.push(`「${title}」缺少具体证据或不适用原因，不能只留模板占位。`);
    }
  }
  return errors;
}

function changedFiles(base) {
  if (!/^[a-f0-9]{40}$/i.test(base ?? "")) return null;
  return execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, "HEAD"], {
    encoding: "utf8", maxBuffer: 20 * 1024 * 1024,
  }).split("\0").filter(Boolean);
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    console.log("PR admission: not a pull_request event; skipped.");
    return;
  }
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const pr = payload.pull_request;

  // Blocking mode: the small set of facts that genuinely forbid merging.
  if (process.argv.includes("--blockers")) {
    const errors = checkPullRequestBlockers(pr);
    if (errors.length) {
      for (const error of errors) console.error(`PR admission: ${error}`);
      process.exitCode = 1;
    } else {
      console.log("PR admission blockers: none.");
    }
    return;
  }

  // Advisory mode: report evidence gaps, never fail the build. A complete description is still
  // not an approval, and an incomplete one is a request for information, not a code defect.
  const files = changedFiles(process.env.MIGRATION_BASE_SHA);
  if (files === null) console.log("PR advisory: no validated base SHA; 界面证据 is not evaluated.");
  const errors = checkPullRequestQuality(pr, files ?? []);
  const lines = ["## PR 准入证据（提示，不阻断合并）", ""];
  if (errors.length === 0) lines.push("六节证据齐全。填写完整不等于批准，仍需独立审查决定是否接收。");
  else {
    lines.push(`发现 ${errors.length} 处缺口：`, "");
    for (const error of errors) lines.push(`- ${error}`);
  }
  const report = lines.join("\n") + "\n";
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  console.log(report);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
