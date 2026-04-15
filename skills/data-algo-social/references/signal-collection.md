# Signal Collection Reference

Derived from Twitter/X's **unified-user-actions (UUA)** and **user-signal-service (USS)** subsystems. Adapted for multi-platform social data collection (Douyin, TikTok, Xiaohongshu, and others).

Twitter's UUA system processes billions of user actions daily through a unified event schema, merging explicit engagements (likes, retweets), implicit signals (impressions, dwell time), and negative signals (reports, blocks) into a single streaming pipeline. The patterns here distill that architecture into reusable collection strategies for any social platform project.

---

## 1. Signal Taxonomy

### Core Signal Types

| # | Signal | Category | Twitter Source | Default Weight | Collection Method |
|---|--------|----------|---------------|----------------|-------------------|
| 1 | Like / Heart | Explicit | `favorite` action in UUA | 1.0 | API event / webhook |
| 2 | Repost / Share | Explicit | `retweet` action in UUA | 3.0 | API event / webhook |
| 3 | Comment / Reply | Explicit | `reply` action in UUA | 5.0 | API event / polling |
| 4 | Follow | Explicit | `follow` action in UUA, real-graph | 8.0 | API event / webhook |
| 5 | Bookmark / Save | Explicit | `bookmark` action in UUA | 2.0 | API polling |
| 6 | View / Impression | Implicit | client-event logging pipeline | 0.1 | Client-side event / pixel |
| 7 | Dwell Time | Implicit | client-event `dwell_time_ms` | 0.01/sec | Client-side timer |
| 8 | Profile Visit | Implicit | client-event `profile_view` | 0.5 | Server log / API |
| 9 | Click-through | Implicit | client-event `url_click` | 0.3 | Client-side event |
| 10 | Scroll-past | Implicit | client-event `served_impression` without engagement | -0.05 | Client-side event |
| 11 | Report | Negative | UUA `report` action, T&S pipeline | -10.0 | API event / moderation queue |
| 12 | Mute / Block | Negative | UUA `mute`/`block`, real-graph negative edge | -8.0 | API event |

**Weight interpretation**: Weights reflect Twitter's observed correlation between signal type and content quality / relevance. Higher weight = stronger positive signal. Negative weight = content demotion. These are baseline values; calibrate with your own data.

### Platform-Specific Signal Variants

| Unified Signal | Douyin (抖音) | TikTok | Xiaohongshu (小红书) | Instagram | YouTube |
|---------------|-------------|--------|---------------------|-----------|---------|
| Like / Heart | 点赞 (dianzhan) | Like | 点赞 | Like / Heart | Like |
| Repost / Share | 转发 (zhuanfa) | Share / Duet / Stitch | 转发 | Share / Repost | Share |
| Comment / Reply | 评论 (pinglun) | Comment / Reply | 评论 | Comment | Comment |
| Follow | 关注 (guanzhu) | Follow | 关注 | Follow | Subscribe |
| Bookmark / Save | 收藏 (shoucang) | Bookmark / Save | 收藏 | Save | Save to playlist |
| View / Impression | 播放 (bofang) | View | 曝光 (puguang) | View / Impression | View |
| Dwell Time | 完播率 (wanbolu, completion rate) | Watch time | 阅读时长 (read duration) | View time | Watch time / retention |
| Profile Visit | 主页访问 (zhuye fangwen) | Profile view | 主页访问 | Profile visit | Channel visit |
| Click-through | 商品点击 (shangpin dianji) | Link click | 笔记点击 (biji dianji) | Link tap / Story tap | Card click / End screen |
| Scroll-past | 划过 (huaguo) | Scroll past | 划过 | Scroll past | Skip |
| Report | 举报 (jubao) | Report | 举报 | Report | Report |
| Mute / Block | 拉黑 (lahei) | Block | 拉黑 | Mute / Block | Block / Not interested |

**Douyin-specific note**: Completion rate (完播率) is a first-class signal in Douyin's algorithm, often weighted higher than explicit likes. Collect `play_duration / video_duration` ratio as a primary engagement metric.

**XHS-specific note**: Xiaohongshu's 收藏 (save/bookmark) signal is unusually strong compared to other platforms. Users save content for future reference, making it a high-intent signal. Weight it 2-3x higher than the baseline bookmark weight.

---

## 2. Collection Architecture Patterns

### Twitter's Architecture (Reference Model)

Twitter processes user signals through three coordinated subsystems:

```
                    +-----------------------+
                    |   Client Events       |
                    |   (mobile/web logs)   |
                    +-----------+-----------+
                                |
                                v
+-------------------+   +------+------+   +-------------------+
| Platform APIs     |-->| Unified     |-->| user-signal-       |
| (follow, like,    |   | User Actions|   | service (USS)      |
|  retweet, reply)  |   | (UUA)       |   | Aggregated view    |
+-------------------+   +------+------+   | per user-content   |
                                |          | pair               |
                                v          +-------------------+
                    +-----------+-----------+
                    | Kafka / Manhattan     |
                    | (event stream +       |
                    |  key-value store)     |
                    +-----------+-----------+
                                |
                    +-----------+-----------+
                    | Timelines Aggregation |
                    | Framework (batch      |
                    |  feature computation) |
                    +-----------------------+
```

Key architectural decisions from Twitter:

1. **Event streaming (Kafka-based UUA pattern)**: Every user action emits an event to a unified Kafka topic. Events are typed with a Thrift schema. Consumers subscribe to the single topic and filter by action type. This decouples signal producers (clients, APIs) from consumers (ranking, recommendation, trust & safety).

2. **Signal aggregation (USS pattern)**: The user-signal-service maintains an aggregated view of all signals for each `(user, content)` pair. Instead of querying raw event logs, downstream systems query USS for "what did user X do with content Y?" This avoids repeated fan-out reads.

3. **Batch + real-time (timelines aggregation framework)**: Real-time signals feed the online serving path (did the user just like this?). Batch signals feed feature computation (how many likes did this post get in the last 24h?). Both paths share the same schema.

4. **Schema-first (Thrift/protobuf definitions)**: The UUA schema defines every possible action type, its metadata fields, and its serialization format before any code is written. This prevents schema drift across hundreds of producing services.

### Mapping to Typical Projects

#### Pattern A: API Polling + Normalization (Douyin, XHS)

For platforms without webhook APIs. Most Chinese social platforms fall here.

```
+-----------------+    +------------------+    +------------------+
| Platform API /  |--->| Normalizer       |--->| Normalized Store |
| HTML Parser     |    | (platform →      |    | (JSON / DB)      |
| (cron-driven)   |    |  unified schema) |    |                  |
+-----------------+    +------------------+    +------------------+
     ^                                              |
     |  rate-limited                                v
     |  polling                          +------------------+
     +------- backoff ------------------ | Scheduler        |
                                         | (adaptive cron)  |
                                         +------------------+
```

- **Douyin**: Official API (limited fields) + HTML page parsing for extended metrics. Polling interval: 15-60 min depending on content age. Use `aweme_id` as content key.
- **XHS**: Hybrid API + scrape approach. Discovery API for content IDs, scrape for full metrics. Polling interval: 30-120 min. Use `note_id` as content key.

#### Pattern B: Official API + Scrape Fallback (TikTok)

For platforms with official APIs that have coverage gaps.

```
+-----------------+    +-----------------+    +------------------+
| Official API    |--->| Merge /         |--->| Normalized Store |
| (primary)       |    | Reconcile       |    |                  |
+-----------------+    +--------+--------+    +------------------+
                                ^
+-----------------+             |
| Scrape Fallback |--->---------+
| (gap-fill only) |
+-----------------+
```

- TikTok Research API provides structured data for approved use cases. Scrape layer fills gaps (e.g., metrics not exposed by the API). Reconciliation logic: API data wins on conflict; scrape data fills nulls.

#### Pattern C: Unified Cross-Platform Pipeline

For multi-platform projects (the most common real-world case).

```
+----------+     +----------+     +----------+
| Douyin   |     | TikTok   |     | XHS      |
| Adapter  |     | Adapter  |     | Adapter  |
+----+-----+     +----+-----+     +----+-----+
     |                |                |
     v                v                v
+----+----------------+----------------+----+
|           Signal Normalizer               |
|    (platform-specific → unified schema)   |
+-----------------------+-------------------+
                        |
                        v
            +-----------+-----------+
            |   Unified Signal Store |
            |   (raw → normalized →  |
            |    aggregated layers)  |
            +------------------------+
```

Each platform adapter handles:
- Authentication and session management
- Rate limiting (platform-specific)
- Raw response parsing
- Error handling and retry logic

The normalizer handles:
- Schema mapping (platform fields → unified fields)
- Timestamp normalization (all to UTC ISO 8601)
- ID namespacing (`douyin:aweme_123`, `tiktok:video_456`, `xhs:note_789`)
- Deduplication (content hash + platform ID)

---

## 3. Real-time vs Batch Decision Matrix

| Factor | Polling / Batch | Streaming / Real-time | Hybrid |
|--------|----------------|----------------------|--------|
| **Data volume** | <10K actions/day | >100K actions/day | 10K-100K actions/day |
| **Platform API** | REST-only, rate-limited | Webhooks / push available | REST + some webhooks |
| **Freshness need** | Hours-old data is fine | Minutes-old data required | Minutes for key signals, hours for bulk |
| **Infra complexity** | Cron job + database | Message queue + consumers + monitoring | Cron + lightweight queue |
| **Cost** | Low (single server) | High (always-on infra) | Medium |
| **Failure handling** | Retry on next cron run | Dead-letter queue + alerting | Cron retries + queue for critical |
| **Best for** | Analytics dashboards, daily reports | Live feeds, alerting, real-time ranking | Content collectors, competitive monitoring |
| **Scale tier** | Hobby | Scale | Growth |

**Decision guidance**:

- **Start with batch/polling** if you're unsure. Most social platform APIs are rate-limited, making true real-time collection impossible without special partnerships. A cron job that polls every 15-30 minutes covers 90% of use cases.
- **Add streaming** when you need sub-minute freshness for specific signals (e.g., trending detection, live engagement tracking). Use it alongside batch, not as a replacement.
- **Hybrid is the pragmatic default** for growth-stage projects: batch-poll all platforms on a schedule, but stream high-priority signals (new content alerts, engagement spikes) through a lightweight queue.

---

## 4. Collector Implementation Patterns

### Signal Normalization Schema

The unified signal interface that all platform adapters normalize into:

```typescript
/** Platform-agnostic signal event, inspired by Twitter's UUA schema. */
interface UnifiedSignal {
  /** Globally unique event ID: `{platform}:{event_type}:{timestamp_ms}:{random_suffix}` */
  id: string;

  /** Source platform identifier */
  platform: 'douyin' | 'tiktok' | 'xhs' | 'instagram' | 'youtube' | 'twitter';

  /** Namespaced content ID: `{platform}:{native_id}` */
  contentId: string;

  /** Namespaced user ID (actor who performed the action): `{platform}:{native_user_id}` */
  userId: string;

  /** Signal type from the taxonomy */
  signalType:
    | 'like' | 'repost' | 'comment' | 'follow' | 'bookmark'
    | 'view' | 'dwell' | 'profile_visit' | 'click_through' | 'scroll_past'
    | 'report' | 'mute_block';

  /** Signal category for quick filtering */
  category: 'explicit' | 'implicit' | 'negative';

  /** Default weight from taxonomy (can be overridden by downstream ranking) */
  weight: number;

  /** ISO 8601 UTC timestamp of when the action occurred */
  timestamp: string;

  /** Platform-native timestamp (preserved for debugging / reconciliation) */
  nativeTimestamp?: string;

  /** Additional platform-specific metadata (e.g., comment text, dwell duration ms) */
  metadata: Record<string, unknown>;

  /** SHA-256 hash of `{platform}:{contentId}:{userId}:{signalType}:{timestamp_day}` for dedup */
  deduplicationKey: string;
}

/** Aggregated signal counts per content item, inspired by Twitter's USS. */
interface ContentSignalSummary {
  contentId: string;
  platform: string;
  signals: {
    likes: number;
    reposts: number;
    comments: number;
    bookmarks: number;
    views: number;
    avgDwellMs: number;
    reports: number;
    muteBlocks: number;
  };
  /** Weighted engagement score: sum of (count * weight) across all signal types */
  engagementScore: number;
  /** Window start (ISO 8601) */
  periodStart: string;
  /** Window end (ISO 8601) */
  periodEnd: string;
  lastUpdated: string;
}
```

### Deduplication Strategy

Social platform APIs frequently return duplicate data (re-fetching the same post, overlapping pagination windows, retries after partial failures). Twitter's UUA uses a combination of event ID and time-window dedup.

```typescript
import { createHash } from 'crypto';

/**
 * Generate a deduplication key for a signal event.
 *
 * Strategy: hash the tuple (platform, contentId, userId, signalType, date).
 * This means the same user performing the same action on the same content
 * on the same day produces the same key. The date window prevents unbounded
 * dedup storage while catching the most common duplicates (re-fetches within
 * the same polling cycle or day).
 *
 * For signals where a user can legitimately repeat the action (e.g., multiple
 * comments on the same post), include a content hash of the action payload
 * (e.g., comment text) in the key.
 */
function generateDeduplicationKey(signal: {
  platform: string;
  contentId: string;
  userId: string;
  signalType: string;
  timestamp: string;
  payload?: string;
}): string {
  const date = signal.timestamp.slice(0, 10); // YYYY-MM-DD
  const base = `${signal.platform}:${signal.contentId}:${signal.userId}:${signal.signalType}:${date}`;
  const input = signal.payload ? `${base}:${signal.payload}` : base;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * In-memory dedup filter with TTL-based expiry.
 * For hobby/growth tier. Scale tier should use Redis or a bloom filter.
 */
class DeduplicationFilter {
  private seen = new Map<string, number>(); // key → expiry timestamp
  private readonly ttlMs: number;

  constructor(ttlHours = 48) {
    this.ttlMs = ttlHours * 60 * 60 * 1000;
  }

  /** Returns true if this is a NEW (unseen) signal. */
  check(key: string): boolean {
    this.evict();
    if (this.seen.has(key)) return false;
    this.seen.set(key, Date.now() + this.ttlMs);
    return true;
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, expiry] of this.seen) {
      if (expiry < now) this.seen.delete(key);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}
```

### Rate Limiting

Platform APIs enforce rate limits. Collectors must respect them to avoid bans. Twitter uses token-bucket internally; apply the same pattern externally.

```typescript
/**
 * Token-bucket rate limiter with exponential backoff on 429 responses.
 *
 * - `capacity`: max burst size (tokens available at any moment)
 * - `refillRate`: tokens added per second
 * - `backoffBase`: initial backoff in ms after a 429 (doubles on each consecutive 429)
 * - `backoffMax`: cap on backoff duration
 */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private consecutiveRejects = 0;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number,
    private readonly backoffBaseMs = 1000,
    private readonly backoffMaxMs = 60000,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /** Wait until a token is available, then consume it. */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens < 1) {
      const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
      await this.sleep(waitMs);
      this.refill();
    }

    this.tokens -= 1;
  }

  /** Call after receiving a 429 / rate-limit response. Applies exponential backoff. */
  async onRateLimited(): Promise<void> {
    this.consecutiveRejects += 1;
    const backoff = Math.min(
      this.backoffBaseMs * Math.pow(2, this.consecutiveRejects - 1),
      this.backoffMaxMs,
    );
    await this.sleep(backoff);
  }

  /** Call after a successful request. Resets consecutive reject counter. */
  onSuccess(): void {
    this.consecutiveRejects = 0;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### Collection Frequency Optimization

Adaptive polling adjusts frequency based on content age and engagement velocity.

| Content Age | Base Interval | Rationale |
|-------------|---------------|-----------|
| 0-2 hours | 5-10 min | Engagement curve is steepest; capture the viral window |
| 2-12 hours | 15-30 min | Engagement is still growing but decelerating |
| 12-48 hours | 1-2 hours | Most engagement has occurred; diminishing returns |
| 2-7 days | 6-12 hours | Long-tail engagement only |
| >7 days | 24 hours or stop | Final snapshot for archival |

**Adaptive adjustment**: If a content item's engagement velocity (delta between two polls) exceeds 2x the average for its age bracket, halve the polling interval temporarily. If velocity drops below 0.5x average, double the interval. This focuses collection resources on content that is actively gaining traction.

### Storage Pipeline

Three-layer storage mirrors Twitter's raw events -> USS aggregation -> timelines feature computation.

```
Layer 1: RAW
  - Verbatim API/scrape responses
  - Stored as JSON files or document DB entries
  - Retention: 7-30 days (configurable)
  - Purpose: debugging, reprocessing, audit trail
  - Path convention: data/raw/{platform}/{YYYY-MM-DD}/{content_id}.json

Layer 2: NORMALIZED
  - UnifiedSignal events (see schema above)
  - Stored in structured DB or JSON-lines files
  - Retention: 90 days - 1 year
  - Purpose: cross-platform analysis, signal querying
  - Path convention: data/normalized/{signal_type}/{YYYY-MM-DD}.jsonl

Layer 3: AGGREGATED
  - ContentSignalSummary records (see schema above)
  - Stored in analytics DB or pre-computed JSON
  - Retention: indefinite (small footprint)
  - Purpose: dashboards, ranking input, trend detection
  - Path convention: data/aggregated/{platform}/{YYYY-MM-DD}.json
```

### Error Handling Patterns

Inspired by Twitter's pipeline resilience. Three mechanisms work together:

**Retry Queue**: Failed collection attempts go into a retry queue with exponential backoff. Max 3 retries. Structure: `{ contentId, platform, attemptCount, nextRetryAt, lastError }`.

**Dead-Letter Store**: After max retries, failed items move to a dead-letter store for manual inspection. These represent systematic failures (API changes, auth revocation, content deletion). Review dead-letter items weekly.

**Circuit Breaker**: If a platform adapter's failure rate exceeds a threshold (e.g., >50% failures in a 5-minute window), the circuit breaker trips and stops all requests to that platform. After a cooldown period, it allows a single probe request. If the probe succeeds, the circuit closes and normal operation resumes.

```typescript
type CircuitState = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 60000,
  ) {}

  /** Check if requests are allowed. */
  canRequest(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = 'half-open';
        return true; // allow one probe request
      }
      return false;
    }
    // half-open: already allowed one probe, block until it resolves
    return false;
  }

  /** Record a successful request. */
  onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  /** Record a failed request. */
  onFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

---

## 5. Platform-Specific Signal Mapping

### Detailed Mapping: Native API Fields to Unified Signals

#### Douyin (抖音)

| Native Field | API Path / HTML Selector | Unified Signal | Notes |
|-------------|-------------------------|----------------|-------|
| `digg_count` | `aweme_detail.statistics.digg_count` | like | 点赞数 |
| `share_count` | `aweme_detail.statistics.share_count` | repost | 转发数 |
| `comment_count` | `aweme_detail.statistics.comment_count` | comment | 评论数 |
| `collect_count` | `aweme_detail.statistics.collect_count` | bookmark | 收藏数 |
| `play_count` | `aweme_detail.statistics.play_count` | view | 播放数 |
| `duration` + watch metrics | derived from play events | dwell | 完播率 = play_duration / video_duration |
| `follower_count` delta | `user.statistics.follower_count` diff | follow | Track delta between polls |
| Content removal | 404 / `status_code != 0` | report (inferred) | Content may have been reported and removed |

**Douyin collection caveats**:
- Douyin aggressively rate-limits non-official API access. Use session cookies with rotation.
- `collect_count` (收藏) was historically hidden; newer API versions expose it.
- Video completion rate is not directly available via API; approximate from `play_count` growth velocity vs `digg_count` growth velocity.

#### TikTok

| Native Field | API Path | Unified Signal | Notes |
|-------------|----------|----------------|-------|
| `digg_count` | `itemInfos.stats.diggCount` | like | |
| `share_count` | `itemInfos.stats.shareCount` | repost | Includes shares to external platforms |
| `comment_count` | `itemInfos.stats.commentCount` | comment | |
| `collect_count` | `itemInfos.stats.collectCount` | bookmark | Added in 2023 |
| `play_count` | `itemInfos.stats.playCount` | view | |
| `duet_count` | custom tracking | repost (variant) | Duets are a form of content amplification |
| `stitch_count` | custom tracking | repost (variant) | Stitches are a form of content amplification |
| `follower_count` | `userInfo.stats.followerCount` | follow | Track delta |

**TikTok collection caveats**:
- TikTok Research API requires application approval. Rate limits: 1000 requests/day for most endpoints.
- Unofficial access is fragile; TikTok actively blocks scrapers with device fingerprinting.
- Duet and stitch counts are not always available in the standard stats object; may require separate enumeration.

#### Xiaohongshu (小红书)

| Native Field | API Path / Selector | Unified Signal | Notes |
|-------------|---------------------|----------------|-------|
| `liked_count` | `note.interact_info.liked_count` | like | 点赞数 |
| `shared_count` | `note.interact_info.shared_count` | repost | 转发数 (often low on XHS) |
| `comment_count` | `note.interact_info.comment_count` | comment | 评论数 |
| `collected_count` | `note.interact_info.collected_count` | bookmark | 收藏数 (high-signal on XHS) |
| `view_count` | not always exposed; estimate from engagement ratio | view | XHS hides view counts on some note types |
| `follower_count` | `user.fans_count` | follow | Track delta |

**XHS collection caveats**:
- XHS has no official public API. All collection is scrape-based or uses undocumented endpoints.
- 收藏 (save/bookmark) is the strongest engagement signal on XHS. A note with high saves relative to likes indicates "utility content" (tutorials, guides, lists).
- XHS uses image-heavy content (图文笔记). Consider collecting image URLs and OCR-derived text as metadata.
- Anti-scraping is moderate; rotating proxies and session management are usually sufficient.

### Cross-Platform Signal Weight Calibration

Default weights from the taxonomy (Section 1) should be adjusted per platform based on user behavior norms:

| Signal | Default | Douyin Adj. | TikTok Adj. | XHS Adj. | Rationale |
|--------|---------|-------------|-------------|----------|-----------|
| Like | 1.0 | 0.8 | 0.8 | 1.0 | Likes are "cheap" on video platforms (quick double-tap) |
| Repost | 3.0 | 3.0 | 2.5 | 1.5 | XHS sharing is rare; Douyin sharing is more intentional |
| Comment | 5.0 | 5.0 | 5.0 | 6.0 | XHS comments are often detailed and high-effort |
| Bookmark | 2.0 | 2.5 | 2.0 | 5.0 | XHS saves are a primary engagement mode |
| View | 0.1 | 0.1 | 0.1 | 0.2 | XHS views are more intentional (user chose to tap) |
| Dwell | 0.01/s | 0.02/s | 0.02/s | 0.01/s | Video platforms: dwell = watch; XHS: dwell = read time |
| Report | -10.0 | -10.0 | -10.0 | -10.0 | Universal |
| Mute/Block | -8.0 | -8.0 | -8.0 | -8.0 | Universal |

### Engagement Score Formula

Compute a unified engagement score per content item, normalizing across platforms:

```
engagement_score = sum(signal_count_i * platform_adjusted_weight_i)
                   for each signal type i
```

For cross-platform comparison, normalize by views to get an engagement rate:

```
engagement_rate = engagement_score / max(view_count, 1)
```

This mirrors Twitter's approach in the heavy ranker, where raw engagement counts are normalized by impressions to produce a comparable quality signal across content with different reach.

---

## Usage Notes

**When to consult this reference**: Any task involving data collection from social platforms -- building a collector, designing a signal schema, choosing polling intervals, handling rate limits, normalizing cross-platform data.

**Companion references**: After signals are collected, they flow into downstream systems covered by other reference files:
- `candidate-generation.md` -- using collected signals to find content worth recommending
- `ranking-pipeline.md` -- using signal features to score and order content
- `content-classification.md` -- using signal patterns to categorize content
- `graph-analysis.md` -- using follow/interaction signals to build user graphs
- `trust-safety.md` -- using negative signals to filter harmful content
