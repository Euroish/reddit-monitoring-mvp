import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REQUIRED_SECTIONS = ["价值与验收", "真实依赖", "设计与复杂度", "验证证据", "风险与回退"];

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

export function checkPullRequestQuality(pr, files) {
  const errors = [];
  if (!pr || typeof pr.body !== "string") return ["PR 描述缺失；请使用仓库 PR 模板。"];
  if (pr.draft) errors.push("Draft 尚未就绪，不可合入；补齐证据并完成自查后再 Ready for review。");
  const held = pr.labels?.some(label => (typeof label === "string" ? label : label.name) === "quality:hold");
  if (held) errors.push("quality:hold 尚未解除；请解决阻断项并由维护者确认，不得自行移除以绕过审查。");
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

function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    console.log("PR admission: not a pull_request event; skipped.");
    return;
  }
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const base = process.env.MIGRATION_BASE_SHA;
  if (!/^[a-f0-9]{40}$/i.test(base ?? "")) throw new Error("PR admission requires a validated base SHA");
  const files = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, "HEAD"], {
    encoding: "utf8", maxBuffer: 20 * 1024 * 1024,
  }).split("\0").filter(Boolean);
  const errors = checkPullRequestQuality(payload.pull_request, files);
  if (errors.length) {
    for (const error of errors) console.error(`PR admission: ${error}`);
    process.exitCode = 1;
  } else {
    console.log("PR admission evidence present; this is NOT a design approval or a merge authorization.");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
