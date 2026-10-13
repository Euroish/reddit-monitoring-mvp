import { createHash } from "node:crypto";

export class ResearchExportError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 413 | 503 = 400, public readonly code = status === 413 ? "research_export_limit" : status === 404 ? "research_export_not_found" : status === 409 ? "research_export_conflict" : status === 503 ? "research_export_unavailable" : "invalid_research_export_request") { super(message); }
}
export function researchScope(userId: string, exportId = "list"): string { return createHash("sha256").update(JSON.stringify(["research-export-v1", userId, exportId])).digest("hex"); }
export function researchCursor(scope: string, value: number | { createdAt: string; id: string }): string { return Buffer.from(JSON.stringify({ version: 1, scope, value })).toString("base64url"); }
export function readResearchCursor(scope: string, cursor: string | undefined, ordinal: boolean): number | { createdAt: string; id: string } | null {
  if (cursor === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error();
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || parsed.version !== 1 || parsed.scope !== scope) throw new Error();
    if (ordinal) {
      if (!Number.isInteger(parsed.value) || parsed.value < 1 || parsed.value > 20000) throw new Error();
    } else if (!parsed.value || typeof parsed.value.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.value.createdAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.value.id)) throw new Error();
    return parsed.value;
  } catch { throw new ResearchExportError("Cursor does not belong to this user/export or is invalid"); }
}
