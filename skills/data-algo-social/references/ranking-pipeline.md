# Ranking Pipeline

Reference patterns derived from Twitter/X's open-sourced recommendation algorithm.
Use this document when building or reviewing any candidate-ranking system for social content.

---

## 1. Two-Stage Ranking Architecture

Twitter's timeline ranking splits into two sequential stages to balance latency and accuracy.
The first stage is cheap and fast, the second stage is expensive and precise.

### Stage 1 -- Light Ranker

| Property | Value |
|---|---|
| Input | ~1500 candidates (from candidate generation / retrieval) |
| Output | ~300 candidates |
| Model | Logistic regression or shallow neural net (1-2 hidden layers) |
| Feature count | ~200 lightweight features |
| Latency budget | < 10 ms per request |
| Purpose | Eliminate clearly irrelevant candidates before heavy computation |

The light ranker acts as a coarse sieve. It uses features that are cheap to compute or
already cached (e.g. author popularity, content age, basic engagement counts). The goal is
not perfect ordering but rather discarding the bottom ~80% of candidates safely.

Key design choices:
- Features must be pre-computed or computable in < 1 ms each.
- The model must be small enough to score 1500 items in a single-digit-ms window.
- Calibration matters less than recall -- false negatives at this stage are permanent losses.
- The model is retrained daily on engagement labels with a 24-hour feedback window.

### Stage 2 -- Heavy Ranker

| Property | Value |
|---|---|
| Input | ~300 candidates (from light ranker) |
| Output | Final ranked list (~50-100 items for viewport) |
| Model | Deep neural network with multi-task learning heads |
| Feature count | ~6000 features |
| Latency budget | < 100 ms per request |
| Purpose | Accurate, fine-grained ranking with multi-objective optimization |

The heavy ranker uses a multi-task neural network that predicts several engagement
probabilities simultaneously:
- `p(like)` -- probability user will like the content
- `p(retweet)` / `p(share)` -- probability of amplification
- `p(reply)` -- probability of conversation engagement
- `p(dwell)` -- probability of extended viewing time
- `p(negative)` -- probability of hide, mute, block, or report

These per-task predictions are combined into a single ranking score via a weighted formula
(see Section 3). The multi-task architecture shares lower layers across all tasks, with
task-specific heads branching from a shared representation.

### Scale-Tier Adaptations

Not every system needs a deep neural pipeline. Adapt the architecture to your scale.

| Scale Tier | Stage 1 | Stage 2 | When to Use |
|---|---|---|---|
| **No ML** | Score-based filter (threshold on recency + engagement) | Weighted multi-factor formula | < 10K users, < 100 candidates per request |
| **Light ML** | Gradient boosted trees (XGBoost / LightGBM) | Logistic regression with feature crosses | 10K-1M users, < 1K candidates per request |
| **Full ML** | Shallow neural net or distilled model | Deep multi-task neural network | > 1M users, large candidate pools |

For the No-ML tier, the "light ranker" is a simple threshold filter:

```typescript
interface CandidateScore {
  id: string;
  recencyScore: number;   // 0-1, exponential decay from post time
  engagementScore: number; // 0-1, normalized engagement rate
  authorScore: number;     // 0-1, author quality signal
}

function lightRankerNoML(
  candidates: CandidateScore[],
  limit: number
): CandidateScore[] {
  const RECENCY_WEIGHT = 0.4;
  const ENGAGEMENT_WEIGHT = 0.35;
  const AUTHOR_WEIGHT = 0.25;

  return candidates
    .map(c => ({
      ...c,
      score: RECENCY_WEIGHT * c.recencyScore
           + ENGAGEMENT_WEIGHT * c.engagementScore
           + AUTHOR_WEIGHT * c.authorScore,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

---

## 2. Feature Engineering Taxonomy

Twitter's heavy ranker ingests approximately 6000 features. Below is the taxonomy with
representative examples per category.

### User Features (15+)

Features describing the requesting user (the viewer).

| Feature | Type | Description |
|---|---|---|
| `follower_count` | int | Total followers |
| `following_count` | int | Total accounts followed |
| `account_age_days` | int | Days since account creation |
| `posting_frequency_7d` | float | Average posts per day over last 7 days |
| `engagement_rate_30d` | float | (likes + replies + shares) / impressions over 30 days |
| `is_verified` | bool | Blue-check or organization verification |
| `primary_language` | categorical | Most-used language |
| `topic_interests` | embedding | Learned topic vector from engagement history |
| `active_hours_distribution` | vector | 24-dim histogram of hourly activity |
| `device_type` | categorical | iOS / Android / Web |
| `notification_responsiveness` | float | Rate of opening push notifications |
| `list_membership_count` | int | Number of lists the user is on |
| `avg_session_duration_s` | float | Mean session length in seconds |
| `content_creation_ratio` | float | Posts created / posts consumed |
| `mute_block_rate` | float | Rate of negative actions over last 90 days |

### Content Features (20+)

Features describing the candidate content item.

| Feature | Type | Description |
|---|---|---|
| `text_length_chars` | int | Character count of text body |
| `text_length_tokens` | int | Token count (model-specific) |
| `has_media` | bool | Contains image or video |
| `media_type` | categorical | none / image / video / gif / poll / link |
| `media_count` | int | Number of attached media items |
| `hashtag_count` | int | Number of hashtags |
| `mention_count` | int | Number of @mentions |
| `url_count` | int | Number of URLs |
| `language` | categorical | Detected content language |
| `topic_id` | categorical | Assigned topic cluster |
| `topic_embedding` | embedding | Dense topic representation |
| `sentiment_score` | float | -1 to 1 sentiment classification |
| `toxicity_score` | float | 0-1 toxicity classifier output |
| `has_card` | bool | Contains a Twitter card (link preview) |
| `is_reply` | bool | Is this a reply to another post |
| `is_quote` | bool | Is this a quote-post |
| `thread_position` | int | Position within a thread (0 = standalone) |
| `total_likes` | int | Cumulative like count |
| `total_retweets` | int | Cumulative retweet count |
| `total_replies` | int | Cumulative reply count |
| `engagement_velocity_1h` | float | Engagements per minute in last hour |
| `author_follower_count` | int | Author's follower count |
| `author_engagement_rate` | float | Author's historical engagement rate |

### Context Features (10+)

Features describing the request context (when, where, how the user is accessing).

| Feature | Type | Description |
|---|---|---|
| `hour_of_day` | int | 0-23, user's local time |
| `day_of_week` | int | 0-6 |
| `is_weekend` | bool | Saturday or Sunday |
| `device_type` | categorical | iOS / Android / Web / API |
| `connection_type` | categorical | wifi / cellular / unknown |
| `country_code` | categorical | ISO country |
| `session_depth` | int | Number of refreshes in current session |
| `time_since_last_visit_s` | int | Seconds since user's last request |
| `is_pull_to_refresh` | bool | Whether triggered by pull-to-refresh gesture |
| `viewport_height` | int | Number of items visible without scrolling |

### Interaction Features (15+)

Features describing the relationship and history between the viewer and the content author.
This is Twitter's "real-graph" -- the pairwise affinity model.

| Feature | Type | Description |
|---|---|---|
| `follows_author` | bool | Viewer follows the author |
| `author_follows_viewer` | bool | Author follows the viewer |
| `mutual_follow` | bool | Bidirectional follow |
| `real_graph_score` | float | Learned pairwise affinity (0-1) |
| `likes_on_author_7d` | int | Viewer's likes on this author, last 7 days |
| `replies_to_author_7d` | int | Viewer's replies to this author, last 7 days |
| `retweets_of_author_7d` | int | Viewer's retweets of this author, last 7 days |
| `profile_visits_on_author_30d` | int | Viewer visited author's profile, last 30 days |
| `dms_with_author_30d` | int | DM exchanges with author, last 30 days |
| `shared_list_count` | int | Number of lists containing both users |
| `time_since_last_interaction_s` | int | Seconds since any interaction with author |
| `negative_actions_on_author` | int | Hides, mutes, blocks of author's content |
| `author_in_close_network` | bool | Author within 2-hop social graph |
| `co_engagement_score` | float | How often viewer and author engage with same content |
| `notification_interaction_rate` | float | Rate of clicking notifications from this author |

### Social Proof Features (10+)

Features reflecting how the viewer's network has engaged with the candidate.

| Feature | Type | Description |
|---|---|---|
| `likes_from_followed` | int | Number of liked-by users that viewer follows |
| `retweets_from_followed` | int | Retweeted by followed accounts |
| `replies_from_followed` | int | Replied to by followed accounts |
| `liked_by_mutual_follow` | bool | Liked by someone who is a mutual follow |
| `engagement_from_close_network` | int | Total engagements from 2-hop network |
| `trusted_circle_engagement_rate` | float | Engagement rate among viewer's top-20 interacted accounts |
| `social_proof_count` | int | Total distinct social proof signals |
| `social_proof_recency_s` | int | Age of most recent social proof event |
| `followed_author_liked` | bool | At least one followed account liked this |
| `topic_community_engagement` | float | Engagement rate within viewer's topic communities |

### Freshness Features (5+)

| Feature | Type | Description |
|---|---|---|
| `post_age_s` | int | Seconds since content was created |
| `post_age_bucket` | categorical | <1h / 1-6h / 6-24h / 1-3d / 3-7d / >7d |
| `trending_velocity` | float | Rate of engagement acceleration |
| `recency_decay_score` | float | Exponential decay: `exp(-lambda * age_hours)` |
| `is_breaking` | bool | Flagged as breaking/trending content |

### Feature Availability by Scale Tier

| Feature Category | No ML | Light ML | Full ML |
|---|---|---|---|
| User features (basic: follower count, age) | Yes | Yes | Yes |
| User features (behavioral: engagement rate, session) | Partial | Yes | Yes |
| User features (embeddings: topic interests) | No | No | Yes |
| Content features (basic: text length, media type) | Yes | Yes | Yes |
| Content features (derived: sentiment, toxicity) | No | Partial | Yes |
| Content features (embeddings: topic vectors) | No | No | Yes |
| Context features | Partial (time only) | Yes | Yes |
| Interaction features (follow relationship) | Yes | Yes | Yes |
| Interaction features (real-graph score) | No | Partial | Yes |
| Social proof features | Basic count only | Yes | Yes |
| Freshness features | Yes | Yes | Yes |

---

## 3. Score Calibration and Normalization

### Cross-Source Score Normalization

Candidate generation produces items from multiple sources (in-network follows, out-of-network
recommendations, topic-based retrieval, trending content). Each source produces scores on
different scales and distributions. These must be normalized before combining.

```typescript
interface ScoredCandidate {
  id: string;
  source: 'in_network' | 'out_of_network' | 'topic' | 'trending';
  rawScore: number;
}

interface SourceStats {
  mean: number;
  stdDev: number;
}

function normalizeScores(
  candidates: ScoredCandidate[],
  sourceStats: Record<string, SourceStats>
): Array<ScoredCandidate & { normalizedScore: number }> {
  return candidates.map(c => {
    const stats = sourceStats[c.source];
    // Z-score normalization: (x - mean) / stdDev
    const zScore = (c.rawScore - stats.mean) / stats.stdDev;
    // Sigmoid squash to [0, 1]
    const normalizedScore = 1 / (1 + Math.exp(-zScore));
    return { ...c, normalizedScore };
  });
}
```

Source statistics (`mean`, `stdDev`) should be computed from a rolling window of recent
scoring runs (e.g. last 24 hours). Update them hourly to track distribution drift.

### Weighted Scoring Formula

The heavy ranker's multi-task heads produce per-engagement probabilities. These are combined
into a single ranking score using a weighted sum with a negative-action penalty.

```
score = w_like * p(like)
      + w_share * p(share)
      + w_reply * p(reply)
      + w_dwell * p(dwell_gt_30s)
      - w_negative * p(negative)
```

Twitter's approximate weights (from the open-source release):

| Signal | Weight | Rationale |
|---|---|---|
| `p(like)` | 0.5 | Lightweight positive signal, high volume |
| `p(share)` / `p(retweet)` | 1.0 | Strong amplification signal |
| `p(reply)` | 13.5 | Conversation is heavily valued |
| `p(dwell > 30s)` | 0.005 | Passive signal, high baseline rate |
| `p(negative)` | -74.0 | Extremely penalized to protect user experience |

The large negative weight on `p(negative)` means even a small probability of a hide/block
action will tank a candidate's score. This is intentional -- negative experiences drive
user churn far more than missing a good post.

```typescript
interface EngagementPredictions {
  pLike: number;
  pShare: number;
  pReply: number;
  pDwell: number;
  pNegative: number;
}

interface RankingWeights {
  like: number;
  share: number;
  reply: number;
  dwell: number;
  negative: number;
}

function computeRankingScore(
  predictions: EngagementPredictions,
  weights: RankingWeights
): number {
  return (
    weights.like * predictions.pLike +
    weights.share * predictions.pShare +
    weights.reply * predictions.pReply +
    weights.dwell * predictions.pDwell -
    weights.negative * predictions.pNegative
  );
}
```

### Score Bucketing for A/B Testing

For A/B experiments, continuous scores are bucketed into discrete tiers. This makes it
easier to measure treatment effects per quality tier and avoids noise from fine-grained
score differences.

```typescript
type ScoreBucket = 'top' | 'high' | 'medium' | 'low' | 'backfill';

function bucketScore(score: number): ScoreBucket {
  if (score > 0.8) return 'top';
  if (score > 0.5) return 'high';
  if (score > 0.2) return 'medium';
  if (score > 0.05) return 'low';
  return 'backfill';
}
```

Bucket thresholds should be calibrated against engagement rates so that each bucket
captures a meaningful share of traffic. Recalibrate monthly.

---

## 4. Diversity and Mixing

After scoring, a diversity layer re-orders the ranked list to prevent degenerate feeds.
Twitter calls this the "home-mixer" phase.

### Author Diversity

Cap the number of posts from any single author in a viewport.

```typescript
function enforceAuthorDiversity<T extends { authorId: string }>(
  ranked: T[],
  maxPerAuthor: number
): T[] {
  const authorCounts = new Map<string, number>();
  const result: T[] = [];

  for (const item of ranked) {
    const count = authorCounts.get(item.authorId) ?? 0;
    if (count < maxPerAuthor) {
      result.push(item);
      authorCounts.set(item.authorId, count + 1);
    }
  }

  return result;
}
```

Twitter uses `maxPerAuthor = 2` for the initial viewport (first ~10 items) and relaxes
to 3-4 deeper in the feed.

### Source Diversity

Balance in-network (from followed accounts) and out-of-network (algorithmic recommendations)
content. Twitter targets roughly 50/50 for the "For You" tab.

```typescript
interface MixConfig {
  inNetworkRatio: number;  // 0.0 - 1.0, target ratio of in-network content
  windowSize: number;      // number of items per mixing window
}

function mixSources<T extends { source: 'in_network' | 'out_of_network' }>(
  inNetwork: T[],
  outOfNetwork: T[],
  config: MixConfig
): T[] {
  const result: T[] = [];
  let inIdx = 0;
  let outIdx = 0;
  const inPerWindow = Math.round(config.windowSize * config.inNetworkRatio);
  const outPerWindow = config.windowSize - inPerWindow;

  while (inIdx < inNetwork.length || outIdx < outOfNetwork.length) {
    for (let i = 0; i < inPerWindow && inIdx < inNetwork.length; i++) {
      result.push(inNetwork[inIdx++]);
    }
    for (let i = 0; i < outPerWindow && outIdx < outOfNetwork.length; i++) {
      result.push(outOfNetwork[outIdx++]);
    }
  }

  return result;
}
```

### Content-Type Diversity

Rotate media types to avoid monotony. A feed of all-video or all-text feels repetitive.

```typescript
type MediaType = 'text' | 'image' | 'video' | 'link' | 'poll';

function enforceContentTypeDiversity<T extends { mediaType: MediaType }>(
  ranked: T[],
  maxConsecutiveSameType: number
): T[] {
  const result: T[] = [];
  const deferred: T[] = [];

  for (const item of ranked) {
    const recentSameType = result
      .slice(-maxConsecutiveSameType)
      .every(r => r.mediaType === item.mediaType);

    if (result.length >= maxConsecutiveSameType && recentSameType) {
      deferred.push(item);
    } else {
      result.push(item);
    }
  }

  // Append deferred items at end (they still appear, just repositioned)
  return [...result, ...deferred];
}
```

### Feedback Fatigue

Suppress content the user has already seen or dismissed. Track impression history and
apply diminishing scores to re-shown items.

```typescript
function applyFatiguePenalty<T extends { id: string; score: number }>(
  candidates: T[],
  impressionHistory: Map<string, number>, // id -> impression count
  decayFactor: number // e.g. 0.5 means score halves per impression
): T[] {
  return candidates.map(c => {
    const impressions = impressionHistory.get(c.id) ?? 0;
    const penalty = Math.pow(decayFactor, impressions);
    return { ...c, score: c.score * penalty };
  });
}
```

### Reverse-Chronological Fallback

When the ML pipeline is unavailable, degraded, or for specific user preferences,
fall back to reverse-chronological ordering with basic deduplication.

```typescript
function reverseChronologicalFallback<T extends { createdAt: Date; authorId: string }>(
  candidates: T[],
  maxPerAuthor: number
): T[] {
  const sorted = [...candidates].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  return enforceAuthorDiversity(sorted, maxPerAuthor);
}
```

This fallback should always be available as a circuit breaker. If the heavy ranker's
p99 latency exceeds 200 ms or the model server returns errors, switch to this path.

---

## 5. Ranking for Different Surfaces

Twitter serves ranked content on multiple product surfaces, each with different objectives.
The same underlying ranking infrastructure is reused with surface-specific configurations.

### Surface Definitions

| Surface | Primary Objective | Candidate Pool | Ranking Emphasis |
|---|---|---|---|
| **For You** (home timeline) | Maximize engagement + session time | In-network + out-of-network | Full multi-task ranking |
| **Search** | Relevance to query | Query-matched content | Query relevance >> engagement |
| **Explore / Trending** | Discovery of popular content | Trending + topic-clustered | Velocity + breadth of engagement |
| **Notifications** | Re-engagement + timeliness | Mentions, likes, follows | Recency + relationship strength |

### Surface Configuration Pattern

Define a surface configuration that overrides ranking weights and diversity rules.

```typescript
interface SurfaceConfig {
  surfaceId: string;
  rankingWeights: RankingWeights;
  diversity: {
    maxPerAuthor: number;
    inNetworkRatio: number;
    maxConsecutiveSameType: number;
  };
  candidateSources: string[];
  maxCandidates: number;
  freshnessBias: number; // multiplier on recency_decay_score
  fallbackToChronological: boolean;
}

const SURFACE_CONFIGS: Record<string, SurfaceConfig> = {
  for_you: {
    surfaceId: 'for_you',
    rankingWeights: { like: 0.5, share: 1.0, reply: 13.5, dwell: 0.005, negative: 74.0 },
    diversity: { maxPerAuthor: 2, inNetworkRatio: 0.5, maxConsecutiveSameType: 3 },
    candidateSources: ['in_network', 'out_of_network', 'topic', 'trending'],
    maxCandidates: 1500,
    freshnessBias: 1.0,
    fallbackToChronological: true,
  },

  search: {
    surfaceId: 'search',
    rankingWeights: { like: 0.2, share: 0.3, reply: 1.0, dwell: 0.01, negative: 50.0 },
    diversity: { maxPerAuthor: 3, inNetworkRatio: 0.0, maxConsecutiveSameType: 5 },
    candidateSources: ['search_index'],
    maxCandidates: 500,
    freshnessBias: 0.5, // search results can be older
    fallbackToChronological: false,
  },

  explore: {
    surfaceId: 'explore',
    rankingWeights: { like: 0.8, share: 1.5, reply: 5.0, dwell: 0.01, negative: 60.0 },
    diversity: { maxPerAuthor: 1, inNetworkRatio: 0.1, maxConsecutiveSameType: 2 },
    candidateSources: ['trending', 'topic', 'out_of_network'],
    maxCandidates: 1000,
    freshnessBias: 2.0, // strongly prefer fresh content
    fallbackToChronological: true,
  },

  notifications: {
    surfaceId: 'notifications',
    rankingWeights: { like: 0.1, share: 0.1, reply: 2.0, dwell: 0.0, negative: 30.0 },
    diversity: { maxPerAuthor: 5, inNetworkRatio: 0.8, maxConsecutiveSameType: 10 },
    candidateSources: ['interactions', 'in_network'],
    maxCandidates: 200,
    freshnessBias: 3.0, // notifications must be timely
    fallbackToChronological: true,
  },
};
```

### Unified Ranking Pipeline

A single pipeline function that accepts a surface config and executes the full
light-ranker -> heavy-ranker -> diversity chain.

```typescript
interface RankedResult<T> {
  items: T[];
  metadata: {
    surface: string;
    candidateCount: number;
    lightRankerOutputCount: number;
    heavyRankerOutputCount: number;
    diversityFiltered: number;
    latencyMs: number;
    usedFallback: boolean;
  };
}

async function rankForSurface<T extends ScoredCandidate & {
  authorId: string;
  mediaType: MediaType;
  createdAt: Date;
  source: 'in_network' | 'out_of_network';
  engagementPredictions?: EngagementPredictions;
}>(
  candidates: T[],
  config: SurfaceConfig,
  impressionHistory: Map<string, number>,
  sourceStats: Record<string, SourceStats>
): Promise<RankedResult<T>> {
  const start = Date.now();
  let usedFallback = false;

  // Step 1: Normalize scores across sources
  const normalized = normalizeScores(candidates, sourceStats);

  // Step 2: Light ranker -- top N by normalized score
  const lightRankerLimit = Math.min(config.maxCandidates, 300);
  const afterLightRanker = normalized
    .sort((a, b) => b.normalizedScore - a.normalizedScore)
    .slice(0, lightRankerLimit) as unknown as T[];

  // Step 3: Heavy ranker -- apply engagement predictions + weights
  let afterHeavyRanker: T[];
  try {
    afterHeavyRanker = afterLightRanker
      .map(item => {
        if (!item.engagementPredictions) return { ...item, finalScore: item.rawScore };
        const score = computeRankingScore(item.engagementPredictions, config.rankingWeights);
        return { ...item, finalScore: score };
      })
      .sort((a: any, b: any) => b.finalScore - a.finalScore);
  } catch {
    // Fallback to chronological if heavy ranker fails
    if (config.fallbackToChronological) {
      afterHeavyRanker = reverseChronologicalFallback(afterLightRanker, config.diversity.maxPerAuthor);
      usedFallback = true;
    } else {
      throw new Error(`Heavy ranker failed for surface ${config.surfaceId} with no fallback`);
    }
  }

  // Step 4: Fatigue penalty
  const afterFatigue = applyFatiguePenalty(
    afterHeavyRanker.map((item, i) => ({ ...item, score: afterHeavyRanker.length - i })),
    impressionHistory,
    0.5
  ) as unknown as T[];

  // Step 5: Diversity enforcement
  const afterAuthorDiv = enforceAuthorDiversity(afterFatigue, config.diversity.maxPerAuthor);
  const afterContentDiv = enforceContentTypeDiversity(afterAuthorDiv, config.diversity.maxConsecutiveSameType);

  // Step 6: Source mixing (only for surfaces that blend in/out network)
  let finalList: T[];
  if (config.diversity.inNetworkRatio > 0 && config.diversity.inNetworkRatio < 1) {
    const inNet = afterContentDiv.filter(i => i.source === 'in_network');
    const outNet = afterContentDiv.filter(i => i.source === 'out_of_network');
    finalList = mixSources(inNet, outNet, {
      inNetworkRatio: config.diversity.inNetworkRatio,
      windowSize: 10,
    });
  } else {
    finalList = afterContentDiv;
  }

  return {
    items: finalList,
    metadata: {
      surface: config.surfaceId,
      candidateCount: candidates.length,
      lightRankerOutputCount: afterLightRanker.length,
      heavyRankerOutputCount: afterHeavyRanker.length,
      diversityFiltered: afterHeavyRanker.length - finalList.length,
      latencyMs: Date.now() - start,
      usedFallback,
    },
  };
}
```

### Monitoring Checklist

After deploying a ranking pipeline, track these metrics per surface:

- **Engagement rate** (likes + shares + replies per impression) -- primary quality metric.
- **Negative action rate** (hide + mute + block per impression) -- must not increase.
- **Source distribution** (% in-network vs out-of-network) -- should match config targets.
- **Author concentration** (Gini coefficient across author impression share) -- lower is more diverse.
- **Latency p50 / p95 / p99** -- must stay within budget per stage.
- **Fallback rate** -- how often the chronological fallback is triggered.
- **Score distribution shift** -- monitor for model drift via score histogram divergence.
