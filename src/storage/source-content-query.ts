import { createHash } from "node:crypto";
import type { ContentQuery } from "../../packages/contracts/src/source-content";
import { SourceContentError } from "../application/services/source-content.service";

function scope(query: ContentQuery): string {
  return createHash("sha256").update(JSON.stringify([query.platform ?? null, query.provider ?? null, query.sourceId ?? null, query.kind ?? null, query.query ?? null, query.from ?? null, query.to ?? null,query.author??null,query.language??null,query.sourceGroup??null,query.sort??"published_desc",query.metricKey??null,query.minMetric??null,query.maxMetric??null])).digest("hex").slice(0, 24);
}
export function encodeContentCursor(query: ContentQuery, timestamp: string, id: string): string { return Buffer.from(JSON.stringify({ timestamp, id, scope: scope(query) })).toString("base64url"); }
export function decodeContentCursor(query: ContentQuery): { timestamp: string; id: string } | null {
  if (!query.cursor) return null;
  try {
    if (query.cursor.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
    if (value.scope !== scope(query) || typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp)) || typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) throw new Error();
    return { timestamp:new Date(value.timestamp).toISOString(), id: value.id };
  } catch { throw new SourceContentError("Invalid cursor or changed query filters"); }
}
