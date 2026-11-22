import { Pool } from "pg";
import { runHistoryBackfill } from "./ai-history-backfill";
import {
  applyHistoryImport,
  planHistoryImport,
  resolveHistoryDatasetDir,
} from "./ai-history-import";
import { validateHistoryDatasetDir } from "./ai-history-schema";

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function createCliPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return new Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
  });
}

export async function runHistoryCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const datasetVersion = getArg(rest, "--dataset") ?? "v1";
  const datasetDir = getArg(rest, "--dir") ?? resolveHistoryDatasetDir(datasetVersion);
  const asJson = hasFlag(rest, "--json");

  if (!command || command === "--help" || command === "-h") {
    console.log("Usage: ai-history-cli <validate|plan|apply|backfill> [options]");
    return 0;
  }

  if (command === "validate") {
    const res = validateHistoryDatasetDir(datasetDir);
    const summary = {
      valid: res.valid,
      datasetDir,
      datasetVersion: res.dataset?.manifest.datasetVersion ?? datasetVersion,
      manifestSha256: res.dataset?.manifestSha256 ?? null,
      entries: res.dataset?.manifest.entries ?? null,
      errors: res.errors,
      warnings: res.warnings,
    };
    if (asJson) console.log(JSON.stringify(summary, null, 2));
    else if (res.valid) console.log(`OK ${summary.datasetVersion} (${summary.manifestSha256?.slice(0, 12)})`);
    else console.error(`INVALID: ${res.errors.join("; ")}`);
    return res.valid ? 0 : 1;
  }

  const pool = createCliPool();
  try {
    if (command === "plan" || (command === "apply" && hasFlag(rest, "--dry-run"))) {
      const report = await planHistoryImport(pool, datasetDir);
      console.log(JSON.stringify(report, null, 2));
      return report.conflicts > 0 ? 2 : 0;
    }

    if (command === "apply") {
      const triggerRaw = getArg(rest, "--trigger") ?? "manual";
      const triggerKind = triggerRaw === "startup" || triggerRaw === "reconcile" ? triggerRaw : "manual";
      const report = await applyHistoryImport(pool, datasetDir, {
        triggerKind,
        reconcile: hasFlag(rest, "--reconcile"),
        sourceCommit: process.env.GIT_COMMIT ?? null,
      });
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }

    if (command === "backfill") {
      const sourceRaw = getArg(rest, "--source") ?? "content_history";
      if (sourceRaw !== "content_history" && sourceRaw !== "official_archive" && sourceRaw !== "epoch_csv") {
        throw new Error(`Invalid --source: ${sourceRaw}`);
      }
      const batchStr = getArg(rest, "--batch");
      const maxStr = getArg(rest, "--max-items");
      const result = await runHistoryBackfill(pool, {
        sourceCode: sourceRaw,
        vendorSlug: getArg(rest, "--vendor"),
        dateFrom: getArg(rest, "--from"),
        dateTo: getArg(rest, "--to"),
        batchSize: batchStr ? Number(batchStr) : undefined,
        maxItems: maxStr ? Number(maxStr) : undefined,
        dryRun: hasFlag(rest, "--dry-run"),
        resume: hasFlag(rest, "--resume"),
        autoPublish: hasFlag(rest, "--auto-publish"),
        csvPath: getArg(rest, "--file"),
      });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void runHistoryCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
