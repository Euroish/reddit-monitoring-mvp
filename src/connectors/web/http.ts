import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { ContentProviderError } from "../shared/content-provider.interface";

const reserved = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) reserved.addSubnet(network, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const)
  reserved.addSubnet(network, prefix, "ipv6");

const decodeGzip = promisify(gunzip);
const maxResponseBytes = 2 * 1024 * 1024;
const trackingParams = new Set([
  "fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref", "ref_src", "spm", "ved", "si",
]);

export type ReadPage = (
  url: URL,
  signal?: AbortSignal,
  headers?: Record<string, string>,
  timeoutMs?: number,
) => Promise<{ body: string; status: number; etag?: string; modified?: string; url?: string }>;

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !reserved.check(ip);
  if (family === 6) return globalV6.check(ip, "ipv6") && !reserved.check(ip, "ipv6");
  return false;
}

export function httpsUrl(raw: string, base?: string): URL | null {
  try {
    const url = new URL(raw, base);
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      !url.hostname.includes(".") || isIP(url.hostname)
    ) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function canonicalizeUrl(raw: string, base?: string, stripTracking = true): URL | null {
  const url = httpsUrl(raw, base);
  if (!url) return null;
  if (stripTracking) {
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || trackingParams.has(lower)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
  }
  return url;
}

export async function read(
  url: URL,
  parent?: AbortSignal,
  headers?: Record<string, string>,
  timeoutMs = 10000,
) {
  const clamped = Math.min(15000, Math.max(3000, Number.isFinite(timeoutMs) ? timeoutMs : 10000));
  const timer = AbortSignal.timeout(clamped);
  const signal = parent ? AbortSignal.any([parent, timer]) : timer;
  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (let hop = 0; hop <= 3; hop++) {
      signal.throwIfAborted();
      const addresses = (await Promise.allSettled([
        resolver.resolve4(url.hostname), resolver.resolve6(url.hostname),
      ])).flatMap((result) => result.status === "fulfilled" ? result.value : []);
      signal.throwIfAborted();
      if (!addresses.length) throw new ContentProviderError("Web source DNS lookup failed", true);
      if (!addresses.every(isPublicIp)) {
        throw new ContentProviderError("Web source address is not public", false);
      }
      const response = await requestPage(url, addresses[0], signal, headers);
      if (!response.location) return { ...response, url: url.href };
      const next = httpsUrl(response.location, url.href);
      if (!next || hop === 3) throw new ContentProviderError("Invalid web source redirect", false);
      if (next.origin !== url.origin) headers = undefined;
      url = next;
    }
    throw new ContentProviderError("Too many web source redirects", false);
  } catch (error) {
    if (error instanceof ContentProviderError || parent?.aborted) throw error;
    throw new ContentProviderError("Web source connection failed or timed out", true);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function requestPage(url: URL, ip: string, signal: AbortSignal, headers?: Record<string, string>) {
  const family = isIP(ip);
  return new Promise<{ body: string; status: number; etag?: string; modified?: string; location?: string }>(
    (resolve, reject) => {
      const req = request(url, {
        headers: {
          "User-Agent": "MonitoringWorkbench/1.0 (RSS reader)",
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1",
          "Accept-Encoding": "gzip",
          ...headers,
        },
        family, signal, agent: false,
        lookup: (_host, _options, callback) => callback(null, ip, family),
      }, (response) => {
        void (async () => {
        try {
          const status = response.statusCode ?? 500;
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            response.destroy();
            resolve({ status, body: "", location: response.headers.location });
            return;
          }
          if (status !== 200 && status !== 304) {
            const retry = response.headers["retry-after"];
            const seconds = retry && /^\d+$/.test(retry)
              ? Number(retry) : (Date.parse(retry ?? "") - Date.now()) / 1000;
            const delay = Number.isFinite(seconds) ? Math.min(43200, Math.max(1, Math.ceil(seconds))) : 30;
            throw new ContentProviderError(
              `Web source returned HTTP ${status}`, status === 429 || status >= 500, delay, status,
            );
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of response) {
            bytes += chunk.length;
            if (bytes > maxResponseBytes) throw new ContentProviderError("Web source response exceeds 2 MiB", false);
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks, bytes);
          const decoded = status === 200 && response.headers["content-encoding"] === "gzip"
            ? await decodeGzip(body, { maxOutputLength: maxResponseBytes }).catch(() => {
              throw new ContentProviderError("Invalid or oversized gzip response", false);
            })
            : body;
          signal.throwIfAborted();
          resolve({
            body: decoded.toString("utf8"), status,
            etag: response.headers.etag, modified: response.headers["last-modified"],
          });
        } catch (error) {
          response.destroy();
          reject(error);
        }
        })();
      });
      req.on("error", reject);
      req.end();
    },
  );
}
