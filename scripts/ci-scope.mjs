import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verificationScope(files, { event, full = false }) {
  const scope = {
    api: full, web: full, postgres: full, browser: full,
    docker: event === "workflow_dispatch", workflow: full,
  };

  for (const file of files) {
    if (/^(README\.md|AGENTS\.md|scripts\/check-docs\.ts)$|^docs\/|^\.github\/(CODEOWNERS$|pull_request_template\.md$|ISSUE_TEMPLATE\/)/.test(file)) continue;
    if (/^\.github\/workflows\/|^scripts\/ci-scope\.(mjs|test\.mjs)$/.test(file)) {
      scope.workflow = true;
    } else if (/^(Dockerfile|\.dockerignore|docker-compose\.yml|scripts\/verify-container-build\.sh)$|^deploy\//.test(file)) {
      scope.docker = true;
    } else if (file.startsWith("tests/browser/")) {
      scope.api = scope.browser = true;
    } else if (file === "apps/web/eslint.config.js") {
      scope.web = true;
    } else if (file.startsWith("apps/web/") || file === "scripts/check-web-bundle.mjs") {
      scope.web = scope.browser = true;
    } else if (/^tests\/unit\/|^(eslint\.config\.mjs|\.dependency-cruiser\.cjs)$/.test(file)) {
      scope.api = true;
    } else if (/^(src|apps\/api|data|tests)\//.test(file)) {
      scope.api = scope.postgres = true;
    } else {
      // Shared dependencies, contracts and unknown paths need both builds and a PG regression run.
      scope.api = scope.web = scope.postgres = true;
      if (file.startsWith("packages/contracts/")) scope.browser = true;
    }
  }
  return { ...scope, project: scope.api || scope.web || scope.postgres || scope.browser };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const release = process.env.GITHUB_REF?.startsWith("refs/tags/") === true;
  if (release) git("merge-base", "--is-ancestor", "HEAD", "origin/main");
  const pr = event === "pull_request" ? payload.pull_request : undefined;
  const base = pr ? git("rev-parse", "HEAD^1") : event === "push" && !release ? payload.before : "";
  const hasBase = /^[0-9a-f]{40}$/.test(base ?? "") && !/^0+$/.test(base);
  if (hasBase) git("merge-base", "--is-ancestor", base, "HEAD");
  const files = hasBase ? git("diff", "--name-only", "--no-renames", "-z", base, "HEAD").split("\0").filter(Boolean) : [];
  const scope = verificationScope(files, { event, full: !hasBase });
  const output = JSON.stringify(scope);
  console.log(output);
  appendFileSync(process.env.GITHUB_OUTPUT, `base=${hasBase ? base : ""}\nscope=${output}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
