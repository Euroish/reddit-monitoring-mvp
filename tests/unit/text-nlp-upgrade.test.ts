import assert from "node:assert/strict";
import test from "node:test";
import type { StoryFeed } from "../../packages/contracts/src/content-stories";
import { classifyIntent, normalizeCleanText } from "../../src/modules/content/enrich";
import { publicSearchDocument } from "../../src/modules/content/search";
import { selectStoryFeed, type StoryInsightMeta, type readStoryWindow } from "../../src/modules/content/stories";
import { computeStoryInsights } from "../../src/modules/content/story-insights";
import {
  buildStemCanonicalMap,
  cleanTextForAnalysis,
  decodeHtmlEntities,
  extractNgrams,
  extractTfIdfKeywords,
  normalizeEnglishInflection,
  scoreBilingualSentiment,
  segmentCjkRun,
  SENTIMENT_ALGO_VERSION,
  splitContrastiveClauses,
  stemEnglishToken,
  stripHtmlToPlainText,
  tokenizeClauses,
  tokenizeText,
} from "../../src/modules/intelligence/text-analysis";
import { runSentimentAnalysisTask as runL3SentimentTask } from "../../src/modules/intelligence/research-l3-algorithms";
import { detectLanguage } from "../../src/shared/text/language";

type StoryWindow = Awaited<ReturnType<typeof readStoryWindow>>;

test("HTML cleaning removes scripts/styles, preserves block boundaries, decodes HTML5 entities, and powers shared callers", () => {
  const dirtyHtml = `
    <article>
      <style>.hidden { display: none; }</style>
      <script>window.__secret = "noise_token_xyz";</script>
      <h1>DeepSeek&mdash;R1 &amp; Agentic Workflows</h1>
      <p>Fast inference&#x2019;s edge&hellip;</p>
      <table><tr><td>Latency</td><td>12ms</td></tr></table>
      <blockquote>Benchmark note &ldquo;stable&rdquo;</blockquote>
    </article>
  `;

  const plain = stripHtmlToPlainText(dirtyHtml);
  assert.ok(!plain.includes("noise_token_xyz"));
  assert.ok(!plain.includes("display: none"));
  assert.ok(!plain.includes("<"));
  assert.ok(plain.includes("DeepSeek—R1 & Agentic Workflows"));
  assert.ok(plain.includes("inference’s edge…"));
  assert.ok(plain.includes("Latency 12ms"));
  assert.ok(!plain.includes("Latency12ms"));
  assert.equal(decodeHtmlEntities("Caf&eacute; &mdash; 10 &lt; 20"), "Café — 10 < 20");

  // Reused in research cleaning, enricher excerpt cleaner, and public search indexer
  const researchClean = cleanTextForAnalysis("<p>Hello&nbsp;<b>OpenAI</b><script>badScript()</script></p>");
  assert.ok(researchClean.includes("Hello OpenAI"));
  assert.ok(!researchClean.includes("badScript"));

  const excerpt = normalizeCleanText("<div><p>Release notes &mdash; [model card](https://example.com/card)</p><script>x=1</script></div>");
  assert.equal(excerpt, "Release notes — model card");

  const searchDoc = publicSearchDocument(
    "<b>Agent&mdash;Update</b>",
    "<p>Low latency&hellip;<style>a{color:red}</style></p>",
    "2026-11-25T00:00:00Z",
  );
  assert.ok(searchDoc.normalizedTitle.includes("agent—update"));
  // normalizePublicSearchText runs NFKC normalization, converting U+2026 (…) into "..."
  assert.ok(searchDoc.normalizedText.includes("low latency..."));
  assert.ok(!searchDoc.normalizedText.includes("color:red"));
});

test("Language detection handles CJK fast-paths, URL/handle stripping, and franc-min Latin disambiguation", () => {
  assert.equal(detectLanguage("New Model Launch", "Full technical report"), "en");
  assert.equal(detectLanguage("大模型开源推理框架发布", "支持多智能体协同与低延迟部署 https://example.com/zh"), "zh");
  assert.equal(detectLanguage("生成AIエージェントの最新動向", "新しい推論モデルが公開されました。"), "ja");
  assert.equal(detectLanguage("새로운 인공지능 모델 출시", "성능과 비용 효율이 크게 향상되었습니다."), "ko");

  assert.equal(
    detectLanguage(
      "Introducing a faster agent runtime for local developer workflows",
      "@devteam Check https://example.com/launch for benchmark numbers, memory usage, and installation instructions across Linux and macOS.",
    ),
    "en",
  );
  assert.equal(
    detectLanguage(
      "Nouveau modèle d'intelligence artificielle pour les développeurs",
      "Cette nouvelle version améliore la compréhension du contexte et réduit fortement la latence lors des déploiements en production.",
    ),
    "fr",
  );
  assert.equal(
    detectLanguage(
      "Neues Sprachmodell für lokale Entwicklerwerkzeuge veröffentlicht",
      "Die aktuelle Version verbessert die Antwortqualität deutlich und senkt den Speicherbedarf auf gewöhnlichen Arbeitsplatzrechnern.",
    ),
    "de",
  );
  assert.equal(
    detectLanguage(
      "Nuevo modelo de inteligencia artificial para aplicaciones empresariales",
      "Esta actualización mejora el rendimiento general y reduce los costos operativos para equipos de ingeniería en producción.",
    ),
    "es",
  );
});

test("Chinese Intl.Segmenter + English inflection/Porter2 stemmer reduce bigram noise and coalesce morphological variants", () => {
  const zhSegmented = segmentCjkRun("大模型支持多智能体开源推理优化");
  assert.ok(zhSegmented.includes("大模型"));
  assert.ok(zhSegmented.includes("多智能体"));
  assert.ok(zhSegmented.includes("开源"));
  assert.ok(zhSegmented.includes("推理"));
  assert.ok(!zhSegmented.includes("多智"));
  assert.ok(!zhSegmented.includes("能体"));

  const zhTokens = tokenizeText("多智能体开源框架提升推理性能", { preserveTechPhrases: true });
  assert.ok(!zhTokens.includes("多智"));
  assert.ok(zhTokens.includes("多智能体"));

  // Lightweight inflectional lemmatizer + Porter2 stemmer
  assert.equal(normalizeEnglishInflection("deployed"), "deploy");
  assert.equal(normalizeEnglishInflection("models"), "model");
  assert.equal(normalizeEnglishInflection("benchmarks"), "benchmark");
  assert.equal(stemEnglishToken("optimizing"), stemEnglishToken("optimization"));

  const corpusDocs = [
    { clauses: tokenizeClauses("Teams are deploying new models rapidly.") },
    { clauses: tokenizeClauses("Deploying open weights after team deployed staging benchmarks.") },
    { clauses: tokenizeClauses("Deploy reliability improved as optimizing teams finished optimization.") },
    { clauses: tokenizeClauses("Optimization for production deployment cut tail latency.") },
  ];
  const ngrams = extractNgrams(corpusDocs, 1, 10);
  const terms = new Set(ngrams.map((item) => item.term));
  // Variants of deploy* and optimiz* coalesce rather than splitting counts across separate entries
  assert.equal([...terms].filter((t) => t.startsWith("deploy")).length, 1);
  assert.equal([...terms].filter((t) => t.startsWith("optimiz")).length, 1);

  const canonMap = buildStemCanonicalMap(
    new Map([
      ["deploy", 5],
      ["deploying", 2],
      ["deployment", 3],
    ]),
  );
  assert.equal(canonMap.get("deploying"), "deploy");
  assert.equal(canonMap.get("deployment"), "deploy");

  const tfidf = extractTfIdfKeywords(corpusDocs, 8);
  assert.ok(tfidf.length > 0);
});

test("Story insights and feed selection reuse stem coalescing consistently", () => {
  const baseMs = Date.UTC(2026, 10, 18, 0, 0, 0);
  const toMs = Date.UTC(2026, 10, 25, 0, 0, 0);
  const specs = [
    { key: "s1", title: "Teams deploy local inference", ts: Date.UTC(2026, 10, 19, 12, 0, 0) },
    { key: "s2", title: "Engineers deploying quantization pipelines", ts: Date.UTC(2026, 10, 22, 12, 0, 0) },
    { key: "s3", title: "New deployment tooling lands today", ts: Date.UTC(2026, 10, 23, 12, 0, 0) },
    { key: "s4", title: "Deployed cluster benchmarks verified", ts: Date.UTC(2026, 10, 24, 12, 0, 0) },
    { key: "s5", title: "Rapid deployment adoption in enterprises", ts: Date.UTC(2026, 10, 24, 15, 0, 0) },
    { key: "s6", title: "Deploying autonomous agents at edge", ts: Date.UTC(2026, 10, 24, 18, 0, 0) },
  ];

  const metaByStoryKey = new Map<string, StoryInsightMeta>();
  const feedItems: StoryFeed["items"] = specs.map((item, idx) => {
    const clean = cleanTextForAnalysis(item.title, true);
    const tokens = tokenizeText(clean, { preserveTechPhrases: true });
    const stemSet = new Set(tokens.map((t) => stemEnglishToken(t)));
    const iso = new Date(item.ts).toISOString();
    const sid = `src-${(idx % 2) + 1}`;
    metaByStoryKey.set(item.key, {
      storyKey: item.key,
      sourceGroup: idx % 2 === 0 ? "ai-firsthand" : "engineering",
      language: "en",
      eventTimeMs: item.ts,
      participatingSourceIds: [sid],
      textForAnalysis: clean,
      tokenSet: new Set(tokens),
      stemSet,
      hasComparableSource: true,
    });
    return {
      storyKey: item.key,
      representative: {
        id: `id-${item.key}`,
        platform: "web",
        title: item.title,
        url: `https://example.com/${item.key}`,
        author: "Reporter",
        thumbnail: null,
        sourceId: sid,
        sourceLabel: idx % 2 === 0 ? "AI Blog" : "Eng Daily",
        tier: idx % 2 === 0 ? "T1" : "T1_5",
        publishedAt: iso,
        discoveredAt: iso,
      },
      excerpt: item.title,
      related: [],
      relatedCount: 0,
      sourceCount: 1,
      heat48h: 10 - idx * 0.1,
      tierBreakdown: { T1: 1, T1_5: 0, T2: 0 },
      sparkline48h: [1, 1, 1, 1, 1, 1, 1, 1],
      change6h: null,
      trend: "flat",
      badges: [],
      updatedAt: iso,
    };
  });

  const window: StoryWindow = {
    view: "latest",
    latest: feedItems,
    hottest: feedItems,
    totalRankedCount: feedItems.length,
    from: new Date(baseMs).toISOString(),
    to: new Date(toMs).toISOString(),
    fromMs: baseMs,
    toMs,
    metaByStoryKey,
  };

  const { insights } = computeStoryInsights(window, { view: "latest", lang: "en" }, toMs);
  const deployKeywords = insights.hotKeywords.items.filter((k) => k.term.startsWith("deploy"));
  assert.equal(deployKeywords.length, 1);
  assert.equal(deployKeywords[0].eventCount, 6);

  // Clicking a canonical stem keyword filters across morphological variants via stemSet fallback
  const filtered = selectStoryFeed(window, "latest", 20, 0, true, { term: deployKeywords[0].term });
  assert.equal(filtered.items.length, 6);
});

test("Shared bilingual sentiment supports AFINN-165, expanded Chinese lexicon, contrastive clauses, and L3 + enricher reuse", async () => {
  assert.equal(SENTIMENT_ALGO_VERSION, "afinn_zh_contrast_v2");

  // Contrastive clause splitting: post-contrast clause outweighs pre-contrast concession
  const enClauses = splitContrastiveClauses("The UI looks nice, but it crashes constantly and feels buggy.");
  assert.equal(enClauses.length, 2);
  assert.ok(enClauses[1].weight > enClauses[0].weight);

  const enNeg = scoreBilingualSentiment("The UI looks nice, but it crashes constantly and feels disappointed.");
  assert.equal(enNeg.label, "negative");
  assert.ok(enNeg.score <= -0.15);

  const zhClauses = splitContrastiveClauses("虽然价格偏贵，但是非常稳定流畅真香。");
  assert.equal(zhClauses.length, 2);
  const zhPos = scoreBilingualSentiment("虽然价格偏贵，但是非常稳定流畅真香。");
  assert.equal(zhPos.label, "positive");
  assert.ok(zhPos.score >= 0.15);

  // Negation flips polarity and neutral/factual text stays unclassified
  const negated = scoreBilingualSentiment("This build is not reliable and feels broken.");
  assert.equal(negated.label, "negative");

  const objective = scoreBilingualSentiment("Python 3.13.1 release notes and SHA256 build checksum table.");
  assert.equal(objective.label, "unclassified");
  assert.equal(objective.score, 0);

  // Caller 1: enricher pain intent uses shared scoreBilingualSentiment
  const painIntent = classifyIntent(
    "Latency regression after latest deploy",
    "Great dashboard, however inference latency keeps crashing and feels unusable.",
    "reddit",
  );
  assert.equal(painIntent.tag, "pain");

  // Caller 2: L3 async sentiment task reuses shared scorer cleanly
  const l3 = await runL3SentimentTask([
    {
      id: "d1",
      platform: "reddit",
      targetKeys: [{ key: "src-1", label: "Source 1" }],
      engagementScore: 42,
      title: "Seamless upgrade",
      text: "Extremely fast and stellar accuracy!",
      bucket: "2026-11-24",
    },
    {
      id: "d2",
      platform: "web",
      targetKeys: [{ key: "src-2", label: "Source 2" }],
      engagementScore: 5,
      title: "SDK changelog v2.4.0",
      text: "Updated HTTP client dependency version to 2.4.0.",
      bucket: "2026-11-24",
    },
  ]);
  assert.equal(l3.summary.classifiedCount, 1);
  assert.equal(l3.summary.unclassifiedCount, 1);
  assert.equal(l3.items.find((it) => it.contentId === "d1")?.sentimentLabel, "positive");
});
