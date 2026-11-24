/**
 * Lightweight bilingual (EN + ZH + mixed) text preprocessing, n-gram/TF-IDF extraction,
 * co-occurrence scoring, and Z-score anomaly detection. Zero heavy external NLP dependencies.
 */

const EN_STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "cannot", "could", "did", "do", "does", "doing", "don", "down", "during", "each", "few",
  "for", "from", "further", "get", "gets", "got", "had", "has", "have", "having", "he", "her", "here",
  "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its",
  "itself", "just", "know", "like", "ll", "make", "many", "may", "me", "more", "most", "much", "must",
  "my", "myself", "new", "no", "nor", "not", "now", "of", "off", "on", "once", "one", "only", "or",
  "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "really", "re", "same", "say",
  "see", "she", "should", "so", "some", "still", "such", "take", "than", "that", "the", "their",
  "theirs", "them", "themselves", "then", "there", "these", "they", "thing", "think", "this", "those",
  "through", "to", "too", "under", "until", "up", "use", "used", "using", "ve", "very", "want", "was",
  "way", "we", "well", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will",
  "with", "won", "would", "you", "your", "yours", "yourself", "yourselves", "also", "even", "much",
  "https", "http", "www", "com", "org", "reddit", "amp", "gt", "lt",
]);

const ZH_STOPWORDS = new Set([
  "的", "了", "和", "是", "就", "都", "而", "及", "与", "着", "或", "一个", "没有", "我们", "你们", "他们",
  "她们", "它们", "自己", "这个", "那个", "这些", "那些", "这样", "那样", "这里", "那里", "什么", "怎么",
  "为什么", "可以", "可能", "应该", "需要", "已经", "正在", "非常", "比较", "还是", "但是", "然而", "因为",
  "所以", "如果", "虽然", "不过", "只是", "就是", "不是", "还有", "以及", "关于", "对于", "通过", "进行",
  "使用", "觉得", "感觉", "认为", "看到", "知道", "出来", "起来", "下去", "现在", "今天", "其实", "确实",
  "真的", "大家", "很多", "一些", "一点", "一下", "一种", "部分", "主要", "基本", "完全", "或者", "并且",
]);

const ZH_SINGLE_STOP = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "上", "也", "很", "到", "说", "要",
  "去", "你", "会", "着", "没", "看", "好", "这", "那", "他", "她", "它", "把", "被", "从", "对", "为", "以",
  "及", "与", "或", "而", "但", "只", "还", "再", "又", "更", "太", "真", "可", "能", "吧", "呢", "啊", "吗",
  "呀", "哦", "嘛", "啦", "个", "种", "次", "条", "篇", "年", "月", "日", "中", "大", "小", "多", "少",
]);

// Curated CJK technical / research lexicon for clean tokenization in mixed prompts
const ZH_DOMAIN_LEXICON = new Set([
  "大模型", "人工智能", "深度学习", "机器学习", "自然语言", "向量数据库", "推理速度", "上下文", "提示词",
  "知识库", "工作流", "智能体", "开源模型", "闭源模型", "代码生成", "编程助手", "算力成本", "推理成本",
  "本地部署", "私有部署", "多模态", "微调", "基准测试", "幻觉", "性价比", "延迟", "吞吐量", "准确率",
  "稳定性", "兼容性", "用户体验", "自动化", "并发", "数据库", "前端", "后端", "架构", "性能", "安全",
  "隐私", "定价", "收费", "免费", "订阅", "限流", "故障", "崩溃", "报错", "卡顿", "升级", "迁移", "替代",
  "对比", "评测", "推荐", "避坑", "真实", "反馈", "评论", "社区", "热度", "趋势", "情感", "正面", "负面",
]);

export interface CleanTokenOptions {
  /** Max tokens retained per document to bound worst-case CPU on giant posts */
  maxTokensPerDoc?: number;
}

export function cleanTextForAnalysis(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    // Convert markdown links [label](url) -> label
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, " $1 ")
    // Strip raw URLs
    .replace(/https?:\/\/[^\s)>\]"']+/gi, " ")
    // Decode common HTML entities
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Strip residual HTML tags & markdown formatting punctuation
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function segmentCjkRun(run: string): string[] {
  const out: string[] = [];
  if (run.length <= 1) {
    return out;
  }
  // Forward longest match with 4->2 char lexicon check, otherwise clean 2-char overlapping bigrams
  let i = 0;
  while (i < run.length) {
    let matched = "";
    for (let len = Math.min(4, run.length - i); len >= 2; len--) {
      const candidate = run.slice(i, i + len);
      if (ZH_DOMAIN_LEXICON.has(candidate)) {
        matched = candidate;
        break;
      }
    }
    if (matched) {
      if (!ZH_STOPWORDS.has(matched)) out.push(matched);
      i += matched.length;
      continue;
    }
    if (i + 1 < run.length) {
      const ch0 = run[i];
      const ch1 = run[i + 1];
      const bi = ch0 + ch1;
      // Avoid emitting bigrams anchored on single grammatical particles unless whole run is 2 chars
      if (!ZH_STOPWORDS.has(bi) && (!ZH_SINGLE_STOP.has(ch0) || !ZH_SINGLE_STOP.has(ch1))) {
        if (!ZH_SINGLE_STOP.has(ch0) && !ZH_SINGLE_STOP.has(ch1)) {
          out.push(bi);
        }
      }
    }
    i += 1;
  }
  return out;
}

const PRESERVED_SHORT_ALNUM = new Set(["o1", "o3", "o4", "r1", "v3", "v2", "4o", "c#", "r", "x"]);

/** Split cleaned text into ordered clause token arrays for unigram, n-gram, and co-occurrence use */
export function tokenizeClauses(raw: string | null | undefined, options: CleanTokenOptions = {}): string[][] {
  const cleaned = cleanTextForAnalysis(raw);
  if (!cleaned) return [];
  const maxTokens = options.maxTokensPerDoc ?? 240;
  const clauses = cleaned.split(/[\n\r.!?;:。！？；：]+/);
  const result: string[][] = [];
  let count = 0;

  for (const clause of clauses) {
    if (count >= maxTokens) break;
    const trimmed = clause.trim();
    if (!trimmed) continue;
    const tokens: string[] = [];
    // Walk mixed Latin/number tokens and CJK spans in order
    const re = /([a-z0-9][a-z0-9.+_-]{0,39}|[\u4e00-\u9fff]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed)) !== null) {
      if (count >= maxTokens) break;
      const seg = m[1];
      if (/^[\u4e00-\u9fff]+$/.test(seg)) {
        for (const t of segmentCjkRun(seg)) {
          if (count >= maxTokens) break;
          tokens.push(t);
          count++;
        }
      } else {
        const low = seg.toLowerCase().replace(/^[._-]+|[._-]+$/g, "");
        if (!low) continue;
        // Drop pure numbers unless 4-digit year-like? Actually drop pure digits to reduce noise
        if (/^\d+$/.test(low)) continue;
        if (EN_STOPWORDS.has(low)) continue;
        if (low.length < 2 && !PRESERVED_SHORT_ALNUM.has(low)) continue;
        tokens.push(low);
        count++;
      }
    }
    if (tokens.length > 0) result.push(tokens);
  }
  return result;
}

export function tokenizeText(raw: string | null | undefined, options: CleanTokenOptions = {}): string[] {
  return tokenizeClauses(raw, options).flat();
}

export interface DocumentTextRecord {
  id: string;
  title: string | null;
  text: string;
  engagementScore: number;
  bucket?: string | null;
  platform?: string;
  targetKeys?: string[];
}

export interface TermFrequencyItem {
  term: string;
  termCount: number;
  docCount: number;
  sharePct: number;
  avgScore?: number;
}

export function extractNgrams(
  docs: readonly { tokens?: string[]; clauses: string[][] }[],
  n: 1 | 2 | 3,
  topN = 20,
): TermFrequencyItem[] {
  const totalDocs = docs.length;
  if (totalDocs === 0) return [];
  const tfMap = new Map<string, number>();
  const dfMap = new Map<string, number>();

  for (const doc of docs) {
    const seenInDoc = new Set<string>();
    for (const clause of doc.clauses) {
      if (clause.length < n) continue;
      for (let i = 0; i <= clause.length - n; i++) {
        const slice = clause.slice(i, i + n);
        // If every token is identical (e.g., spam "good good"), skip n >= 2
        if (n >= 2 && new Set(slice).size === 1) continue;
        const gram = slice.some((s) => /[\u4e00-\u9fff]/.test(s)) ? slice.join(" / ") : slice.join(" ");
        tfMap.set(gram, (tfMap.get(gram) ?? 0) + 1);
        if (!seenInDoc.has(gram)) {
          seenInDoc.add(gram);
          dfMap.set(gram, (dfMap.get(gram) ?? 0) + 1);
        }
      }
    }
  }

  return [...dfMap.entries()]
    .map(([term, docCount]) => ({
      term,
      termCount: tfMap.get(term) ?? docCount,
      docCount,
      sharePct: Number(((docCount / totalDocs) * 100).toFixed(1)),
    }))
    .filter((item) => (n === 1 ? item.docCount >= 1 : item.docCount >= (totalDocs >= 10 ? 2 : 1)))
    .sort((a, b) => b.docCount - a.docCount || b.termCount - a.termCount || a.term.localeCompare(b.term))
    .slice(0, topN);
}

export function extractTfIdfKeywords(
  docs: readonly { clauses: string[][] }[],
  topN = 20,
): TermFrequencyItem[] {
  const totalDocs = docs.length;
  if (totalDocs === 0) return [];
  const dfMap = new Map<string, number>();
  const tfTotal = new Map<string, number>();
  const docTokenCounts: Array<Map<string, number>> = [];

  for (const doc of docs) {
    const counts = new Map<string, number>();
    for (const clause of doc.clauses) {
      for (const tok of clause) {
        counts.set(tok, (counts.get(tok) ?? 0) + 1);
        tfTotal.set(tok, (tfTotal.get(tok) ?? 0) + 1);
      }
    }
    for (const tok of counts.keys()) {
      dfMap.set(tok, (dfMap.get(tok) ?? 0) + 1);
    }
    docTokenCounts.push(counts);
  }

  const scoreSum = new Map<string, number>();
  for (const counts of docTokenCounts) {
    for (const [tok, tf] of counts.entries()) {
      const df = dfMap.get(tok) ?? 1;
      const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;
      const tfidf = (1 + Math.log(tf)) * idf;
      scoreSum.set(tok, (scoreSum.get(tok) ?? 0) + tfidf);
    }
  }

  return [...scoreSum.entries()]
    .map(([term, totalScore]) => {
      const docCount = dfMap.get(term) ?? 1;
      return {
        term,
        termCount: tfTotal.get(term) ?? docCount,
        docCount,
        sharePct: Number(((docCount / totalDocs) * 100).toFixed(1)),
        avgScore: Number((totalScore / totalDocs).toFixed(4)),
      };
    })
    .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0) || b.docCount - a.docCount)
    .slice(0, topN);
}

export function computeTermCooccurrence(
  docs: readonly { clauses: string[][] }[],
  matrixSize = 14,
): {
  terms: string[];
  cells: Array<{ termA: string; termB: string; coCount: number; lift: number }>;
  topPairs: Array<{ termA: string; termB: string; coCount: number; lift: number }>;
} {
  const N = docs.length;
  if (N === 0) return { terms: [], cells: [], topPairs: [] };

  const df = new Map<string, number>();
  const docSets: Array<Set<string>> = [];
  for (const doc of docs) {
    const s = new Set(doc.clauses.flat());
    docSets.push(s);
    for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const topTerms = [...df.entries()]
    .filter(([, count]) => count >= (N >= 8 ? 2 : 1))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, matrixSize)
    .map(([term]) => term);

  const termSet = new Set(topTerms);
  const pairCount = new Map<string, number>();

  for (const s of docSets) {
    const present = [...s].filter((t) => termSet.has(t)).sort();
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const key = `${present[i]}\u0000${present[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  const cells: Array<{ termA: string; termB: string; coCount: number; lift: number }> = [];
  const topPairs: Array<{ termA: string; termB: string; coCount: number; lift: number }> = [];

  for (let i = 0; i < topTerms.length; i++) {
    for (let j = 0; j < topTerms.length; j++) {
      const a = topTerms[i];
      const b = topTerms[j];
      if (i === j) {
        cells.push({ termA: a, termB: b, coCount: df.get(a) ?? 0, lift: 1 });
        continue;
      }
      const key = i < j ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      const co = pairCount.get(key) ?? 0;
      const pA = (df.get(a) ?? 1) / N;
      const pB = (df.get(b) ?? 1) / N;
      const pAB = co / N;
      const lift = pA > 0 && pB > 0 ? Number((pAB / (pA * pB)).toFixed(2)) : 0;
      cells.push({ termA: a, termB: b, coCount: co, lift });
      if (i < j && co > 0) {
        topPairs.push({ termA: a, termB: b, coCount: co, lift });
      }
    }
  }

  topPairs.sort((a, b) => b.coCount - a.coCount || b.lift - a.lift);
  return { terms: topTerms, cells, topPairs: topPairs.slice(0, 20) };
}

export function computeDistinctiveTermsForGroups(
  groups: ReadonlyArray<{
    objectKey: string;
    label: string;
    docIndices: number[];
  }>,
  docTokenSets: ReadonlyArray<Set<string>>,
  topPerGroup = 10,
) {
  const totalDocs = docTokenSets.length;
  const globalDf = new Map<string, number>();
  for (const s of docTokenSets) {
    for (const t of s) globalDf.set(t, (globalDf.get(t) ?? 0) + 1);
  }

  return groups.map((grp) => {
    const nGroup = grp.docIndices.length;
    const nRest = Math.max(0, totalDocs - nGroup);
    if (nGroup === 0) {
      return { objectKey: grp.objectKey, label: grp.label, contentCount: 0, distinctiveTerms: [] };
    }
    const grpDf = new Map<string, number>();
    for (const idx of grp.docIndices) {
      for (const t of docTokenSets[idx] ?? []) {
        grpDf.set(t, (grpDf.get(t) ?? 0) + 1);
      }
    }

    const scored = [...grpDf.entries()]
      .filter(([, gCount]) => gCount >= (nGroup >= 5 ? 2 : 1))
      .map(([term, gCount]) => {
        const allCount = globalDf.get(term) ?? gCount;
        const rCount = Math.max(0, allCount - gCount);
        const pGroup = (gCount + 0.5) / (nGroup + 1);
        const pRest = (rCount + 0.5) / (nRest + 1);
        // Log-odds difference with Dirichlet smoothing
        const logOdds = Math.log(pGroup / (1 - pGroup)) - Math.log(pRest / (1 - pRest));
        const inGroupPct = Number(((gCount / nGroup) * 100).toFixed(1));
        const restPct = nRest > 0 ? Number(((rCount / nRest) * 100).toFixed(1)) : 0;
        return {
          term,
          score: Number((logOdds * Math.log1p(gCount)).toFixed(3)),
          docCount: gCount,
          inGroupPct,
          restPct,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.docCount - a.docCount)
      .slice(0, topPerGroup);

    return {
      objectKey: grp.objectKey,
      label: grp.label,
      contentCount: nGroup,
      distinctiveTerms: scored,
    };
  });
}

export function detectBucketAnomalies(
  series: ReadonlyArray<{
    bucket: string;
    count: number;
    topTerms: string[];
    topItemIds: string[];
  }>,
  sensitivity: "low" | "medium" | "high" = "medium",
) {
  const thresholdZ = sensitivity === "high" ? 1.5 : sensitivity === "low" ? 2.5 : 2.0;
  if (series.length === 0) {
    return { thresholdZ, points: [] };
  }
  const counts = series.map((s) => s.count);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((acc, c) => acc + (c - mean) ** 2, 0) / Math.max(1, counts.length);
  const std = Math.sqrt(variance);

  const points = series.map((pt) => {
    const z = std > 0 ? (pt.count - mean) / std : 0;
    const isAnomaly = series.length >= 4 && std > 0 && Math.abs(z) >= thresholdZ;
    const direction: "spike" | "drop" | "normal" = !isAnomaly ? "normal" : z > 0 ? "spike" : "drop";
    return {
      bucket: pt.bucket,
      count: pt.count,
      baselineAvg: Number(mean.toFixed(2)),
      zScore: Number(z.toFixed(2)),
      isAnomaly,
      direction,
      topTerms: pt.topTerms,
      topItemIds: pt.topItemIds,
    };
  });
  return { thresholdZ, points };
}
