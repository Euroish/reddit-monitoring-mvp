import type {
  TargetComparisonWorkbenchResponse,
  WorkbenchComparableSeriesId,
} from "../../../packages/contracts/src/http";
import type { MonitorTarget } from "../../domain/entities/monitor-target";
import type { SubredditCollectionCoverage } from "../../domain/entities/subreddit-collection-coverage";
import type { SubredditDailyFact } from "../../domain/entities/subreddit-daily-fact";

const SERIES_DEFS: Array<{
  id: WorkbenchComparableSeriesId;
  label: string;
  unit: "score" | "count";
}> = [
  { id: "heat_price", label: "Heat Price", unit: "score" },
  { id: "ema_7", label: "EMA 7", unit: "score" },
  { id: "ema_30", label: "EMA 30", unit: "score" },
  { id: "activity_index", label: "Activity Index", unit: "score" },
  { id: "qualified_activity_index", label: "Qualified Activity Index", unit: "score" },
  { id: "activity_confidence", label: "Activity Confidence", unit: "score" },
  { id: "observed_new_posts", label: "Observed New Posts", unit: "count" },
  { id: "observed_qualified_posts", label: "Observed Qualified Posts", unit: "count" },
  { id: "total_new_posts", label: "Total New Posts", unit: "count" },
  { id: "qualified_post_count", label: "Qualified Posts", unit: "count" },
];

export const COMPARABLE_WORKBENCH_SERIES_IDS = SERIES_DEFS.map((series) => series.id);

export function buildTargetComparisonWorkbenchReadModel(args: {
  requestId: string;
  generatedAtIso: string;
  targets: MonitorTarget[];
  fromIso: string;
  toIso: string;
  timeframe?: "1d";
  rangePreset?: "7d" | "30d" | "90d";
  dailyFactsByTargetId: ReadonlyMap<string, readonly SubredditDailyFact[]>;
  coverageByTargetId?: ReadonlyMap<string, readonly SubredditCollectionCoverage[]>;
  seriesIds?: WorkbenchComparableSeriesId[];
}): TargetComparisonWorkbenchResponse {
  const seriesIds = args.seriesIds && args.seriesIds.length > 0
    ? args.seriesIds
    : (["heat_price"] as WorkbenchComparableSeriesId[]);
  const selectedSeries = SERIES_DEFS.filter((definition) => seriesIds.includes(definition.id));
  const dayCount = Math.max(1, Math.ceil((Date.parse(args.toIso) - Date.parse(args.fromIso)) / 86_400_000));

  return {
    ok: true,
    requestId: args.requestId,
    generatedAtIso: args.generatedAtIso,
    range: {
      fromIso: args.fromIso,
      toIso: args.toIso,
      grain: "day",
      dayCount,
      timeframe: args.timeframe ?? "1d",
      ...(args.rangePreset ? { rangePreset: args.rangePreset } : {}),
    },
    series: selectedSeries,
    targets: args.targets.map((target) => ({
      targetId: target.id,
      canonicalName: target.canonicalName,
      displayName: target.canonicalName,
      targetType: "subreddit",
    })),
    comparisons: args.targets.flatMap((target) => {
      const facts = [...(args.dailyFactsByTargetId.get(target.id) ?? [])].sort((a, b) =>
        a.day.localeCompare(b.day),
      );
      const coverageByDay = new Map(
        [...(args.coverageByTargetId?.get(target.id) ?? [])].map((coverage) => [coverage.day, coverage]),
      );
      return selectedSeries.map((series) =>
        buildComparisonSeries(target, facts, series.id, coverageByDay),
      );
    }),
    summary: args.targets.map((target) => {
      const facts = [...(args.dailyFactsByTargetId.get(target.id) ?? [])].sort((a, b) =>
        a.day.localeCompare(b.day),
      );
      const latest = facts.at(-1);
      const coverageByDay = new Map(
        [...(args.coverageByTargetId?.get(target.id) ?? [])].map((coverage) => [coverage.day, coverage]),
      );
      const latestCoverage = latest ? coverageByDay.get(latest.day) : undefined;
      return {
        targetId: target.id,
        canonicalName: target.canonicalName,
        latestHeatPrice: latest ? latest.heatPrice : null,
        latestTotalNewPosts:
          latest && latestCoverage?.coverageStatus === "complete" ? latest.postVolume : null,
        latestQualifiedPostCount:
          latest && latestCoverage?.coverageStatus === "complete" ? latest.qualifiedPostVolume : null,
      };
    }),
  };
}

function buildComparisonSeries(
  target: MonitorTarget,
  facts: SubredditDailyFact[],
  seriesId: WorkbenchComparableSeriesId,
  coverageByDay: ReadonlyMap<string, SubredditCollectionCoverage>,
): TargetComparisonWorkbenchResponse["comparisons"][number] {
  const baselineFact = facts.find((fact) => {
    const value = valueForSeries(seriesId, fact, coverageByDay.get(fact.day));
    return value != null && value > 0;
  });
  const baselineValue = baselineFact
    ? valueForSeries(seriesId, baselineFact, coverageByDay.get(baselineFact.day))
    : null;
  const latestFact = facts.at(-1);
  const latestValue = latestFact
    ? valueForSeries(seriesId, latestFact, coverageByDay.get(latestFact.day))
    : null;

  return {
    targetId: target.id,
    canonicalName: target.canonicalName,
    seriesId,
    baselineValue,
    latestValue,
    latestNormalizedValue:
      baselineValue && latestValue != null ? normalizeValue(latestValue, baselineValue) : null,
    points: facts.map((fact) => {
      const coverage = coverageByDay.get(fact.day);
      const value = valueForSeries(seriesId, fact, coverage);
      return {
        at: fact.day,
        value,
        normalizedValue:
          baselineValue && value != null ? normalizeValue(value, baselineValue) : null,
        ...(isCoverageGatedSeries(seriesId)
          ? {
              coverageStatus: coverage?.coverageStatus ?? "unknown",
              ...(coverage?.coverageBasis ? { coverageBasis: coverage.coverageBasis } : {}),
              valueSemantics: resolveValueSemantics(seriesId, coverage),
            }
          : {}),
      };
    }),
  };
}

function normalizeValue(value: number, baselineValue: number): number {
  return Number(((value / baselineValue) * 100).toFixed(2));
}

function valueForSeries(
  seriesId: WorkbenchComparableSeriesId,
  fact: SubredditDailyFact,
  coverage?: SubredditCollectionCoverage,
): number | null {
  if (seriesId === "heat_price") return fact.heatPrice;
  if (seriesId === "ema_7") return fact.ema7;
  if (seriesId === "ema_30") return fact.ema30;
  if (seriesId === "activity_index") return fact.postVolume;
  if (seriesId === "qualified_activity_index") return fact.qualifiedPostVolume;
  if (seriesId === "activity_confidence") {
    return fact.postVolume > 0 ? Number(((fact.sampledPostVolume / fact.postVolume) * 100).toFixed(6)) : 0;
  }
  if ((seriesId === "total_new_posts" || seriesId === "qualified_post_count") && coverage?.coverageStatus !== "complete") {
    return null;
  }
  if (seriesId === "total_new_posts") return fact.postVolume;
  if (seriesId === "observed_new_posts") return fact.postVolume;
  if (seriesId === "observed_qualified_posts") return fact.qualifiedPostVolume;
  return fact.qualifiedPostVolume;
}

function isCoverageGatedSeries(seriesId: WorkbenchComparableSeriesId): boolean {
  return (
    seriesId === "observed_new_posts" ||
    seriesId === "observed_qualified_posts" ||
    seriesId === "total_new_posts" ||
    seriesId === "qualified_post_count"
  );
}

function resolveValueSemantics(
  seriesId: WorkbenchComparableSeriesId,
  coverage: SubredditCollectionCoverage | undefined,
): "complete_total" | "observed_total" | "missing" {
  if ((seriesId === "total_new_posts" || seriesId === "qualified_post_count") && coverage?.coverageStatus === "complete") {
    return "complete_total";
  }
  if (seriesId === "total_new_posts" || seriesId === "qualified_post_count") {
    return "missing";
  }
  return "observed_total";
}
