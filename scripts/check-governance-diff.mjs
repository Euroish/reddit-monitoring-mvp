import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

/**
 * PR Governance & Anti-Weakening Guard.
 *
 * Inspects git diff against base SHA (MIGRATION_BASE_SHA / GITHUB_BASE_SHA) and:
 * 1. Hard-fails if `.only(` is added to any test file.
 * 2. Posts prominent warnings to GITHUB_STEP_SUMMARY if the PR modifies CI/lint/boundary
 *    governance files, introduces `.skip` / `test.todo` / `eslint-disable`, or exceeds
 *    recommended PR size / module blast-radius budgets.
 */

const GOVERNANCE_PATTERNS = [
  /^\.github\/workflows\//,
  /^\.github\/CODEOWNERS$/,
  /^eslint\.config\.mjs$/,
  /^\.dependency-cruiser\.cjs$/,
  /^scripts\/check-[^/]+\.(ts|mjs)$/,
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
}

function main() {
  const baseSha = process.env.MIGRATION_BASE_SHA || process.env.GITHUB_BASE_SHA;
  if (!baseSha) {
    console.log("Governance diff guard skipped (no base SHA in environment).");
    return;
  }

  const changedFiles = git(["diff", "--name-only", `${baseSha}...HEAD`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const govFiles = changedFiles.filter((file) => GOVERNANCE_PATTERNS.some((re) => re.test(file)));

  const touchedModules = new Set(
    changedFiles
      .map((file) => /^src\/modules\/([^/]+)\//.exec(file)?.[1])
      .filter(Boolean),
  );

  const numstat = git(["diff", "--numstat", `${baseSha}...HEAD`])
    .split(/\r?\n/)
    .filter(Boolean);
  let additions = 0;
  let deletions = 0;
  for (const row of numstat) {
    const [a, d] = row.split("\t");
    if (/^\d+$/.test(a)) additions += Number(a);
    if (/^\d+$/.test(d)) deletions += Number(d);
  }

  const testDiff = git(["diff", "--unified=0", `${baseSha}...HEAD`, "--", "tests/"])
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

  const addedOnly = testDiff.filter((line) => /\b(?:test|describe|it)\.only\s*\(/.test(line));
  const addedSkip = testDiff.filter((line) =>
    /\b(?:test|describe|it)\.(?:skip|todo)\s*\(|\{\s*skip\s*:\s*true/.test(line),
  );

  const codeDiff = git([
    "diff",
    "--unified=0",
    `${baseSha}...HEAD`,
    "--",
    "src/",
    "apps/",
    "packages/",
    "scripts/",
  ])
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  const addedLintDisable = codeDiff.filter((line) => /eslint-disable|@ts-ignore|@ts-nocheck/.test(line));

  const lines = [
    "### PR Governance & Blast-Radius Audit",
    "",
    `- **Changed files**: \`${changedFiles.length}\` (+\`${additions}\` / -\`${deletions}\`)`,
    `- **Backend modules touched**: ${touchedModules.size ? [...touchedModules].sort().map((m) => `\`${m}\``).join(", ") : "_none_"}`,
  ];

  const warnings = [];
  if (govFiles.length > 0) {
    warnings.push(
      `⚠️ **Governance / CI gates modified** (${govFiles.map((f) => `\`${f}\``).join(", ")}) — requires explicit owner review.`,
    );
  }
  if (addedSkip.length > 0) {
    warnings.push(
      `⚠️ **Skipped/todo test added** (${addedSkip.length} line(s)) — verify tests were not weakened to make CI green.`,
    );
  }
  if (addedLintDisable.length > 0) {
    warnings.push(
      `⚠️ **Lint/type suppression added** (${addedLintDisable.length} \`eslint-disable\` / \`@ts-ignore\` / \`@ts-nocheck\` line(s)).`,
    );
  }
  if (additions + deletions > 1500) {
    warnings.push(
      `ℹ️ **Large PR advisory**: \`${additions + deletions}\` changed lines exceeds the 1,500-line reviewability target; consider vertical slicing on future PRs.`,
    );
  }
  if (touchedModules.size > 3) {
    warnings.push(
      `ℹ️ **Wide blast radius**: touches \`${touchedModules.size}\` backend modules simultaneously.`,
    );
  }

  if (warnings.length > 0) {
    lines.push("", ...warnings.map((w) => `- ${w}`));
  } else {
    lines.push("- ✅ No governance-gate modifications, skipped tests, or lint suppressions detected.");
  }

  const report = lines.join("\n") + "\n";
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }

  if (addedOnly.length > 0) {
    console.error("ERROR: Found `.only(` in newly added test lines — remove focused test markers before merging:");
    for (const line of addedOnly) console.error(`  ${line}`);
    process.exit(1);
  }
}

main();
