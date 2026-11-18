import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

const [planPath, mode, ...extra] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const terminal = new Set(["succeeded", "failed", "cancelled"]);
const windowSize = 32;
const hash = (data) => createHash("sha256").update(JSON.stringify(data)).digest("hex");

function normalizeTask(task, index) {
  if (!task || typeof task !== "object" ||
      Object.keys(task).some(key => !["sourceId", "from", "to", "limit", "includeComments", "maxCommentsPerPost", "useFallback"].includes(key))) {
    throw new Error(`Invalid task ${index + 1}`);
  }
  const { sourceId, from, to, limit, includeComments = false, maxCommentsPerPost, useFallback = false } = task;
  const start = typeof from === "string" ? Date.parse(from) : NaN;
  const end = typeof to === "string" ? Date.parse(to) : NaN;
  if (typeof sourceId !== "string" || !uuid.test(sourceId) || !Number.isFinite(start) || !Number.isFinite(end) || start >= end ||
      !Number.isInteger(limit) || limit < 1 || limit > 300 ||
      typeof includeComments !== "boolean" || typeof useFallback !== "boolean" ||
      (maxCommentsPerPost !== undefined && (!Number.isInteger(maxCommentsPerPost) || maxCommentsPerPost < 1 || maxCommentsPerPost > 50))) {
    throw new Error(`Invalid source, dates, or collection limits in task ${index + 1}`);
  }
  const body = {
    from: new Date(start).toISOString(), to: new Date(end).toISOString(),
    limit, includeComments, maxCommentsPerPost, useFallback,
  };
  const normalizedSourceId = sourceId.toLowerCase();
  return { sourceId: normalizedSourceId, body, key: `batch:${hash([normalizedSourceId, body])}` };
}

async function main() {
  if (!planPath || (mode !== undefined && mode !== "--apply") || extra.length) {
    throw new Error("Usage: npm run collect:batch -- plan.json [--apply]");
  }
  const raw = JSON.parse(await readFile(planPath, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Expected a nonempty array of collection tasks");
  const tasks = [...new Map(raw.map(normalizeTask).map(task => [task.key, task])).values()];
  if (mode !== "--apply") {
    console.log(JSON.stringify({
      plannedTasks: tasks.length, duplicateTasks: raw.length - tasks.length,
      requestedLimitSum: tasks.reduce((sum, task) => sum + task.body.limit, 0),
    }));
    return;
  }

  const base = new URL(process.env.COLLECT_API_URL ?? "");
  const token = process.env.COLLECT_API_TOKEN;
  const localHttp = base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (!token || (base.protocol !== "https:" && !localHttp) || base.username || base.password || base.search || base.hash) {
    throw new Error("Set COLLECT_API_TOKEN and COLLECT_API_URL (HTTPS or loopback HTTP)");
  }
  const url = base.href.replace(/\/$/, "");
  const fingerprint = hash([url, tasks.map(task => task.key)]);
  const progressPath = planPath + ".progress.json";
  const progress = await readFile(progressPath, "utf8").then(JSON.parse, error => {
    if (error.code !== "ENOENT") throw error;
    return { fingerprint, tasks: {} };
  });
  if (progress.fingerprint !== fingerprint) throw new Error("Plan or API changed. Use a different plan file to start a new run.");

  async function saveProgress() {
    const temporary = progressPath + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(progress, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, progressPath);
  }

  let stopping = false;
  let nextRequest = 0;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  async function request(path, task) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (stopping) throw new Error("Interrupted. Resume with the same plan.");
      await wait(Math.max(0, nextRequest - Date.now()));
      if (stopping) throw new Error("Interrupted. Resume with the same plan.");
      nextRequest = Date.now() + 1000;
      const response = await fetch(url + path, {
        method: task ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(task ? { "content-type": "application/json", "idempotency-key": task.key } : {}),
        },
        body: task ? JSON.stringify(task.body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        const seconds = header === null ? NaN : Number(header);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
        await response.body?.cancel();
        nextRequest = Date.now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 60000);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Collection API HTTP ${response.status}. Progress saved at ${progressPath}`);
      }
      return response.json();
    }
    throw new Error("Collection API still rate limited. Resume with the same plan.");
  }

  let paused = false;
  for (let offset = 0; offset < tasks.length && !stopping && !paused; offset += windowSize) {
    const window = tasks.slice(offset, offset + windowSize);
    for (const task of window) {
      if (stopping) break;
      if (!progress.tasks[task.key]) {
        const { jobId } = await request(`/v1/sources/${task.sourceId}/collect`, task);
        if (typeof jobId !== "string" || !uuid.test(jobId)) throw new Error("Invalid task receipt");
        progress.tasks[task.key] = { jobId, status: "queued" };
        await saveProgress();
      }
    }

    const pending = window.map(task => progress.tasks[task.key]).filter(row => row && !terminal.has(row.status));
    const deadline = Date.now() + 5 * 60_000;
    while (pending.length && !stopping && Date.now() < deadline) {
      const { jobs } = await request(`/v1/source-jobs?ids=${pending.map(row => row.jobId).join(",")}`);
      const byId = new Map(jobs.map(job => [job.id, job]));
      for (const row of pending) {
        const job = byId.get(row.jobId);
        if (!job) throw new Error("A submitted job is missing or outside the API key's source scope.");
        Object.assign(row, job);
      }
      await saveProgress();
      for (let index = pending.length - 1; index >= 0; index--) {
        if (terminal.has(pending[index].status)) pending.splice(index, 1);
      }
      if (pending.some(row => row.status === "queued" && row.error === "Budget disabled, exhausted or request spacing")) break;
      if (pending.length && !stopping) await wait(5000);
    }
    paused = pending.length > 0;
  }
  const rows = Object.values(progress.tasks);
  const count = (field) => rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
  const failed = rows.filter(row => row.status === "failed" || row.status === "cancelled").length;
  console.log(JSON.stringify({
    planned: tasks.length, submitted: rows.length, succeeded: rows.filter(row => row.status === "succeeded").length,
    failed, pending: rows.filter(row => !terminal.has(row.status)).length,
    requests: count("request_count"), processed: count("records_processed"),
    inserted: count("records_inserted"), updated: count("records_updated"), progressPath,
  }));
  if (paused || stopping || failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
