import "../src/runtime/load-local-env";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createSourceContentService } from "../src/runtime/source-content-runtime";

async function main() {
  if (process.env.SOURCE_RUN_MODE !== "demo" || process.env.SOURCE_NETWORK_ENABLED === "true") throw new Error("Demo seeding requires SOURCE_RUN_MODE=demo and disabled network");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/info_workbench_dev") throw new Error("Demo seed is restricted to managed loopback info_workbench_dev");
  const db = new PostgresClient();
  try {
    const service = createSourceContentService(db);
    const platforms = await db.query<{ code: string }>("SELECT code FROM source WHERE code IN ('reddit','x')");
    const definitions = [{ platform: "reddit" as const, provider: "demo_reddit", label: "[合成演示] Reddit 智能体", target: { type: "community" as const, community: "demo_agents", query: "智能体" } }, ...(platforms.rows.some(row => row.code === "x") ? [{ platform: "x" as const, provider: "demo_x", label: "[合成演示] X 智能体", target: { type: "search" as const, query: "智能体" } }] : [])];
    const existing = await service.repository.listSources();
    for (const definition of definitions) {
      if (existing.some(source => source.provider === definition.provider)) continue;
      const source = await service.createSource({ ...definition, contentKind: "post" });
      const to = new Date().toISOString(), from = new Date(Date.now() - 86400000).toISOString();
      await service.enqueue(source.id, { from, to, pageSize: 10, maxPages: 1 });
      await service.workOnce();
    }
    console.log("Seeded bounded synthetic demo pages; no source network requests.");
  } finally { await db.close(); }
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
