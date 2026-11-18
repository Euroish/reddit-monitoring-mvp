import { createHash } from "node:crypto";
import { normalizePublicSearchText } from "./search";

export type StoryTitle = { id: string; title: string; url: string | null; links: string[] };

function linkKey(raw: string) {
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.pathname === "/") return null;
    const host = url.hostname.replace(/^www\./u, "");
    const paper = host === "arxiv.org" && url.pathname.match(/^\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/u);
    if (paper) return `arxiv.org/abs/${paper[1]}`;
    if (host === "github.com" && !/^\/[^/]+\/[^/]+\/(?:releases\/tag|issues|pull|discussions)\/[^/]+/u.test(url.pathname)) return null;
    for (const name of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/iu.test(name)) url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return host + url.pathname.replace(/\/$/u, "") + url.search;
  } catch {
    return null;
  }
}

const stop = new Set("a an and are as at by for from how in is it of on or that the to was what when with you your".split(" "));

function titleTokens(title: string) {
  const terms = new Set<string>();
  for (const match of normalizePublicSearchText(title).matchAll(/\p{Script=Han}+|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu)) {
    const word = match[0];
    if (/^\p{Script=Han}/u.test(word)) {
      const chars = [...word];
      for (let i = 1; i < chars.length; i++) terms.add(chars[i - 1] + chars[i]);
    } else if (word.length > 1 && !stop.has(word)) {
      terms.add(word);
    }
  }
  return terms;
}

function simHash(tokens: Set<string>, hashes: Map<string, Buffer>) {
  const weights = new Int16Array(64);
  for (const token of tokens) {
    let hash = hashes.get(token);
    if (!hash) {
      hash = createHash("sha256").update(token).digest().subarray(0, 8);
      hashes.set(token, hash);
    }
    for (let i = 0; i < 64; i++) weights[i] += hash[i >> 3] & (1 << (i & 7)) ? 1 : -1;
  }
  return weights.reduce((hash, weight, i) => weight > 0 ? hash | (1n << BigInt(i)) : hash, 0n);
}

function near(a: bigint, b: bigint) {
  let bits = a ^ b;
  for (let i = 0; i < 7 && bits; i++) bits &= bits - 1n;
  return bits === 0n;
}

// Process oldest first, comparing fuzzy titles only with the original anchor of each cluster.
export function groupStories<T extends StoryTitle>(items: T[]): T[][] {
  const clusters: T[][] = [];
  const byLink = new Map<string, number>();
  const byTitle = new Map<string, number>();
  const buckets = new Map<string, Map<number, number[]>>();
  const profiles: { tokens: Set<string>; fingerprint: bigint }[] = [];
  const hashes = new Map<string, Buffer>();
  for (const item of items) {
    const links = [item.url, ...item.links].flatMap(raw => {
      const key = raw && linkKey(raw);
      return key ? [key] : [];
    });
    const tokens = titleTokens(item.title);
    const numbers = [...new Set(item.title.normalize("NFKC").match(/\d+(?:\.\d+)*/gu) ?? [])].sort().join(" ");
    const exact = normalizePublicSearchText(item.title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    let group: number | undefined;
    for (const link of links) {
      const match = byLink.get(link);
      if (match !== undefined) group = Math.min(group ?? match, match);
    }
    group ??= tokens.size >= 2 ? byTitle.get(exact) : undefined;
    if (group === undefined) {
      const fingerprint = tokens.size >= 4 ? simHash(tokens, hashes) : 0n;
      let index = buckets.get(numbers);
      const bands = tokens.size >= 4 ? Array.from({ length: 4 }, (_, i) => i * 65536 + Number((fingerprint >> BigInt(i * 16)) & 65535n)) : [];
      if (index && bands.length) {
        const candidates = new Set<number>();
        // At seven differing bits or fewer, one of the four bands differs by at most one bit.
        for (const key of bands) {
          for (const match of index.get(key) ?? []) candidates.add(match);
          for (let bit = 0; bit < 16; bit++) {
            for (const match of index.get(key ^ (1 << bit)) ?? []) candidates.add(match);
          }
        }
        for (const candidate of candidates) {
          const profile = profiles[candidate];
          if (!near(fingerprint, profile.fingerprint)) continue;
          let common = 0;
          for (const token of tokens) if (profile.tokens.has(token)) common++;
          if (common >= 4 && common * 3 >= (tokens.size + profile.tokens.size - common) * 2)
            group = Math.min(group ?? candidate, candidate);
        }
      }
      if (group === undefined) {
        group = clusters.length;
        clusters.push([]);
        profiles.push({ tokens, fingerprint });
        if (bands.length && !index) buckets.set(numbers, index = new Map());
        for (const key of bands) {
          let bucket = index!.get(key);
          if (!bucket) index!.set(key, bucket = []);
          bucket.push(group);
          if (bucket.length > 32) bucket.shift();
        }
      }
    }
    clusters[group].push(item);
    for (const link of links) if (!byLink.has(link)) byLink.set(link, group);
    if (tokens.size >= 2 && !byTitle.has(exact)) byTitle.set(exact, group);
  }
  return clusters;
}
