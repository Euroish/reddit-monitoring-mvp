import type { StoryEvidence, StoryInsights, StoryInsightsQuery } from "../../../packages/contracts/src/content-stories";
import { formatDisplayTerm, solveSparseNmf, computeTermCooccurrence } from "../../shared/text/analysis";
import type { readStoryWindow } from "./stories";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const CHANNEL_LABELS: Record<string, { zh: string; en: string }> = {
  "ai-firsthand": { zh: "AI 一手与研发", en: "AI Firsthand" },
  "dev-infra": { zh: "工程与基础", en: "Dev & Infra" },
  "tech-media": { zh: "科技与数码", en: "Tech Media" },
  science: { zh: "科研与科普", en: "Science" },
  "public-affairs": { zh: "公共与文化", en: "Public Affairs" },
  "design-visual": { zh: "设计与视觉", en: "Design & Visual" },
  lifestyle: { zh: "生活与旅行", en: "Lifestyle" },
  "social-trends": { zh: "热榜与趋势", en: "Social Trends" },
};

const TIER_LABELS: Record<StoryEvidence["tier"], string> = {
  T1: "T1",
  T1_5: "T1.5",
  T2: "T2",
};

export interface ComputedStoryInsights {
  insights: StoryInsights;
  topicStoryKeys: Map<string, Set<string>>;
}

function pct(count: number, total: number): number {
  return total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
}

function buildTrendBuckets(
  view: StoryInsights["view"],
  fromMs: number,
  toMs: number,
  nowMs: number,
): Array<{ bucket: string; fromMs: number; toMs: number; isPartial: boolean }> {
  const stepMs = view === "digest" ? 2 * HOUR_MS : view === "hot" ? 6 * HOUR_MS : DAY_MS;
  const buckets: Array<{ bucket: string; fromMs: number; toMs: number; isPartial: boolean }> = [];
  const start = view === "latest" ? Math.floor(fromMs / DAY_MS) * DAY_MS : fromMs;

  for (let t = start; t < toMs; t += stepMs) {
    const end = Math.min(toMs, t + stepMs);
    const iso = new Date(t).toISOString();
    const label = view === "latest" ? iso.slice(5, 10) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
    const isPartial = view !== "digest" && end > nowMs - 60_000 && t < nowMs;
    buckets.push({ bucket: label, fromMs: t, toMs: end, isPartial });
  }
  return buckets;
}

export function computeStoryInsights(
  window: Awaited<ReturnType<typeof readStoryWindow>>,
  query: Pick<StoryInsightsQuery, "view" | "sourceGroup" | "lang">,
  nowMs = Date.now(),
): ComputedStoryInsights {
  const lang = query.lang === "en" ? "en" : "zh";
  const view = query.view ?? window.view ?? "latest";
  const list = view === "latest" ? window.latest : window.hottest;
  const analyzedCount = list.length;
  const windowTotalCount = Math.max(analyzedCount, window.totalRankedCount ?? analyzedCount);
  const capped = windowTotalCount > analyzedCount;
  const generatedAt = new Date(nowMs).toISOString();

  const records = list.map((story) => {
    const meta = window.metaByStoryKey.get(story.storyKey);
    const eventTimeMs = meta?.eventTimeMs ?? Date.parse(story.updatedAt);
    return {
      story,
      storyKey: story.storyKey,
      title: story.representative.title,
      sourceId: story.representative.sourceId,
      sourceLabel: story.representative.sourceLabel,
      tier: story.representative.tier,
      sourceGroup: meta?.sourceGroup ?? "",
      language: meta?.language ?? "other",
      eventTimeMs: Number.isFinite(eventTimeMs) ? eventTimeMs : window.fromMs,
      participatingSourceIds: meta?.participatingSourceIds ?? [story.representative.sourceId],
      tokenSet: meta?.tokenSet ?? new Set<string>(),
      hasComparableSource: meta?.hasComparableSource ?? true,
    };
  });

  // 1. Quality metrics
  const textReadyCount = records.filter((r) => r.tokenSet.size > 0).length;
  const textCoveragePct = pct(textReadyCount, analyzedCount);
  const allParticipating = new Set<string>();
  const channelCounts = new Map<string, number>();
  const sourceCounts = new Map<string, { label: string; tier: StoryEvidence["tier"]; count: number }>();
  const tierCounts = new Map<StoryEvidence["tier"], number>();
  const langCounts = new Map<string, number>();

  for (const r of records) {
    for (const sid of r.participatingSourceIds) allParticipating.add(sid);
    const ch = r.sourceGroup || "other";
    channelCounts.set(ch, (channelCounts.get(ch) ?? 0) + 1);
    const src = sourceCounts.get(r.sourceId);
    if (src) src.count += 1;
    else sourceCounts.set(r.sourceId, { label: r.sourceLabel, tier: r.tier, count: 1 });
    tierCounts.set(r.tier, (tierCounts.get(r.tier) ?? 0) + 1);
    langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
  }

  // 2. L1 Activity Trend
  const granularity: "2h" | "6h" | "day" = view === "digest" ? "2h" : view === "hot" ? "6h" : "day";
  const rawBuckets = buildTrendBuckets(view, window.fromMs, window.toMs, nowMs);
  const bucketCounts = new Array<number>(rawBuckets.length).fill(0);
  const docBucketIdx = new Array<number>(records.length).fill(-1);

  for (let i = 0; i < records.length; i++) {
    const ts = records[i].eventTimeMs;
    const idx = rawBuckets.findIndex((b) => ts >= b.fromMs && ts < b.toMs);
    const fallbackIdx = idx >= 0 ? idx : ts >= window.toMs && rawBuckets.length > 0 ? rawBuckets.length - 1 : -1;
    if (fallbackIdx >= 0) {
      bucketCounts[fallbackIdx]++;
      docBucketIdx[i] = fallbackIdx;
    }
  }

  const buckets = rawBuckets.map((b, i) => ({
    bucket: b.bucket,
    from: new Date(b.fromMs).toISOString(),
    to: new Date(b.toMs).toISOString(),
    count: bucketCounts[i],
    isPartial: b.isPartial,
  }));

  const nonEmptyBuckets = buckets.filter((b) => b.count > 0);
  const peakBucket = nonEmptyBuckets.reduce<typeof buckets[number] | undefined>(
    (best, cur) => (!best || cur.count > best.count ? cur : best),
    undefined,
  );
  const activitySummary =
    analyzedCount === 0
      ? (lang === "zh" ? "当前筛选窗口内暂无去重资讯事件。" : "No story events in the active window.")
      : peakBucket
        ? (lang === "zh"
            ? `${peakBucket.bucket} 更新最集中（${peakBucket.count} 条），当前窗口共 ${analyzedCount} 个去重事件。`
            : `Peak activity at ${peakBucket.bucket} (${peakBucket.count} stories) across ${analyzedCount} events.`)
        : (lang === "zh" ? `当前窗口共 ${analyzedCount} 个去重事件。` : `${analyzedCount} deduplicated stories in window.`);

  const activityPanelStatus: StoryInsights["panels"]["activityTrend"] =
    analyzedCount === 0
      ? { status: "hidden", reason: lang === "zh" ? "当前范围内暂无资讯事件" : "No events in window" }
      : nonEmptyBuckets.length < 2
        ? { status: "degraded", reason: lang === "zh" ? "仅覆盖 1 个活跃时段，时间分布区分度较低" : "Only 1 active time bucket" }
        : { status: "ok" };

  // 3. L1 Hot Keywords (document frequency across deduplicated events)
  const df = new Map<string, number>();
  for (const r of records) {
    for (const tok of r.tokenSet) df.set(tok, (df.get(tok) ?? 0) + 1);
  }
  const minKeywordDf = analyzedCount >= 12 ? 2 : 1;
  const keywordItems = [...df.entries()]
    .filter(([, cnt]) => cnt >= minKeywordDf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([term, eventCount]) => ({
      term,
      displayTerm: formatDisplayTerm(term),
      eventCount,
      sharePct: pct(eventCount, Math.max(1, textReadyCount)),
    }));

  const hotKeywordsStatus: StoryInsights["panels"]["hotKeywords"] =
    textReadyCount === 0 || keywordItems.length === 0
      ? { status: "hidden", reason: lang === "zh" ? "有效文本或高频关键词不足" : "Insufficient text tokens" }
      : keywordItems.length < 2
        ? { status: "degraded", reason: lang === "zh" ? "有效区分关键词过少" : "Fewer than 2 distinct keywords" }
        : { status: "ok" };

  // 4. L1 Source & Content Composition (mutually exclusive)
  const byChannel = [...channelCounts.entries()]
    .map(([key, count]) => ({
      key,
      label: CHANNEL_LABELS[key]?.[lang] ?? (key === "other" ? (lang === "zh" ? "其他" : "Other") : key),
      count,
      sharePct: pct(count, analyzedCount),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const sortedSources = [...sourceCounts.entries()]
    .map(([key, info]) => ({ key, ...info }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const topSources = sortedSources.slice(0, 6);
  const otherSourceCount = sortedSources.slice(6).reduce((sum, s) => sum + s.count, 0);
  const bySource = [
    ...topSources.map((s) => ({
      key: s.key,
      label: s.label,
      tier: s.tier as string | null,
      isOther: false,
      count: s.count,
      sharePct: pct(s.count, analyzedCount),
    })),
    ...(otherSourceCount > 0
      ? [{
          key: "__other__",
          label: lang === "zh" ? `其他来源 (${sortedSources.length - 6})` : `Other (${sortedSources.length - 6})`,
          tier: null,
          isOther: true,
          count: otherSourceCount,
          sharePct: pct(otherSourceCount, analyzedCount),
        }]
      : []),
  ];

  const tierOrder: StoryEvidence["tier"][] = ["T1", "T1_5", "T2"];
  const byTier = tierOrder
    .filter((tk) => (tierCounts.get(tk) ?? 0) > 0)
    .map((tk) => {
      const count = tierCounts.get(tk) ?? 0;
      return { key: tk, label: TIER_LABELS[tk], count, sharePct: pct(count, analyzedCount) };
    });

  const langLabels: Record<string, string> = {
    zh: "中文",
    en: "English",
    ja: "日本語",
    ko: "한국어",
    other: lang === "zh" ? "其他" : "Other",
  };
  const byLanguage = [...langCounts.entries()]
    .map(([key, count]) => ({
      key,
      label: langLabels[key] ?? key.toUpperCase(),
      count,
      sharePct: pct(count, analyzedCount),
    }))
    .sort((a, b) => b.count - a.count);

  const recommendedDimension: StoryInsights["composition"]["recommendedDimension"] =
    !query.sourceGroup && byChannel.length >= 2
      ? "channel"
      : bySource.length >= 2
        ? "source"
        : byTier.length >= 2
          ? "tier"
          : "language";

  const maxDistinctComp = Math.max(byChannel.length, bySource.length, byTier.length, byLanguage.length);
  const compositionStatus: StoryInsights["panels"]["composition"] =
    analyzedCount === 0
      ? { status: "hidden", reason: lang === "zh" ? "无可用事件" : "No events" }
      : maxDistinctComp < 2
        ? { status: "hidden", reason: lang === "zh" ? "仅单一来源与等级，构成无对比差异" : "Single source and tier" }
        : { status: "ok" };

  // 5. L2 Rising Terms (half-window comparison over equal contiguous spans)
  const splitMs = Math.floor((window.fromMs + window.toMs) / 2);
  const splitAt = new Date(splitMs).toISOString();
  const prevIndices: number[] = [];
  const currIndices: number[] = [];
  for (let i = 0; i < records.length; i++) {
    if (records[i].eventTimeMs < splitMs) prevIndices.push(i);
    else currIndices.push(i);
  }
  const prevCountDocs = prevIndices.length;
  const currCountDocs = currIndices.length;
  const minHalf = 3;
  const hasComparableBaseline = analyzedCount >= 8 && prevCountDocs >= minHalf && currCountDocs >= minHalf;

  const termSparkline = (term: string): number[] => {
    const pts = new Array<number>(rawBuckets.length).fill(0);
    for (let i = 0; i < records.length; i++) {
      const bIdx = docBucketIdx[i];
      if (bIdx >= 0 && records[i].tokenSet.has(term)) pts[bIdx]++;
    }
    return pts;
  };

  let risingMode: StoryInsights["risingTerms"]["mode"] = "hidden";
  let risingItems: StoryInsights["risingTerms"]["items"] = [];
  let comparabilityNote = "";

  if (analyzedCount < 6 || textReadyCount < 4) {
    risingMode = "hidden";
    comparabilityNote = lang === "zh" ? "当前样本量较少，尚不足以识别统计显著的升温词。" : "Sample size too small for rising-term detection.";
  } else if (!hasComparableBaseline) {
    // Graceful degradation to emerging recent terms when historical half lacks baseline
    const targetDocs = currCountDocs >= 3 ? currIndices : records.map((_, i) => i);
    const recentDf = new Map<string, number>();
    for (const idx of targetDocs) {
      for (const tok of records[idx].tokenSet) recentDf.set(tok, (recentDf.get(tok) ?? 0) + 1);
    }
    const minFreq = targetDocs.length >= 10 ? 2 : 1;
    risingItems = [...recentDf.entries()]
      .filter(([, cnt]) => cnt >= minFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term, c]) => {
        const rate = pct(c, targetDocs.length);
        return {
          term,
          displayTerm: formatDisplayTerm(term),
          currentCount: c,
          previousCount: 0,
          currentRatePct: rate,
          previousRatePct: 0,
          deltaPctPoints: rate,
          isNew: true,
          sparkline: termSparkline(term),
        };
      });
    risingMode = risingItems.length > 0 ? "emerging" : "hidden";
    comparabilityNote = lang === "zh"
      ? "历史对比基线样本不足，已退化为展示近期新出现关键词。"
      : "Insufficient prior-half baseline; showing emerging terms instead.";
  } else {
    const prevDf = new Map<string, number>();
    const currDf = new Map<string, number>();
    for (const i of prevIndices) for (const tok of records[i].tokenSet) prevDf.set(tok, (prevDf.get(tok) ?? 0) + 1);
    for (const i of currIndices) for (const tok of records[i].tokenSet) currDf.set(tok, (currDf.get(tok) ?? 0) + 1);

    const minCurrentCount = currCountDocs >= 25 ? 3 : 2;
    const nonComparableRatio = records.filter((r) => !r.hasComparableSource).length / Math.max(1, records.length);

    risingItems = [...currDf.entries()]
      .filter(([, cCount]) => cCount >= minCurrentCount)
      .map(([term, cCount]) => {
        const pCount = prevDf.get(term) ?? 0;
        const cRate = pct(cCount, currCountDocs);
        const pRate = pct(pCount, prevCountDocs);
        const deltaPp = Number((cRate - pRate).toFixed(1));
        return {
          term,
          displayTerm: formatDisplayTerm(term),
          currentCount: cCount,
          previousCount: pCount,
          currentRatePct: cRate,
          previousRatePct: pRate,
          deltaPctPoints: deltaPp,
          isNew: pCount === 0,
          sparkline: termSparkline(term),
        };
      })
      .filter((it) => it.deltaPctPoints >= 1.0)
      .sort(
        (a, b) =>
          b.deltaPctPoints * Math.log1p(b.currentCount) - a.deltaPctPoints * Math.log1p(a.currentCount) ||
          b.currentCount - a.currentCount,
      )
      .slice(0, 5);

    risingMode = risingItems.length > 0 ? "rising" : "hidden";
    comparabilityNote =
      risingItems.length === 0
        ? (lang === "zh" ? "前后半段词汇热度基本持平，暂无显著升温词。" : "Topic velocity is stable across both halves.")
        : nonComparableRatio > 0.35
          ? (lang === "zh" ? "以百分比增量排序（提示：部分新接入或非常驻来源可能影响基线）。" : "Ranked by percentage-point gain (some newly active sources present).")
          : (lang === "zh" ? `对比 ${splitAt.slice(5, 16).replace("T", " ")} 前后等长窗口的提及率变化（百分点）。` : `Mentions share shift across ${splitAt.slice(5, 16).replace("T", " ")} UTC.`);
  }

  const risingStatus: StoryInsights["panels"]["risingTerms"] =
    risingMode === "hidden"
      ? { status: "hidden", reason: comparabilityNote }
      : risingMode === "emerging"
        ? { status: "degraded", reason: comparabilityNote }
        : { status: "ok" };

  // 6. L2 Recent Main Topics (shared sparse NMF -> disjoint primary cluster + Other, with co-occurrence fallback)
  const topicStoryKeys = new Map<string, Set<string>>();
  let topicsMode: StoryInsights["topics"]["mode"] = "hidden";
  const topicItems: StoryInsights["topics"]["items"] = [];
  let topicQualityNote: string | undefined;
  let assignedCount = 0;
  let unassignedCount = analyzedCount;

  if (textReadyCount >= 6) {
    const desiredK =
      textReadyCount >= 80 ? 5 : textReadyCount >= 36 ? 4 : textReadyCount >= 16 ? 3 : 2;
    const tokenLists = records.map((r) => [...r.tokenSet]);
    const nmf = solveSparseNmf(tokenLists, { numTopics: desiredK, maxVocab: 260, iterations: 16, seed: 20261125 });

    if (nmf.effectiveK >= 2) {
      const V = nmf.vocab.length;
      const membersByK = Array.from({ length: nmf.effectiveK }, () => [] as number[]);
      const otherIndices: number[] = [];

      nmf.assignments.forEach((a, d) => {
        if (a.topicIdx === null || a.score < 0.34) otherIndices.push(d);
        else membersByK[a.topicIdx].push(d);
      });

      const validClusters = membersByK
        .map((members, k) => {
          const weights: Array<{ term: string; w: number }> = [];
          for (let v = 0; v < V; v++) weights.push({ term: nmf.vocab[v], w: nmf.H[k * V + v] });
          weights.sort((a, b) => b.w - a.w);
          const keywords = weights.slice(0, 4).map((x) => formatDisplayTerm(x.term));
          return { k, members, keywords };
        })
        .filter((c) => c.members.length >= 2);

      // Reassign singleton cluster members to Other so no noise 1-item clusters appear
      const keptSet = new Set(validClusters.map((c) => c.k));
      membersByK.forEach((members, k) => {
        if (!keptSet.has(k)) otherIndices.push(...members);
      });

      const assignedRatio = validClusters.reduce((s, c) => s + c.members.length, 0) / Math.max(1, analyzedCount);
      if (validClusters.length >= 2 && assignedRatio >= 0.4) {
        topicsMode = "nmf";
        validClusters.sort((a, b) => b.members.length - a.members.length);
        validClusters.forEach((c, idx) => {
          const topicId = `topic-${idx + 1}`;
          const keys = new Set(c.members.map((d) => records[d].storyKey));
          topicStoryKeys.set(topicId, keys);
          topicItems.push({
            topicId,
            label: c.keywords.slice(0, 3).join(" · "),
            keywords: c.keywords,
            docCount: c.members.length,
            sharePct: pct(c.members.length, analyzedCount),
            isOther: false,
            sampleTitles: c.members.slice(0, 3).map((d) => records[d].title),
          });
        });
        assignedCount = validClusters.reduce((s, c) => s + c.members.length, 0);
        unassignedCount = otherIndices.length;
        if (otherIndices.length > 0) {
          topicStoryKeys.set("other", new Set(otherIndices.map((d) => records[d].storyKey)));
          topicItems.push({
            topicId: "other",
            label: lang === "zh" ? "其他 / 未归类" : "Other / Unassigned",
            keywords: [],
            docCount: otherIndices.length,
            sharePct: pct(otherIndices.length, analyzedCount),
            isOther: true,
            sampleTitles: otherIndices.slice(0, 2).map((d) => records[d].title),
          });
        }
      }
    }

    // Co-occurrence fallback if NMF could not separate topics cleanly
    if (topicsMode === "hidden") {
      const cooc = computeTermCooccurrence(records.map((r) => ({ clauses: [[...r.tokenSet]] })), 12);
      const usedDocs = new Set<number>();
      const fallbackClusters: Array<{ keywords: string[]; members: number[] }> = [];
      for (const pair of cooc.topPairs.slice(0, 6)) {
        const members: number[] = [];
        records.forEach((r, idx) => {
          if (!usedDocs.has(idx) && r.tokenSet.has(pair.termA) && r.tokenSet.has(pair.termB)) {
            members.push(idx);
          }
        });
        if (members.length >= 2) {
          members.forEach((idx) => usedDocs.add(idx));
          fallbackClusters.push({
            keywords: [formatDisplayTerm(pair.termA), formatDisplayTerm(pair.termB)],
            members,
          });
        }
        if (fallbackClusters.length >= 4) break;
      }
      if (fallbackClusters.length >= 2) {
        topicsMode = "cooccurrence_degraded";
        topicQualityNote = lang === "zh" ? "话题凝聚度偏低，已降级为高频共现词对聚类。" : "Low topic separation; showing co-occurring keyword groups.";
        fallbackClusters.forEach((fc, idx) => {
          const topicId = `cooc-${idx + 1}`;
          topicStoryKeys.set(topicId, new Set(fc.members.map((d) => records[d].storyKey)));
          topicItems.push({
            topicId,
            label: fc.keywords.join(" + "),
            keywords: fc.keywords,
            docCount: fc.members.length,
            sharePct: pct(fc.members.length, analyzedCount),
            isOther: false,
            sampleTitles: fc.members.slice(0, 3).map((d) => records[d].title),
          });
        });
        assignedCount = usedDocs.size;
        const leftover = records.map((_, i) => i).filter((i) => !usedDocs.has(i));
        unassignedCount = leftover.length;
        if (leftover.length > 0) {
          topicStoryKeys.set("other", new Set(leftover.map((d) => records[d].storyKey)));
          topicItems.push({
            topicId: "other",
            label: lang === "zh" ? "其他 / 未归类" : "Other / Unassigned",
            keywords: [],
            docCount: leftover.length,
            sharePct: pct(leftover.length, analyzedCount),
            isOther: true,
            sampleTitles: leftover.slice(0, 2).map((d) => records[d].title),
          });
        }
      }
    }
  } else {
    topicQualityNote = lang === "zh" ? "有效文本样本不足 6 条，暂不生成话题聚类。" : "Requires ≥6 text items for topic clustering.";
  }

  const topicsStatus: StoryInsights["panels"]["topics"] =
    topicsMode === "hidden"
      ? { status: "hidden", reason: topicQualityNote ?? (lang === "zh" ? "话题分散度较高，未能归纳出稳定主题" : "Insufficient cluster quality") }
      : topicsMode === "cooccurrence_degraded"
        ? { status: "degraded", reason: topicQualityNote }
        : { status: "ok" };

  return {
    insights: {
      view,
      from: window.from,
      to: window.to,
      generatedAt,
      timeAnchor: "published_or_discovered",
      sample: {
        analyzedCount,
        windowTotalCount,
        capped,
        coverage: "stored_sample",
      },
      quality: {
        textReadyCount,
        textCoveragePct,
        activeSourceCount: sourceCounts.size,
        activeChannelCount: channelCounts.size,
        activeTierCount: tierCounts.size,
        activeLanguageCount: langCounts.size,
        isLowSample: analyzedCount < 6,
      },
      panels: {
        activityTrend: activityPanelStatus,
        hotKeywords: hotKeywordsStatus,
        composition: compositionStatus,
        risingTerms: risingStatus,
        topics: topicsStatus,
      },
      activityTrend: {
        bucketGranularity: granularity,
        summaryText: activitySummary,
        buckets,
      },
      hotKeywords: {
        analyzedTextCount: textReadyCount,
        items: keywordItems,
      },
      composition: {
        recommendedDimension,
        allParticipatingSourceCount: allParticipating.size,
        byChannel,
        bySource,
        byTier,
        byLanguage,
      },
      risingTerms: {
        mode: risingMode,
        comparabilityNote,
        splitAt,
        previousWindowCount: prevCountDocs,
        currentWindowCount: currCountDocs,
        items: risingItems,
      },
      topics: {
        mode: topicsMode,
        qualityNote: topicQualityNote,
        clusterCount: topicItems.filter((i) => !i.isOther).length,
        assignedCount,
        unassignedCount,
        items: topicItems,
      },
    },
    topicStoryKeys,
  };
}
