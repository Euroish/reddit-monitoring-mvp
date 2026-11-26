import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const origin = "https://api.apify.com";

function allowed(method, path) {
  if (method === "POST") return /^\/v2\/acts\/(kaix~reddit-scraper|red_crawler~reddit-(search|scrape)-v2)\/runs$/.test(path);
  if (method !== "GET") return false;
  return path === "/v2/users/me"
    || /^\/v2\/acts\/(kaix~reddit-scraper|red_crawler~reddit-(search|scrape)-v2)$/.test(path)
    || /^\/v2\/(actor-runs\/[A-Za-z0-9]+|datasets\/[A-Za-z0-9]+\/items)$/.test(path);
}

async function readInput(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 256 * 1024) throw new Error("Input exceeds relay limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function sanitizedStart402(body) {
  let reader;
  try {
    reader = body.getReader();
    const buffer = Buffer.alloc(4096);
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes)));
        return parsed?.error?.type === "actor-memory-limit-exceeded"
          ? JSON.stringify({ error: { type: "actor-memory-limit-exceeded" } })
          : "{}";
      }
      // Without EOF we cannot trust a JSON-looking prefix at the limit.
      if (bytes + value.byteLength >= buffer.length) return "{}";
      buffer.set(value, bytes);
      bytes += value.byteLength;
    }
  } catch {
    return "{}";
  } finally {
    void reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

export async function handleApifyRelay(request, response, client, {
  fetcher = fetch,
  readToken = () => readFile("/run/apify-credentials/apify_token", "utf8"),
} = {}) {
  if (request.socket.remoteAddress !== client) {
    response.writeHead(403).end();
    return;
  }
  if (!request.url?.startsWith("/v2/")) {
    response.writeHead(403, { "Content-Type": "application/json" }).end("{}");
    return;
  }
  const target = new URL(origin + request.url);
  if (!allowed(request.method, target.pathname) || target.hash || target.searchParams.has("token")) {
    response.writeHead(403, { "Content-Type": "application/json" }).end("{}");
    return;
  }

  const cancel = new AbortController();
  response.once("close", () => cancel.abort());
  try {
    const token = (await readToken()).trim();
    if (!/^apify_api_[A-Za-z0-9_-]{12,256}$/.test(token)) throw new Error("Invalid relay credential");
    const body = request.method === "POST" ? await readInput(request) : undefined;
    const timeout = target.pathname === "/v2/users/me" ? 4_500 : 19_000;
    const upstream = await fetcher(target, {
      method: request.method,
      body,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(timeout)]),
      redirect: "error",
    });
    response.writeHead(upstream.status, { "Content-Type": "application/json" });
    if (target.pathname === "/v2/users/me" || !upstream.ok || !upstream.body) {
      // The route allowlist above admits only actor-run starts for POST.
      if (request.method === "POST" && upstream.status === 402 && upstream.body) {
        response.end(await sanitizedStart402(upstream.body));
      } else {
        void upstream.body?.cancel().catch(() => {});
        response.end("{}");
      }
      return;
    }
    await pipeline(Readable.fromWeb(upstream.body), response);
  } catch {
    if (response.headersSent) response.destroy();
    else response.writeHead(502).end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { APIFY_RELAY_BIND: bind, APIFY_RELAY_CLIENT: client } = process.env;
  if (!bind || !client || process.env.HTTPS_PROXY !== "http://10.250.247.2:7890") {
    throw new Error("Apify relay requires its private listener, client and gateway");
  }
  createServer({ requestTimeout: 10_000, headersTimeout: 5_000 },
    (request, response) => handleApifyRelay(request, response, client)).listen(8080, bind);
}
