import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// This list is the agreed documentation structure, not an implementation inventory.
const documents = [
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/architecture.md",
  "docs/development.md",
  "docs/status.md",
  "docs/history/development-log.md",
  "docs/history/handoff.md",
  "docs/research/data-sources.md",
  "docs/plans/source-expansion.md",
];
const root = path.resolve(__dirname, "..");
const files = new Set(
  execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter((file) => file && existsSync(path.join(root, file))),
);
const errors: string[] = [];

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
    if (entry.isDirectory() && documents.some((document) => document.startsWith(`${relative}/`))) {
      checkDocumentationDirectory(relative);
    } else if (!entry.isFile() || !documents.includes(relative)) {
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
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const link = decodeURIComponent(target.split("#")[0]);
    const resolved = path.resolve(path.dirname(fullPath), link);
    const relative = path.relative(root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative) || !existsSync(resolved)) {
      errors.push(`Invalid repository link in ${document}: ${target}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed: ${documents.length} documents, all local links resolve.`);
}
