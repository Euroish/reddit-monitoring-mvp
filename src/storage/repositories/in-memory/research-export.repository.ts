import type { ResearchExportView } from "../../../../packages/contracts/src/research-export";
import type { PublicContent } from "../../../../packages/contracts/src/source-content";
import type { ResearchExportRepository, ResearchFreezeInput, ResearchPageQuery, ResearchSnapshot, ResearchSnapshotContext } from "../../../domain/repositories/research-export-repository";
import { readResearchCursor, researchCursor, researchScope } from "../../research-export-query";
import type { InMemorySourceContentRepository } from "./source-content.repository";

export class InMemoryResearchExportRepository implements ResearchExportRepository {
  private readonly snapshots = new Map<string, { userId: string; view: ResearchExportView; items: PublicContent[] }>();
  constructor(private readonly source: InMemorySourceContentRepository, private readonly indexCoverage?: (snapshot: InMemorySourceContentRepository, ids: string[]) => Promise<number | null>) {}
  async freeze(input: ResearchFreezeInput, capture: (context: ResearchSnapshotContext) => Promise<ResearchSnapshot>) {
    // Clone synchronously before the first await. Every later read uses this clone.
    const snapshotSource = this.source.snapshotForResearch();
    const snapshot = await capture({ content: snapshotSource, indexedContentCount: async ids => {
      if (this.indexCoverage) return this.indexCoverage(snapshotSource, ids);
      return (await snapshotSource.searchCoverage(ids)).indexed;
    } });
    const view: ResearchExportView = { id: input.id, name: input.name, createdAt: input.createdAt, total: snapshot.items.length, manifest: snapshot.manifest };
    if (this.snapshots.has(input.id)) throw new Error("Research export ID already exists");
    this.snapshots.set(input.id, structuredClone({ userId: input.userId, view, items: snapshot.items }));
    return structuredClone(view);
  }
  async get(userId: string, id: string) { const row = this.snapshots.get(id); return row?.userId === userId ? structuredClone(row.view) : null; }
  async list(userId: string, input: ResearchPageQuery) {
    const scope = researchScope(userId), after = readResearchCursor(scope, input.cursor, false) as { createdAt: string; id: string } | null;
    const rows = [...this.snapshots.values()].filter(row => row.userId === userId && (!after || row.view.createdAt < after.createdAt || row.view.createdAt === after.createdAt && row.view.id < after.id)).sort((a, b) => b.view.createdAt.localeCompare(a.view.createdAt) || b.view.id.localeCompare(a.view.id));
    const exports = rows.slice(0, input.limit).map(row => structuredClone(row.view)), last = exports.at(-1);
    return { exports, nextCursor: rows.length > input.limit && last ? researchCursor(scope, { createdAt: last.createdAt, id: last.id }) : null };
  }
  async page(userId: string, id: string, input: ResearchPageQuery) {
    const scope = researchScope(userId, id), after = readResearchCursor(scope, input.cursor, true) as number | null, row = this.snapshots.get(id);
    if (row?.userId !== userId) return null;
    const offset = after ?? 0, items = row.items.slice(offset, offset + input.limit);
    return { researchExport: structuredClone(row.view), items: structuredClone(items), nextCursor: offset + items.length < row.items.length ? researchCursor(scope, offset + items.length) : null };
  }
  async delete(userId: string, id: string) { if (this.snapshots.get(id)?.userId !== userId) return false; return this.snapshots.delete(id); }
}
