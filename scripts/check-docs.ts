import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DOCUMENTATION_FILES } from "./release-package-lib.mjs";

const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const gitFiles = (...args: string[]) =>
  execFileSync("git", ["ls-files", ...args, "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
const files = new Set(
  gitFiles("-co", "--exclude-standard").filter((file) => existsSync(path.join(root, file))),
);
const errors: string[] = [];

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

// 1. Guard against retired architecture paths, retired connectors, and obsolete workspace junk.
for (const file of files) {
  if (/^(?:src\/(?:application|domain|runtime|jobs|workers|storage\/repositories)\/|workers\/)/.test(file)) {
    errors.push(`Retired architecture path: ${file}`);
  }
  if (/^src\/connectors\/(?:reddit\/arctic-shift|x\/twitterapi-io)/.test(file)) {
    errors.push(`Retired online connector: ${file}`);
  }
  if (
    /^(skills|prompts|context|obsidian-reddit专用|awesome-design-md-main)\//.test(file) ||
    file === "00_START_HERE.md" ||
    file === ".codex"
  ) {
    errors.push(`Obsolete agent/reference material: ${file}`);
  }
  if ((file.startsWith("src/modules/") || file.startsWith("apps/api/src/")) && file.endsWith(".ts")) {
    const fullPath = path.join(root, file);
    if (lstatSync(fullPath).isSymbolicLink()) {
      errors.push(`Linked module file: ${file}`);
    }
  }
}

// 2. Guard against private secrets or env files tracked in Git.
for (const file of gitFiles()) {
  if (
    /(?:^|\/)\.env(?:$|\.)|(?:^|\/)[^/]+\.env$|(?:^|\/)credentials\.json$|\.(key|pem)$/.test(file) &&
    !file.endsWith(".example")
  ) {
    errors.push(`Private configuration tracked by Git: ${file}`);
  }
}

// 3. Keep docs/ restricted to regular Markdown files (no binary reports/dumps).
function checkDocumentationDirectory(directory: string): void {
  if (!existsSync(path.join(root, directory))) return;
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) checkDocumentationDirectory(relative);
    else if (!entry.isFile() || !/\.(md|mdc|markdown)$/i.test(entry.name)) {
      errors.push(`Unexpected docs entry: ${relative}. Use regular Markdown files under docs/.`);
    }
  }
}
checkDocumentationDirectory("docs");

// 4. Verify release documentation inventory, SSOT pointers, and internal Markdown links/anchors.
const markdownTargets = new Set<string>(DOCUMENTATION_FILES);
for (const file of files) {
  if (file.startsWith("docs/") && /\.(md|mdc|markdown)$/i.test(file)) markdownTargets.add(file);
}

for (const document of DOCUMENTATION_FILES) {
  const fullPath = path.join(root, document);
  if (!existsSync(fullPath) || lstatSync(fullPath).isSymbolicLink()) {
    errors.push(`Missing or linked document: ${document}`);
  }
}

for (const document of markdownTargets) {
  const fullPath = path.join(root, document);
  if (!existsSync(fullPath) || lstatSync(fullPath).isSymbolicLink()) continue;
  const content = readFileSync(fullPath, "utf8");
  if (document === "AGENTS.md") {
    if (!content.includes("docs/development.md") || !content.includes("docs/status.md")) {
      errors.push(
        "AGENTS.md must point explicitly to the two canonical record files: docs/development.md and docs/status.md.",
      );
    }
  }
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

// 5. Enforce immutable applied SQL migrations and forward-only numbering.
checkMigrations();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Policy check passed: ${DOCUMENTATION_FILES.length} release docs (${markdownTargets.size} Markdown files scanned); links, private paths, retired paths, and migrations valid.`,
  );
}
