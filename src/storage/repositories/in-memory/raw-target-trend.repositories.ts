import type { AnomalyEvent } from "../../../domain/entities/anomaly-event";
import type { KeywordTrendDaily } from "../../../domain/entities/keyword-trend-daily";
import type { MonitorTarget } from "../../../domain/entities/monitor-target";
import type { PostGrowthFact } from "../../../domain/entities/post-growth-fact";
import type { SubredditDailyFact } from "../../../domain/entities/subreddit-daily-fact";
import type { SubredditCollectionCoverage } from "../../../domain/entities/subreddit-collection-coverage";
import type { SubredditTrendPoint } from "../../../domain/entities/subreddit-trend-point";
import type { AnomalyEventRepository } from "../../../domain/repositories/anomaly-event-repository";
import type { KeywordTrendDailyRepository } from "../../../domain/repositories/keyword-trend-daily-repository";
import type { MonitorTargetRepository } from "../../../domain/repositories/monitor-target-repository";
import type { PostGrowthFactRepository } from "../../../domain/repositories/post-growth-fact-repository";
import type { RawEventRepository } from "../../../domain/repositories/raw-event-repository";
import type { SubredditDailyFactRepository } from "../../../domain/repositories/subreddit-daily-fact-repository";
import type { SubredditCollectionCoverageRepository } from "../../../domain/repositories/subreddit-collection-coverage-repository";
import type { SubredditTrendPointRepository } from "../../../domain/repositories/subreddit-trend-point-repository";
import type { RawEnvelope } from "../../../connectors/shared/connector.interface";

export class InMemoryRawEventRepository implements RawEventRepository {
  private readonly events: Array<{
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope;
    retainRawPayload: boolean;
    retentionReason?: string;
  }> = [];

  public async append<TPayload>(event: {
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope<TPayload>;
    retention?: {
      retainRawPayload?: boolean;
      reason?: string;
    };
  }): Promise<void> {
    this.events.push({
      ...event,
      retainRawPayload: event.retention?.retainRawPayload === true || event.envelope.httpStatus >= 400,
      retentionReason: event.retention?.reason,
    });
  }

  public all(): Array<{
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope;
    retainRawPayload: boolean;
    retentionReason?: string;
  }> {
    return [...this.events];
  }
}

export class InMemoryMonitorTargetRepository implements MonitorTargetRepository {
  private readonly byCanonicalName = new Map<string, MonitorTarget>();

  public async listSubreddits(): Promise<MonitorTarget[]> {
    return Array.from(this.byCanonicalName.values())
      .filter((target) => target.targetType === "subreddit")
      .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  }

  public async findActiveSubreddits(): Promise<MonitorTarget[]> {
    return (await this.listSubreddits()).filter((target) => target.status === "active");
  }

  public async findByCanonicalName(canonicalName: string): Promise<MonitorTarget | null> {
    return this.byCanonicalName.get(canonicalName) ?? null;
  }

  public async findById(targetId: string): Promise<MonitorTarget | null> {
    for (const target of this.byCanonicalName.values()) {
      if (target.id === targetId) {
        return target;
      }
    }
    return null;
  }

  public async upsert(target: MonitorTarget): Promise<MonitorTarget> {
    this.byCanonicalName.set(target.canonicalName, target);
    return target;
  }

  public all(): MonitorTarget[] {
    return Array.from(this.byCanonicalName.values());
  }
}

export class InMemorySubredditTrendPointRepository implements SubredditTrendPointRepository {
  private readonly points = new Map<string, SubredditTrendPoint>();

  public async upsertMany(points: SubredditTrendPoint[]): Promise<void> {
    for (const point of points) {
      const key = `${point.targetId}|${point.windowStart}|${point.windowEnd}`;
      this.points.set(key, point);
    }
  }

  public async listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
  }): Promise<SubredditTrendPoint[]> {
    return Array.from(this.points.values())
      .filter((point) => {
        return (
          point.targetId === args.targetId &&
          point.windowStart >= args.from &&
          point.windowStart <= args.to
        );
      })
      .sort((a, b) => a.windowStart.localeCompare(b.windowStart));
  }

  public async listLatestByTargetsInRange(args: {
    targetIds: string[];
    from: string;
    to: string;
  }): Promise<SubredditTrendPoint[]> {
    if (args.targetIds.length === 0) {
      return [];
    }

    const targetSet = new Set(args.targetIds);
    const latestByTarget = new Map<string, SubredditTrendPoint>();

    for (const point of this.points.values()) {
      if (!targetSet.has(point.targetId)) {
        continue;
      }
      if (point.windowStart < args.from || point.windowStart > args.to) {
        continue;
      }

      const existing = latestByTarget.get(point.targetId);
      if (!existing || point.windowStart > existing.windowStart) {
        latestByTarget.set(point.targetId, point);
      }
    }

    return Array.from(latestByTarget.values()).sort((a, b) => a.targetId.localeCompare(b.targetId));
  }

  public all(): SubredditTrendPoint[] {
    return Array.from(this.points.values());
  }
}

export class InMemorySubredditDailyFactRepository implements SubredditDailyFactRepository {
  private readonly facts = new Map<string, SubredditDailyFact>();

  public async upsertMany(facts: SubredditDailyFact[]): Promise<void> {
    for (const fact of facts) {
      const key = `${fact.targetId}|${fact.day}`;
      this.facts.set(key, fact);
    }
  }

  public async replaceRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
    facts: SubredditDailyFact[];
  }): Promise<void> {
    for (const [key, fact] of this.facts.entries()) {
      if (
        fact.targetId === args.targetId &&
        fact.day >= args.fromDay &&
        fact.day <= args.toDay
      ) {
        this.facts.delete(key);
      }
    }

    await this.upsertMany(args.facts);
  }

  public async listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
  }): Promise<SubredditDailyFact[]> {
    return Array.from(this.facts.values())
      .filter((fact) => {
        return (
          fact.targetId === args.targetId &&
          fact.day >= args.fromDay &&
          fact.day <= args.toDay
        );
      })
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  public async listLatestByTargetsInRange(args: {
    targetIds: string[];
    fromDay: string;
    toDay: string;
  }): Promise<SubredditDailyFact[]> {
    if (args.targetIds.length === 0) {
      return [];
    }

    const targetSet = new Set(args.targetIds);
    const latestByTarget = new Map<string, SubredditDailyFact>();
    for (const fact of this.facts.values()) {
      if (!targetSet.has(fact.targetId)) {
        continue;
      }
      if (fact.day < args.fromDay || fact.day > args.toDay) {
        continue;
      }
      const current = latestByTarget.get(fact.targetId);
      if (!current || fact.day > current.day) {
        latestByTarget.set(fact.targetId, fact);
      }
    }

    return Array.from(latestByTarget.values()).sort((a, b) => a.targetId.localeCompare(b.targetId));
  }

  public all(): SubredditDailyFact[] {
    return Array.from(this.facts.values());
  }
}

export class InMemorySubredditCollectionCoverageRepository
  implements SubredditCollectionCoverageRepository
{
  private readonly rows = new Map<string, SubredditCollectionCoverage>();

  public async upsertMany(rows: SubredditCollectionCoverage[]): Promise<void> {
    for (const row of rows) {
      this.rows.set(`${row.targetId}|${row.day}`, row);
    }
  }

  public async replaceRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
    rows: SubredditCollectionCoverage[];
  }): Promise<void> {
    for (const [key, row] of this.rows.entries()) {
      if (
        row.targetId === args.targetId &&
        row.day >= args.fromDay &&
        row.day <= args.toDay
      ) {
        this.rows.delete(key);
      }
    }
    await this.upsertMany(args.rows);
  }

  public async listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
  }): Promise<SubredditCollectionCoverage[]> {
    return Array.from(this.rows.values())
      .filter((row) => (
        row.targetId === args.targetId &&
        row.day >= args.fromDay &&
        row.day <= args.toDay
      ))
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  public all(): SubredditCollectionCoverage[] {
    return Array.from(this.rows.values());
  }
}

export class InMemoryKeywordTrendDailyRepository implements KeywordTrendDailyRepository {
  private readonly rows = new Map<string, KeywordTrendDaily>();

  public async upsertMany(rows: KeywordTrendDaily[]): Promise<void> {
    for (const row of rows) {
      const key = `${row.targetId}|${row.day}|${row.track}|${row.normalizedQueryText}|${row.queryScope}`;
      this.rows.set(key, row);
    }
  }

  public async listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
    keywords?: string[];
    tracks?: Array<"auto_keyword" | "explicit_query">;
    queryScopes?: Array<"subreddit" | "global">;
    limit?: number;
  }): Promise<KeywordTrendDaily[]> {
    const keywords =
      args.keywords && args.keywords.length > 0
        ? new Set(args.keywords.map((item) => item.trim().toLowerCase()))
        : null;
    const tracks = args.tracks && args.tracks.length > 0 ? new Set(args.tracks) : null;
    const queryScopes =
      args.queryScopes && args.queryScopes.length > 0 ? new Set(args.queryScopes) : null;
    const limit = args.limit ?? 10;

    const allRows = Array.from(this.rows.values()).filter((row) => {
      if (row.targetId !== args.targetId) {
        return false;
      }
      if (row.day < args.fromDay || row.day > args.toDay) {
        return false;
      }
      if (keywords && !keywords.has(row.normalizedQueryText) && !keywords.has(row.keyword)) {
        return false;
      }
      if (tracks && !tracks.has(row.track)) {
        return false;
      }
      if (queryScopes && !queryScopes.has(row.queryScope)) {
        return false;
      }
      return true;
    });

    if (keywords || tracks || queryScopes) {
      return allRows.sort((a, b) => {
        const byTrack = a.track.localeCompare(b.track);
        if (byTrack !== 0) {
          return byTrack;
        }
        const byKeyword = a.normalizedQueryText.localeCompare(b.normalizedQueryText);
        if (byKeyword !== 0) {
          return byKeyword;
        }
        return a.day.localeCompare(b.day);
      });
    }

    const totals = new Map<string, number>();
    for (const row of allRows) {
      if (row.track !== "auto_keyword") {
        continue;
      }
      totals.set(
        row.normalizedQueryText,
        (totals.get(row.normalizedQueryText) ?? 0) + row.matchedPosts,
      );
    }
    const topKeywords = new Set(
      Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([keyword]) => keyword),
    );

    return allRows
      .filter((row) => row.track === "auto_keyword" && topKeywords.has(row.normalizedQueryText))
      .sort((a, b) => {
        const byTrack = a.track.localeCompare(b.track);
        if (byTrack !== 0) {
          return byTrack;
        }
        const byKeyword = a.normalizedQueryText.localeCompare(b.normalizedQueryText);
        if (byKeyword !== 0) {
          return byKeyword;
        }
        return a.day.localeCompare(b.day);
      });
  }

  public async listByQueryInRange(args: {
    normalizedQueryText: string;
    fromDay: string;
    toDay: string;
    track?: "auto_keyword" | "explicit_query";
    queryScope?: "subreddit" | "global";
    limit?: number;
  }): Promise<KeywordTrendDaily[]> {
    const normalizedQueryText = args.normalizedQueryText.trim().toLowerCase();
    const rows = Array.from(this.rows.values())
      .filter((row) => {
        if (row.normalizedQueryText !== normalizedQueryText) {
          return false;
        }
        if (row.day < args.fromDay || row.day > args.toDay) {
          return false;
        }
        if (args.track && row.track !== args.track) {
          return false;
        }
        if (args.queryScope && row.queryScope !== args.queryScope) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const byDay = a.day.localeCompare(b.day);
        if (byDay !== 0) {
          return byDay;
        }
        return a.targetId.localeCompare(b.targetId);
      });
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
        ? Math.max(1, Math.trunc(args.limit))
        : undefined;
    return limit ? rows.slice(0, limit) : rows;
  }

  public all(): KeywordTrendDaily[] {
    return Array.from(this.rows.values());
  }
}

export class InMemoryAnomalyEventRepository implements AnomalyEventRepository {
  private readonly rows = new Map<string, AnomalyEvent>();

  public async upsertMany(rows: AnomalyEvent[]): Promise<void> {
    for (const row of rows) {
      const key = `${row.targetId}|${row.signalType}|${row.signalKey}|${row.observedAt}`;
      this.rows.set(key, row);
    }
  }

  public async listByTargetInRange(args: {
    targetId: string;
    fromIso: string;
    toIso: string;
    signalTypes?: Array<"volume" | "quality" | "keyword" | "driver">;
    limit?: number;
  }): Promise<AnomalyEvent[]> {
    const signalTypes =
      args.signalTypes && args.signalTypes.length > 0 ? new Set(args.signalTypes) : null;

    return Array.from(this.rows.values())
      .filter((row) => {
        if (row.targetId !== args.targetId) {
          return false;
        }
        if (row.observedAt < args.fromIso || row.observedAt > args.toIso) {
          return false;
        }
        if (signalTypes && !signalTypes.has(row.signalType)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const byObserved = a.observedAt.localeCompare(b.observedAt);
        if (byObserved !== 0) {
          return byObserved;
        }
        const bySignalType = a.signalType.localeCompare(b.signalType);
        if (bySignalType !== 0) {
          return bySignalType;
        }
        return a.signalKey.localeCompare(b.signalKey);
      })
      .slice(0, args.limit ?? 500);
  }

  public all(): AnomalyEvent[] {
    return Array.from(this.rows.values());
  }
}

export class InMemoryPostGrowthFactRepository implements PostGrowthFactRepository {
  private readonly rows = new Map<string, PostGrowthFact>();

  public async upsertMany(rows: PostGrowthFact[]): Promise<void> {
    for (const row of rows) {
      const key = `${row.targetId}|${row.contentId}|${row.ageBucket}|${row.observedAt}`;
      this.rows.set(key, row);
    }
  }

  public async listByTargetInRange(args: {
    targetId: string;
    fromIso: string;
    toIso: string;
    ageBuckets?: Array<"1h" | "6h" | "24h">;
    limit?: number;
  }): Promise<PostGrowthFact[]> {
    const limit = args.limit ?? 500;

    return this.filterRows(args)
      .sort((a, b) => {
        const byObserved = a.observedAt.localeCompare(b.observedAt);
        if (byObserved !== 0) {
          return byObserved;
        }
        const byBucket = a.ageBucket.localeCompare(b.ageBucket);
        if (byBucket !== 0) {
          return byBucket;
        }
        return a.contentId.localeCompare(b.contentId);
      })
      .slice(0, limit);
  }

  public async listTopByTargetInRange(args: {
    targetId: string;
    fromIso: string;
    toIso: string;
    ageBuckets?: Array<"1h" | "6h" | "24h">;
    limit?: number;
  }): Promise<PostGrowthFact[]> {
    const bestByContentId = new Map<string, PostGrowthFact>();
    for (const row of this.filterRows(args)) {
      const current = bestByContentId.get(row.contentId);
      if (!current || compareDriverRows(row, current) < 0) {
        bestByContentId.set(row.contentId, row);
      }
    }

    return Array.from(bestByContentId.values())
      .sort(compareDriverRows)
      .slice(0, args.limit ?? 25);
  }

  private filterRows(args: {
    targetId: string;
    fromIso: string;
    toIso: string;
    ageBuckets?: Array<"1h" | "6h" | "24h">;
  }): PostGrowthFact[] {
    const ageBuckets =
      args.ageBuckets && args.ageBuckets.length > 0 ? new Set(args.ageBuckets) : null;

    return Array.from(this.rows.values()).filter((row) => {
      if (row.targetId !== args.targetId) {
        return false;
      }
      if (row.observedAt < args.fromIso || row.observedAt > args.toIso) {
        return false;
      }
      if (ageBuckets && !ageBuckets.has(row.ageBucket)) {
        return false;
      }
      return true;
    });
  }

  public all(): PostGrowthFact[] {
    return Array.from(this.rows.values());
  }
}

function compareDriverRows(a: PostGrowthFact, b: PostGrowthFact): number {
  const byDriverScore = b.driverScore - a.driverScore;
  if (byDriverScore !== 0) {
    return byDriverScore;
  }
  const byObserved = b.observedAt.localeCompare(a.observedAt);
  if (byObserved !== 0) {
    return byObserved;
  }
  const byAgeMinutes = a.ageMinutes - b.ageMinutes;
  if (byAgeMinutes !== 0) {
    return byAgeMinutes;
  }
  return a.contentId.localeCompare(b.contentId);
}
