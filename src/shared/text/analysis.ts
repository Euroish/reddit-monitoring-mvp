import stemmer from "wink-porter2-stemmer";
import { stripHtmlToPlainText } from "./html";

/**
 * Shared lightweight bilingual (EN + ZH + mixed) text preprocessing, phrase normalization,
 * Node 24 Intl.Segmenter CJK word segmentation, English inflectional lemmatization & Porter2 stemming,
 * n-gram/TF-IDF extraction, co-occurrence scoring, sparse NMF solver, and anomaly detection.
 * Leaf module under src/shared/ with zero database, HTTP, or native C++ dependencies.
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
  "https", "http", "www", "com", "org", "reddit", "amp", "gt", "lt", "nbsp", "quot",
  "read", "comments", "comment", "points", "article", "show", "ask", "via", "post", "posts", "today",
]);

const ZH_STOPWORDS = new Set([
  "的", "了", "和", "是", "就", "都", "而", "及", "与", "着", "或", "一个", "没有", "我们", "你们", "他们",
  "她们", "它们", "自己", "这个", "那个", "这些", "那些", "这样", "那样", "这里", "那里", "什么", "怎么",
  "为什么", "可以", "可能", "应该", "需要", "已经", "正在", "非常", "比较", "还是", "但是", "然而", "因为",
  "所以", "如果", "虽然", "不过", "只是", "就是", "不是", "还有", "以及", "关于", "对于", "通过", "进行",
  "使用", "觉得", "感觉", "认为", "看到", "知道", "出来", "起来", "下去", "现在", "今天", "其实", "确实",
  "真的", "大家", "很多", "一些", "一点", "一下", "一种", "部分", "主要", "基本", "完全", "或者", "并且",
  "报道", "发布", "更新", "消息", "表示", "称", "指出", "相关", "目前", "其中", "同时", "此外",
]);

const ZH_SINGLE_STOP = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "上", "也", "很", "到", "说", "要",
  "去", "你", "会", "着", "没", "看", "好", "这", "那", "他", "她", "它", "把", "被", "从", "对", "为", "以",
  "及", "与", "或", "而", "但", "只", "还", "再", "又", "更", "太", "真", "可", "能", "吧", "呢", "啊", "吗",
  "呀", "哦", "嘛", "啦", "个", "种", "次", "条", "篇", "年", "月", "日", "中", "大", "小", "多", "少",
]);

// Curated CJK technical / research lexicon for clean tokenization in mixed prompts (also supplements ICU Intl.Segmenter gaps)
const ZH_DOMAIN_LEXICON = new Set([
  "大模型", "人工智能", "深度学习", "机器学习", "自然语言", "向量数据库", "推理速度", "上下文", "提示词",
  "知识库", "工作流", "智能体", "多智能体", "开源模型", "闭源模型", "代码生成", "编程助手", "算力成本", "推理成本",
  "本地部署", "私有部署", "多模态", "微调", "基准测试", "幻觉", "性价比", "延迟", "吞吐量", "准确率",
  "稳定性", "兼容性", "用户体验", "自动化", "并发", "数据库", "前端", "后端", "架构", "性能", "安全",
  "隐私", "定价", "收费", "免费", "订阅", "限流", "故障", "崩溃", "报错", "卡顿", "升级", "迁移", "替代",
  "对比", "评测", "推荐", "避坑", "真实", "反馈", "评论", "社区", "热度", "趋势", "情感", "正面", "负面",
  "具身智能", "世界模型", "推理模型", "强化学习", "量子计算", "机器人", "芯片", "半导体", "自动驾驶",
  "开源", "闭源", "模型", "推理", "训练", "优化", "量化", "蒸馏", "部署", "编译", "基准", "测试",
  "指标", "框架", "工具", "算法", "插件", "缓存", "响应", "内存", "显存", "算力", "接口", "源码",
  "文档", "协同", "对齐", "合规", "成本", "效率", "体验", "口碑", "涨价", "降价", "付费", "权重",
]);

// Curated multi-word technical phrases preserved as cohesive tokens in editorial / tech insights
const EN_TECH_PHRASES: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/\bai[\s-]+agents?\b/gi, "ai_agent", "AI Agent"],
  [/\bworld[\s-]+models?\b/gi, "world_model", "World Model"],
  [/\bopen[\s-]+source\b/gi, "open_source", "Open Source"],
  [/\bopen[\s-]+weights?\b/gi, "open_weights", "Open Weights"],
  [/\blarge[\s-]+language[\s-]+models?\b/gi, "llm", "LLM"],
  [/\bcontext[\s-]+windows?\b/gi, "context_window", "Context Window"],
  [/\bchain[\s-]+of[\s-]+thought\b/gi, "chain_of_thought", "Chain of Thought"],
  [/\breasoning[\s-]+models?\b/gi, "reasoning_model", "Reasoning Model"],
  [/\bcode[\s-]+generation\b/gi, "code_generation", "Code Generation"],
  [/\bmachine[\s-]+learning\b/gi, "machine_learning", "Machine Learning"],
  [/\bdeep[\s-]+learning\b/gi, "deep_learning", "Deep Learning"],
  [/\breinforcement[\s-]+learning\b/gi, "reinforcement_learning", "Reinforcement Learning"],
  [/\bfine[\s-]+tuning\b/gi, "fine_tuning", "Fine Tuning"],
  [/\bvector[\s-]+databases?\b/gi, "vector_db", "Vector DB"],
  [/\bfoundation[\s-]+models?\b/gi, "foundation_model", "Foundation Model"],
  [/\bfunction[\s-]+calling\b/gi, "function_calling", "Function Calling"],
  [/\bmcp[\s-]+servers?\b/gi, "mcp_server", "MCP Server"],
];

// Conservative acronym/plural canonicalization & human-readable display casing
const SAFE_ALIAS_MAP: Record<string, string> = {
  llms: "llm",
  agents: "agent",
  models: "model",
  benchmarks: "benchmark",
  gpus: "gpu",
  apis: "api",
  sdks: "sdk",
  tools: "tool",
  workflows: "workflow",
  tokens: "token",
  chips: "chip",
  robots: "robot",
};

const DISPLAY_LABEL_MAP: Record<string, string> = {
  ai: "AI",
  ai_agent: "AI Agent",
  world_model: "World Model",
  open_source: "Open Source",
  open_weights: "Open Weights",
  context_window: "Context Window",
  chain_of_thought: "Chain of Thought",
  reasoning_model: "Reasoning Model",
  code_generation: "Code Generation",
  machine_learning: "Machine Learning",
  deep_learning: "Deep Learning",
  reinforcement_learning: "RL / Reinforcement Learning",
  fine_tuning: "Fine Tuning",
  vector_db: "Vector DB",
  foundation_model: "Foundation Model",
  function_calling: "Function Calling",
  mcp_server: "MCP Server",
  llm: "LLM",
  gpu: "GPU",
  cpu: "CPU",
  api: "API",
  sdk: "SDK",
  rag: "RAG",
  mcp: "MCP",
  cli: "CLI",
  ide: "IDE",
  ui: "UI",
  openai: "OpenAI",
  anthropic: "Anthropic",
  claude: "Claude",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  chatgpt: "ChatGPT",
  llama: "Llama",
  qwen: "Qwen",
  github: "GitHub",
  huggingface: "Hugging Face",
  nvidia: "NVIDIA",
  apple: "Apple",
  google: "Google",
  meta: "Meta",
  microsoft: "Microsoft",
  linux: "Linux",
  rust: "Rust",
  python: "Python",
  typescript: "TypeScript",
};

export interface CleanTokenOptions {
  /** Max tokens retained per document to bound worst-case CPU on giant posts */
  maxTokensPerDoc?: number;
  /** Preserve multi-word technical phrases & apply safe abbreviation normalization */
  preserveTechPhrases?: boolean;
}

const BOILERPLATE_STRIP_PATTERNS: readonly RegExp[] = [
  /\b(?:read more|continue reading|click here|learn more|subscribe now|sign up)\b[^.!?\n]*/gi,
  /\bsubmitted by\b\s*(?:\/?u\/[a-z0-9_-]+)?/gi,
  /\b(?:posted by|originally published at)\b[^.!?\n]*/gi,
  /阅读原文|查看详情|点击关注|转发抽奖|立即订阅/gu,
];

export function cleanTextForAnalysis(raw: string | null | undefined, stripBoilerplate = false): string {
  if (!raw) return "";
  let text = stripHtmlToPlainText(raw)
    // Convert markdown links [label](url) -> label
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, " $1 ")
    // Strip raw URLs
    .replace(/https?:\/\/[^\s)>\]"']+/gi, " ")
    // Strip code blocks & markdown formatting punctuation
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_~>#|]/g, " ");
  if (stripBoilerplate) {
    for (const pat of BOILERPLATE_STRIP_PATTERNS) text = text.replace(pat, " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

export function formatDisplayTerm(canonical: string): string {
  if (DISPLAY_LABEL_MAP[canonical]) return DISPLAY_LABEL_MAP[canonical];
  if (canonical.includes("_")) {
    return canonical
      .split("_")
      .map((part) => DISPLAY_LABEL_MAP[part] ?? (part.charAt(0).toUpperCase() + part.slice(1)))
      .join(" ");
  }
  return canonical;
}

// Node 24 native ICU-backed Chinese word segmenter (zero native addon or dictionary file overhead)
const zhWordSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("zh-CN", { granularity: "word" })
    : null;

function segmentPlainCjkSlice(slice: string, out: string[]): void {
  if (!slice) return;
  if (zhWordSegmenter) {
    for (const seg of zhWordSegmenter.segment(slice)) {
      if (!seg.isWordLike) continue;
      const word = seg.segment;
      if (ZH_STOPWORDS.has(word)) continue;
      if (word.length === 1 && (ZH_SINGLE_STOP.has(word) || !ZH_DOMAIN_LEXICON.has(word))) continue;
      out.push(word);
    }
    return;
  }
  if (slice.length >= 2 && !ZH_STOPWORDS.has(slice)) out.push(slice);
}

/**
 * Segments CJK runs using curated domain compound matching + Node 24 native Intl.Segmenter.
 */
export function segmentCjkRun(run: string): string[] {
  const out: string[] = [];
  if (run.length <= 1) return out;
  let i = 0;
  let plainStart = 0;

  while (i < run.length) {
    let matched = "";
    for (let len = Math.min(5, run.length - i); len >= 2; len--) {
      const candidate = run.slice(i, i + len);
      if (ZH_DOMAIN_LEXICON.has(candidate)) {
        matched = candidate;
        break;
      }
    }
    if (matched) {
      if (i > plainStart) segmentPlainCjkSlice(run.slice(plainStart, i), out);
      if (!ZH_STOPWORDS.has(matched)) out.push(matched);
      i += matched.length;
      plainStart = i;
      continue;
    }
    i += 1;
  }
  if (plainStart < run.length) segmentPlainCjkSlice(run.slice(plainStart), out);
  return out;
}

const EN_IRREGULAR_LEMMAS: Record<string, string> = {
  ran: "run",
  running: "run",
  built: "build",
  building: "build",
  wrote: "write",
  written: "write",
  writing: "write",
  broken: "break",
  broke: "break",
  breaking: "break",
  crashed: "crash",
  crashes: "crash",
  crashing: "crash",
  deployed: "deploy",
  deploying: "deploy",
  deployments: "deployment",
  optimized: "optimize",
  optimizing: "optimize",
  faster: "fast",
  fastest: "fast",
  slower: "slow",
  slowest: "slow",
  cheaper: "cheap",
  cheapest: "cheap",
  queries: "query",
  capabilities: "capability",
  latencies: "latency",
  agencies: "agency",
  dependencies: "dependency",
  repositories: "repository",
  libraries: "library",
  summaries: "summary",
  categories: "category",
  stories: "story",
  issues: "issue",
  errors: "error",
  bugs: "bug",
  updates: "update",
  updated: "update",
  updating: "update",
  released: "release",
  releases: "release",
  releasing: "release",
  published: "publish",
  publishing: "publish",
  improved: "improve",
  improves: "improve",
  improving: "improve",
  fixed: "fix",
  fixes: "fix",
  fixing: "fix",
  failed: "fail",
  fails: "fail",
  failing: "fail",
};

const SILENT_E_STEMS = new Set([
  "use", "make", "take", "give", "save", "move", "live", "love", "hate", "hope",
  "code", "note", "rate", "scale", "share", "store", "write", "solve", "serve",
  "merge", "parse", "route", "cache", "pause", "close", "score", "trace", "frame",
  "release", "update", "create", "delete", "enable", "disable", "manage", "change",
  "compare", "improve", "produce", "reduce", "replace", "require", "include", "explore",
  "compile", "deploy", "configure", "optimize", "generate", "integrate", "evaluate",
  "automate", "accelerate", "migrate", "summarize", "analyze", "benchmark",
]);

/**
 * Computes Porter2 English stem via pure-JS wink-porter2-stemmer (~26 KB).
 */
export function stemEnglishToken(word: string): string {
  if (!word || !/^[a-z]{3,}$/.test(word)) return word;
  return stemmer(word);
}

/**
 * Lightweight inflectional English lemmatizer returning human-readable base forms
 * while preserving acronyms, version codes, and curated phrases intact.
 */
export function normalizeEnglishInflection(low: string): string {
  if (low.length < 4 || !/^[a-z]+$/.test(low)) return low;
  if (SAFE_ALIAS_MAP[low]) return SAFE_ALIAS_MAP[low];
  if (EN_IRREGULAR_LEMMAS[low]) return EN_IRREGULAR_LEMMAS[low];

  // Plural restoration
  if (low.length > 5 && low.endsWith("ies") && !/[aeiou]ies$/.test(low)) {
    return `${low.slice(0, -3)}y`;
  }
  if (low.length > 5 && /(sses|xes|zes|ches|shes)$/.test(low)) {
    return low.slice(0, -2);
  }
  if (low.length > 4 && low.endsWith("s") && !/(ss|us|is|as|os|ous|ics)$/.test(low)) {
    const singular = low.slice(0, -1);
    if (singular.length >= 3) return singular;
  }

  // Regular -ed / -ing inflectional restoration (only if stem maintains >= 3 chars & vowel)
  if (low.length > 5 && low.endsWith("ied")) {
    return `${low.slice(0, -3)}y`;
  }
  if (low.length > 5 && low.endsWith("ed") && !/(eed|ted|ded)$/.test(low)) {
    let base = low.slice(0, -2);
    if (/([bcdfgptmnr])\1$/.test(base)) base = base.slice(0, -1);
    else if (SILENT_E_STEMS.has(`${base}e`)) base = `${base}e`;
    if (base.length >= 3 && /[aeiouy]/.test(base)) return base;
  }
  if (low.length > 6 && low.endsWith("ing") && !/(thing|string|bring|spring|king|ring|wing|pricing|coding)$/.test(low)) {
    let base = low.slice(0, -3);
    if (/([bcdfgptmnr])\1$/.test(base)) base = base.slice(0, -1);
    else if (SILENT_E_STEMS.has(`${base}e`)) base = `${base}e`;
    if (base.length >= 3 && /[aeiouy]/.test(base)) return base;
  }

  return low;
}

const PRESERVED_SHORT_ALNUM = new Set(["o1", "o3", "o4", "r1", "v3", "v2", "4o", "c#", "r", "x"]);

/** Split cleaned text into ordered clause token arrays for unigram, n-gram, and co-occurrence use */
export function tokenizeClauses(raw: string | null | undefined, options: CleanTokenOptions = {}): string[][] {
  let cleaned = cleanTextForAnalysis(raw, Boolean(options.preserveTechPhrases));
  if (!cleaned) return [];
  if (options.preserveTechPhrases) {
    for (const [pat, token] of EN_TECH_PHRASES) {
      cleaned = cleaned.replace(pat, ` ${token} `);
    }
  }
  const maxTokens = options.maxTokensPerDoc ?? 240;
  const clauses = cleaned.split(/[\n\r.!?;:。！？；：]+/);
  const result: string[][] = [];
  let count = 0;

  for (const clause of clauses) {
    if (count >= maxTokens) break;
    const trimmed = clause.trim();
    if (!trimmed) continue;
    const tokens: string[] = [];
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
        let low = seg.toLowerCase().replace(/^[._-]+|[._-]+$/g, "");
        if (!low) continue;
        if (/^\d+$/.test(low)) continue;
        if (EN_STOPWORDS.has(low)) continue;
        if (low.length >= 4 && !low.includes("_") && /^[a-z]+$/.test(low)) {
          low = normalizeEnglishInflection(low);
        } else if (options.preserveTechPhrases && SAFE_ALIAS_MAP[low]) {
          low = SAFE_ALIAS_MAP[low];
        }
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

export interface TermFrequencyItem {
  term: string;
  termCount: number;
  docCount: number;
  sharePct: number;
  avgScore?: number;
}

/**
 * Maps English surface variants (`>= 5` chars) that share a Porter2 stem within the corpus
 * to the cleanest canonical form (shortest readable word, tie-broken by highest df).
 */
export function buildStemCanonicalMap(dfMap: ReadonlyMap<string, number>): Map<string, string> {
  const byStem = new Map<string, string[]>();
  for (const term of dfMap.keys()) {
    if (!/^[a-z]{5,}$/.test(term)) continue;
    const st = stemEnglishToken(term);
    const list = byStem.get(st);
    if (list) list.push(term);
    else byStem.set(st, [term]);
  }
  const canonical = new Map<string, string>();
  for (const group of byStem.values()) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) =>
        a.length - b.length ||
        (dfMap.get(b) ?? 0) - (dfMap.get(a) ?? 0) ||
        a.localeCompare(b),
    );
    const winner = group[0];
    for (const term of group) canonical.set(term, winner);
  }
  return canonical;
}

export function extractNgrams(
  docs: readonly { tokens?: string[]; clauses: string[][] }[],
  n: 1 | 2 | 3,
  topN = 20,
): TermFrequencyItem[] {
  const totalDocs = docs.length;
  if (totalDocs === 0) return [];
  const tfMap = new Map<string, number>();
  const docSetsMap = new Map<string, Set<number>>();

  for (let docIdx = 0; docIdx < docs.length; docIdx++) {
    const doc = docs[docIdx];
    for (const clause of doc.clauses) {
      if (clause.length < n) continue;
      for (let i = 0; i <= clause.length - n; i++) {
        const slice = clause.slice(i, i + n);
        if (n >= 2 && new Set(slice).size === 1) continue;
        const gram = slice.some((s) => /[\u4e00-\u9fff]/.test(s)) ? slice.join(" / ") : slice.join(" ");
        tfMap.set(gram, (tfMap.get(gram) ?? 0) + 1);
        let set = docSetsMap.get(gram);
        if (!set) {
          set = new Set<number>();
          docSetsMap.set(gram, set);
        }
        set.add(docIdx);
      }
    }
  }

  if (n === 1) {
    const rawDf = new Map([...docSetsMap.entries()].map(([k, s]) => [k, s.size]));
    const canonMap = buildStemCanonicalMap(rawDf);
    if (canonMap.size > 0) {
      const mergedTf = new Map<string, number>();
      const mergedDocs = new Map<string, Set<number>>();
      for (const [term, set] of docSetsMap.entries()) {
        const target = canonMap.get(term) ?? term;
        mergedTf.set(target, (mergedTf.get(target) ?? 0) + (tfMap.get(term) ?? set.size));
        let dest = mergedDocs.get(target);
        if (!dest) {
          dest = new Set<number>();
          mergedDocs.set(target, dest);
        }
        for (const idx of set) dest.add(idx);
      }
      return [...mergedDocs.entries()]
        .map(([term, set]) => ({
          term,
          termCount: mergedTf.get(term) ?? set.size,
          docCount: set.size,
          sharePct: Number(((set.size / totalDocs) * 100).toFixed(1)),
        }))
        .filter((item) => item.docCount >= 1)
        .sort((a, b) => b.docCount - a.docCount || b.termCount - a.termCount || a.term.localeCompare(b.term))
        .slice(0, topN);
    }
  }

  return [...docSetsMap.entries()]
    .map(([term, set]) => ({
      term,
      termCount: tfMap.get(term) ?? set.size,
      docCount: set.size,
      sharePct: Number(((set.size / totalDocs) * 100).toFixed(1)),
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
  const rawDfMap = new Map<string, number>();
  const docTokenCounts: Array<Map<string, number>> = [];

  for (const doc of docs) {
    const counts = new Map<string, number>();
    for (const clause of doc.clauses) {
      for (const tok of clause) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
    for (const tok of counts.keys()) rawDfMap.set(tok, (rawDfMap.get(tok) ?? 0) + 1);
    docTokenCounts.push(counts);
  }

  const canonMap = buildStemCanonicalMap(rawDfMap);
  const dfSets = new Map<string, Set<number>>();
  const tfTotal = new Map<string, number>();
  const normalizedDocs: Array<Map<string, number>> = [];

  for (let docIdx = 0; docIdx < docTokenCounts.length; docIdx++) {
    const merged = new Map<string, number>();
    for (const [tok, tf] of docTokenCounts[docIdx].entries()) {
      const target = canonMap.get(tok) ?? tok;
      merged.set(target, (merged.get(target) ?? 0) + tf);
      tfTotal.set(target, (tfTotal.get(target) ?? 0) + tf);
      let s = dfSets.get(target);
      if (!s) {
        s = new Set<number>();
        dfSets.set(target, s);
      }
      s.add(docIdx);
    }
    normalizedDocs.push(merged);
  }

  const scoreSum = new Map<string, number>();
  for (const counts of normalizedDocs) {
    for (const [tok, tf] of counts.entries()) {
      const df = dfSets.get(tok)?.size ?? 1;
      const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;
      const tfidf = (1 + Math.log(tf)) * idf;
      scoreSum.set(tok, (scoreSum.get(tok) ?? 0) + tfidf);
    }
  }

  return [...scoreSum.entries()]
    .map(([term, totalScore]) => {
      const docCount = dfSets.get(term)?.size ?? 1;
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
      if (i < j && co > 0) topPairs.push({ termA: a, termB: b, coCount: co, lift });
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
  if (series.length === 0) return { thresholdZ, points: [] };
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

/** Deterministic seeded sparse TF-IDF NMF factorization shared between L3 research and Feed insights. */
export function solveSparseNmf(
  tokenLists: ReadonlyArray<readonly string[]>,
  options: { numTopics: number; maxVocab?: number; iterations?: number; seed?: number },
): {
  vocab: string[];
  W: Float64Array;
  H: Float64Array;
  effectiveK: number;
  nonEmptyCount: number;
  assignments: Array<{ topicIdx: number | null; score: number }>;
} {
  const D = tokenLists.length;
  const maxVocab = Math.max(20, options.maxVocab ?? 260);
  const df = new Map<string, number>();
  const docCounts: Array<Map<string, number>> = [];

  for (let i = 0; i < D; i++) {
    const cMap = new Map<string, number>();
    for (const tok of tokenLists[i]) cMap.set(tok, (cMap.get(tok) ?? 0) + 1);
    for (const tok of cMap.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);
    docCounts.push(cMap);
  }

  const minDf = D >= 20 ? 2 : 1;
  const maxDf = D >= 16 ? Math.max(minDf + 1, Math.floor(D * 0.85)) : D;
  const vocab = [...df.entries()]
    .filter(([, count]) => count >= minDf && count <= maxDf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxVocab)
    .map(([term]) => term);

  const V = vocab.length;
  if (D === 0 || V < 2) {
    return {
      vocab,
      W: new Float64Array(0),
      H: new Float64Array(0),
      effectiveK: 0,
      nonEmptyCount: 0,
      assignments: tokenLists.map(() => ({ topicIdx: null, score: 0 })),
    };
  }

  const vocabIdx = new Map(vocab.map((t, idx) => [t, idx]));
  const rows: Array<Array<[number, number]>> = [];
  let nonEmptyCount = 0;

  for (let i = 0; i < D; i++) {
    const entries: Array<[number, number]> = [];
    let normSq = 0;
    for (const [term, tf] of docCounts[i].entries()) {
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
      nonEmptyCount++;
    }
    rows.push(entries);
  }

  const effectiveK = Math.min(options.numTopics, V, Math.max(1, nonEmptyCount));
  let state = (options.seed ?? 20261125) >>> 0;
  const rand = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return 0.05 + (state / 0x100000000) * 0.9;
  };

  const W = new Float64Array(D * effectiveK);
  const H = new Float64Array(effectiveK * V);
  for (let i = 0; i < W.length; i++) W[i] = rand();
  for (let i = 0; i < H.length; i++) H[i] = rand();

  const EPS = 1e-9;
  const iters = options.iterations ?? 16;
  const WtV = new Float64Array(effectiveK * V);
  const WtW = new Float64Array(effectiveK * effectiveK);
  const WtWH = new Float64Array(effectiveK * V);
  const VHt = new Float64Array(D * effectiveK);
  const HHt = new Float64Array(effectiveK * effectiveK);
  const WHHt = new Float64Array(D * effectiveK);

  for (let iter = 0; iter < iters; iter++) {
    WtV.fill(0);
    for (let d = 0; d < D; d++) {
      const row = rows[d];
      if (!row.length) continue;
      for (let k = 0; k < effectiveK; k++) {
        const wdk = W[d * effectiveK + k];
        for (const [v, val] of row) WtV[k * V + v] += wdk * val;
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
        for (let v = 0; v < V; v++) WtWH[k1 * V + v] += c * H[k2 * V + v];
      }
    }
    for (let i = 0; i < H.length; i++) H[i] = H[i] * (WtV[i] / (WtWH[i] + EPS));

    VHt.fill(0);
    for (let d = 0; d < D; d++) {
      const row = rows[d];
      if (!row.length) continue;
      for (const [v, val] of row) {
        for (let k = 0; k < effectiveK; k++) VHt[d * effectiveK + k] += val * H[k * V + v];
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
    for (let i = 0; i < W.length; i++) W[i] = W[i] * (VHt[i] / (WHHt[i] + EPS));
  }

  const assignments = rows.map((row, d) => {
    if (!row.length) return { topicIdx: null, score: 0 };
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
    return { topicIdx: bestK, score: sumW > 0 ? Number((bestVal / sumW).toFixed(4)) : 0 };
  });

  return { vocab, W, H, effectiveK, nonEmptyCount, assignments };
}
