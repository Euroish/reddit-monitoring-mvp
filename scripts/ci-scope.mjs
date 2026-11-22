import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verificationScope(files, { event, full = false, forceBrowser = false, release = false }) {
  const scope = {
    api: false, web: false, postgres: false, browser: forceBrowser,
    docker: event === "workflow_dispatch", workflow: false, pack: release || event === "workflow_dispatch",
  };
  const areas = new Set();

  for (const file of files) {
    if (/^(README\.md|AGENTS\.md|\.github\/pull_request_template\.md)$|^docs\/|^\.github\/(CODEOWNERS$|ISSUE_TEMPLATE\/)/.test(file)) continue;
    if (/^\.github\/workflows\/|^scripts\/ci-scope\.(mjs|test\.mjs)$/.test(file)) {
      scope.workflow = true;
      areas.add("shared");
    } else if (/^(Dockerfile|\.dockerignore|docker-compose\.yml|scripts\/verify-container-build\.sh)$|^deploy\//.test(file)) {
      scope.docker = true;
    } else if (file.startsWith("tests/browser/")) {
      scope.browser = true;
      scope.api = true; // Root typecheck includes browser test sources.
    } else if (file.startsWith("apps/web/") || file === "scripts/check-web-bundle.mjs") {
      areas.add("web");
    } else if (/^(src|apps\/api|data|tests)\//.test(file) ||
               /^(eslint\.config\.mjs|eslint-suppressions\.json|\.dependency-cruiser\.cjs)$/.test(file)) {
      areas.add("api");
      if (/^apps\/api\/|^src\/(config|platform|shared|storage)\/|^src\/modules\/(access|ai|content|projects|workspace)\/|^data\/|^tests\/helpers\//.test(file)) {
        scope.browser = true;
      }
    } else {
      areas.add("shared"); // Locks, contracts, scripts, and new paths use the conservative default.
    }
    if (/^scripts\/(package-release|release-package-lib|verify-release)\.mjs$|^\.github\/workflows\/release\.yml$/.test(file)) {
      scope.pack = true;
    }
  }

  if (full || areas.has("shared") || (event === "push" && (areas.size || scope.browser || scope.docker))) {
    scope.api = scope.web = scope.postgres = scope.browser = true;
  }
  if (areas.has("api")) scope.api = scope.postgres = true;
  if (areas.has("web")) scope.web = scope.browser = true;
  if (full) scope.workflow = true;
  return { ...scope, project: scope.api || scope.web || scope.postgres || scope.browser || scope.pack };
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
  const scope = verificationScope(files, {
    event, full: !hasBase, release, forceBrowser: pr?.labels.some(({ name }) => name === "run-e2e"),
  });
  const output = JSON.stringify(scope);
  console.log(output);
  appendFileSync(process.env.GITHUB_OUTPUT, `base=${hasBase ? base : ""}\nscope=${output}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
