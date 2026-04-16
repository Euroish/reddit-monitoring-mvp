import type { KeywordTrendDaily } from "../../../domain/entities/keyword-trend-daily";
import type { MonitorTarget } from "../../../domain/entities/monitor-target";
import type { SubredditDailyFact } from "../../../domain/entities/subreddit-daily-fact";
import type { SubredditTrendPoint } from "../../../domain/entities/subreddit-trend-point";
import type { KeywordTrendDailyRepository } from "../../../domain/repositories/keyword-trend-daily-repository";
import type { MonitorTargetRepository } from "../../../domain/repositories/monitor-target-repository";
import type { RawEventRepository } from "../../../domain/repositories/raw-event-repository";
import type { SubredditDailyFactRepository } from "../../../domain/repositories/subreddit-daily-fact-repository";
import type { SubredditTrendPointRepository } from "../../../domain/repositories/subreddit-trend-point-repository";
import type { RawEnvelope } from "../../../connectors/shared/connector.interface";

export class InMemoryRawEventRepository implements RawEventRepository {
  private readonly events: Array<{
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope;
  }> = [];

  public async append<TPayload>(event: {
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope<TPayload>;
  }): Promise<void> {
    this.events.push(event);
  }

  public all(): Array<{
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope;
  }> {
    return [...this.events];
  }
}

export class InMemoryMonitorTargetRepository implements MonitorTargetRepository {
  private readonly byCanonicalName = new Map<string, MonitorTarget>();

  public async findActiveSubreddits(): Promise<MonitorTarget[]> {
    return Array.from(this.byCanonicalName.values()).filter(
      (target) => target.targetType === "subreddit" && target.status === "active",
    );
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

export class InMemoryKeywordTrendDailyRepository implements KeywordTrendDailyRepository {
  private readonly rows = new Map<string, KeywordTrendDaily>();

  public async upsertMany(rows: KeywordTrendDaily[]): Promise<void> {
    for (const row of rows) {
      const key = `${row.targetId}|${row.day}|${row.keyword}`;
      this.rows.set(key, row);
    }
  }

  public async listByTargetInRange(args: {
    targetId: string;
    fromDay: string;
    toDay: string;
    keywords?: string[];
    limit?: number;
  }): Promise<KeywordTrendDaily[]> {
    const keywords =
      args.keywords && args.keywords.length > 0
        ? new Set(args.keywords.map((item) => item.trim().toLowerCase()))
        : null;
    const limit = args.limit ?? 10;

    const allRows = Array.from(this.rows.values()).filter((row) => {
      if (row.targetId !== args.targetId) {
        return false;
      }
      if (row.day < args.fromDay || row.day > args.toDay) {
        return false;
      }
      if (keywords && !keywords.has(row.keyword)) {
        return false;
      }
      return true;
    });

    if (keywords) {
      return allRows.sort((a, b) => {
        const byKeyword = a.keyword.localeCompare(b.keyword);
        if (byKeyword !== 0) {
          return byKeyword;
        }
        return a.day.localeCompare(b.day);
      });
    }

    const totals = new Map<string, number>();
    for (const row of allRows) {
      totals.set(row.keyword, (totals.get(row.keyword) ?? 0) + row.matchedPosts);
    }
    const topKeywords = new Set(
      Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([keyword]) => keyword),
    );

    return allRows
      .filter((row) => topKeywords.has(row.keyword))
      .sort((a, b) => {
        const byKeyword = a.keyword.localeCompare(b.keyword);
        if (byKeyword !== 0) {
          return byKeyword;
        }
        return a.day.localeCompare(b.day);
      });
  }

  public all(): KeywordTrendDaily[] {
    return Array.from(this.rows.values());
  }
}
