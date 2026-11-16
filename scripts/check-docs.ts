import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// This list is the agreed documentation structure, not an implementation inventory.
const documents = [
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/architecture.md",
  "docs/contracts.md",
  "docs/design.md",
  "docs/development.md",
  "docs/status.md",
  "docs/history/development-log.md",
  "docs/history/handoff.md",
  "docs/research/data-sources.md",
  "docs/research/source_replacement_and_twitterapi_io_removal_spec.md",
  "docs/research/architecture_audit_and_rebuild_spec.md",
  "docs/plans/source-expansion.md",
];
const documentationEntries = new Set(documents);
const root = path.resolve(__dirname, "..");
const files = new Set(
  execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter((file) => file && existsSync(path.join(root, file))),
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
    const slug = heading.toLowerCase()
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let anchor = slug;
    for (let suffix = 1; anchors.has(anchor); suffix++) anchor = `${slug}-${suffix}`;
    anchors.add(anchor);
  }
  return anchors;
}

for (const file of files) {
  if (/\.(md|mdc|markdown)$/i.test(file) && !documents.includes(file)) {
    errors.push(`Unexpected documentation: ${file}. Update an existing document instead.`);
  }
  if (/^(skills|prompts|context|obsidian-reddit专用|awesome-design-md-main)\//.test(file)
      || file === "00_START_HERE.md" || file === ".codex") {
    errors.push(`Obsolete agent/reference material: ${file}`);
  }
}

function checkDocumentationDirectory(directory: string): void {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory() && [...documentationEntries].some((document) => document.startsWith(`${relative}/`))) {
      checkDocumentationDirectory(relative);
    } else if (!entry.isFile() || !documentationEntries.has(relative)) {
      errors.push(`Unexpected docs entry: ${relative}. Reports belong in output/.`);
    }
  }
}
checkDocumentationDirectory("docs");
for (const document of documents) {
  const fullPath = path.join(root, document);
  if (!existsSync(fullPath)) {
    errors.push(`Missing document: ${document}`);
    continue;
  }
  const content = readFileSync(fullPath, "utf8");
  if (document === "README.md" && content.trimEnd().split("\n").length > 60) {
    errors.push("Root README must stay within 60 lines; put details in docs/.");
  }
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [link, fragment] = target.split("#").map(decodeURIComponent);
    const resolved = link ? path.resolve(path.dirname(fullPath), link) : fullPath;
    const relative = path.relative(root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative) || !existsSync(resolved)) {
      errors.push(`Invalid repository link in ${document}: ${target}`);
    } else if (fragment && /\.md$/i.test(resolved)
        && !headingAnchors(readFileSync(resolved, "utf8")).has(fragment)) {
      errors.push(`Invalid Markdown anchor in ${document}: ${target}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed: ${documents.length} documents, local links/anchors and README size valid.`);
}
