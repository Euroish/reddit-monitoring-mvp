import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLocalEnvironment } from "../src/runtime/load-local-env";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { capacityProjection, sourceStoragePlan } from "../src/ops/source-storage-plan";

const option = (name: string) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
async function main() {
  loadLocalEnvironment();
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search || url.hash) throw new Error("Storage preview requires loopback PostgreSQL without URL options");
  const output = option("--out") ?? "output/validation/source-storage-plan.json", file = path.resolve(output);
  if (!file.startsWith(path.resolve("output") + path.sep)) throw new Error("Reports must remain under output/");
  const policy = { jobDays: Number(option("--job-days") ?? 90), observationDays: Number(option("--observation-days") ?? 90),
    heartbeatDays: Number(option("--heartbeat-days") ?? 14), usageDays: Number(option("--usage-days") ?? 90), auditDays: Number(option("--audit-days") ?? 180) };
  const db = new PostgresClient({ connectionString: url.href });
  try {
    const plan = await sourceStoragePlan(db, policy);
    const content = plan.tables.content, observation = plan.tables.content_observation;
    const supplied = option("--daily-content") !== undefined && option("--daily-observations") !== undefined;
    const traffic = supplied ? { dailyContent: Number(option("--daily-content")), dailyObservations: Number(option("--daily-observations")), days: Number(option("--capacity-days") ?? 90) } : null;
    const projection = traffic ? capacityProjection({ allocatedContentBytes: content?.allocatedBytes ?? 0, contentRows: content?.rows ?? 0,
      allocatedObservationBytes: observation?.allocatedBytes ?? 0, observationRows: observation?.rows ?? 0 }, traffic) : null;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ ...plan, capacityInputs: traffic, projection }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ report: output, mode: "dry-run", deletionExecuted: false }));
  } finally { await db.close(); }
}
if (require.main === module) void main().catch(error => { console.error(error instanceof Error ? error.message : "Storage preview failed"); process.exitCode = 1; });
