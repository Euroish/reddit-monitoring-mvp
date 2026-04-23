import { execFileSync } from "node:child_process";
import {
  classifyValidationScope,
  type ValidationScopeResult,
} from "../src/shared/validation-scope";

interface CliArgs {
  milestone: boolean;
  json: boolean;
  files: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const files: string[] = [];
  let milestone = false;
  let json = false;

  for (const arg of argv) {
    if (arg === "--milestone") {
      milestone = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    files.push(arg);
  }

  return {
    milestone,
    json,
    files,
  };
}

function resolveFiles(files: string[]): string[] {
  if (files.length > 0) {
    return files;
  }

  const raw = execFileSync("git", ["diff", "--name-only", "--relative", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function printHumanReadable(result: ValidationScopeResult, files: string[]): void {
  // eslint-disable-next-line no-console
  console.log(`classification: ${result.classification}`);
  if (files.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`files: ${files.join(", ")}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `categories: ${result.categories.length > 0 ? result.categories.join(", ") : "none"}`,
  );
  for (const reason of result.reasons) {
    // eslint-disable-next-line no-console
    console.log(`reason: ${reason}`);
  }
  for (const command of result.repoCommands) {
    // eslint-disable-next-line no-console
    console.log(`repo: ${command}`);
  }
  for (const command of result.hostCommands) {
    // eslint-disable-next-line no-console
    console.log(`host: ${command}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const files = resolveFiles(args.files);
  const result = classifyValidationScope({
    files,
    milestone: args.milestone,
  });

  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        files,
        ...result,
      }),
    );
    return;
  }

  printHumanReadable(result, files);
}

if (require.main === module) {
  main();
}
