import "../src/runtime/load-local-env";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { createSourceContentService } from "../src/runtime/source-content-runtime";

async function main() {
  const db = new PostgresClient(), service = createSourceContentService(db), controller = new AbortController();
  const worker={id:`source-worker-${process.pid}-${randomUUID()}`,startedAt:new Date().toISOString(),state:"active" as const,lastJobId:null};
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());
  try {
    do {
      await service.heartbeat(worker);
      const worked = await service.workOnce(controller.signal);
      await service.heartbeat({...worker,lastJobId:service.lastWorkedJobId});
      if (process.argv.includes("--once")) break;
      await delay(worked ? 1500 : 3000, undefined, { signal: controller.signal });
    } while (!controller.signal.aborted);
  } catch (error) { if (!controller.signal.aborted) throw error; }
  finally { await service.heartbeat({...worker,state:"stopped"}).catch(()=>undefined);await db.close(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Source worker failed"); process.exitCode = 1; });
