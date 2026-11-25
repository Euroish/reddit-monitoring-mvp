import { parentPort, workerData } from "node:worker_threads";
import type { ContentPlatform } from "../../../packages/contracts/src/common";
import type {
  AnalysisBlock,
  L2ComparisonRequest,
  L2ComparisonResponse,
  L2GroupDistinctiveItem,
  L2HotTermSeries,
  L2MatrixCell,
  L2MultiSeriesTrendPoint,
  L2ObjectComparisonRow,
  L2OverlapCell,
  L2TermItem,
  L2WindowCompareRow,
  L2WindowTermShift,
} from "../../../packages/contracts/src/research";
import type { ResolvedResearchContext } from "../projects/index";
import { computePeriodDelta } from "./metrics";
import {
  computeDistinctiveTermsForGroups,
  computeTermCooccurrence,
  detectBucketAnomalies,
  extractNgrams,
  extractTfIdfKeywords,
  tokenizeClauses,
} from "./text-analysis";

const METHOD_VERSION = "1.0.0";

type ComparisonContext = Pick<ResolvedResearchContext, "scope" | "dataVersion"> & {
  project: Pick<ResolvedResearchContext["project"], "id" | "name">;
};

export interface L2Inputs {
  total: Array<{ total_count: number; undated_count: number }>;
  object_stats: Array<{
    obj_key: string;
    obj_label: string;
    obj_type: string;
    content_count: number;
    posts_count: number;
    comments_count: number;
    exclusive_count: number;
    avg_eng: number;
    reported_comments_sum: string;
  }>;
  object_trends: Array<{ bucket_utc: string; obj_key: string; obj_label: string; cnt: number }>;
  object_platforms: Array<{ obj_key: string; obj_label: string; platform: ContentPlatform; cnt: number }>;
  object_communities: Array<{ obj_key: string; obj_label: string; community_name: string; platform: ContentPlatform; cnt: number }>;
  overlaps: Array<{ row_key: string; col_key: string; inter_cnt: number }>;
  text_docs: string;
}

type TextDocument = {
  id: string;
  title: string | null;
  body_text: string | null;
  clean_excerpt: string | null;
  ts_utc: string | null;
  engagement_score: number;
  obj_keys: string[];
};

export interface L2AnalysisJob {
  ctx: ComparisonContext;
  request: L2ComparisonRequest;
  inputs: L2Inputs;
}

function interpretTermsBlock(
  titleZh: string,
  items: readonly L2TermItem[],
  emptySel: boolean,
  lang: "zh" | "en",
): { summaryText: string; summaryBullets: string[] } {
  if (emptySel) {
    return {
      summaryText: lang === "zh" ? "当前未选择任何研究范围，请在上方选择关键词或批次。" : "No targets selected.",
      summaryBullets: [],
    };
  }
  if (items.length === 0) {
    return {
      summaryText: lang === "zh" ? `当前样本内暂无达到频次阈值的${titleZh}。` : `No significant ${titleZh} found in current scope.`,
      summaryBullets: [],
    };
  }
  const top3 = items.slice(0, 3).map((i) => `${i.term} (${i.docCount} 条 / ${i.sharePct}%)`).join("、");
  if (lang === "zh") {
    return {
      summaryText: `${titleZh}排名靠前的核心表达为：${top3}。`,
      summaryBullets: [`排名第一的「${items[0].term}」出现在 ${items[0].docCount} 条去重内容中，覆盖率 ${items[0].sharePct}%。`],
    };
  }
  const enTop3 = items.slice(0, 3).map((i) => `${i.term} (${i.docCount} docs, ${i.sharePct}%)`).join(", ");
  return {
    summaryText: `Leading ${titleZh}: ${enTop3}.`,
    summaryBullets: [`Top item "${items[0].term}" appears in ${items[0].docCount} items (${items[0].sharePct}%).`],
  };
}

function emptyBlock<T>(
  ctx: ComparisonContext,
  analysisId: string,
  groupingBasis: AnalysisBlock["methodology"]["groupingBasis"],
  data: T,
  summaryText: string,
  generatedAt: string,
  lang: "zh" | "en",
  notes: string[] = [],
): AnalysisBlock<T> {
  return {
    analysisId,
    methodVersion: METHOD_VERSION,
    projectId: ctx.project.id,
    scope: ctx.scope,
    dataVersion: ctx.dataVersion,
    sampleCount: 0,
    coverage: {
      model: ctx.scope.emptySelection ? "empty_scope" : "stored_sample",
      label: ctx.scope.emptySelection ? "未选择研究范围" : "项目已采集样本",
      datedCount: 0,
      undatedCount: 0,
      isCompleteScope: !ctx.scope.emptySelection,
    },
    methodology: {
      dedupBasis: "canonical_content_id",
      groupingBasis,
      denominatorLabel: lang === "zh" ? "去重样本数" : "Deduplicated items",
      denominatorValue: 0,
      multiMembershipAllowed: groupingBasis === "collection_target",
      notes,
    },
    summaryText,
    summaryBullets: [],
    data,
    generatedAt,
    status: "empty",
  };
}

export function analyzeL2({ ctx, request, inputs }: L2AnalysisJob): L2ComparisonResponse {
  const lang = request.lang ?? "zh";
  const compareMode = request.compareMode ?? "target";
  const topN = Math.max(8, Math.min(40, request.topN ?? 20));
  const sensitivity = request.anomalySensitivity ?? "medium";
  const generatedAt = new Date().toISOString();

  if (ctx.scope.emptySelection) {
    const msg = lang === "zh" ? "当前未选择研究对象或批次。" : "No targets or batches selected.";
    const mk = <T>(id: string, basis: AnalysisBlock["methodology"]["groupingBasis"], data: T) =>
      emptyBlock(ctx, id, basis, data, msg, generatedAt, lang);
    return {
      projectId: ctx.project.id,
      projectName: ctx.project.name,
      dataVersion: ctx.dataVersion,
      cacheStatus: "miss",
      sampledCount: 0,
      totalInScope: 0,
      isSampled: false,
      generatedAt,
      scope: ctx.scope,
      compareMode,
      analyses: {
        unigrams: mk("L2-01", "none", { items: [] }),
        bigrams: mk("L2-02", "none", { items: [] }),
        trigrams: mk("L2-03", "none", { items: [] }),
        tfidf: mk("L2-04", "none", { items: [] }),
        cooccurrence: mk("L2-05", "none", { terms: [], cells: [], topPairs: [] }),
        objectCounts: mk("L2-06", "collection_target", { rows: [], deduplicatedTotal: 0 }),
        objectTrends: mk("L2-07", "time_bucket", { points: [], objects: [] }),
        objectPlatformMatrix: mk("L2-08", "collection_target", { rows: [], cols: [], cells: [] }),
        objectCommunityMatrix: mk("L2-09", "collection_target", { rows: [], cols: [], cells: [] }),
        objectDistinctiveTerms: mk("L2-10", "collection_target", { groups: [] }),
        overlapMatrix: mk("L2-11", "collection_target", { objects: [], cells: [] }),
        windowComparison: mk("L2-12", "time_bucket", {
          splitAt: generatedAt,
          beforeLabel: "",
          afterLabel: "",
          beforeCount: 0,
          afterCount: 0,
          metrics: [],
        }),
        hotTermTrends: mk("L2-13", "time_bucket", { buckets: [], series: [] }),
        anomalyDetection: mk("L2-14", "time_bucket", {
          sensitivity,
          thresholdZ: 2.0,
          anomalyCount: 0,
          points: [],
        }),
        windowTermShifts: mk("L2-15", "time_bucket", { splitAt: generatedAt, rising: [], falling: [] }),
      },
    };
  }

  const dedupTotal = inputs.total[0]?.total_count ?? 0;
  const undatedCount = inputs.total[0]?.undated_count ?? 0;
  const datedCount = Math.max(0, dedupTotal - undatedCount);
  const sampledDocs = JSON.parse(inputs.text_docs) as TextDocument[];
  const isSampled = dedupTotal > sampledDocs.length;

  // Tokenize sampled text docs once
  const tokenizedDocs = sampledDocs.map((row) => {
    const raw = [row.title, row.body_text || row.clean_excerpt].filter(Boolean).join(" ");
    const clauses = tokenizeClauses(raw, { maxTokensPerDoc: 220 });
    const flatSet = new Set(clauses.flat());
    const bucket = row.ts_utc ? row.ts_utc.slice(0, 10) : null;
    return {
      id: row.id,
      clauses,
      tokenSet: flatSet,
      tsMs: row.ts_utc ? Date.parse(row.ts_utc) : null,
      bucket,
      engagementScore: Number(row.engagement_score ?? 0),
      objKeys: row.obj_keys ?? [],
    };
  });

  // L2-01..L2-05: Text features
  const unigrams = extractNgrams(tokenizedDocs, 1, topN);
  const bigrams = extractNgrams(tokenizedDocs, 2, topN);
  const trigrams = extractNgrams(tokenizedDocs, 3, topN);
  const tfidf = extractTfIdfKeywords(tokenizedDocs, topN);
  const cooccurrence = computeTermCooccurrence(tokenizedDocs, 14);

  const mkBlock = <T>(
    analysisId: string,
    groupingBasis: AnalysisBlock["methodology"]["groupingBasis"],
    sampleCount: number,
    data: T,
    interp: { summaryText: string; summaryBullets: string[] },
    notes: string[] = [],
  ): AnalysisBlock<T> => ({
    analysisId,
    methodVersion: METHOD_VERSION,
    projectId: ctx.project.id,
    scope: ctx.scope,
    dataVersion: ctx.dataVersion,
    sampleCount,
    coverage: {
      model: isSampled && ["L2-01", "L2-02", "L2-03", "L2-04", "L2-05", "L2-10", "L2-13", "L2-15"].includes(analysisId)
        ? "partial_sample"
        : "stored_sample",
      label: isSampled ? `基于按热度优先抽样 ${sampledDocs.length}/${dedupTotal} 条` : "项目已采集样本",
      datedCount,
      undatedCount,
      isCompleteScope: !isSampled,
    },
    methodology: {
      dedupBasis: "canonical_content_id",
      groupingBasis,
      denominatorLabel: lang === "zh" ? "当前范围内唯一内容数" : "Deduplicated items",
      denominatorValue: sampleCount,
      multiMembershipAllowed: groupingBasis === "collection_target",
      notes,
    },
    summaryText: interp.summaryText,
    summaryBullets: interp.summaryBullets,
    data,
    generatedAt,
    status: sampleCount === 0 ? "empty" : "ok",
  });

  // L2-06: Object counts comparison
  const objRows: L2ObjectComparisonRow[] = inputs.object_stats.map((r) => ({
    objectKey: r.obj_key,
    label: r.obj_label,
    objectType: r.obj_type,
    contentCount: r.content_count,
    postsCount: r.posts_count,
    commentsCount: r.comments_count,
    sharePct: dedupTotal > 0 ? Number(((r.content_count / dedupTotal) * 100).toFixed(1)) : 0,
    exclusiveCount: r.exclusive_count,
    overlapCount: Math.max(0, r.content_count - r.exclusive_count),
    avgEngagementScore: Number(r.avg_eng.toFixed(2)),
    reportedCommentsSum: Number(r.reported_comments_sum),
  }));

  const objCountInterp = (() => {
    if (objRows.length === 0) return { summaryText: lang === "zh" ? "暂无比较对象。" : "No comparison objects.", summaryBullets: [] };
    if (objRows.length === 1) {
      return {
        summaryText: lang === "zh"
          ? `当前仅选中 1 个对象「${objRows[0].label}」（共 ${objRows[0].contentCount} 条内容），增加第二个对象即可进行横向对比。`
          : `Single object "${objRows[0].label}" (${objRows[0].contentCount} items). Add another target to compare side-by-side.`,
        summaryBullets: [],
      };
    }
    const top = objRows[0];
    const second = objRows[1];
    const text = lang === "zh"
      ? `共对比 ${objRows.length} 个对象：「${top.label}」内容量最高（${top.contentCount} 条，独占 ${top.exclusiveCount} 条，篇均互动分 ${top.avgEngagementScore}），其次为「${second.label}」（${second.contentCount} 条）。`
      : `Comparing ${objRows.length} objects: "${top.label}" leads with ${top.contentCount} items (${top.exclusiveCount} exclusive), followed by "${second.label}" (${second.contentCount}).`;
    return { summaryText: text, summaryBullets: [text] };
  })();

  // L2-07: Object trend series
  const objectsList = objRows.map((o) => ({ key: o.objectKey, label: o.label }));
  const trendBucketsMap = new Map<string, Map<string, number>>();
  for (const r of inputs.object_trends) {
    const bKey = r.bucket_utc.slice(0, 10);
    if (!trendBucketsMap.has(bKey)) trendBucketsMap.set(bKey, new Map());
    trendBucketsMap.get(bKey)!.set(r.obj_key, r.cnt);
  }
  const objTrendPoints: L2MultiSeriesTrendPoint[] = [...trendBucketsMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, m]) => {
      const total = [...m.values()].reduce((acc, v) => acc + v, 0);
      return {
        bucket,
        totalCount: total,
        series: objectsList.map((o) => {
          const cnt = m.get(o.key) ?? 0;
          return {
            objectKey: o.key,
            label: o.label,
            count: cnt,
            sharePct: total > 0 ? Number(((cnt / total) * 100).toFixed(1)) : 0,
          };
        }),
      };
    });

  // L2-08: Object x Platform matrix
  const objTotalMap = new Map(objRows.map((o) => [o.objectKey, o.contentCount]));
  const platCols = ([...new Set(inputs.object_platforms.map((r) => r.platform))] as ContentPlatform[]).map((p) => ({
    key: p,
    label: p.toUpperCase(),
  }));
  const objPlatCells: L2MatrixCell[] = inputs.object_platforms.map((r) => {
    const denom = objTotalMap.get(r.obj_key) ?? r.cnt;
    return {
      objectKey: r.obj_key,
      objectLabel: r.obj_label,
      colKey: r.platform,
      colLabel: r.platform.toUpperCase(),
      count: r.cnt,
      sharePct: denom > 0 ? Number(((r.cnt / denom) * 100).toFixed(1)) : 0,
    };
  });

  // L2-09: Object x Community matrix (top 10 communities by total mentions)
  const commTotals = new Map<string, { label: string; sum: number }>();
  for (const r of inputs.object_communities) {
    const lbl = r.platform === "reddit" && !r.community_name.startsWith("r/") ? `r/${r.community_name}` : r.community_name;
    const prev = commTotals.get(r.community_name) ?? { label: lbl, sum: 0 };
    prev.sum += r.cnt;
    commTotals.set(r.community_name, prev);
  }
  const topCommunities = [...commTotals.entries()]
    .sort((a, b) => b[1].sum - a[1].sum)
    .slice(0, 10);
  const topCommSet = new Set(topCommunities.map(([k]) => k));
  const objCommCells: L2MatrixCell[] = inputs.object_communities
    .filter((r) => topCommSet.has(r.community_name))
    .map((r) => {
      const denom = objTotalMap.get(r.obj_key) ?? r.cnt;
      return {
        objectKey: r.obj_key,
        objectLabel: r.obj_label,
        colKey: r.community_name,
        colLabel: commTotals.get(r.community_name)?.label ?? r.community_name,
        count: r.cnt,
        sharePct: denom > 0 ? Number(((r.cnt / denom) * 100).toFixed(1)) : 0,
      };
    });

  // L2-10: Distinctive terms per object
  const docSetsOnly = tokenizedDocs.map((d) => d.tokenSet);
  const groupIndices = objRows.slice(0, 10).map((o) => {
    const docIndices: number[] = [];
    tokenizedDocs.forEach((d, idx) => {
      if (d.objKeys.includes(o.objectKey)) docIndices.push(idx);
    });
    return { objectKey: o.objectKey, label: o.label, docIndices };
  });
  const distinctiveGroups: L2GroupDistinctiveItem[] = computeDistinctiveTermsForGroups(groupIndices, docSetsOnly, 10);

  // L2-11: Jaccard Overlap Matrix J(A,B) = |A∩B| / |A∪B|
  const interMap = new Map<string, number>();
  for (const r of inputs.overlaps) {
    interMap.set(`${r.row_key}\u0000${r.col_key}`, r.inter_cnt);
  }
  const overlapObjects = objRows.map((o) => ({ key: o.objectKey, label: o.label, count: o.contentCount }));
  const overlapCells: L2OverlapCell[] = [];
  let maxPairJaccard: { a: string; b: string; jaccardPct: number; inter: number } | null = null;
  for (let i = 0; i < overlapObjects.length; i++) {
    for (let j = 0; j < overlapObjects.length; j++) {
      const a = overlapObjects[i];
      const b = overlapObjects[j];
      const inter = i === j ? a.count : (interMap.get(`${a.key}\u0000${b.key}`) ?? 0);
      const union = Math.max(1, a.count + b.count - inter);
      const jaccardPct = a.count === 0 && b.count === 0 ? 0 : Number(((inter / union) * 100).toFixed(1));
      overlapCells.push({
        rowKey: a.key,
        rowLabel: a.label,
        colKey: b.key,
        colLabel: b.label,
        intersectionCount: inter,
        unionCount: a.count + b.count - inter,
        jaccardPct,
      });
      if (i < j && (!maxPairJaccard || jaccardPct > maxPairJaccard.jaccardPct)) {
        maxPairJaccard = { a: a.label, b: b.label, jaccardPct, inter };
      }
    }
  }

  // L2-12: Window Comparison & L2-15 Window Term Shifts
  const datedTimes = tokenizedDocs.map((d) => d.tsMs).filter((t): t is number => t !== null).sort((a, b) => a - b);
  const splitMs = request.windowSplitAt
    ? Date.parse(request.windowSplitAt)
    : datedTimes.length >= 2
      ? Math.floor((datedTimes[0] + datedTimes[datedTimes.length - 1]) / 2)
      : Date.now();
  const splitAtIso = new Date(Number.isFinite(splitMs) ? splitMs : Date.now()).toISOString();

  const beforeDocs = tokenizedDocs.filter((d) => d.tsMs !== null && d.tsMs < splitMs);
  const afterDocs = tokenizedDocs.filter((d) => d.tsMs !== null && d.tsMs >= splitMs);
  const avgEng = (list: typeof tokenizedDocs) =>
    list.length ? Number((list.reduce((s, d) => s + d.engagementScore, 0) / list.length).toFixed(2)) : 0;

  const volDelta = computePeriodDelta(afterDocs.length, beforeDocs.length);
  const engDelta = computePeriodDelta(avgEng(afterDocs), avgEng(beforeDocs));
  const windowMetrics: L2WindowCompareRow[] = [
    {
      metric: "volume",
      label: lang === "zh" ? "内容总量" : "Content Volume",
      previousValue: beforeDocs.length,
      currentValue: afterDocs.length,
      delta: volDelta.delta,
      deltaPct: volDelta.deltaPct,
      status: volDelta.status,
    },
    {
      metric: "avgEngagement",
      label: lang === "zh" ? "篇均互动分" : "Avg Engagement",
      previousValue: avgEng(beforeDocs),
      currentValue: avgEng(afterDocs),
      delta: engDelta.delta,
      deltaPct: engDelta.deltaPct,
      status: engDelta.status,
    },
  ];

  // Term shifts between before and after
  const beforeDf = new Map<string, number>();
  const afterDf = new Map<string, number>();
  for (const d of beforeDocs) for (const t of d.tokenSet) beforeDf.set(t, (beforeDf.get(t) ?? 0) + 1);
  for (const d of afterDocs) for (const t of d.tokenSet) afterDf.set(t, (afterDf.get(t) ?? 0) + 1);
  const allShiftTerms = new Set([...beforeDf.keys(), ...afterDf.keys()]);
  const shiftList: L2WindowTermShift[] = [];
  for (const term of allShiftTerms) {
    const bc = beforeDf.get(term) ?? 0;
    const ac = afterDf.get(term) ?? 0;
    if (bc + ac < (tokenizedDocs.length >= 15 ? 3 : 1)) continue;
    const bPct = beforeDocs.length > 0 ? Number(((bc / beforeDocs.length) * 100).toFixed(1)) : 0;
    const aPct = afterDocs.length > 0 ? Number(((ac / afterDocs.length) * 100).toFixed(1)) : 0;
    const diff = Number((aPct - bPct).toFixed(1));
    if (Math.abs(diff) < 0.2) continue;
    shiftList.push({
      term,
      beforeCount: bc,
      afterCount: ac,
      beforeSharePct: bPct,
      afterSharePct: aPct,
      deltaPctPoints: diff,
      direction: diff > 0 ? "rising" : "falling",
    });
  }
  const rising = shiftList.filter((s) => s.direction === "rising").sort((a, b) => b.deltaPctPoints - a.deltaPctPoints).slice(0, 12);
  const falling = shiftList.filter((s) => s.direction === "falling").sort((a, b) => a.deltaPctPoints - b.deltaPctPoints).slice(0, 12);

  // L2-13 Hot Term Trends & L2-14 Anomaly Detection
  const dayBuckets = [...new Set(tokenizedDocs.map((d) => d.bucket).filter((b): b is string => Boolean(b)))].sort();
  const topTrackTerms = unigrams.slice(0, 6).map((t) => t.term);
  const hotTermSeries: L2HotTermSeries[] = topTrackTerms.map((term) => {
    const points = dayBuckets.map((b) => ({
      bucket: b,
      count: tokenizedDocs.filter((d) => d.bucket === b && d.tokenSet.has(term)).length,
    }));
    const first = points[0]?.count ?? 0;
    const last = points[points.length - 1]?.count ?? 0;
    const growthPct = first > 0 ? Number((((last - first) / first) * 100).toFixed(1)) : null;
    return {
      term,
      totalDocCount: unigrams.find((u) => u.term === term)?.docCount ?? 0,
      growthPct,
      points,
    };
  });

  const bucketSummaries = dayBuckets.map((b) => {
    const docsInBucket = tokenizedDocs.filter((d) => d.bucket === b);
    const termCnt = new Map<string, number>();
    for (const d of docsInBucket) for (const t of d.tokenSet) termCnt.set(t, (termCnt.get(t) ?? 0) + 1);
    const topTerms = [...termCnt.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(([t]) => t);
    const topItemIds = [...docsInBucket].sort((a, b2) => b2.engagementScore - a.engagementScore).slice(0, 3).map((d) => d.id);
    return { bucket: b, count: docsInBucket.length, topTerms, topItemIds };
  });
  const anomalyRes = detectBucketAnomalies(bucketSummaries, sensitivity);
  const anomalyCount = anomalyRes.points.filter((p) => p.isAnomaly).length;
  const peakAnomaly = anomalyRes.points.filter((p) => p.direction === "spike").sort((a, b) => b.zScore - a.zScore)[0];

  const overlapSummary = maxPairJaccard
    ? (lang === "zh"
        ? `最接近的对象组合为「${maxPairJaccard.a}」与「${maxPairJaccard.b}」，交集 ${maxPairJaccard.inter} 条，Jaccard 相似度 ${maxPairJaccard.jaccardPct}%。`
        : `Closest pair: "${maxPairJaccard.a}" & "${maxPairJaccard.b}" (${maxPairJaccard.inter} shared items, ${maxPairJaccard.jaccardPct}% Jaccard).`)
    : (lang === "zh" ? "需要至少 2 个对象才可计算 Jaccard 重叠度矩阵。" : "Select at least 2 objects to compute Jaccard overlap.");

  const anomalySummary = anomalyCount > 0 && peakAnomaly
    ? (lang === "zh"
        ? `共检测到 ${anomalyCount} 个异常波动时间桶；峰值出现在 ${peakAnomaly.bucket}（${peakAnomaly.count} 条，Z=${peakAnomaly.zScore}），关联热词：${peakAnomaly.topTerms.join("、") || "—"}。`
        : `Detected ${anomalyCount} anomalous bucket(s); highest spike on ${peakAnomaly.bucket} (${peakAnomaly.count} items, Z=${peakAnomaly.zScore}).`)
    : (lang === "zh" ? "当前时间序列波动处于基线正常区间，未触发突变告警。" : "No statistical volume spikes detected in current window.");

  return {
    projectId: ctx.project.id,
    projectName: ctx.project.name,
    dataVersion: ctx.dataVersion,
    cacheStatus: "miss",
    sampledCount: sampledDocs.length,
    totalInScope: dedupTotal,
    isSampled,
    generatedAt,
    scope: ctx.scope,
    compareMode,
    analyses: {
      unigrams: mkBlock("L2-01", "none", sampledDocs.length, { items: unigrams }, interpretTermsBlock(lang === "zh" ? "高频词" : "Unigrams", unigrams, false, lang)),
      bigrams: mkBlock("L2-02", "none", sampledDocs.length, { items: bigrams }, interpretTermsBlock(lang === "zh" ? "二元短语" : "Bigrams", bigrams, false, lang)),
      trigrams: mkBlock("L2-03", "none", sampledDocs.length, { items: trigrams }, interpretTermsBlock(lang === "zh" ? "三元表达" : "Trigrams", trigrams, false, lang)),
      tfidf: mkBlock("L2-04", "none", sampledDocs.length, { items: tfidf }, interpretTermsBlock(lang === "zh" ? "TF-IDF 特征词" : "TF-IDF Terms", tfidf, false, lang)),
      cooccurrence: mkBlock(
        "L2-05",
        "none",
        sampledDocs.length,
        cooccurrence,
        cooccurrence.topPairs.length > 0
          ? {
              summaryText: lang === "zh"
                ? `最强共现词对为「${cooccurrence.topPairs[0].termA} + ${cooccurrence.topPairs[0].termB}」（共现 ${cooccurrence.topPairs[0].coCount} 条，Lift=${cooccurrence.topPairs[0].lift}）。`
                : `Strongest pair: "${cooccurrence.topPairs[0].termA} + ${cooccurrence.topPairs[0].termB}" (${cooccurrence.topPairs[0].coCount} docs).`,
              summaryBullets: [],
            }
          : { summaryText: lang === "zh" ? "样本中暂无显著共现词对。" : "No co-occurring pairs above threshold.", summaryBullets: [] },
      ),
      objectCounts: mkBlock("L2-06", "collection_target", dedupTotal, { rows: objRows, deduplicatedTotal: dedupTotal }, objCountInterp),
      objectTrends: mkBlock(
        "L2-07",
        "time_bucket",
        datedCount,
        { points: objTrendPoints, objects: objectsList },
        {
          summaryText: objTrendPoints.length > 0
            ? (lang === "zh" ? `追踪了 ${objectsList.length} 个对象在 ${objTrendPoints.length} 个日期桶内的声量变化。` : `Tracked ${objectsList.length} objects across ${objTrendPoints.length} daily buckets.`)
            : (lang === "zh" ? "暂无带时间戳的对象趋势数据。" : "No dated trend points."),
          summaryBullets: [],
        },
      ),
      objectPlatformMatrix: mkBlock(
        "L2-08",
        "collection_target",
        dedupTotal,
        { rows: objectsList, cols: platCols, cells: objPlatCells },
        {
          summaryText: lang === "zh" ? `展示 ${objectsList.length} 个研究对象在 ${platCols.length} 个平台上的分布矩阵。` : `Distribution across ${objectsList.length} objects × ${platCols.length} platforms.`,
          summaryBullets: [],
        },
      ),
      objectCommunityMatrix: mkBlock(
        "L2-09",
        "collection_target",
        dedupTotal,
        {
          rows: objectsList,
          cols: topCommunities.map(([k, v]) => ({ key: k, label: v.label })),
          cells: objCommCells,
        },
        {
          summaryText: topCommunities.length > 0
            ? (lang === "zh" ? `展示各研究对象在前 ${topCommunities.length} 个活跃社区的覆盖密度。` : `Coverage across top ${topCommunities.length} communities.`)
            : (lang === "zh" ? "当前范围内暂无带社区标识的样本。" : "No community metadata in current scope."),
          summaryBullets: [],
        },
      ),
      objectDistinctiveTerms: mkBlock(
        "L2-10",
        "collection_target",
        sampledDocs.length,
        { groups: distinctiveGroups },
        {
          summaryText: distinctiveGroups.some((g) => g.distinctiveTerms.length > 0)
            ? (lang === "zh" ? "已按 Dirichlet Log-Odds 计算各研究对象相对其他对象的差异特征词。" : "Distinctive terms computed via log-odds against remaining corpus.")
            : (lang === "zh" ? "对象样本或差异不足，暂无显著区分特征词。" : "Insufficient variance to extract distinctive terms."),
          summaryBullets: [],
        },
      ),
      overlapMatrix: mkBlock(
        "L2-11",
        "collection_target",
        dedupTotal,
        { objects: overlapObjects, cells: overlapCells },
        { summaryText: overlapSummary, summaryBullets: [overlapSummary] },
      ),
      windowComparison: mkBlock(
        "L2-12",
        "time_bucket",
        datedCount,
        {
          splitAt: splitAtIso,
          beforeLabel: lang === "zh" ? "前半段" : "Earlier",
          afterLabel: lang === "zh" ? "后半段" : "Recent",
          beforeCount: beforeDocs.length,
          afterCount: afterDocs.length,
          metrics: windowMetrics,
        },
        {
          summaryText: lang === "zh"
            ? `以 ${splitAtIso.slice(0, 10)} 为界：前半段 ${beforeDocs.length} 条，后半段 ${afterDocs.length} 条。`
            : `Split at ${splitAtIso.slice(0, 10)}: ${beforeDocs.length} before vs ${afterDocs.length} after.`,
          summaryBullets: [],
        },
      ),
      hotTermTrends: mkBlock(
        "L2-13",
        "time_bucket",
        datedCount,
        { buckets: dayBuckets, series: hotTermSeries },
        {
          summaryText: hotTermSeries.length > 0
            ? (lang === "zh" ? `追踪前 ${hotTermSeries.length} 个核心高频词的逐日提及轨迹。` : `Tracking daily mentions of top ${hotTermSeries.length} terms.`)
            : (lang === "zh" ? "暂无足够的多日词频数据。" : "Insufficient dated term series."),
          summaryBullets: [],
        },
      ),
      anomalyDetection: mkBlock(
        "L2-14",
        "time_bucket",
        datedCount,
        { sensitivity, thresholdZ: anomalyRes.thresholdZ, anomalyCount, points: anomalyRes.points },
        { summaryText: anomalySummary, summaryBullets: [anomalySummary] },
      ),
      windowTermShifts: mkBlock(
        "L2-15",
        "time_bucket",
        datedCount,
        { splitAt: splitAtIso, rising, falling },
        {
          summaryText: rising.length > 0
            ? (lang === "zh" ? `后半段升温最显著的词为「${rising[0].term}」（占比上升 +${rising[0].deltaPctPoints} 个百分点）。` : `Fastest rising term: "${rising[0].term}" (+${rising[0].deltaPctPoints} pp).`)
            : (lang === "zh" ? "前后窗口间词频结构较平稳。" : "Term shares remained stable across windows."),
          summaryBullets: [],
        },
      ),
    },
  };
}

if (parentPort) parentPort.postMessage(analyzeL2(workerData as L2AnalysisJob));
