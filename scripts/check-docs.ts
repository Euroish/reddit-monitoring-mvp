import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DOCUMENTATION_FILES } from "./release-package-lib.mjs";

const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const gitFiles = (...args: string[]) => execFileSync("git", ["ls-files", ...args, "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const files = new Set(gitFiles("-co", "--exclude-standard").filter(file => existsSync(path.join(root, file))));
const errors: string[] = [];
const rules = new Map<string, string>();
const moduleFiles: Record<string, string[]> = {
  access: ["routes.ts", "sql.ts"],
  collection: ["routes.ts", "sql.ts", "worker.ts"],
  content: ["routes.ts", "sql.ts", "search.ts"],
  projects: ["routes.ts", "sql.ts"],
  workspace: ["routes.ts", "sql.ts"],
};

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
    const slug = heading.toLowerCase().replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "").replace(/\s/g, "-");
    let anchor = slug;
    for (let suffix = 1; anchors.has(anchor); suffix++) anchor = `${slug}-${suffix}`;
    anchors.add(anchor);
  }
  return anchors;
}

for (const file of files) {
  if (/\.(md|mdc|markdown)$/i.test(file) && !DOCUMENTATION_FILES.includes(file)) errors.push(`Unexpected documentation: ${file}. Update an existing document.`);
  if (/^(skills|prompts|context|obsidian-reddit专用|awesome-design-md-main)\//.test(file) || file === "00_START_HERE.md" || file === ".codex") errors.push(`Obsolete agent/reference material: ${file}`);
}
for (const file of gitFiles()) {
  if (/(?:^|\/)\.env(?:$|\.)|(?:^|\/)[^/]+\.env$|(?:^|\/)credentials\.json$|\.(key|pem)$/.test(file) && !file.endsWith(".example")) errors.push(`Private configuration tracked by Git: ${file}`);
}

function checkDocumentationDirectory(directory: string): void {
  if (!existsSync(path.join(root, directory))) return;
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory() && DOCUMENTATION_FILES.some(file => file.startsWith(`${relative}/`))) checkDocumentationDirectory(relative);
    else if (!entry.isFile() || !DOCUMENTATION_FILES.includes(relative)) errors.push(`Unexpected docs entry: ${relative}. Reports belong in output/.`);
  }
}
checkDocumentationDirectory("docs");
for (const document of DOCUMENTATION_FILES) {
  const fullPath = path.join(root, document);
  if (!existsSync(fullPath) || lstatSync(fullPath).isSymbolicLink()) {
    errors.push(`Missing or linked document: ${document}`);
    continue;
  }
  const content = readFileSync(fullPath, "utf8");
  if (document === "README.md" && content.trimEnd().split("\n").length > 60) errors.push("Root README must stay within 60 lines.");
  for (const row of content.matchAll(/^\| ([A-Z]+-\d{2,3}) \|([^\n]*)/gm)) {
    if (!/^ (MUST NOT|MUST|SHOULD|MAY) \|/.test(row[2])) errors.push(`Rule ${row[1]} needs a normative keyword: ${document}`);
    if (rules.has(row[1])) errors.push(`Duplicate rule ${row[1]}: ${rules.get(row[1])}, ${document}`);
    rules.set(row[1], document);
  }
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [link, fragment] = target.split("#").map(decodeURIComponent);
    const resolved = link ? path.resolve(path.dirname(fullPath), link) : fullPath;
    const relative = path.relative(root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !existsSync(resolved)) errors.push(`Invalid repository link in ${document}: ${target}`);
    else if (fragment && /\.md$/i.test(resolved) && !headingAnchors(readFileSync(resolved, "utf8")).has(fragment)) errors.push(`Invalid Markdown anchor in ${document}: ${target}`);
  }
}

for (const file of files) {
  if (!file.startsWith("src/modules/")) continue;
  const [, , module, filename, ...extra] = file.split("/");
  if (extra.length || !moduleFiles[module]?.includes(filename)) {
    errors.push(`Unregistered module file: ${file}. Keep the five-module layout; register a concrete responsibility before adding a file.`);
    continue;
  }
  const fullPath = path.join(root, file);
  if (lstatSync(fullPath).isSymbolicLink()) { errors.push(`Linked module file: ${file}`); continue; }
  const code = readFileSync(fullPath, "utf8"), source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const comments = new Map<number, ts.CommentRange>();
  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node) && /Repository$/.test(node.name.text)) errors.push(`Wrapper class/repository in functional module: ${file}`);
    let specifier: ts.Node | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteralLike(specifier) && /(?:^|\/)(?:application\/services|domain\/repositories|storage\/repositories|runtime)(?:\/|$)/.test(specifier.text)) errors.push(`Legacy dependency in new module: ${file}`);
    for (const range of [...ts.getLeadingCommentRanges(code, node.pos) ?? [], ...ts.getTrailingCommentRanges(code, node.end) ?? []]) comments.set(range.pos, range);
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const range of comments.values()) if (range.end - range.pos > 300) errors.push(`Oversized module comment: ${file}:${source.getLineAndCharacterOfPosition(range.pos).line + 1}. Keep only the necessary reason (300 characters maximum).`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`Policy check passed: ${DOCUMENTATION_FILES.length} documents, ${rules.size} unique rules; links, private paths and module boundaries valid.`);
