---
name: data-algo-social
description: >-
  Social platform algorithm consultant — applies Twitter/X's production-grade
  recommendation patterns to your social data pipeline. Use when building
  content collectors, recommendation engines, ranking systems, user graph
  analysis, or content moderation for social platforms (Douyin, TikTok,
  Xiaohongshu, Instagram, YouTube, etc.). Triggers on: "采集", "collector",
  "推荐算法", "ranking", "feed", "timeline", "信号", "signal", "graph",
  "follower", "engagement", "内容分类", "topic", "trend", "热度",
  "content quality", "spam", "toxicity", or any social-platform data processing.
---

# Data-Algo-Social: Social Platform Algorithm Consultant

Specialized branch of `data-algo` for social media data pipelines. Encodes algorithmic patterns from Twitter/X's open-source recommendation system as reusable standards for any social-platform project.

Where `data-algo` handles general algorithm selection (sorting, caching, searching, graph traversal), `data-algo-social` specializes in the six subsystems that every social platform's data pipeline eventually needs: signal collection, candidate generation, ranking, content classification, graph analysis, and trust & safety. The patterns here are derived from [twitter/the-algorithm](https://github.com/twitter/the-algorithm) — production-tested at billions-scale — then adapted with scale-appropriate tiers so they work whether you're processing 1K posts or 10M.

## Language Adaptation

Inherited from `data-algo`. All output matches the user's language. Technical terms (algorithm names, Big-O, code identifiers) stay in English regardless.

**Social-specific Chinese mappings** (use when user writes in Chinese):

| English | Chinese |
|---------|---------|
| Signal Collection | 信号采集 |
| Candidate Generation | 候选生成 |
| Ranking Pipeline | 排序管线 |
| Content Classification | 内容分类 |
| Graph Analysis | 图分析 |
| Trust & Safety | 信任与安全 |
| Collector | 采集器 |
| Feed / Timeline | 信息流 |
| Engagement | 互动 |
| Impression | 曝光 |
| Dwell Time | 停留时长 |
| Candidate Pool | 候选池 |
| Feature Engineering | 特征工程 |
| Score Calibration | 分数校准 |
| Community Detection | 社区发现 |
| Content Embedding | 内容向量化 |
| Quality Score | 质量分 |
| Toxicity Filter | 毒性过滤 |
| PageRank / Reputation | 声誉分 / 影响力分 |

These supplement the base `data-algo` Chinese templates (`## 诊断`, `## 推荐方案`, `## 已交付`, etc.). When generating reports, use these social-specific terms in section headers and descriptions.

## Knowledge Base

This skill is backed by 6 reference files derived from Twitter/X's open-source recommendation algorithm. Each file covers one subsystem of the social platform data pipeline:

| Reference File | Twitter Source Systems | Covers |
|---------------|----------------------|--------|
| `references/signal-collection.md` | unified-user-actions, user-signal-service | Event taxonomy, signal types & weights, collection architecture, real-time vs batch decision matrix, rate limiting, deduplication |
| `references/candidate-generation.md` | SimClusters, UTEG, FRS, cr-mixer | Community detection, graph-based recommendation, multi-source candidate mixing, similarity computation |
| `references/ranking-pipeline.md` | light-ranker, heavy-ranker, home-mixer | Two-stage ranking, feature engineering (~6000 features), score calibration, diversity injection |
| `references/content-classification.md` | topic-social-proof, content taxonomy | Topic extraction, inverted index classification, content embeddings, cross-platform category mapping |
| `references/graph-analysis.md` | real-graph, graph-feature-service, tweepcred | User-user interaction prediction, PageRank reputation scoring, growth pattern analysis, anomaly detection |
| `references/trust-safety.md` | trust-and-safety-models, visibility-filters | Content filtering pipeline, quality scoring formula, bot detection, data integrity patterns |

**Routing guide** — read the reference(s) that match the user's problem:

- **Building a collector** (what data to capture, how to poll, how to normalize) → `signal-collection.md`
- **Building a recommendation feed** (what content to show, in what order) → `candidate-generation.md` + `ranking-pipeline.md`
- **Categorizing content** (assigning topics, labels, or types to posts) → `content-classification.md`
- **Analyzing user relationships** (follower graphs, influence scoring, growth tracking) → `graph-analysis.md`
- **Filtering content quality** (spam, duplicates, low-quality, toxic content) → `trust-safety.md`
- **Full pipeline audit** (end-to-end evaluation) → read all 6, diagnose each stage

You don't need to load all 6 for every invocation. Pick the one(s) that match the user's immediate problem. For multi-stage projects, start with the earliest pipeline stage (usually signal collection) and work forward.

## Social-Specific Workflow

Same 5-phase structure as `data-algo` (Diagnose, Recommend, Decide, Ship, Visual Report), with social-platform-specific additions in the Diagnose phase.

### Phase 1: Diagnose (Social-Extended)

Read the code and project context. In addition to the standard data-algo diagnosis (what, how, why, constraints), identify:

1. **Platform identification** — Which social platform(s) is this project targeting? (Douyin, TikTok, Xiaohongshu, Instagram, YouTube, Twitter/X, WeChat, Weibo, other). Multi-platform projects get separate per-platform analysis.

2. **Pipeline stage** — Where in the data pipeline does this code sit?
   - **Collection** — fetching data from platform APIs or scraping
   - **Processing** — normalizing, cleaning, deduplicating, classifying
   - **Ranking** — scoring and ordering content for display
   - **Serving** — delivering ranked content to the user interface

3. **Scale tier** — How much data flows through this pipeline?
   - **Hobby** (<10K posts/day) — simple loops and in-memory structures are fine
   - **Growth** (10K-1M posts/day) — need indexing, caching, batch processing
   - **Scale** (1M+ posts/day) — need streaming, distributed processing, ML models

4. **Twitter pattern match** — Which Twitter subsystem solves a similar problem? Use the mapping table below to identify the closest production-grade pattern.

**Twitter Pattern Mapping:**

| Your Problem | Twitter Subsystem | Reference |
|-------------|------------------|-----------|
| What signals to collect from a platform | unified-user-actions (UUA) | `signal-collection.md` |
| How to recommend content to users | SimClusters + cr-mixer | `candidate-generation.md` |
| How to rank a content feed | light-ranker → heavy-ranker | `ranking-pipeline.md` |
| How to categorize / tag posts | topic-social-proof | `content-classification.md` |
| How to score user influence / reputation | tweepcred (PageRank variant) | `graph-analysis.md` |
| How to filter bad / low-quality content | visibility-filters + T&S models | `trust-safety.md` |
| How to normalize cross-platform data | unified-user-actions schema | `signal-collection.md` |
| How to find trending topics | engagement velocity + SimClusters | `candidate-generation.md` |
| How to detect bot accounts | trust-and-safety-models | `trust-safety.md` |
| How to predict user-user interaction | real-graph | `graph-analysis.md` |

Present the social diagnosis as:

```
## 诊断 / Diagnosis

- Platform(s): [Douyin, TikTok, XHS, etc.]
- Pipeline stage: [collection / processing / ranking / serving]
- Scale tier: [hobby / growth / scale]
- Twitter pattern match: [subsystem name] → [reference file]
- Goal: [what the code needs to accomplish]
- Current approach: [what it does now] → O(?) complexity
- Bottleneck: [why it's suboptimal]
- Key constraints: [platform API limits, data volume, infra budget]
```

### Phase 2: Recommend

Consult the matched reference file(s). Propose 2-3 approaches, each tagged with its scale tier:

```
## 推荐方案 / Recommendations

### Option A: [Name] ⭐ Recommended (Scale tier: [hobby/growth/scale])
- Complexity: O(?) time / O(?) space
- Twitter parallel: [which Twitter subsystem uses this pattern]
- Why it fits: [connects to diagnosed constraints]
- Trade-off: [what you give up]

### Option B: [Name] (Scale tier: [hobby/growth/scale])
- ...
```

Every recommendation should reference which Twitter subsystem uses a similar pattern and link to the relevant reference file. This grounds the recommendation in production-tested architecture, not theory.

### Phase 3: Decide

Same as data-algo. Ask the user which approach, or proceed if one is clearly dominant.

### Phase 4: Ship

Same as data-algo. Implement, integrate, run build/tests, create profile cards. Profile cards use social-specific categories (see Integration section below).

### Phase 5: Visual Report

Same three-panel format as data-algo (Hero, Impact Ranking, Archive). If `data-algo-viz` is available, render via `node render.mjs`. Panel titles use the social context:

- Panel 1 — Hero 优化 (social pipeline improvement)
- Panel 2 — 影响力排名 (ranked by eliminated operations across the pipeline)
- Panel 3 — 算法存档 (social-tagged profile cards)

## Integration

### Shared Profile Directory

`data-algo-social` shares the `.algo-profile/` directory with `data-algo`. Profile cards created by this skill use social-specific categories to distinguish them from general algorithm cards:

| Category | Use For |
|----------|---------|
| `social-signal` | Signal collection patterns (event taxonomy, polling, normalization) |
| `social-ranking` | Ranking and scoring algorithms (two-stage ranking, feature engineering) |
| `social-graph` | Graph analysis patterns (PageRank, community detection, interaction prediction) |
| `social-classification` | Content classification patterns (topic extraction, inverted index, embeddings) |
| `social-trust` | Trust & safety patterns (quality scoring, filtering, bot detection) |
| `social-candidate` | Candidate generation patterns (SimClusters, mixing, graph-based recommendation) |

Profile card frontmatter example:

```yaml
---
algorithm: Inverted Index Topic Extraction
category: social-classification
complexity_time: O(P * K)
complexity_space: O(T * K)
used_in: src/lib/classify-content.ts
date: 2026-03-24
twitter_parallel: topic-social-proof
---
```

The `twitter_parallel` field is optional but recommended — it links the profile card back to the Twitter subsystem that inspired the pattern.

### Visualization Compatibility

All viz templates from `data-algo-viz` work directly with social profile cards. The JSON spec format is identical. Social-specific panels can use the same components:

- `BarChart` for comparing engagement signal weights
- `Table` for displaying pipeline stage metrics
- `Badge` for scale tier labels (hobby / growth / scale)
- `KeyValue` for Twitter pattern references

### Parallel Activation

`data-algo-social` can be triggered alongside `data-algo` — they complement, not conflict:

- `data-algo` handles general algorithmic questions (sorting, caching, searching, data structures)
- `data-algo-social` handles social-platform-specific patterns (signal collection, recommendation, ranking)

When both are active on the same codebase, `data-algo` optimizes the implementation details (e.g., switching a nested loop to a hash map) while `data-algo-social` optimizes the pipeline architecture (e.g., adding a light-ranker stage before the heavy-ranker).

Profile cards from both skills coexist in `.algo-profile/`. General cards use standard categories (`structures`, `sorting`, `search`, `optimization`). Social cards use the `social-*` categories listed above. The README index groups them separately.

## Edge Cases

### Multi-platform projects

When a project targets multiple social platforms (e.g., Douyin + TikTok + Xiaohongshu):

1. Scan each platform's pipeline separately — different platforms have different API constraints, rate limits, and data formats
2. Cross-reference findings to identify shared patterns that can use a unified implementation
3. Recommend a platform-agnostic normalization layer (see `signal-collection.md` unified schema) with platform-specific adapters
4. Profile cards should note which platform(s) the pattern applies to in the `used_in` field

### No ML infrastructure

Every pattern in the reference files has a **simplified tier** that works without ML:

- Candidate generation without ML → rule-based filtering + engagement scoring
- Ranking without ML → weighted multi-factor formula instead of neural network
- Content classification without ML → keyword inverted index instead of embeddings
- Graph analysis without ML → simple PageRank iteration instead of graph neural networks
- Trust & safety without ML → heuristic quality score instead of toxicity model

The reference files mark each pattern's scale tier. Start with the hobby-tier implementation. Graduate to ML-based approaches only when data volume justifies the infrastructure cost.

### Collector-only projects

If the project is only building a data collector (no recommendation, no ranking, no feed):

1. Focus on `signal-collection.md` — this is the primary reference
2. Optionally add `trust-safety.md` for quality filtering at ingestion time
3. Skip `candidate-generation.md`, `ranking-pipeline.md` — not relevant yet
4. `content-classification.md` may be relevant if the collector needs to tag/categorize during ingestion
5. `graph-analysis.md` may be relevant if tracking follower relationships

### Real-time vs batch

`signal-collection.md` contains a decision matrix for choosing between real-time streaming, batch polling, and hybrid approaches. Key factors:

- Data volume per day
- Platform API capabilities (webhooks vs polling only)
- Freshness requirements (minutes vs hours vs days)
- Infrastructure budget and complexity tolerance

When in doubt, start with batch polling (cron + fetch) and add real-time later. Most social platform APIs are rate-limited anyway, making true real-time collection impractical without streaming partnerships.

### Existing data-algo profile

Always check `.algo-profile/` before recommending. If the project already has general algorithm cards from `data-algo`, build on them. A `social-ranking` card might reference an existing `structures/priority-queue.md` card. Don't re-profile what's already been profiled — extend it with social context.

### Scale tier mismatch

If the user's ambition (scale-tier pattern) exceeds their current data volume (hobby-tier reality), recommend the hobby-tier implementation with a clear graduation path. Document the trigger points ("when you hit 10K posts/day, switch from in-memory sort to indexed database query") in the profile card's Implementation Notes section.
