import type { CrawlCursor } from "../../../domain/entities/crawl-cursor";
import type { ProviderHealthWindow } from "../../../domain/entities/provider-health-window";
import type {
  CrawlCursorRepository,
  ResolveCrawlCursorInput,
  UpsertCrawlCursorInput,
} from "../../../domain/repositories/crawl-cursor-repository";
import type {
  ProviderHealthAggregate,
  ProviderHealthWindowRepository,
  RecordProviderHealthWindowInput,
} from "../../../domain/repositories/provider-health-window-repository";

export class InMemoryCrawlCursorRepository implements CrawlCursorRepository {
  private readonly byKey = new Map<string, CrawlCursor>();

  public async resolve(input: ResolveCrawlCursorInput): Promise<CrawlCursor | null> {
    return this.byKey.get(this.toKey(input)) ?? null;
  }

  public async list(args: { mode?: "live" | "backfill"; targetId?: string }): Promise<CrawlCursor[]> {
    return Array.from(this.byKey.values())
      .filter((row) => {
        return (!args.mode || row.mode === args.mode) && (!args.targetId || row.targetId === args.targetId);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.provider.localeCompare(b.provider));
  }

  public async upsert(input: UpsertCrawlCursorInput): Promise<void> {
    const key = this.toKey(input);
    this.byKey.set(key, {
      provider: input.provider,
      targetId: input.targetId,
      mode: input.mode,
      cursor: input.cursor,
      rewindCursor: input.rewindCursor,
      lastFetchedAt: input.lastFetchedAt,
      updatedAt: input.updatedAt,
    });
  }

  public all(): CrawlCursor[] {
    return Array.from(this.byKey.values());
  }

  private toKey(input: { provider: string; targetId: string; mode: "live" | "backfill" }): string {
    return `${input.provider}|${input.targetId}|${input.mode}`;
  }
}

export class InMemoryProviderHealthWindowRepository implements ProviderHealthWindowRepository {
  private readonly byKey = new Map<string, ProviderHealthWindow>();

  public async record(input: RecordProviderHealthWindowInput): Promise<void> {
    const key = this.toKey(input);
    const current = this.byKey.get(key) ?? {
      provider: input.provider,
      targetId: input.targetId,
      mode: input.mode,
      windowStart: input.windowStart,
      requestCount: 0,
      successCount: 0,
      emptyResponseCount: 0,
      fallbackCount: 0,
      candidateCount: 0,
      acceptedCount: 0,
      filteredOutCount: 0,
      duplicatePostCount: 0,
      ingestLagSecondsSum: 0,
      ingestLagSampleCount: 0,
      providerDiffCount: 0,
      providerDiffSampleCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
      timeoutCount: 0,
      circuitOpenCount: 0,
      updatedAt: input.updatedAt,
    };

    this.byKey.set(key, {
      ...current,
      requestCount: current.requestCount + input.requestCountDelta,
      successCount: current.successCount + input.successCountDelta,
      emptyResponseCount: current.emptyResponseCount + input.emptyResponseCountDelta,
      fallbackCount: current.fallbackCount + input.fallbackCountDelta,
      candidateCount: current.candidateCount + input.candidateCountDelta,
      acceptedCount: current.acceptedCount + input.acceptedCountDelta,
      filteredOutCount: current.filteredOutCount + input.filteredOutCountDelta,
      duplicatePostCount: current.duplicatePostCount + input.duplicatePostCountDelta,
      ingestLagSecondsSum: current.ingestLagSecondsSum + input.ingestLagSecondsSumDelta,
      ingestLagSampleCount: current.ingestLagSampleCount + input.ingestLagSampleCountDelta,
      providerDiffCount: current.providerDiffCount + input.providerDiffCountDelta,
      providerDiffSampleCount:
        current.providerDiffSampleCount + input.providerDiffSampleCountDelta,
      errorCount: current.errorCount + input.errorCountDelta,
      rateLimitCount: current.rateLimitCount + input.rateLimitCountDelta,
      timeoutCount: current.timeoutCount + input.timeoutCountDelta,
      circuitOpenCount: current.circuitOpenCount + input.circuitOpenCountDelta,
      lastStatusCode: input.lastStatusCode ?? current.lastStatusCode,
      lastErrorCode: input.lastErrorCode ?? current.lastErrorCode,
      lastErrorMessage: input.lastErrorMessage ?? current.lastErrorMessage,
      updatedAt: input.updatedAt,
    });
  }

  public async listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
    mode?: "live" | "backfill";
  }): Promise<ProviderHealthWindow[]> {
    return Array.from(this.byKey.values())
      .filter((row) => {
        return (
          row.targetId === args.targetId &&
          row.windowStart >= args.from &&
          row.windowStart <= args.to &&
          (!args.mode || row.mode === args.mode)
        );
      })
      .sort((a, b) => a.windowStart.localeCompare(b.windowStart) || a.provider.localeCompare(b.provider));
  }

  public async summarizeByProviderInRange(args: {
    from: string;
    to: string;
    targetId?: string;
    mode?: "live" | "backfill";
  }): Promise<ProviderHealthAggregate[]> {
    const grouped = new Map<string, ProviderHealthAggregate>();
    for (const row of this.byKey.values()) {
      if (row.windowStart < args.from || row.windowStart > args.to) {
        continue;
      }
      if (args.targetId && row.targetId !== args.targetId) {
        continue;
      }
      if (args.mode && row.mode !== args.mode) {
        continue;
      }
      const key = `${row.provider}|${row.mode}`;
      const current = grouped.get(key) ?? {
        provider: row.provider,
        mode: row.mode,
        requestCount: 0,
        successCount: 0,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 0,
        acceptedCount: 0,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      };
      current.requestCount += row.requestCount;
      current.successCount += row.successCount;
      current.emptyResponseCount += row.emptyResponseCount;
      current.fallbackCount += row.fallbackCount;
      current.candidateCount += row.candidateCount;
      current.acceptedCount += row.acceptedCount;
      current.filteredOutCount += row.filteredOutCount;
      current.duplicatePostCount += row.duplicatePostCount;
      current.ingestLagSecondsSum += row.ingestLagSecondsSum;
      current.ingestLagSampleCount += row.ingestLagSampleCount;
      current.providerDiffCount += row.providerDiffCount;
      current.providerDiffSampleCount += row.providerDiffSampleCount;
      current.errorCount += row.errorCount;
      current.rateLimitCount += row.rateLimitCount;
      current.timeoutCount += row.timeoutCount;
      current.circuitOpenCount += row.circuitOpenCount;
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).sort((a, b) => a.provider.localeCompare(b.provider));
  }

  public all(): ProviderHealthWindow[] {
    return Array.from(this.byKey.values());
  }

  private toKey(input: {
    provider: string;
    targetId: string;
    mode: "live" | "backfill";
    windowStart: string;
  }): string {
    return `${input.provider}|${input.targetId}|${input.mode}|${input.windowStart}`;
  }
}
