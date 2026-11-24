import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const gitFiles = (...args: string[]) =>
  execFileSync("git", ["ls-files", ...args, "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
const files = new Set(
  gitFiles("-co", "--exclude-standard").filter((file) => existsSync(path.join(root, file))),
);
const errors: string[] = [];

function stripFencedCodeBlocks(content: string): string {
  const kept: string[] = [];
  let fence = "";
  for (const line of content.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (fence === marker[0]) fence = "";
      kept.push("");
      continue;
    }
    kept.push(fence ? "" : line);
  }
  return kept.join("\n");
}

function headingAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  let fence = "";
  for (const line of content.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (fence === marker[0]) fence = "";
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/)?.[1];
    if (!heading) continue;
    const slug = heading
      .toLowerCase()
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let anchor = slug;
    for (let suffix = 1; anchors.has(anchor); suffix++) anchor = `${slug}-${suffix}`;
    anchors.add(anchor);
  }
  return anchors;
}

function checkMigrations(): void {
  const schemaDir = path.join(root, "src/storage/schema");
  const schemaFiles = existsSync(schemaDir) ? readdirSync(schemaDir) : [];
  const seenPost040 = new Map<string, string>();
  for (const entry of schemaFiles) {
    const m = entry.match(/^(\d{3})_[a-z0-9_]+\.sql$/);
    if (!m) continue;
    const num = Number(m[1]);
    if (num >= 41) {
      const prev = seenPost040.get(m[1]);
      if (prev) errors.push(`Duplicate forward migration prefix ${m[1]}: ${prev}, ${entry}`);
      seenPost040.set(m[1], entry);
    }
  }
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    git("rev-parse", "--verify", "HEAD");
  } catch {
    return; // Test fixtures without a commit have no applied schema baseline.
  }
  const requestedBase = process.env.MIGRATION_BASE_SHA;
  let base: string;
  try {
    base = requestedBase
      ? git("rev-parse", "--verify", `${requestedBase}^{commit}`)
      : git("merge-base", "HEAD", "origin/main");
  } catch {
    if (requestedBase) {
      errors.push("Cannot resolve the pull request migration baseline.");
      return;
    }
    base = "HEAD";
  }
  const schemaPath = "src/storage/schema";
  const baseline = git("ls-tree", "-r", "--name-only", base, "--", schemaPath)
    .split("\n")
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(path.basename(file)));
  const baselineNames = new Set(baseline.map((file) => path.basename(file)));
  const latestApplied = Math.max(
    50,
    ...baseline.map((file) => Number(path.basename(file).slice(0, 3))),
  );
  const changed = git("diff", "--name-only", "--no-renames", base, "--", schemaPath)
    .split("\n")
    .filter((file) => baselineNames.has(path.basename(file)));
  for (const file of changed) {
    errors.push(`Applied migration ${file} must not be modified, moved, or removed.`);
  }
  for (const file of schemaFiles) {
    if (
      /^\d{3}_[a-z0-9_]+\.sql$/.test(file) &&
      !baselineNames.has(file) &&
      Number(file.slice(0, 3)) <= latestApplied
    ) {
      errors.push(
        `New migration ${file} must use a number after ${String(latestApplied).padStart(3, "0")}.`,
      );
    }
  }
}

// Guard against private secrets or env files tracked in Git.
for (const file of gitFiles()) {
  if (
    /(?:^|\/)\.env(?:$|\.)|(?:^|\/)[^/]+\.env$|(?:^|\/)credentials\.json$|\.(key|pem)$/.test(file) &&
    !file.endsWith(".example")
  ) {
    errors.push(`Private configuration tracked by Git: ${file}`);
  }
}

// Verify Markdown links and anchors across root docs and docs/**/*.md (allowing diagrams/assets in docs/).
const markdownTargets = new Set<string>();
for (const file of files) {
  if (file === "README.md" || file === "AGENTS.md" || (file.startsWith("docs/") && /\.(md|mdc|markdown)$/i.test(file))) {
    markdownTargets.add(file);
  }
}

for (const document of markdownTargets) {
  const fullPath = path.join(root, document);
  if (!existsSync(fullPath) || lstatSync(fullPath).isSymbolicLink()) continue;
  const content = stripFencedCodeBlocks(readFileSync(fullPath, "utf8"));
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|sandbox:)/.test(target)) continue;
    const [link, fragment] = target.split("#").map(decodeURIComponent);
    const resolved = link ? path.resolve(path.dirname(fullPath), link) : fullPath;
    const relative = path.relative(root, resolved);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !existsSync(resolved)
    ) {
      errors.push(`Invalid repository link in ${document}: ${target}`);
    } else if (
      fragment &&
      /\.md$/i.test(resolved) &&
      !headingAnchors(readFileSync(resolved, "utf8")).has(fragment)
    ) {
      errors.push(`Invalid Markdown anchor in ${document}: ${target}`);
    }
  }
}

// Guard against accidentally committed focused tests that silently skip the rest of a suite.
for (const file of files) {
  if (!/^tests\/.+\.(?:[cm]?[jt]sx?)$/.test(file)) continue;
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath) || lstatSync(fullPath).isSymbolicLink()) continue;
  if (/\b(?:test|describe|it)\.only\s*\(/.test(readFileSync(fullPath, "utf8"))) {
    errors.push(`Focused test (.only) must not be committed: ${file}`);
  }
}

// Enforce immutable applied SQL migrations and forward-only numbering.
checkMigrations();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Policy check passed: ${markdownTargets.size} Markdown files checked; links, private paths, and migrations valid.`,
  );
}
