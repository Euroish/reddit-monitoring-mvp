import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";

const linter = new Linter();
export const MAX_COMPLEXITY = 25;

export function complexityViolations(code, filename) {
  const messages = linter.verify(code, [{
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { noInlineConfig: true },
    rules: { complexity: ["error", MAX_COMPLEXITY] },
  }], { filename, allowInlineConfig: false });
  const errors = messages.filter(message => message.fatal);
  if (errors.length) throw new Error(`${filename}: ${errors.map(message => message.message).join("; ")}`);
  return messages.filter(message => message.ruleId === "complexity").map(message => {
    const match = message.message.match(/^(.*) has a complexity of (\d+)\./);
    if (!match) throw new Error(`Unexpected ESLint complexity diagnostic: ${message.message}`);
    return { name: match[1], complexity: Number(match[2]), line: message.line };
  });
}

export function complexityRegressions(before, after) {
  const allowances = new Map();
  for (const item of before) {
    const values = allowances.get(item.name) ?? [];
    values.push(item.complexity);
    allowances.set(item.name, values);
  }
  for (const values of allowances.values()) values.sort((a, b) => b - a);
  const regressions = [];
  // Same diagnostic identity can represent several anonymous callbacks. Compare
  // the sorted multiset, not line numbers, so moving code cannot grow the budget.
  for (const item of [...after].sort((a, b) => b.complexity - a.complexity)) {
    const limit = allowances.get(item.name)?.shift() ?? MAX_COMPLEXITY;
    if (item.complexity > limit) regressions.push({ ...item, limit });
  }
  return regressions;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}

function main() {
  const base = process.env.MIGRATION_BASE_SHA || process.argv[2] || git("merge-base", "HEAD", "origin/main").trim();
  if (!/^[a-f0-9]{40}$/i.test(base)) throw new Error("Complexity check requires a commit SHA");
  git("rev-parse", "--verify", `${base}^{commit}`);
  const files = git("diff", "--name-only", "--no-renames", "--diff-filter=ACM", "-z", base, "HEAD", "--",
    "src/", "apps/api/src/", "apps/web/src/", "packages/contracts/src/")
    .split("\0").filter(file => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"));
  let failed = false;
  for (const file of files) {
    const after = complexityViolations(git("show", `HEAD:${file}`), file);
    const existed = git("ls-tree", "--name-only", base, "--", file).trim().length > 0;
    const before = existed ? complexityViolations(git("show", `${base}:${file}`), file) : [];
    for (const item of complexityRegressions(before, after)) {
      console.error(`${file}:${item.line}: ${item.name}: complexity ${item.complexity} exceeds ${item.limit}`);
      failed = true;
    }
    if (before.length || after.length) console.log(`${file}: over-${MAX_COMPLEXITY} functions ${before.length} -> ${after.length}`);
  }
  console.log(`Complexity ratchet checked ${files.length} changed production files; no inline exemptions. Design review remains required.`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
