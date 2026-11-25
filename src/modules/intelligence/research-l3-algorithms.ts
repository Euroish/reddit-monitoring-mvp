import type {
  L3SentimentSummary,
  L3TopicItem,
  L3TopicSummary,
} from "../../../packages/contracts/src/research";
import {
  cleanTextForAnalysis,
  scoreBilingualSentiment,
  SENTIMENT_ALGO_VERSION,
  tokenizeClauses,
} from "./text-analysis";

export interface L3SourceDocument {
  id: string;
  platform: "reddit" | "x" | "bluesky" | "web";
  title: string | null;
  text: string;
  bucket: string | null;
  targetKeys: Array<{ key: string; label: string }>;
  engagementScore: number;
}

export interface L3ItemAssignment {
  contentId: string;
  sentimentLabel?: "positive" | "neutral" | "negative" | "unclassified";
  sentimentScore?: number;
  topicIndex?: number | null;
  topicScore?: number | null;
}

export { SENTIMENT_ALGO_VERSION };
export const TOPIC_ALGO_VERSION = "nmf_tfidf_v1";

function yieldTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function runSentimentAnalysisTask(
  docs: readonly L3SourceDocument[],
  options: {
    lang?: "zh" | "en";
    signal?: AbortSignal;
    onProgress?: (pct: number, stage: string) => void | Promise<void>;
  } = {},
): Promise<{ summary: L3SentimentSummary; items: L3ItemAssignment[] }> {
  const lang = options.lang ?? "zh";
  const total = docs.length;
  const countsMap = { positive: 0, neutral: 0, negative: 0, unclassified: 0 };
  const trendMap = new Map<string, { bucket: string; positive: number; neutral: number; negative: number; unclassified: number }>();
  const platMap = new Map<L3SourceDocument["platform"], { positive: number; neutral: number; negative: number; unclassified: number; total: number }>();
  const targetMap = new Map<string, { targetKey: string; targetLabel: string; positive: number; neutral: number; negative: number; unclassified: number; total: number }>();
  const posCandidates: Array<{ doc: L3SourceDocument; score: number }> = [];
  const negCandidates: Array<{ doc: L3SourceDocument; score: number }> = [];
  const assignments: L3ItemAssignment[] = [];

  for (let i = 0; i < total; i++) {
    if (options.signal?.aborted) {
      throw new Error("Task cancelled");
    }
    const doc = docs[i];
    const combined = [doc.title, doc.text].filter(Boolean).join(" ");
    const res = scoreBilingualSentiment(combined);
    countsMap[res.label] += 1;
    assignments.push({
      contentId: doc.id,
      sentimentLabel: res.label,
      sentimentScore: res.score,
    });

    if (doc.bucket) {
      const tb = trendMap.get(doc.bucket) ?? { bucket: doc.bucket, positive: 0, neutral: 0, negative: 0, unclassified: 0 };
      tb[res.label] += 1;
      trendMap.set(doc.bucket, tb);
    }

    const pb = platMap.get(doc.platform) ?? { positive: 0, neutral: 0, negative: 0, unclassified: 0, total: 0 };
    pb[res.label] += 1;
    pb.total += 1;
    platMap.set(doc.platform, pb);

    for (const tk of doc.targetKeys) {
      const tEntry = targetMap.get(tk.key) ?? {
        targetKey: tk.key,
        targetLabel: tk.label,
        positive: 0,
        neutral: 0,
        negative: 0,
        unclassified: 0,
        total: 0,
      };
      tEntry[res.label] += 1;
      tEntry.total += 1;
      targetMap.set(tk.key, tEntry);
    }

    if (res.label === "positive") posCandidates.push({ doc, score: res.score });
    if (res.label === "negative") negCandidates.push({ doc, score: res.score });

    if (i > 0 && i % 250 === 0) {
      const pct = Math.min(90, 15 + Math.round((i / Math.max(1, total)) * 75));
      await options.onProgress?.(pct, lang === "zh" ? `情感打分中 (${i}/${total})` : `Scoring sentiment (${i}/${total})`);
      await yieldTick();
    }
  }

  const pct = (n: number) => (total > 0 ? Number(((n / total) * 100).toFixed(1)) : 0);
  const classifiedCount = total - countsMap.unclassified;
  posCandidates.sort((a, b) => b.score - a.score || b.doc.engagementScore - a.doc.engagementScore);
  negCandidates.sort((a, b) => a.score - b.score || b.doc.engagementScore - a.doc.engagementScore);

  const exemplars: L3SentimentSummary["exemplars"] = [
    ...posCandidates.slice(0, 4).map((x) => ({
      contentId: x.doc.id,
      label: "positive" as const,
      score: x.score,
      title: x.doc.title,
      excerpt: cleanTextForAnalysis(x.doc.text).slice(0, 180),
      platform: x.doc.platform,
    })),
    ...negCandidates.slice(0, 4).map((x) => ({
      contentId: x.doc.id,
      label: "negative" as const,
      score: x.score,
      title: x.doc.title,
      excerpt: cleanTextForAnalysis(x.doc.text).slice(0, 180),
      platform: x.doc.platform,
    })),
  ];

  const counts: L3SentimentSummary["counts"] = [
    { label: "positive", count: countsMap.positive, sharePct: pct(countsMap.positive) },
    { label: "neutral", count: countsMap.neutral, sharePct: pct(countsMap.neutral) },
    { label: "negative", count: countsMap.negative, sharePct: pct(countsMap.negative) },
    { label: "unclassified", count: countsMap.unclassified, sharePct: pct(countsMap.unclassified) },
  ];

  const bullets: string[] = [];
  if (total === 0) {
    bullets.push(lang === "zh" ? "所选范围内暂无可分析文本。" : "No text records in selected scope.");
  } else if (lang === "zh") {
    bullets.push(
      `共分析 ${total.toLocaleString("en-US")} 条文本：可识别情感倾向 ${classifiedCount} 条（占比 ${pct(classifiedCount)}%），其中正面 ${countsMap.positive} 条（${pct(countsMap.positive)}%）、负面 ${countsMap.negative} 条（${pct(countsMap.negative)}%）、中性/混合 ${countsMap.neutral} 条（${pct(countsMap.neutral)}%）。`,
    );
    if (countsMap.unclassified > 0) {
      bullets.push(
        `另有 ${countsMap.unclassified} 条（${pct(countsMap.unclassified)}%）未命中明显情感词典（例如纯客观资讯/短链接），已如实单列“未判”而非强行归为中性。`,
      );
    }
  } else {
    bullets.push(
      `Analyzed ${total.toLocaleString("en-US")} items: ${classifiedCount} classified (${pct(classifiedCount)}%) — positive ${countsMap.positive} (${pct(countsMap.positive)}%), negative ${countsMap.negative} (${pct(countsMap.negative)}%), neutral/mixed ${countsMap.neutral} (${pct(countsMap.neutral)}%).`,
    );
    if (countsMap.unclassified > 0) {
      bullets.push(`${countsMap.unclassified} items (${pct(countsMap.unclassified)}%) contained no explicit sentiment cues and are reported transparently as unclassified.`);
    }
  }

  return {
    summary: {
      taskType: "sentiment",
      algorithmVersion: SENTIMENT_ALGO_VERSION,
      sampleCount: total,
      classifiedCount,
      unclassifiedCount: countsMap.unclassified,
      counts,
      trend: [...trendMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
      byPlatform: [...platMap.entries()].map(([platform, v]) => ({ platform, ...v })),
      byTarget: [...targetMap.values()].sort((a, b) => b.total - a.total),
      exemplars,
      summaryText: bullets[0] ?? "",
      summaryBullets: bullets,
    },
    items: assignments,
  };
}

function makeSeededPrng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return 0.05 + (state / 0x100000000) * 0.9;
  };
}

/** Deterministic NMF topic discovery over sparse TF-IDF document matrix */
export async function runTopicDiscoveryTask(
  docs: readonly L3SourceDocument[],
  options: {
    numTopics?: number;
    maxVocab?: number;
    lang?: "zh" | "en";
    signal?: AbortSignal;
    onProgress?: (pct: number, stage: string) => void | Promise<void>;
  } = {},
): Promise<{ summary: L3TopicSummary; items: L3ItemAssignment[] }> {
  const lang = options.lang ?? "zh";
  const D = docs.length;
  const maxVocab = Math.max(50, Math.min(1200, options.maxVocab ?? 400));

  if (D === 0) {
    const emptyMsg = lang === "zh" ? "所选范围内暂无可用于主题建模的文本样本。" : "No documents in scope for topic discovery.";
    return {
      summary: {
        taskType: "topic_modeling",
        algorithmVersion: TOPIC_ALGO_VERSION,
        sampleCount: 0,
        vocabularySize: 0,
        numTopics: 0,
        unassignedCount: 0,
        topics: [],
        byTarget: [],
        summaryText: emptyMsg,
        summaryBullets: [],
      },
      items: [],
    };
  }

  const requestedK = Math.max(2, Math.min(10, options.numTopics ?? (D < 12 ? 3 : 5)));
  const K = Math.min(requestedK, Math.max(2, Math.floor(D / 2)));

  // Step 1: Tokenize & compute DF/TF
  const df = new Map<string, number>();
  const docTermCounts: Array<Map<string, number>> = [];
  for (let i = 0; i < D; i++) {
    if (options.signal?.aborted) throw new Error("Task cancelled");
    const toks = tokenizeClauses([docs[i].title, docs[i].text].filter(Boolean).join(" ")).flat();
    const cMap = new Map<string, number>();
    for (const tok of toks) cMap.set(tok, (cMap.get(tok) ?? 0) + 1);
    for (const tok of cMap.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);
    docTermCounts.push(cMap);
  }

  await options.onProgress?.(25, lang === "zh" ? "构建 TF-IDF 词表..." : "Building TF-IDF vocabulary...");
  await yieldTick();

  const minDf = D >= 20 ? 2 : 1;
  const maxDf = D >= 20 ? Math.max(minDf + 1, Math.floor(D * 0.85)) : D;
  const vocab = [...df.entries()]
    .filter(([, count]) => count >= minDf && count <= maxDf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxVocab)
    .map(([term]) => term);

  const V = vocab.length;
  if (V < 2) {
    const sparseMsg = lang === "zh" ? "有效特征词不足，无法提取稳定的潜在主题，建议扩大时间或批次范围。" : "Insufficient distinct terms to extract topics. Try widening the scope.";
    return {
      summary: {
        taskType: "topic_modeling",
        algorithmVersion: TOPIC_ALGO_VERSION,
        sampleCount: D,
        vocabularySize: V,
        numTopics: 0,
        unassignedCount: D,
        topics: [],
        byTarget: [],
        summaryText: sparseMsg,
        summaryBullets: [],
      },
      items: docs.map((d) => ({ contentId: d.id, topicIndex: null, topicScore: null })),
    };
  }

  const vocabIdx = new Map(vocab.map((t, idx) => [t, idx]));
  // Sparse rows: Array<Array<[colIdx, tfidfVal]>> normalized to L2 = 1 per doc
  const rows: Array<Array<[number, number]>> = [];
  const nonEmptyDocIndices: number[] = [];

  for (let i = 0; i < D; i++) {
    const entries: Array<[number, number]> = [];
    let normSq = 0;
    for (const [term, tf] of docTermCounts[i].entries()) {
      const col = vocabIdx.get(term);
      if (col === undefined) continue;
      const idf = Math.log((D + 1) / ((df.get(term) ?? 1) + 1)) + 1;
      const val = (1 + Math.log(tf)) * idf;
      entries.push([col, val]);
      normSq += val * val;
    }
    if (normSq > 0) {
      const inv = 1 / Math.sqrt(normSq);
      for (const e of entries) e[1] *= inv;
      nonEmptyDocIndices.push(i);
    }
    rows.push(entries);
  }

  // Step 2: Deterministic NMF multiplicative updates over sparse X (D x V) ~= W (D x K) * H (K x V)
  const effectiveK = Math.min(K, V, Math.max(1, nonEmptyDocIndices.length));
  const rand = makeSeededPrng(20261124);
  const W = new Float64Array(D * effectiveK);
  const H = new Float64Array(effectiveK * V);
  for (let i = 0; i < W.length; i++) W[i] = rand();
  for (let i = 0; i < H.length; i++) H[i] = rand();

  const EPS = 1e-9;
  const maxIter = 18;
  const WtV = new Float64Array(effectiveK * V);
  const WtW = new Float64Array(effectiveK * effectiveK);
  const WtWH = new Float64Array(effectiveK * V);
  const VHt = new Float64Array(D * effectiveK);
  const HHt = new Float64Array(effectiveK * effectiveK);
  const WHHt = new Float64Array(D * effectiveK);

  for (let iter = 0; iter < maxIter; iter++) {
    if (options.signal?.aborted) throw new Error("Task cancelled");

    // Update H: H = H * (W^T * V) / (W^T * W * H + EPS)
    WtV.fill(0);
    for (let d = 0; d < D; d++) {
      const row = rows[d];
      if (!row.length) continue;
      for (let k = 0; k < effectiveK; k++) {
        const wdk = W[d * effectiveK + k];
        for (const [v, val] of row) {
          WtV[k * V + v] += wdk * val;
        }
      }
    }
    WtW.fill(0);
    for (let d = 0; d < D; d++) {
      for (let k1 = 0; k1 < effectiveK; k1++) {
        const w1 = W[d * effectiveK + k1];
        for (let k2 = k1; k2 < effectiveK; k2++) {
          const prod = w1 * W[d * effectiveK + k2];
          WtW[k1 * effectiveK + k2] += prod;
          if (k1 !== k2) WtW[k2 * effectiveK + k1] += prod;
        }
      }
    }
    WtWH.fill(0);
    for (let k1 = 0; k1 < effectiveK; k1++) {
      for (let k2 = 0; k2 < effectiveK; k2++) {
        const c = WtW[k1 * effectiveK + k2];
        for (let v = 0; v < V; v++) {
          WtWH[k1 * V + v] += c * H[k2 * V + v];
        }
      }
    }
    for (let i = 0; i < H.length; i++) {
      H[i] = H[i] * (WtV[i] / (WtWH[i] + EPS));
    }

    // Update W: W = W * (V * H^T) / (W * H * H^T + EPS)
    VHt.fill(0);
    for (let d = 0; d < D; d++) {
      const row = rows[d];
      if (!row.length) continue;
      for (const [v, val] of row) {
        for (let k = 0; k < effectiveK; k++) {
          VHt[d * effectiveK + k] += val * H[k * V + v];
        }
      }
    }
    HHt.fill(0);
    for (let k1 = 0; k1 < effectiveK; k1++) {
      for (let k2 = k1; k2 < effectiveK; k2++) {
        let sum = 0;
        for (let v = 0; v < V; v++) sum += H[k1 * V + v] * H[k2 * V + v];
        HHt[k1 * effectiveK + k2] = sum;
        HHt[k2 * effectiveK + k1] = sum;
      }
    }
    WHHt.fill(0);
    for (let d = 0; d < D; d++) {
      for (let k1 = 0; k1 < effectiveK; k1++) {
        let sum = 0;
        for (let k2 = 0; k2 < effectiveK; k2++) sum += W[d * effectiveK + k2] * HHt[k2 * effectiveK + k1];
        WHHt[d * effectiveK + k1] = sum;
      }
    }
    for (let i = 0; i < W.length; i++) {
      W[i] = W[i] * (VHt[i] / (WHHt[i] + EPS));
    }

    if (iter % 4 === 3) {
      const pct = Math.min(90, 35 + Math.round(((iter + 1) / maxIter) * 55));
      await options.onProgress?.(pct, lang === "zh" ? `NMF 主题分解迭代 ${iter + 1}/${maxIter}` : `NMF iteration ${iter + 1}/${maxIter}`);
      await yieldTick();
    }
  }

  // Normalize each topic row in H and assign documents to dominant topic
  const topicAssignments: Array<{ docIdx: number; topicIdx: number | null; score: number }> = [];
  const docsPerTopic: Array<Array<{ docIdx: number; score: number }>> = Array.from({ length: effectiveK }, () => []);
  let unassignedCount = 0;

  for (let d = 0; d < D; d++) {
    if (rows[d].length === 0) {
      unassignedCount++;
      topicAssignments.push({ docIdx: d, topicIdx: null, score: 0 });
      continue;
    }
    let bestK = 0;
    let bestVal = -1;
    let sumW = 0;
    for (let k = 0; k < effectiveK; k++) {
      const val = W[d * effectiveK + k];
      sumW += val;
      if (val > bestVal) {
        bestVal = val;
        bestK = k;
      }
    }
    const shareScore = sumW > 0 ? Number((bestVal / sumW).toFixed(4)) : 0;
    topicAssignments.push({ docIdx: d, topicIdx: bestK, score: shareScore });
    docsPerTopic[bestK].push({ docIdx: d, score: shareScore });
  }

  // Rank topics by docCount descending, remapping topicIndex cleanly
  const rawTopics = Array.from({ length: effectiveK }, (_, k) => {
    const termWeights: Array<{ term: string; weight: number }> = [];
    let weightSum = 0;
    for (let v = 0; v < V; v++) weightSum += H[k * V + v];
    for (let v = 0; v < V; v++) {
      termWeights.push({
        term: vocab[v],
        weight: weightSum > 0 ? Number((H[k * V + v] / weightSum).toFixed(4)) : 0,
      });
    }
    termWeights.sort((a, b) => b.weight - a.weight);
    const topTerms = termWeights.slice(0, 8);
    const members = [...docsPerTopic[k]].sort((a, b) => b.score - a.score || docs[b.docIdx].engagementScore - docs[a.docIdx].engagementScore);
    return { origK: k, topTerms, members };
  }).filter((t) => t.members.length > 0);

  rawTopics.sort((a, b) => b.members.length - a.members.length);
  const origToFinal = new Map<number, number>();
  rawTopics.forEach((rt, finalIdx) => origToFinal.set(rt.origK, finalIdx));

  const assignedTotal = Math.max(1, D - unassignedCount);
  const topics: L3TopicItem[] = rawTopics.map((rt, idx) => {
    const labelTerms = rt.topTerms.slice(0, 3).map((t) => t.term);
    const label = `${lang === "zh" ? "主题" : "Topic"} ${idx + 1}: ${labelTerms.join(" / ")}`;
    const avgScore = rt.members.length
      ? Number((rt.members.reduce((acc, m) => acc + m.score, 0) / rt.members.length).toFixed(3))
      : 0;
    return {
      topicIndex: idx,
      label,
      topTerms: rt.topTerms,
      docCount: rt.members.length,
      sharePct: Number(((rt.members.length / D) * 100).toFixed(1)),
      avgScore,
      representativeIds: rt.members.slice(0, 12).map((m) => docs[m.docIdx].id),
      representativeExcerpts: rt.members.slice(0, 4).map((m) => {
        const d = docs[m.docIdx];
        return {
          contentId: d.id,
          title: d.title,
          excerpt: cleanTextForAnalysis(d.text).slice(0, 160),
          platform: d.platform,
        };
      }),
    };
  });

  const targetTopicCounts = new Map<string, { targetKey: string; targetLabel: string; total: number; counts: Map<number, number> }>();
  const finalAssignments: L3ItemAssignment[] = topicAssignments.map((a) => {
    const finalIdx = a.topicIdx === null ? null : (origToFinal.get(a.topicIdx) ?? null);
    const doc = docs[a.docIdx];
    for (const tk of doc.targetKeys) {
      let entry = targetTopicCounts.get(tk.key);
      if (!entry) {
        entry = { targetKey: tk.key, targetLabel: tk.label, total: 0, counts: new Map() };
        targetTopicCounts.set(tk.key, entry);
      }
      entry.total += 1;
      if (finalIdx !== null) {
        entry.counts.set(finalIdx, (entry.counts.get(finalIdx) ?? 0) + 1);
      }
    }
    return {
      contentId: doc.id,
      topicIndex: finalIdx,
      topicScore: finalIdx !== null ? a.score : null,
    };
  });

  const byTarget: L3TopicSummary["byTarget"] = [...targetTopicCounts.values()].map((t) => ({
    targetKey: t.targetKey,
    targetLabel: t.targetLabel,
    topicCounts: topics.map((tp) => {
      const cnt = t.counts.get(tp.topicIndex) ?? 0;
      return {
        topicIndex: tp.topicIndex,
        count: cnt,
        sharePct: t.total > 0 ? Number(((cnt / t.total) * 100).toFixed(1)) : 0,
      };
    }),
  }));

  const topTopic = topics[0];
  const bullets: string[] = [];
  if (topics.length > 0 && lang === "zh") {
    bullets.push(
      `基于 NMF 对 ${D.toLocaleString("en-US")} 条文本提取出 ${topics.length} 个主要话题主题（词表 ${V} 词）；最大主题「${topTopic.label}」覆盖 ${topTopic.docCount} 条内容（占总量 ${topTopic.sharePct}%）。`,
    );
    if (unassignedCount > 0) {
      bullets.push(`有 ${unassignedCount} 条过短或纯符号文本未匹配到有效词表（已分配为未归类，总有效分配率 ${((assignedTotal / D) * 100).toFixed(1)}%）。`);
    }
  } else if (topics.length > 0) {
    bullets.push(
      `Extracted ${topics.length} topics via deterministic NMF across ${D.toLocaleString("en-US")} items (${V} vocab terms). Top topic "${topTopic.label}" covers ${topTopic.docCount} items (${topTopic.sharePct}%).`,
    );
  }

  return {
    summary: {
      taskType: "topic_modeling",
      algorithmVersion: TOPIC_ALGO_VERSION,
      sampleCount: D,
      vocabularySize: V,
      numTopics: topics.length,
      unassignedCount,
      topics,
      byTarget,
      summaryText: bullets[0] ?? "",
      summaryBullets: bullets,
    },
    items: finalAssignments,
  };
}
