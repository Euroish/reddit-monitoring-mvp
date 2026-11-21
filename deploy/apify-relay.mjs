import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const origin = "https://api.apify.com";
const { APIFY_RELAY_BIND: bind, APIFY_RELAY_CLIENT: client } = process.env;
if (!bind || !client || process.env.HTTPS_PROXY !== "http://10.250.247.2:7890") {
  throw new Error("Apify relay requires its private listener, client and gateway");
}

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

createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, async (request, response) => {
  if (request.socket.remoteAddress !== client || !request.url?.startsWith("/v2/")) {
    response.writeHead(403).end();
    return;
  }
  const target = new URL(origin + request.url);
  if (!allowed(request.method, target.pathname) || target.hash || target.searchParams.has("token")) {
    response.writeHead(403).end();
    return;
  }

  const cancel = new AbortController();
  response.once("close", () => cancel.abort());
  try {
    const token = (await readFile("/run/apify-credentials/apify_token", "utf8")).trim();
    if (!/^apify_api_[A-Za-z0-9_-]{12,256}$/.test(token)) throw new Error("Invalid relay credential");
    const body = request.method === "POST" ? await readInput(request) : undefined;
    const timeout = target.pathname === "/v2/users/me" ? 4_500 : 19_000;
    const upstream = await fetch(target, {
      method: request.method,
      body,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(timeout)]),
      redirect: "error",
    });
    response.writeHead(upstream.status, { "Content-Type": "application/json" });
    if (target.pathname === "/v2/users/me" || !upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      response.end("{}");
      return;
    }
    await pipeline(Readable.fromWeb(upstream.body), response);
  } catch {
    if (response.headersSent) response.destroy();
    else response.writeHead(502).end();
  }
}).listen(8080, bind);
