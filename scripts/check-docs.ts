import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DOCUMENTATION_FILES } from "./release-package-lib.mjs";

const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const gitFiles = (...args: string[]) =>
  execFileSync("git", ["ls-files", ...args, "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const files = new Set(gitFiles("-co", "--exclude-standard").filter(file => existsSync(path.join(root, file))));
const errors: string[] = [];
const rules = new Map<string, string>();
const ALLOWED_MODULES = new Set(["access", "collection", "content", "projects", "workspace"]);
const LEGACY_IMPORT_RE = /(?:^|\/)(?:application\/services|domain\/repositories|storage\/repositories|runtime)(?:\/|$)/;
const MAX_MODULE_LINES = 450;
const MAX_CODE_LINE_CHARS = 220;

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

function collectCommentOrTemplateLines(source: ts.SourceFile, code: string): Set<number> {
  const exemptLines = new Set<number>();
  const markRange = (startPos: number, endPos: number) => {
    const startLine = source.getLineAndCharacterOfPosition(startPos).line;
    const endLine = source.getLineAndCharacterOfPosition(Math.max(startPos, endPos - 1)).line;
    for (let ln = startLine; ln <= endLine; ln++) exemptLines.add(ln);
  };
  const visitRange = (node: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) markRange(node.getStart(source), node.end);
    for (const r of ts.getLeadingCommentRanges(code, node.pos) ?? []) markRange(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(code, node.end) ?? []) markRange(r.pos, r.end);
    ts.forEachChild(node, visitRange);
  };
  visitRange(source);
  return exemptLines;
}

function checkTypeScriptBoundary(file: string, enforceNoClasses: boolean): void {
  const fullPath = path.join(root, file);
  if (lstatSync(fullPath).isSymbolicLink()) { errors.push(`Linked module file: ${file}`); return; }
  const code = readFileSync(fullPath, "utf8");
  const lines = code.split(/\r?\n/);
  if (enforceNoClasses && lines.length > MAX_MODULE_LINES) {
    errors.push(`Oversized module file (${lines.length} lines > ${MAX_MODULE_LINES}): ${file}. Split cleanly inside the module.`);
  }
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const exemptLines = collectCommentOrTemplateLines(source, code);
  for (let i = 0; i < lines.length; i++) {
    if (!exemptLines.has(i) && lines[i].length > MAX_CODE_LINE_CHARS) {
      errors.push(`Code line exceeds ${MAX_CODE_LINE_CHARS} chars (${lines[i].length}): ${file}:${i + 1}. Avoid code-golfing.`);
    }
  }
  function visit(node: ts.Node): void {
    if (enforceNoClasses && (ts.isClassDeclaration(node) || ts.isClassExpression(node) || (ts.isInterfaceDeclaration(node) && /Repository$/.test(node.name.text)))) {
      errors.push(`Wrapper class/repository in functional module: ${file}`);
    }
    let specifier: ts.Node | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteralLike(specifier) && LEGACY_IMPORT_RE.test(specifier.text)) {
      errors.push(`Legacy dependency in new module: ${file}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function checkMigrations(): void {
  const schemaDir = path.join(root, "src/storage/schema");
  if (!existsSync(schemaDir)) return;
  const seenPost040 = new Map<string, string>();
  for (const entry of readdirSync(schemaDir)) {
    const m = entry.match(/^(\d{3})_[a-z0-9_]+\.sql$/);
    if (!m) continue;
    const num = Number(m[1]);
    if (num >= 41) {
      const prev = seenPost040.get(m[1]);
      if (prev) errors.push(`Duplicate forward migration prefix ${m[1]}: ${prev}, ${entry}`);
      seenPost040.set(m[1], entry);
    }
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, stdio: "ignore" });
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src/storage/schema"], { cwd: root, encoding: "utf8" })
      .split(/\r?\n/).filter(Boolean);
    for (const rel of changed) {
      const num = Number(path.basename(rel).match(/^(\d{3})_/)?.[1] ?? "999");
      if (num <= 50) errors.push(`Applied migration ${rel} (<= 050) must not be modified; add a 051+ forward migration.`);
    }
  } catch { /* Temp test fixtures without HEAD skip git diff guard. */ }
}

for (const file of files) {
  if (/^(?:src\/(?:application|domain|runtime|jobs|workers|storage\/repositories)\/|workers\/)/.test(file)) errors.push(`Retired architecture path: ${file}`);
  if (/^src\/connectors\/(?:reddit\/arctic-shift|x\/twitterapi-io)/.test(file)) errors.push(`Retired online connector: ${file}`);
  if (/^(skills|prompts|context|obsidian-reddit专用|awesome-design-md-main)\//.test(file) || file === "00_START_HERE.md" || file === ".codex") {
    errors.push(`Obsolete agent/reference material: ${file}`);
  }
}
for (const file of gitFiles()) {
  if (/(?:^|\/)\.env(?:$|\.)|(?:^|\/)[^/]+\.env$|(?:^|\/)credentials\.json$|\.(key|pem)$/.test(file) && !file.endsWith(".example")) {
    errors.push(`Private configuration tracked by Git: ${file}`);
  }
}

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

for (const document of DOCUMENTATION_FILES) {
  const fullPath = path.join(root, document);
  if (!existsSync(fullPath) || lstatSync(fullPath).isSymbolicLink()) {
    errors.push(`Missing or linked document: ${document}`);
    continue;
  }
  const content = readFileSync(fullPath, "utf8");
  if (document === "README.md" && content.trimEnd().split("\n").length > 60) errors.push("Root README must stay within 60 lines.");
  if (document === "AGENTS.md") {
    if (!content.includes("docs/development.md") || !content.includes("docs/status.md")) {
      errors.push("AGENTS.md must point explicitly to the two canonical record files: docs/development.md and docs/status.md.");
    }
  }
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
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !existsSync(resolved)) {
      errors.push(`Invalid repository link in ${document}: ${target}`);
    } else if (fragment && /\.md$/i.test(resolved) && !headingAnchors(readFileSync(resolved, "utf8")).has(fragment)) {
      errors.push(`Invalid Markdown anchor in ${document}: ${target}`);
    }
  }
}

const legacyServerPresent = existsSync(path.join(root, "apps/api/src/create-api-server.ts"));
for (const file of files) {
  if (file.startsWith("src/modules/") && file.endsWith(".ts")) {
    const [, , moduleName, filename, ...extra] = file.split("/");
    if (extra.length || !ALLOWED_MODULES.has(moduleName) || !/^[a-z0-9-]+\.ts$/.test(filename)) {
      errors.push(`Unregistered module file: ${file}. Keep files flat inside the five domain modules.`);
      continue;
    }
    checkTypeScriptBoundary(file, true);
  } else if (!legacyServerPresent && file.startsWith("apps/api/src/") && file.endsWith(".ts")) {
    checkTypeScriptBoundary(file, false);
  }
}

checkMigrations();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Policy check passed: ${DOCUMENTATION_FILES.length} release documents, ${rules.size} unique rules; links, private paths and module boundaries valid.`);
}
