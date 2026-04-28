import type {
  TargetComparisonWorkbenchResponse,
  WorkbenchComparableSeriesId,
} from "../../../packages/contracts/src/http";
import type { MonitorTarget } from "../../domain/entities/monitor-target";
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
      return selectedSeries.map((series) => buildComparisonSeries(target, facts, series.id));
    }),
    summary: args.targets.map((target) => {
      const facts = [...(args.dailyFactsByTargetId.get(target.id) ?? [])].sort((a, b) =>
        a.day.localeCompare(b.day),
      );
      const latest = facts.at(-1);
      return {
        targetId: target.id,
        canonicalName: target.canonicalName,
        latestHeatPrice: latest ? latest.heatPrice : null,
        latestTotalNewPosts: latest ? latest.postVolume : null,
        latestQualifiedPostCount: latest ? latest.qualifiedPostVolume : null,
      };
    }),
  };
}

function buildComparisonSeries(
  target: MonitorTarget,
  facts: SubredditDailyFact[],
  seriesId: WorkbenchComparableSeriesId,
): TargetComparisonWorkbenchResponse["comparisons"][number] {
  const baselineFact = facts.find((fact) => valueForSeries(seriesId, fact) > 0);
  const baselineValue = baselineFact ? valueForSeries(seriesId, baselineFact) : null;
  const latestFact = facts.at(-1);
  const latestValue = latestFact ? valueForSeries(seriesId, latestFact) : null;

  return {
    targetId: target.id,
    canonicalName: target.canonicalName,
    seriesId,
    baselineValue,
    latestValue,
    latestNormalizedValue:
      baselineValue && latestValue != null ? normalizeValue(latestValue, baselineValue) : null,
    points: facts.map((fact) => {
      const value = valueForSeries(seriesId, fact);
      return {
        at: fact.day,
        value,
        normalizedValue: baselineValue ? normalizeValue(value, baselineValue) : null,
      };
    }),
  };
}

function normalizeValue(value: number, baselineValue: number): number {
  return Number(((value / baselineValue) * 100).toFixed(2));
}

function valueForSeries(seriesId: WorkbenchComparableSeriesId, fact: SubredditDailyFact): number {
  if (seriesId === "heat_price") return fact.heatPrice;
  if (seriesId === "ema_7") return fact.ema7;
  if (seriesId === "ema_30") return fact.ema30;
  if (seriesId === "activity_index") return fact.postVolume;
  if (seriesId === "qualified_activity_index") return fact.qualifiedPostVolume;
  if (seriesId === "activity_confidence") {
    return fact.postVolume > 0 ? Number(((fact.sampledPostVolume / fact.postVolume) * 100).toFixed(6)) : 0;
  }
  if (seriesId === "total_new_posts") return fact.postVolume;
  if (seriesId === "observed_new_posts") return fact.postVolume;
  if (seriesId === "observed_qualified_posts") return fact.qualifiedPostVolume;
  return fact.qualifiedPostVolume;
}
