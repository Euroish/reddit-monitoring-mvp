# Content Classification Patterns

Reference for content classification derived from Twitter/X's recommendation algorithm.
Covers keyword-based topic extraction, content embeddings, cross-platform taxonomy,
and advanced classification strategies for creator analytics pipelines.

---

## 1. Topic Extraction via Inverted Index

Twitter's `topic-social-proof` module solves multi-label classification by inverting
the lookup direction. Instead of iterating every post against every category's keyword
list, it builds a **keyword -> topic** inverted index once and scans each post's tokens
against the index.

### Why This Matters

The naive approach is O(P x C x K) where P = posts, C = categories, K = avg keywords
per category. With the inverted index the cost drops to O(P x T) where T = tokens per
post. For dash-persona's H1 bottleneck (classifying thousands of Douyin/TikTok posts
across 30+ categories), this is a 10-50x speedup depending on category count.

### Core Data Structures

```typescript
/**
 * Build a keyword -> category[] inverted index.
 * Handles multi-label: the same keyword can map to multiple categories.
 */
function buildInvertedIndex(
  categories: Record<string, string[]>
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [category, keywords] of Object.entries(categories)) {
    for (const kw of keywords) {
      const lower = kw.toLowerCase();
      const existing = index.get(lower) || [];
      existing.push(category);
      index.set(lower, existing);
    }
  }
  return index;
}

/**
 * Classify a single post into zero or more categories.
 * Returns deduplicated category list.
 */
function classifyContent(
  text: string,
  index: Map<string, string[]>
): string[] {
  const tokens = tokenize(text.toLowerCase());
  const matched = new Set<string>();
  for (const token of tokens) {
    const cats = index.get(token);
    if (cats) cats.forEach((c) => matched.add(c));
  }
  return [...matched];
}

/**
 * Basic tokenizer. Split on whitespace and CJK character boundaries.
 * For Chinese/Japanese/Korean text, emit individual characters AND
 * bigrams to capture two-character compound words.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // Latin/alphanumeric words
  const wordPattern = /[a-z0-9]+/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  // CJK characters: unigrams + bigrams
  const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af]/g;
  const cjkChars: string[] = [];
  while ((match = cjkPattern.exec(text)) !== null) {
    cjkChars.push(match[0]);
  }
  for (let i = 0; i < cjkChars.length; i++) {
    tokens.push(cjkChars[i]);
    if (i + 1 < cjkChars.length) {
      tokens.push(cjkChars[i] + cjkChars[i + 1]);
    }
  }
  return tokens;
}
```

### Social Proof Scoring

Classification alone tells you WHAT topics a post covers. Social proof scoring tells
you HOW STRONGLY a post belongs to each topic by looking at who engaged with it.

```typescript
interface EngagerProfile {
  userId: string;
  topicAffinities: Record<string, number>; // topic -> affinity score [0, 1]
}

interface ScoredClassification {
  topic: string;
  keywordScore: number;   // from inverted index match count
  socialScore: number;     // from engager affinity aggregation
  combinedScore: number;
}

/**
 * Score topic assignments using both keyword matches and engager affinities.
 * socialWeight controls blend: 0 = pure keyword, 1 = pure social proof.
 */
function scoreTopics(
  text: string,
  index: Map<string, string[]>,
  engagers: EngagerProfile[],
  socialWeight: number = 0.6
): ScoredClassification[] {
  const tokens = tokenize(text.toLowerCase());

  // Count keyword hits per topic
  const keywordHits = new Map<string, number>();
  for (const token of tokens) {
    const cats = index.get(token);
    if (cats) {
      for (const c of cats) {
        keywordHits.set(c, (keywordHits.get(c) || 0) + 1);
      }
    }
  }

  // Aggregate engager affinity per topic
  const socialScores = new Map<string, number>();
  for (const engager of engagers) {
    for (const [topic, affinity] of Object.entries(engager.topicAffinities)) {
      socialScores.set(topic, (socialScores.get(topic) || 0) + affinity);
    }
  }

  // Normalize scores to [0, 1]
  const maxKeyword = Math.max(...keywordHits.values(), 1);
  const maxSocial = Math.max(...socialScores.values(), 1);

  // Merge all topics seen from either signal
  const allTopics = new Set([...keywordHits.keys(), ...socialScores.keys()]);
  const results: ScoredClassification[] = [];

  for (const topic of allTopics) {
    const kw = (keywordHits.get(topic) || 0) / maxKeyword;
    const sc = (socialScores.get(topic) || 0) / maxSocial;
    results.push({
      topic,
      keywordScore: kw,
      socialScore: sc,
      combinedScore: kw * (1 - socialWeight) + sc * socialWeight,
    });
  }

  return results.sort((a, b) => b.combinedScore - a.combinedScore);
}
```

---

## 2. Content Embedding Patterns

Twitter's SimClusters generates content embeddings by aggregating the embeddings of
users who engaged with the content. This avoids running an expensive model on every
post -- the content embedding is a byproduct of user behavior.

### Core Concept

```
postEmbedding = weightedSum(engagerEmbeddings)
```

Where weights come from engagement type:
- Like: 1.0
- Retweet/share: 2.0
- Reply: 1.5
- Bookmark/save: 3.0

### Sparse Representation

SimClusters uses ~145K communities but any given post only activates 10-50 of them.
Store as sparse vectors (only non-zero dimensions) to save memory and speed up
similarity computation.

```typescript
type SparseVector = Map<number, number>; // communityId -> activation

function cosineSimilarity(a: SparseVector, b: SparseVector): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [dim, val] of a) {
    normA += val * val;
    const bVal = b.get(dim);
    if (bVal !== undefined) {
      dotProduct += val * bVal;
    }
  }
  for (const [, val] of b) {
    normB += val * val;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Build a post embedding from its engagers' embeddings.
 * Updates incrementally: call again as new engagements arrive.
 */
function buildPostEmbedding(
  engagements: Array<{
    userId: string;
    type: string;
    userEmbedding: SparseVector;
  }>,
  engagementWeights: Record<string, number> = {
    like: 1.0,
    share: 2.0,
    reply: 1.5,
    save: 3.0,
  }
): SparseVector {
  const embedding: SparseVector = new Map();

  for (const { type, userEmbedding } of engagements) {
    const weight = engagementWeights[type] || 1.0;
    for (const [dim, val] of userEmbedding) {
      embedding.set(dim, (embedding.get(dim) || 0) + val * weight);
    }
  }

  // L2 normalize
  let norm = 0;
  for (const [, val] of embedding) {
    norm += val * val;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (const [dim, val] of embedding) {
      embedding.set(dim, val / norm);
    }
  }

  return embedding;
}
```

---

## 3. Embedding Progression Path

When to graduate from one classification approach to the next. Each level is a
strict superset in capability but adds operational complexity.

| Data Volume | Method | Complexity | When to Use | Tradeoffs |
|-------------|--------|------------|-------------|-----------|
| < 1K posts | Keyword inverted index | O(P x T) | Prototyping, MVP | No semantic understanding. Fast to ship. |
| 1K - 10K | Keyword + social proof scoring | O(P x T x E) | Early traction, engagement data available | Needs engager profiles. Better ranking. |
| 10K - 100K | TF-IDF + cosine similarity | O(P x V) | Medium scale, no ML infra | Vocabulary explosion with CJK text. |
| 100K+ | Dense embeddings (SimClusters-style) | O(P x D) | Production, semantic understanding needed | Requires user embedding pipeline. |

**Key insight**: Start with keyword inverted index. It covers 80% of classification
needs at 1% of the complexity. Only move to embeddings when you need semantic
similarity (e.g., "this post about hotel pools is similar to this post about resort
amenities" without explicit keyword overlap).

### Migration Strategy

Each level wraps the previous one. The inverted index remains useful as a fast
pre-filter even when dense embeddings are available:

1. Use keyword index to narrow candidates from P to ~0.1P
2. Run embedding similarity only on the narrowed set
3. Blend keyword score and embedding score for final ranking

---

## 4. Cross-Platform Category Mapping

Multi-platform creator analytics (Douyin, TikTok, XHS, YouTube) require a unified
taxonomy because each platform uses different category systems.

### Platform Category Divergence

Douyin official categories (partial):
- 美食 (food), 旅行 (travel), 时尚 (fashion), 美妆 (beauty), 知识 (knowledge)

TikTok categories:
- Food & Drink, Travel, Fashion, Beauty, Education

XHS (Xiaohongshu) note types:
- 美食探店 (food discovery), 旅行攻略 (travel guide), 穿搭 (outfit), 护肤 (skincare)

These overlap conceptually but the boundaries differ. Douyin's "美食" includes both
cooking tutorials and restaurant reviews. XHS splits those into "美食探店" (restaurant
discovery) and "美食教程" (cooking tutorial).

### Unified Taxonomy

```typescript
interface UnifiedCategory {
  id: string;
  label: { en: string; zh: string };
  parent: string | null;
  platformMappings: {
    douyin?: string[];
    tiktok?: string[];
    xhs?: string[];
    youtube?: string[];
  };
  keywords: {
    en: string[];
    zh: string[];
  };
}

const CREATOR_CONTENT_TAXONOMY: UnifiedCategory[] = [
  {
    id: "lifestyle",
    label: { en: "Lifestyle", zh: "生活方式" },
    parent: null,
    platformMappings: {
      douyin: ["生活"],
      tiktok: ["Lifestyle"],
      xhs: ["生活记录"],
    },
    keywords: {
      en: ["lifestyle", "daily", "routine", "vlog", "day in my life"],
      zh: ["生活", "日常", "vlog", "一天"],
    },
  },
  {
    id: "lifestyle.travel",
    label: { en: "Travel", zh: "旅行" },
    parent: "lifestyle",
    platformMappings: {
      douyin: ["旅行"],
      tiktok: ["Travel"],
      xhs: ["旅行攻略", "旅行日记"],
      youtube: ["Travel & Events"],
    },
    keywords: {
      en: ["travel", "trip", "destination", "hotel", "resort", "flight", "vacation"],
      zh: ["旅行", "旅游", "出行", "酒店", "度假", "目的地", "攻略", "自驾"],
    },
  },
  {
    id: "lifestyle.food",
    label: { en: "Food & Dining", zh: "美食" },
    parent: "lifestyle",
    platformMappings: {
      douyin: ["美食"],
      tiktok: ["Food & Drink"],
      xhs: ["美食探店", "美食教程"],
      youtube: ["Food"],
    },
    keywords: {
      en: ["food", "recipe", "cooking", "restaurant", "dining", "meal", "chef"],
      zh: ["美食", "做饭", "探店", "餐厅", "食谱", "吃"],
    },
  },
  {
    id: "lifestyle.fashion",
    label: { en: "Fashion & Style", zh: "时尚穿搭" },
    parent: "lifestyle",
    platformMappings: {
      douyin: ["时尚"],
      tiktok: ["Fashion"],
      xhs: ["穿搭", "时尚"],
    },
    keywords: {
      en: ["fashion", "outfit", "style", "ootd", "clothing", "wear", "brand"],
      zh: ["穿搭", "时尚", "搭配", "衣服", "品牌", "风格"],
    },
  },
  {
    id: "lifestyle.beauty",
    label: { en: "Beauty & Skincare", zh: "美妆护肤" },
    parent: "lifestyle",
    platformMappings: {
      douyin: ["美妆"],
      tiktok: ["Beauty"],
      xhs: ["护肤", "彩妆"],
    },
    keywords: {
      en: ["beauty", "makeup", "skincare", "cosmetics", "tutorial", "routine"],
      zh: ["美妆", "护肤", "化妆", "彩妆", "面膜", "精华"],
    },
  },
  {
    id: "knowledge",
    label: { en: "Knowledge & Education", zh: "知识" },
    parent: null,
    platformMappings: {
      douyin: ["知识"],
      tiktok: ["Education"],
      xhs: ["知识分享"],
      youtube: ["Education"],
    },
    keywords: {
      en: ["learn", "tutorial", "how to", "explained", "tips", "guide"],
      zh: ["知识", "教程", "学习", "分享", "技巧", "干货"],
    },
  },
  {
    id: "entertainment",
    label: { en: "Entertainment", zh: "娱乐" },
    parent: null,
    platformMappings: {
      douyin: ["娱乐", "搞笑"],
      tiktok: ["Entertainment", "Comedy"],
      xhs: ["娱乐"],
      youtube: ["Entertainment", "Comedy"],
    },
    keywords: {
      en: ["funny", "comedy", "entertainment", "skit", "challenge", "trend"],
      zh: ["搞笑", "娱乐", "段子", "挑战", "整活"],
    },
  },
];
```

### Confidence Scoring Per Category

When classifying content, emit a confidence score per category assignment.
This allows downstream consumers to filter by threshold.

```typescript
interface CategoryAssignment {
  categoryId: string;
  confidence: number;   // 0.0 - 1.0
  matchedKeywords: string[];
  source: "keyword" | "social_proof" | "embedding" | "platform_tag";
}

/**
 * Classify content against the unified taxonomy with confidence.
 * Higher confidence when multiple signals agree.
 */
function classifyWithConfidence(
  text: string,
  platformTag: string | null,
  taxonomy: UnifiedCategory[],
  index: Map<string, string[]>
): CategoryAssignment[] {
  const tokens = tokenize(text.toLowerCase());
  const results: CategoryAssignment[] = [];

  for (const cat of taxonomy) {
    const matchedKeywords: string[] = [];
    const allKeywords = [...cat.keywords.en, ...cat.keywords.zh];

    for (const token of tokens) {
      if (allKeywords.some((kw) => kw.toLowerCase() === token)) {
        matchedKeywords.push(token);
      }
    }

    let confidence = 0;

    // Keyword signal
    if (matchedKeywords.length > 0) {
      confidence += Math.min(matchedKeywords.length / 3, 0.5);
    }

    // Platform tag signal (highest confidence single signal)
    if (platformTag) {
      const platformCats = Object.values(cat.platformMappings).flat();
      if (
        platformCats.some(
          (pc) => pc?.toLowerCase() === platformTag.toLowerCase()
        )
      ) {
        confidence += 0.4;
      }
    }

    // Parent-child boost: if child matches, parent gets partial credit
    if (confidence > 0.2) {
      results.push({
        categoryId: cat.id,
        confidence: Math.min(confidence, 1.0),
        matchedKeywords,
        source: platformTag ? "platform_tag" : "keyword",
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
```

---

## 5. Advanced Classification Patterns

### Temporal Classification

Track how topic relevance shifts over time for a creator's content.

```typescript
interface TemporalTopicSignal {
  topic: string;
  period: string;         // e.g. "2026-W12"
  postCount: number;
  engagementRate: number;
  trend: "rising" | "stable" | "declining";
  velocityPctChange: number; // vs previous period
}

/**
 * Detect topic trend direction by comparing rolling windows.
 * A topic is "rising" if its share of the creator's content increased
 * by more than 20% in the current window vs the previous window.
 */
function detectTopicTrends(
  posts: Array<{
    date: string;
    categories: string[];
    engagements: number;
  }>,
  windowDays: number = 7
): TemporalTopicSignal[] {
  const now = Date.now();
  const msPerDay = 86400000;

  const currentWindow = posts.filter(
    (p) => now - new Date(p.date).getTime() < windowDays * msPerDay
  );
  const previousWindow = posts.filter((p) => {
    const age = now - new Date(p.date).getTime();
    return age >= windowDays * msPerDay && age < 2 * windowDays * msPerDay;
  });

  const countByTopic = (window: typeof posts) => {
    const counts = new Map<string, { posts: number; engagements: number }>();
    for (const p of window) {
      for (const cat of p.categories) {
        const existing = counts.get(cat) || { posts: 0, engagements: 0 };
        existing.posts++;
        existing.engagements += p.engagements;
        counts.set(cat, existing);
      }
    }
    return counts;
  };

  const current = countByTopic(currentWindow);
  const previous = countByTopic(previousWindow);
  const allTopics = new Set([...current.keys(), ...previous.keys()]);

  const signals: TemporalTopicSignal[] = [];
  for (const topic of allTopics) {
    const cur = current.get(topic) || { posts: 0, engagements: 0 };
    const prev = previous.get(topic) || { posts: 0, engagements: 0 };
    const velocity =
      prev.posts > 0
        ? ((cur.posts - prev.posts) / prev.posts) * 100
        : cur.posts > 0
          ? 100
          : 0;

    signals.push({
      topic,
      period: `current_${windowDays}d`,
      postCount: cur.posts,
      engagementRate: cur.posts > 0 ? cur.engagements / cur.posts : 0,
      trend:
        velocity > 20 ? "rising" : velocity < -20 ? "declining" : "stable",
      velocityPctChange: velocity,
    });
  }

  return signals.sort((a, b) => b.velocityPctChange - a.velocityPctChange);
}
```

### Engagement-Weighted Categories

Categories popular with YOUR audience specifically, not the platform average.
This reveals where a creator's audience actually resonates.

```typescript
/**
 * Compute engagement-weighted category scores.
 * A category scores high if posts in that category consistently
 * outperform the creator's average engagement rate.
 */
function engagementWeightedCategories(
  posts: Array<{
    categories: string[];
    engagements: number;
    impressions: number;
  }>
): Array<{
  category: string;
  avgEngagementRate: number;
  indexVsCreatorAvg: number;
}> {
  const globalAvg =
    posts.reduce(
      (s, p) => s + (p.impressions > 0 ? p.engagements / p.impressions : 0),
      0
    ) / posts.length;

  const categoryStats = new Map<
    string,
    { totalRate: number; count: number }
  >();
  for (const post of posts) {
    const rate =
      post.impressions > 0 ? post.engagements / post.impressions : 0;
    for (const cat of post.categories) {
      const existing = categoryStats.get(cat) || {
        totalRate: 0,
        count: 0,
      };
      existing.totalRate += rate;
      existing.count++;
      categoryStats.set(cat, existing);
    }
  }

  const results = [];
  for (const [category, stats] of categoryStats) {
    const avgRate = stats.totalRate / stats.count;
    results.push({
      category,
      avgEngagementRate: avgRate,
      indexVsCreatorAvg: globalAvg > 0 ? avgRate / globalAvg : 0,
    });
  }

  return results.sort((a, b) => b.indexVsCreatorAvg - a.indexVsCreatorAvg);
}
```

### Niche Detection

Find categories where a creator over-indexes compared to the platform average.
High over-index = the creator "owns" this niche relative to peers.

```typescript
interface NicheSignal {
  category: string;
  creatorShare: number;  // % of creator's posts in this category
  platformShare: number; // % of platform posts in this category (benchmark)
  overIndex: number;     // creatorShare / platformShare
  isNiche: boolean;      // overIndex > threshold
}

function detectNiches(
  creatorPosts: Array<{ categories: string[] }>,
  platformBenchmark: Record<string, number>, // category -> platform share [0, 1]
  nicheThreshold: number = 2.0
): NicheSignal[] {
  const creatorCounts = new Map<string, number>();
  let totalAssignments = 0;

  for (const post of creatorPosts) {
    for (const cat of post.categories) {
      creatorCounts.set(cat, (creatorCounts.get(cat) || 0) + 1);
      totalAssignments++;
    }
  }

  const signals: NicheSignal[] = [];
  for (const [category, count] of creatorCounts) {
    const creatorShare = count / totalAssignments;
    const platformShare = platformBenchmark[category] || 0.01;
    const overIndex = creatorShare / platformShare;

    signals.push({
      category,
      creatorShare,
      platformShare,
      overIndex,
      isNiche: overIndex >= nicheThreshold,
    });
  }

  return signals.sort((a, b) => b.overIndex - a.overIndex);
}
```

### Content Similarity for Deduplication

When collecting from multiple platforms, the same content often appears on Douyin,
TikTok, and XHS with minor text variations. Use SimHash for near-duplicate detection.

```typescript
/**
 * 64-bit SimHash for text content.
 * Two posts are near-duplicates if their SimHash hamming distance <= 3.
 */
function simhash(text: string): bigint {
  const tokens = tokenize(text.toLowerCase());
  const vector = new Array(64).fill(0);

  for (const token of tokens) {
    const hash = fnv1a64(token);
    for (let i = 0; i < 64; i++) {
      if ((hash >> BigInt(i)) & 1n) {
        vector[i]++;
      } else {
        vector[i]--;
      }
    }
  }

  let fingerprint = 0n;
  for (let i = 0; i < 64; i++) {
    if (vector[i] > 0) {
      fingerprint |= 1n << BigInt(i);
    }
  }
  return fingerprint;
}

function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

function fnv1a64(str: string): bigint {
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

/**
 * Deduplicate a batch of posts using SimHash.
 * Returns indices of posts to keep (first seen wins).
 */
function deduplicatePosts(
  posts: Array<{ text: string }>,
  maxHammingDistance: number = 3
): number[] {
  const fingerprints: Array<{ index: number; hash: bigint }> = [];
  const kept: number[] = [];

  for (let i = 0; i < posts.length; i++) {
    const hash = simhash(posts[i].text);
    const isDuplicate = fingerprints.some(
      (fp) => hammingDistance(fp.hash, hash) <= maxHammingDistance
    );
    if (!isDuplicate) {
      fingerprints.push({ index: i, hash });
      kept.push(i);
    }
  }

  return kept;
}
```

---

## Summary: Decision Checklist

1. **Starting a new project?** Use the inverted index (Section 1). Ship in an hour.
2. **Have engagement data?** Add social proof scoring on top of keyword matching.
3. **Multi-platform?** Define a unified taxonomy (Section 4) before writing any classification code.
4. **Posts > 100K?** Consider embedding-based classification (Section 2).
5. **Need dedup across platforms?** SimHash with hamming distance <= 3 catches near-duplicates.
6. **Want to find the creator's niche?** Compute over-index vs platform benchmark (Section 5).
7. **Tracking content strategy shifts?** Use temporal classification with rolling windows.
