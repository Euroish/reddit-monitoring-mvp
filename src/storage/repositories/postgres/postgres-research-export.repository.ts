import type { PoolClient, QueryResultRow } from "pg";
import type { PublicContent } from "../../../../packages/contracts/src/source-content";
import type { ResearchExportView } from "../../../../packages/contracts/src/research-export";
import type { ResearchExportRepository, ResearchFreezeInput, ResearchPageQuery, ResearchSnapshot, ResearchSnapshotContext } from "../../../domain/repositories/research-export-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { PostgresSourceContentRepository } from "./postgres-source-content.repository";
import { readResearchCursor, researchCursor, researchScope } from "../../research-export-query";

function view(row: QueryResultRow): ResearchExportView { return { id: row.id, name: row.name, total: row.total, manifest: row.manifest, createdAt: new Date(row.created_at).toISOString() }; }
export type ResearchIndexCoverageReader = (client: PoolClient, ids: string[]) => Promise<number | null>;
export class PostgresResearchExportRepository implements ResearchExportRepository {
  constructor(private readonly db: PostgresClient, private readonly indexCoverage?: ResearchIndexCoverageReader) {}
  async freeze(input: ResearchFreezeInput, capture: (context: ResearchSnapshotContext) => Promise<ResearchSnapshot>): Promise<ResearchExportView> {
    return this.db.withTransaction(async client => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const content = new PostgresSourceContentRepository({
        query: async (sql, params) => {
          if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP)\b/i.test(sql)) throw new Error("Research source snapshot accepts read queries only");
          return client.query(sql, params);
        },
        withTransaction: async () => { throw new Error("Research source snapshot cannot begin a nested transaction"); },
      });
      const snapshot = await capture({ content, indexedContentCount: async ids => {
        if (this.indexCoverage) return this.indexCoverage(client, ids);
        return (await content.searchCoverage(ids)).indexed;
      } });
      const row = (await client.query("INSERT INTO research_export(id,user_id,name,total,manifest,payload_bytes,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *", [input.id, input.userId, input.name, snapshot.items.length, JSON.stringify(snapshot.manifest), snapshot.payloadBytes, input.createdAt])).rows[0];
      for (let offset = 0; offset < snapshot.items.length; offset += 100) {
        const members = snapshot.items.slice(offset, offset + 100).map((payload, index) => ({ ordinal: offset + index + 1, content_id: payload.id, identity_key: JSON.stringify([payload.platform, payload.kind, payload.externalId]), payload }));
        await client.query("INSERT INTO research_export_member(export_id,ordinal,content_id,identity_key,payload) SELECT $1,entry.ordinal,entry.content_id,entry.identity_key,entry.payload FROM jsonb_to_recordset($2::jsonb) AS entry(ordinal INTEGER,content_id TEXT,identity_key TEXT,payload JSONB)", [input.id, JSON.stringify(members)]);
      }
      return view(row);
    });
  }
  async get(userId: string, id: string) { const row = (await this.db.query("SELECT * FROM research_export WHERE user_id=$1 AND id=$2", [userId, id])).rows[0]; return row ? view(row) : null; }
  async list(userId: string, input: ResearchPageQuery) {
    const scope = researchScope(userId), after = readResearchCursor(scope, input.cursor, false) as { createdAt: string; id: string } | null;
    const rows = (await this.db.query("SELECT * FROM research_export WHERE user_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4", [userId, after?.createdAt ?? null, after?.id ?? null, input.limit + 1])).rows;
    const exports = rows.slice(0, input.limit).map(view), last = exports.at(-1);
    return { exports, nextCursor: rows.length > input.limit && last ? researchCursor(scope, { createdAt: last.createdAt, id: last.id }) : null };
  }
  async page(userId: string, id: string, input: ResearchPageQuery) {
    const scope = researchScope(userId, id), after = readResearchCursor(scope, input.cursor, true) as number | null;
    const result = await this.db.query("SELECT e.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('ordinal',m.ordinal,'payload',m.payload) ORDER BY m.ordinal) FROM (SELECT ordinal,payload FROM research_export_member WHERE export_id=e.id AND ordinal>$3 ORDER BY ordinal LIMIT $4) m),'[]'::jsonb) AS members FROM research_export e WHERE e.user_id=$1 AND e.id=$2", [userId, id, after ?? 0, input.limit + 1]);
    const row = result.rows[0]; if (!row) return null;
    const members = row.members as { ordinal: number; payload: PublicContent }[], page = members.slice(0, input.limit), last = page.at(-1);
    return { researchExport: view(row), items: page.map(member => member.payload), nextCursor: members.length > input.limit && last ? researchCursor(scope, last.ordinal) : null };
  }
  async delete(userId: string, id: string) { return Boolean((await this.db.query("DELETE FROM research_export WHERE user_id=$1 AND id=$2 RETURNING id", [userId, id])).rows[0]); }
}
