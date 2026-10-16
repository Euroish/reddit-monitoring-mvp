import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { validateRuntimeEnvironment } from "../src/runtime/environment-config";

export async function testFiles(directory = path.join(process.cwd(), "tests")): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await testFiles(filename));
    else if (entry.name.endsWith(".test.ts")) result.push(filename);
  }
  return result.sort();
}

export function postgresTestUrl(env: NodeJS.ProcessEnv): string {
  if (!env.TEST_SOURCE_DATABASE_URL) throw new Error("TEST_SOURCE_DATABASE_URL is required for native SQL acceptance; no tests were run or counted as passing");
  try {
    const url = new URL(env.TEST_SOURCE_DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) || !/^\/source_validation_[a-z0-9_]+$/.test(url.pathname)) throw new Error();
  } catch { throw new Error("TEST_SOURCE_DATABASE_URL must name a dedicated loopback source_validation_* PostgreSQL database"); }
  return env.TEST_SOURCE_DATABASE_URL;
}

async function main() {
  const scope = process.argv[2];
  if (scope !== "offline" && scope !== "postgres") throw new Error("Expected run-ci-tests.ts offline or postgres");
  if (scope === "postgres") postgresTestUrl(process.env);
  const files = (await testFiles()).filter(file => file.endsWith("-postgres.test.ts") === (scope === "postgres"));
  if (!files.length) throw new Error(`No ${scope} test files discovered`);
  const env: NodeJS.ProcessEnv = { ...process.env, LOCAL_ENV_FILE: "none", SOURCE_RUN_MODE: "demo", SOURCE_NETWORK_ENABLED: "false", REDDIT_RUN_MODE: "mock", TWITTERAPI_IO_API_KEY: "" };
  if (scope === "offline") delete env.TEST_SOURCE_DATABASE_URL;
  validateRuntimeEnvironment(env);
  console.log(JSON.stringify({ scope, testFileCount: files.length, realSourceRequestsAllowed: false, sqlTestsExcluded: scope === "offline" }));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", ...files], { env, stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
    let summary = "";
    child.stdout.on("data", chunk => { process.stdout.write(chunk); summary = (summary + chunk.toString()).slice(-16000); });
    child.once("error", reject);
    child.once("exit", code => {
      if (code !== 0) reject(new Error(`${scope} tests failed (exit ${code})`));
      else if (!/# tests [1-9]\d*/.test(summary)) reject(new Error("Test runner did not report an executed test count"));
      else if (!/# skipped 0(?:\r?\n|$)/.test(summary)) reject(new Error(`${scope} acceptance requires zero skipped tests; missing SQL setup cannot produce a green result`));
      else resolve();
    });
  });
}

if (require.main === module) void main().catch(error => { console.error(error instanceof Error ? error.message : "CI test runner failed"); process.exitCode = 1; });
