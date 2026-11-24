import type {
  L1KeywordRow,
  L1KindRow,
  L1PlatformEngagementSummary,
  L1PlatformRow,
  L1ScaleData,
  L1SourceRankingItem,
  L1TrendPoint,
} from "../../../packages/contracts/src/research";

export type InterpretLang = "zh" | "en";

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function interpretScale(
  data: L1ScaleData,
  emptySelection: boolean,
  lang: InterpretLang = "zh",
): { summaryText: string; summaryBullets: string[] } {
  if (emptySelection) {
    return {
      summaryText:
        lang === "zh"
          ? "当前未选择任何研究关键词或数据批次，请在上方研究范围控制器中选择参与分析的数据。"
          : "No research keywords or data batches are currently selected. Select targets above to run analysis.",
      summaryBullets: [],
    };
  }
  if (data.deduplicatedContentCount === 0) {
    return {
      summaryText:
        lang === "zh"
          ? "当前筛选范围内暂无内容样本，可尝试放宽时间范围、平台或内容类型筛选条件。"
          : "No stored samples match the current analysis scope. Try widening the time window or filters.",
      summaryBullets: [],
    };
  }
  const bullets: string[] = [];
  if (lang === "zh") {
    bullets.push(
      `去重后共有 ${fmtNum(data.deduplicatedContentCount)} 条内容（帖文 ${fmtNum(data.postsCount)} 条、已采集评论 ${fmtNum(data.commentsCount)} 条${data.articlesCount > 0 ? `、文章 ${fmtNum(data.articlesCount)} 篇` : ""}）。`,
    );
    if (data.reportedPlatformCommentsSum > 0 || data.commentsCount > 0) {
      bullets.push(
        `平台记录的主帖评论总量为 ${fmtNum(data.reportedPlatformCommentsSum)} 条，当前范围实际入库评论样本 ${fmtNum(data.commentsCount)} 条。`,
      );
    }
    if (data.multiTargetOverlapCount > 0) {
      bullets.push(
        `有 ${fmtNum(data.multiTargetOverlapCount)} 条内容同时命中了多个所选关键词/来源，总规模统计已按唯一内容去重。`,
      );
    }
    if (data.undatedCount > 0) {
      bullets.push(`其中 ${fmtNum(data.undatedCount)} 条内容缺少原始发布时间，不计入按发布时间分桶的趋势图。`);
    }
    if (data.deduplicatedContentCount < 5) {
      bullets.push("当前样本量较少（不足 5 条），分布与占比统计仅供参考。");
    }
    return {
      summaryText: bullets.slice(0, 2).join(" "),
      summaryBullets: bullets,
    };
  }

  bullets.push(
    `Scope contains ${fmtNum(data.deduplicatedContentCount)} deduplicated items (${fmtNum(data.postsCount)} posts, ${fmtNum(data.commentsCount)} collected comments${data.articlesCount > 0 ? `, ${fmtNum(data.articlesCount)} articles` : ""}).`,
  );
  if (data.reportedPlatformCommentsSum > 0 || data.commentsCount > 0) {
    bullets.push(
      `Posts report ${fmtNum(data.reportedPlatformCommentsSum)} total platform comments; ${fmtNum(data.commentsCount)} comment records are stored in this scope.`,
    );
  }
  if (data.multiTargetOverlapCount > 0) {
    bullets.push(
      `${fmtNum(data.multiTargetOverlapCount)} items appear across multiple selected keywords and are deduplicated in totals.`,
    );
  }
  if (data.undatedCount > 0) {
    bullets.push(`${fmtNum(data.undatedCount)} items lack an original publish timestamp and are excluded from dated trend buckets.`);
  }
  return {
    summaryText: bullets.slice(0, 2).join(" "),
    summaryBullets: bullets,
  };
}

export function interpretTrend(
  points: L1TrendPoint[],
  undatedCount: number,
  emptySelection: boolean,
  lang: InterpretLang = "zh",
): { summaryText: string; summaryBullets: string[] } {
  if (emptySelection) {
    return {
      summaryText:
        lang === "zh"
          ? "当前未选中研究对象，暂无讨论趋势数据。"
          : "No targets selected; trend series is empty.",
      summaryBullets: [],
    };
  }
  if (points.length === 0) {
    return {
      summaryText:
        lang === "zh"
          ? undatedCount > 0
            ? `当前范围内有 ${fmtNum(undatedCount)} 条内容缺少发布时间，暂无可用于按发布时间绘制趋势的样本。`
            : "当前研究范围内暂无带发布时间的讨论样本。"
          : undatedCount > 0
            ? `${fmtNum(undatedCount)} items lack publish timestamps; no dated trend buckets are available.`
            : "No dated samples found in the selected scope.",
      summaryBullets: [],
    };
  }

  if (points.length === 1) {
    const only = points[0];
    const label = only.bucket.slice(0, 10);
    const text =
      lang === "zh"
        ? `当前研究范围内仅在 ${label} 有 1 个时间分桶的数据，共 ${fmtNum(only.totalCount)} 条内容（帖文 ${fmtNum(only.postsCount)}、评论 ${fmtNum(only.commentsCount)}）。${undatedCount > 0 ? `另有 ${fmtNum(undatedCount)} 条缺少发布时间。` : ""}`
        : `Only a single time bucket (${label}) has data in scope, totaling ${fmtNum(only.totalCount)} items.${undatedCount > 0 ? ` ${fmtNum(undatedCount)} undated items excluded.` : ""}`;
    return { summaryText: text, summaryBullets: [text] };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const maxVal = Math.max(...points.map((p) => p.totalCount));
  const peaks = points.filter((p) => p.totalCount === maxVal);
  const peakLabel = peaks.map((p) => p.bucket.slice(0, 13).replace("T", " ")).slice(0, 2).join("、");
  const startLabel = first.bucket.slice(0, 10);
  const endLabel = last.bucket.slice(0, 10);
  const delta = last.totalCount - first.totalCount;

  const bullets: string[] = [];
  if (lang === "zh") {
    const changeClause =
      first.totalCount === 0
        ? last.totalCount > 0
          ? `末期（${endLabel}）增至 ${fmtNum(last.totalCount)} 条`
          : `起点（${startLabel}）与终点（${endLabel}）均为 0 条`
        : `较起点（${startLabel}，${fmtNum(first.totalCount)} 条）${delta > 0 ? "上升" : delta < 0 ? "下降" : "持平"}${delta !== 0 ? ` ${Math.abs(Math.round((delta / first.totalCount) * 100))}%` : ""}至 ${fmtNum(last.totalCount)} 条（${endLabel}）`;
    bullets.push(
      `观测区间 ${startLabel} 至 ${endLabel} 共覆盖 ${points.length} 个有效分桶，讨论量峰值为 ${fmtNum(maxVal)} 条（出现在 ${peakLabel}${peaks.length > 1 ? " 等" : ""}），${changeClause}。`,
    );
    if (undatedCount > 0) {
      bullets.push(`另有 ${fmtNum(undatedCount)} 条样本未记录发布时间，未纳入时间轴分桶。`);
    }
    return { summaryText: bullets.join(" "), summaryBullets: bullets };
  }

  const pctText =
    first.totalCount > 0
      ? ` (${delta >= 0 ? "+" : ""}${Math.round((delta / first.totalCount) * 100)}%)`
      : "";
  bullets.push(
    `Across ${points.length} active buckets from ${startLabel} to ${endLabel}, volume peaked at ${fmtNum(maxVal)} (${peakLabel}) and moved from ${fmtNum(first.totalCount)} to ${fmtNum(last.totalCount)}${pctText}.`,
  );
  if (undatedCount > 0) {
    bullets.push(`${fmtNum(undatedCount)} undated items are excluded from the time axis.`);
  }
  return { summaryText: bullets.join(" "), summaryBullets: bullets };
}

export function interpretKeywords(
  rows: L1KeywordRow[],
  deduplicatedTotal: number,
  overlapTotal: number,
  lang: InterpretLang = "zh",
): { summaryText: string; summaryBullets: string[] } {
  if (rows.length === 0 || deduplicatedTotal === 0) {
    return {
      summaryText:
        lang === "zh"
          ? "当前研究范围内暂无按采集关键词分组的内容统计。"
          : "No keyword-attributed content in the current scope.",
      summaryBullets: [],
    };
  }
  const sorted = [...rows].sort((a, b) => b.contentCount - a.contentCount);
  const top = sorted[0];
  const tiedTop = sorted.filter((r) => r.contentCount === top.contentCount);
  const bullets: string[] = [];

  if (lang === "zh") {
    if (sorted.length === 1) {
      bullets.push(
        `当前仅包含 1 个采集关键词「${top.label}」，共覆盖 ${fmtNum(top.contentCount)} 条去重内容（占总研究范围 ${fmtPct(top.contentCount, deduplicatedTotal)}）。`,
      );
    } else if (tiedTop.length > 1) {
      bullets.push(
        `当前研究范围内，${tiedTop.map((r) => `「${r.label}」`).join("与")} 并列第一，各关联 ${fmtNum(top.contentCount)} 条内容（分别占总去重样本的 ${fmtPct(top.contentCount, deduplicatedTotal)}）。`,
      );
    } else {
      const second = sorted[1];
      const diff = top.contentCount - second.contentCount;
      bullets.push(
        `当前研究范围内，「${top.label}」关联内容最多，为 ${fmtNum(top.contentCount)} 条（占总去重样本 ${fmtPct(top.contentCount, deduplicatedTotal)}），其次为「${second.label}」（${fmtNum(second.contentCount)} 条），两者相差 ${fmtNum(diff)} 条。`,
      );
    }
    if (overlapTotal > 0) {
      bullets.push(
        `存在 ${fmtNum(overlapTotal)} 条跨关键词重叠内容（占去重总量 ${fmtPct(overlapTotal, deduplicatedTotal)}），按关键词分组时允许重复归属，但项目总量已去重。`,
      );
    }
    return { summaryText: bullets.join(" "), summaryBullets: bullets };
  }

  if (sorted.length === 1) {
    bullets.push(`Only "${top.label}" is present in scope with ${fmtNum(top.contentCount)} items (${fmtPct(top.contentCount, deduplicatedTotal)}).`);
  } else {
    const second = sorted[1];
    bullets.push(
      `"${top.label}" leads with ${fmtNum(top.contentCount)} items (${fmtPct(top.contentCount, deduplicatedTotal)}), ahead of "${second.label}" (${fmtNum(second.contentCount)}).`,
    );
  }
  if (overlapTotal > 0) {
    bullets.push(`${fmtNum(overlapTotal)} items overlap across multiple keywords and remain deduplicated in project totals.`);
  }
  return { summaryText: bullets.join(" "), summaryBullets: bullets };
}

export function interpretPlatforms(
  rows: L1PlatformRow[],
  deduplicatedTotal: number,
  lang: InterpretLang = "zh",
): { summaryText: string; summaryBullets: string[] } {
  if (rows.length === 0 || deduplicatedTotal === 0) {
    return {
      summaryText:
        lang === "zh" ? "当前范围内暂无平台分布数据。" : "No platform distribution data in current scope.",
      summaryBullets: [],
    };
  }
  const sorted = [...rows].sort((a, b) => b.contentCount - a.contentCount);
  const top = sorted[0];
  const nameOf = (p: string) => (p === "x" ? "X" : p === "reddit" ? "Reddit" : p === "bluesky" ? "Bluesky" : "Web");

  if (sorted.length === 1) {
    const text =
      lang === "zh"
        ? `当前研究范围全部来自单一平台 ${nameOf(top.platform)}，共 ${fmtNum(top.contentCount)} 条去重内容（100.0%）。`
        : `All ${fmtNum(top.contentCount)} items in scope come from ${nameOf(top.platform)} (100.0%).`;
    return { summaryText: text, summaryBullets: [text] };
  }
  const second = sorted[1];
  const text =
    lang === "zh"
      ? `${nameOf(top.platform)} 为当前主要内容来源，共 ${fmtNum(top.contentCount)} 条（占比 ${fmtPct(top.contentCount, deduplicatedTotal)}）；其次为 ${nameOf(second.platform)}（${fmtNum(second.contentCount)} 条，占比 ${fmtPct(second.contentCount, deduplicatedTotal)}）。`
      : `${nameOf(top.platform)} accounts for the largest share at ${fmtNum(top.contentCount)} items (${fmtPct(top.contentCount, deduplicatedTotal)}), followed by ${nameOf(second.platform)} (${fmtNum(second.contentCount)}, ${fmtPct(second.contentCount, deduplicatedTotal)}).`;
  return { summaryText: text, summaryBullets: [text] };
}

export function interpretSources(
  communities: L1SourceRankingItem[],
  collectionSources: L1SourceRankingItem[],
  deduplicatedTotal: number,
  lang: InterpretLang = "zh",
): { summaryText: string; summaryBullets: string[] } {
  const list = communities.length > 0 ? communities : collectionSources;
  if (list.length === 0 || deduplicatedTotal === 0) {
    return {
      summaryText:
        lang === "zh" ? "当前范围内暂无社区或来源排名数据。" : "No community or source ranking data available.",
      summaryBullets: [],
    };
  }
  const sorted = [...list].sort((a, b) => b.contentCount - a.contentCount);
  const top = sorted[0];
  const tied = sorted.filter((x) => x.contentCount === top.contentCount);

  if (lang === "zh") {
    if (sorted.length === 1) {
      const text = `当前研究范围内共有 1 个主要来源 ${top.label}，共 ${fmtNum(top.contentCount)} 条内容（占总量 ${fmtPct(top.contentCount, deduplicatedTotal)}）。`;
      return { summaryText: text, summaryBullets: [text] };
    }
    if (tied.length > 1) {
      const text = `当前研究范围内，${tied.map((t) => t.label).slice(0, 3).join("、")} 并列第一，均为 ${fmtNum(top.contentCount)} 条内容（占比 ${fmtPct(top.contentCount, deduplicatedTotal)}）。`;
      return { summaryText: text, summaryBullets: [text] };
    }
    const second = sorted[1];
    const diff = top.contentCount - second.contentCount;
    const text = `当前研究范围内，${top.label} 的内容数量最高，为 ${fmtNum(top.contentCount)} 条（占总量 ${fmtPct(top.contentCount, deduplicatedTotal)}），其次为 ${second.label}（${fmtNum(second.contentCount)} 条）。排名第一的来源比第二名多 ${fmtNum(diff)} 条内容。`;
    return { summaryText: text, summaryBullets: [text] };
  }

  if (sorted.length === 1) {
    const text = `${top.label} is the sole observed community/source with ${fmtNum(top.contentCount)} items.`;
    return { summaryText: text, summaryBullets: [text] };
  }
  const second = sorted[1];
  const text = `${top.label} leads with ${fmtNum(top.contentCount)} items (${fmtPct(top.contentCount, deduplicatedTotal)}), ahead of ${second.label} (${fmtNum(second.contentCount)}) by ${fmtNum(top.contentCount - second.contentCount)}.`;
  return { summaryText: text, summaryBullets: [text] };
}

export function interpretKinds(
  totals: { posts: number; comments: number; articles: number; total: number },
  byPlatform: L1KindRow[],
  lang: InterpretLang = "zh",
): { summaryText: string; summaryBullets: string[] } {
  if (totals.total === 0) {
    return {
      summaryText:
        lang === "zh" ? "当前范围内暂无内容类型分布数据。" : "No content type distribution data available.",
      summaryBullets: [],
    };
  }
  const parts: Array<{ label: string; count: number }> = [
    { label: lang === "zh" ? "帖文" : "Posts", count: totals.posts },
    { label: lang === "zh" ? "评论" : "Comments", count: totals.comments },
    { label: lang === "zh" ? "文章" : "Articles", count: totals.articles },
  ].filter((p) => p.count > 0);
  const top = [...parts].sort((a, b) => b.count - a.count)[0];
  const desc = parts.map((p) => `${p.label} ${fmtNum(p.count)}（${fmtPct(p.count, totals.total)}）`).join("、");
  if (lang === "zh") {
    const text = `当前 ${fmtNum(totals.total)} 条去重内容中，以${top.label}为主（${fmtPct(top.count, totals.total)}）；整体结构为：${desc}${byPlatform.length > 1 ? `，分布在 ${byPlatform.length} 个平台` : ""}。`;
    return { summaryText: text, summaryBullets: [text] };
  }
  const enDesc = parts.map((p) => `${p.label}: ${fmtNum(p.count)} (${fmtPct(p.count, totals.total)})`).join(", ");
  const text = `Across ${fmtNum(totals.total)} deduplicated items, ${top.label.toLowerCase()} make up the largest share (${fmtPct(top.count, totals.total)}): ${enDesc}.`;
  return { summaryText: text, summaryBullets: [text] };
}

export function interpretEngagement(
  platforms: L1PlatformEngagementSummary[],
  reportedVsCollected: { reportedPlatformComments: number; collectedComments: number },
  lang: InterpretLang = "zh",
): { summaryText: string; summaryBullets: string[] } {
  if (platforms.length === 0) {
    return {
      summaryText:
        lang === "zh" ? "当前范围内暂无可用于统计互动指标的内容样本。" : "No items with engagement metrics in current scope.",
      summaryBullets: [],
    };
  }
  const bullets: string[] = [];
  if (lang === "zh") {
    for (const p of platforms) {
      const pName = p.platform === "x" ? "X" : p.platform === "reddit" ? "Reddit" : p.platform === "bluesky" ? "Bluesky" : "Web";
      if (p.postCount > 0) {
        bullets.push(
          `${pName}（${fmtNum(p.postCount)} 篇主帖/文章）：累计 ${p.primaryMetricLabel} ${fmtNum(p.totalPrimaryMetric)}（篇均 ${p.avgPrimaryMetric.toFixed(1)}），平台记录评论/回复 ${fmtNum(p.reportedRepliesSum)} 条。`,
        );
      }
    }
    if (reportedVsCollected.reportedPlatformComments > 0 || reportedVsCollected.collectedComments > 0) {
      bullets.push(
        `全范围主帖标注评论总量为 ${fmtNum(reportedVsCollected.reportedPlatformComments)} 条，实际已入库评论文本 ${fmtNum(reportedVsCollected.collectedComments)} 条（各平台指标定义不同，分开展示以避免跨平台直接相加失真）。`,
      );
    }
    if (bullets.length === 0) {
      bullets.push("当前样本主要为评论或缺少互动指标的主帖，暂无可汇总的点赞/评论计数。");
    }
    return { summaryText: bullets.join(" "), summaryBullets: bullets };
  }

  for (const p of platforms) {
    if (p.postCount > 0) {
      bullets.push(
        `${p.platform.toUpperCase()} (${fmtNum(p.postCount)} posts): ${fmtNum(p.totalPrimaryMetric)} ${p.primaryMetricLabel} (avg ${p.avgPrimaryMetric.toFixed(1)}), ${fmtNum(p.reportedRepliesSum)} reported replies.`,
      );
    }
  }
  bullets.push(
    `Platform-reported replies total ${fmtNum(reportedVsCollected.reportedPlatformComments)} vs ${fmtNum(reportedVsCollected.collectedComments)} collected comment records.`,
  );
  return { summaryText: bullets.join(" "), summaryBullets: bullets };
}
