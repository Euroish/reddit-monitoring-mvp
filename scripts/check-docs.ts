import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const blueprintRoot = "docs/plans/frontend-blueprint-20261108/";
// Explicit design deliverables, not a blanket exception for generated reports.
const blueprintArchive = "docs/plans/frontend-blueprint-20261108.zip";
const blueprintFiles = [
  "README.md", "INTERFACES.md", "DESIGN.md", "ACCEPTANCE.md", "index.html",
  "build.py", "build_catalog.py", "verify.cjs", "package-manifest.json", "data/catalog.json",
  "diagrams/index.html", "diagrams/system.html", "diagrams/system.architecture.json",
  "diagrams/search-freeze.svg", "diagrams/collection-merge.svg", "diagrams/access-control.svg", "diagrams/job-lifecycle.svg",
  "prototype/index.html", "prototype/app.js", "prototype/fixtures.js", "prototype/mock-api.js",
  "prototype/research-pages.js", "prototype/operations-pages.js", "prototype/styles.css", "prototype/pages.css",
  ...Array.from({ length: 39 }, (_, index) => `diagrams/features/F${String(index + 1).padStart(2, "0")}.svg`),
].map((file) => blueprintRoot + file);
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
  ...blueprintFiles.filter((file) => file.endsWith(".md")),
];
const documentationEntries = new Set([...documents, ...blueprintFiles, blueprintArchive]);
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
    if (entry.isDirectory() && [...documentationEntries].some((document) => document.startsWith(`${relative}/`))) {
      checkDocumentationDirectory(relative);
    } else if (!entry.isFile() || !documentationEntries.has(relative)) {
      errors.push(`Unexpected docs entry: ${relative}. Reports belong in output/.`);
    }
  }
}
checkDocumentationDirectory("docs");
for (const asset of blueprintFiles) {
  if (!existsSync(path.join(root, asset))) errors.push(`Missing design deliverable: ${asset}`);
}

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
