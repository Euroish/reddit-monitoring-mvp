# Caching Strategies — System Design Reference

Derived from karanpratapsingh/system-design and ByteByteGoHq/system-design-101.

---

## Quick Selection Guide

| Need | Pattern | Trade-off | Use When |
|------|---------|-----------|----------|
| Simple lazy caching | Cache-Aside | Stale reads possible | Read-heavy, can tolerate eventual consistency |
| Transparent read caching | Read-Through | Cache library dependency | ORM-style cache, read-heavy with uniform access |
| Strong read consistency | Write-Through | Higher write latency | Read-after-write consistency required |
| High write throughput | Write-Back | Data loss risk on crash | Write-heavy (logging, analytics, metrics) |
| Protect cache from write pollution | Write-Around | Cache misses on recent writes | Write-once-read-never data (logs, archives) |
| Evict least useful items | LRU Eviction | O(1) but no frequency awareness | General-purpose eviction, recency-driven workloads |
| Evict infrequent items | LFU Eviction | Higher bookkeeping overhead | Frequency-driven workloads, skewed popularity |
| Time-bound freshness | TTL Strategy | Stale data within TTL window | External API caching, DNS, session data |
| Immediate consistency | Event-Driven Invalidation | Infrastructure complexity | Strong consistency requirements, event-sourced systems |

---

## Detailed Entries

### Cache-Aside (Lazy Loading)

- **What**: The application checks the cache first. On a miss, it reads from the database, writes the result to the cache, and returns it. The cache is populated on-demand.
- **Complexity**: O(1) per cache hit, O(1) cache write + DB read cost on miss
- **CAP Trade-off**: AP -- tolerates stale reads (cache may hold old data until TTL or invalidation); favors availability over consistency
- **Use when**: Read-heavy workloads (>80% reads); data that can tolerate short staleness; applications that need explicit control over what gets cached
- **Avoid when**: Read-after-write consistency is required; cache stampede risk is high (many concurrent misses for the same key); writes are frequent and reads must always see latest
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory Map with TTL | Simple `Map<key, {value, expiresAt}>` |
| **Growth** (1K-100K) | Redis/Memcached with application-level cache-aside logic | `GET key` -> miss -> DB read -> `SET key value EX ttl` |
| **Scale** (100K+) | Multi-tier: L1 in-process + L2 Redis cluster | Local cache for hot keys, Redis for warm keys, DB for cold |

**TypeScript Implementation** (Hobby tier):
```typescript
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class CacheAside<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /** Cache-aside pattern: check cache, fallback to fetcher, populate cache */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}
```

---

### Read-Through

- **What**: The cache sits between the application and the database. On a miss, the cache itself loads the data from the database (not the application). The application only talks to the cache.
- **Complexity**: O(1) per cache hit; cache handles miss logic transparently
- **CAP Trade-off**: Same as cache-aside (AP), but the cache layer owns the miss-handling logic, reducing application complexity
- **Use when**: You want a transparent caching layer (the app doesn't manage cache population); ORM or data access layer integration; uniform read patterns
- **Avoid when**: Different keys need different fetch strategies; the cache library doesn't support read-through; you need fine-grained control over what gets cached
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory cache with loader function | Cache wraps the DB; app only calls `cache.get(key)` |
| **Growth** (1K-100K) | Redis with custom read-through proxy | Proxy intercepts misses, queries DB, populates Redis |
| **Scale** (100K+) | Dedicated caching proxy (e.g., Twemproxy, mcrouter) | Handles sharding, miss-fill, and connection pooling |

**TypeScript Implementation** (Hobby tier):
```typescript
class ReadThroughCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private loader: (key: string) => Promise<T>;
  private defaultTtlMs: number;
  private inflight: Map<string, Promise<T>> = new Map();

  constructor(loader: (key: string) => Promise<T>, defaultTtlMs = 60_000) {
    this.loader = loader;
    this.defaultTtlMs = defaultTtlMs;
  }

  async get(key: string): Promise<T> {
    // Check cache
    const entry = this.cache.get(key);
    if (entry && Date.now() <= entry.expiresAt) {
      return entry.value;
    }

    // Deduplicate concurrent requests for the same key (stampede protection)
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.loader(key).then(value => {
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + this.defaultTtlMs,
      });
      this.inflight.delete(key);
      return value;
    });

    this.inflight.set(key, promise);
    return promise;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}
```

---

### Write-Through

- **What**: Every write goes to both the cache and the database synchronously. The write is only confirmed after both succeed. This guarantees that the cache always reflects the latest data.
- **Complexity**: O(1) cache write + DB write cost per write operation
- **CAP Trade-off**: CP -- strong consistency between cache and DB, but higher write latency (must wait for both)
- **Use when**: Read-after-write consistency is required; financial data, user profiles, or any data where stale reads are unacceptable; combined with cache-aside for reads
- **Avoid when**: Write-heavy workloads where latency matters (double-write penalty); data is rarely read after writing; write amplification is a concern
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Synchronous write to Map + DB in same function | Simple but blocks on both writes |
| **Growth** (1K-100K) | Redis + DB write in a transaction-like wrapper | Write to Redis and DB; rollback cache on DB failure |
| **Scale** (100K+) | Write-through proxy with circuit breaker | Proxy handles dual-write; falls back to DB-only on cache failure |

**TypeScript Implementation** (Hobby tier):
```typescript
class WriteThroughCache<T> {
  private cache: Map<string, T> = new Map();
  private dbWrite: (key: string, value: T) => Promise<void>;
  private dbRead: (key: string) => Promise<T | undefined>;

  constructor(
    dbWrite: (key: string, value: T) => Promise<void>,
    dbRead: (key: string) => Promise<T | undefined>
  ) {
    this.dbWrite = dbWrite;
    this.dbRead = dbRead;
  }

  async write(key: string, value: T): Promise<void> {
    // Write to DB first (source of truth)
    await this.dbWrite(key, value);
    // Then update cache
    this.cache.set(key, value);
  }

  async read(key: string): Promise<T | undefined> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const value = await this.dbRead(key);
    if (value !== undefined) {
      this.cache.set(key, value);
    }
    return value;
  }
}
```

---

### Write-Back (Write-Behind)

- **What**: Writes go only to the cache and are confirmed immediately. The cache asynchronously flushes dirty entries to the database on a schedule or when evicted. This maximizes write throughput.
- **Complexity**: O(1) per write (cache only); async DB write batched
- **CAP Trade-off**: AP -- high availability and low write latency, but data can be lost if the cache crashes before flushing to DB
- **Use when**: Write-heavy workloads (logging, metrics, analytics); write latency is critical; data loss of recent writes is acceptable (or mitigated with replicated cache)
- **Avoid when**: Data durability is critical (financial transactions); you cannot tolerate any data loss; the cache is not replicated
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory dirty set + periodic flush | `setInterval` flushes dirty entries to DB |
| **Growth** (1K-100K) | Redis with AOF persistence + async DB sync | Redis durability protects against crash; background job flushes to DB |
| **Scale** (100K+) | Write-ahead log (WAL) + async replication | Kafka as durable write buffer; consumers flush to DB |

**TypeScript Implementation** (Hobby tier):
```typescript
class WriteBackCache<T> {
  private cache: Map<string, T> = new Map();
  private dirty: Set<string> = new Set();
  private dbWrite: (key: string, value: T) => Promise<void>;
  private flushTimer: ReturnType<typeof setInterval>;

  constructor(
    dbWrite: (key: string, value: T) => Promise<void>,
    flushIntervalMs = 5_000
  ) {
    this.dbWrite = dbWrite;
    this.flushTimer = setInterval(() => this.flush(), flushIntervalMs);
  }

  write(key: string, value: T): void {
    this.cache.set(key, value);
    this.dirty.add(key);
    // Returns immediately -- DB write happens asynchronously
  }

  read(key: string): T | undefined {
    return this.cache.get(key);
  }

  private async flush(): Promise<void> {
    const keysToFlush = Array.from(this.dirty);
    this.dirty.clear();

    for (const key of keysToFlush) {
      const value = this.cache.get(key);
      if (value !== undefined) {
        try {
          await this.dbWrite(key, value);
        } catch {
          // Re-mark as dirty for retry on next flush
          this.dirty.add(key);
        }
      }
    }
  }

  /** Flush all dirty entries and stop the timer */
  async destroy(): Promise<void> {
    clearInterval(this.flushTimer);
    await this.flush();
  }
}
```

---

### Write-Around

- **What**: Writes go directly to the database, bypassing the cache entirely. The cache is only populated on reads (via cache-aside or read-through). This avoids polluting the cache with data that may never be read.
- **Complexity**: O(1) DB write; cache not involved in writes
- **CAP Trade-off**: AP on reads (same as cache-aside); writes go directly to source of truth
- **Use when**: Write-once-read-never data (logs, audit trails, archives); data that is written far more often than read; large objects that would waste cache space
- **Avoid when**: Read-after-write consistency is needed (recently written data will miss cache); data is frequently written AND read
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Direct DB writes + cache-aside for reads | Simplest combination; cache only holds read-hot data |
| **Growth** (1K-100K) | DB writes + Redis cache-aside | Optionally invalidate cache key on write for consistency |
| **Scale** (100K+) | DB writes + event-driven cache invalidation | DB change events (CDC) trigger cache invalidation |

**TypeScript Implementation** (Hobby tier):
```typescript
class WriteAroundCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private dbWrite: (key: string, value: T) => Promise<void>;
  private dbRead: (key: string) => Promise<T | undefined>;
  private defaultTtlMs: number;

  constructor(
    dbWrite: (key: string, value: T) => Promise<void>,
    dbRead: (key: string) => Promise<T | undefined>,
    defaultTtlMs = 60_000
  ) {
    this.dbWrite = dbWrite;
    this.dbRead = dbRead;
    this.defaultTtlMs = defaultTtlMs;
  }

  /** Write goes directly to DB, bypassing cache */
  async write(key: string, value: T): Promise<void> {
    await this.dbWrite(key, value);
    // Optionally invalidate stale cache entry
    this.cache.delete(key);
  }

  /** Read uses cache-aside pattern */
  async read(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);
    if (entry && Date.now() <= entry.expiresAt) {
      return entry.value;
    }

    const value = await this.dbRead(key);
    if (value !== undefined) {
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + this.defaultTtlMs,
      });
    }
    return value;
  }
}
```

---

### LRU Eviction

- **What**: Evicts the Least Recently Used item when the cache reaches capacity. Uses a doubly-linked list + hash map for O(1) access and eviction.
- **Complexity**: O(1) per get, put, and eviction
- **CAP Trade-off**: Local policy; in distributed caches, each node runs LRU independently
- **Use when**: General-purpose cache eviction; recency-driven workloads where recent items are likely accessed again; default choice when no specific access pattern is known
- **Avoid when**: Access pattern is frequency-driven (popular items accessed repeatedly but not recently); scan pollution (a one-time sequential scan evicts all hot items)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See data-algo core for doubly-linked list + hash map DS internals

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory doubly-linked list + Map | Standard LRU cache implementation |
| **Growth** (1K-100K) | Redis with `maxmemory-policy allkeys-lru` | Redis approximates LRU with sampling (default 5 keys) |
| **Scale** (100K+) | Segmented LRU (SLRU) or W-TinyLFU (Caffeine-style) | Protects hot items from scan pollution |

**TypeScript Implementation** (Hobby tier):
```typescript
class LRUCache<T> {
  private capacity: number;
  private cache: Map<string, T>; // Map maintains insertion order in JS

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value === undefined) return undefined;

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  put(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict least recently used (first key in Map)
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) this.cache.delete(lruKey);
    }
    this.cache.set(key, value);
  }

  get size(): number {
    return this.cache.size;
  }
}
```

---

### LFU Eviction

- **What**: Evicts the Least Frequently Used item when the cache reaches capacity. Tracks access frequency for each key. On tie, evicts the least recently used among the least frequent.
- **Complexity**: O(1) per get, put, and eviction (with frequency bucket lists)
- **CAP Trade-off**: Local policy; more bookkeeping than LRU but better hit rates for skewed workloads
- **Use when**: Workloads with skewed popularity (some items accessed far more than others); CDN caching; recommendation result caching
- **Avoid when**: Access patterns shift over time (old popular items never get evicted); cache needs to adapt quickly to changing access patterns; simpler LRU is sufficient
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See data-algo core for hash map + frequency list DS internals

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory frequency map + min-frequency tracking | Bucket lists keyed by frequency |
| **Growth** (1K-100K) | Redis with `maxmemory-policy allkeys-lfu` | Redis approximates LFU with Morris counters |
| **Scale** (100K+) | W-TinyLFU (window + frequency sketch) | Combines recency and frequency; used by Caffeine (Java) |

**TypeScript Implementation** (Hobby tier):
```typescript
class LFUCache<T> {
  private capacity: number;
  private minFreq = 0;
  private keyToVal: Map<string, T> = new Map();
  private keyToFreq: Map<string, number> = new Map();
  private freqToKeys: Map<number, Set<string>> = new Map();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  private touch(key: string): void {
    const freq = this.keyToFreq.get(key)!;
    const newFreq = freq + 1;
    this.keyToFreq.set(key, newFreq);

    // Remove from old frequency bucket
    const oldBucket = this.freqToKeys.get(freq)!;
    oldBucket.delete(key);
    if (oldBucket.size === 0) {
      this.freqToKeys.delete(freq);
      if (this.minFreq === freq) this.minFreq = newFreq;
    }

    // Add to new frequency bucket
    if (!this.freqToKeys.has(newFreq)) {
      this.freqToKeys.set(newFreq, new Set());
    }
    this.freqToKeys.get(newFreq)!.add(key);
  }

  get(key: string): T | undefined {
    if (!this.keyToVal.has(key)) return undefined;
    this.touch(key);
    return this.keyToVal.get(key);
  }

  put(key: string, value: T): void {
    if (this.capacity <= 0) return;

    if (this.keyToVal.has(key)) {
      this.keyToVal.set(key, value);
      this.touch(key);
      return;
    }

    if (this.keyToVal.size >= this.capacity) {
      // Evict least frequently used
      const minBucket = this.freqToKeys.get(this.minFreq)!;
      const evictKey = minBucket.values().next().value!;
      minBucket.delete(evictKey);
      if (minBucket.size === 0) this.freqToKeys.delete(this.minFreq);
      this.keyToVal.delete(evictKey);
      this.keyToFreq.delete(evictKey);
    }

    this.keyToVal.set(key, value);
    this.keyToFreq.set(key, 1);
    this.minFreq = 1;
    if (!this.freqToKeys.has(1)) this.freqToKeys.set(1, new Set());
    this.freqToKeys.get(1)!.add(key);
  }
}
```

---

### TTL Strategies

- **What**: Time-To-Live assigns an expiration time to each cache entry. Entries are evicted or refreshed when their TTL expires. TTL selection balances freshness against cache hit rate.
- **Complexity**: O(1) per expiration check
- **CAP Trade-off**: AP -- allows stale reads within the TTL window; shorter TTL = more consistent but lower hit rate
- **Use when**: External API response caching; DNS caching; session data; any data with a known freshness requirement
- **Avoid when**: Data changes unpredictably (event-driven invalidation is better); TTL cannot be estimated; real-time consistency is required
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### TTL Selection Guide

| Data Type | Suggested TTL | Rationale |
|-----------|--------------|-----------|
| Static assets (images, CSS) | 24h-30d | Rarely changes; use cache-busting URLs for updates |
| API responses (read-heavy) | 30s-5min | Balance freshness vs load reduction |
| User session data | 15min-1h | Match session timeout policy |
| Database query results | 1min-10min | Depends on write frequency |
| DNS records | 5min-1h | Match upstream TTL |
| Real-time data (prices, scores) | 1s-10s | Very short TTL or use event invalidation |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Lazy expiration on access | Check TTL on `get()`; delete if expired |
| **Growth** (1K-100K) | Redis `SET key value EX ttl` | Redis handles expiration natively; mix of lazy + periodic cleanup |
| **Scale** (100K+) | TTL + jitter + stale-while-revalidate | Add random jitter to prevent thundering herd; serve stale while refreshing |

**TypeScript Implementation** (Hobby tier):
```typescript
class TTLCache<T> {
  private cache: Map<string, { value: T; expiresAt: number }> = new Map();

  set(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Set with jitter to prevent thundering herd */
  setWithJitter(key: string, value: T, baseTtlMs: number, jitterMs: number): void {
    const jitter = Math.floor(Math.random() * jitterMs);
    this.set(key, value, baseTtlMs + jitter);
  }
}
```

---

### Cache Invalidation Patterns

- **What**: Strategies for keeping cache data consistent with the source of truth. Three main approaches: event-driven, TTL-based, and version-based.
- **Complexity**: Varies by approach
- **CAP Trade-off**: Stronger invalidation = more consistency (CP) but more infrastructure complexity
- **Use when**: Cache consistency matters; data changes unpredictably; multiple services write to the same data
- **Avoid when**: TTL alone provides sufficient freshness; single-writer systems where write-through is sufficient
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Event-Driven Invalidation

Publish a cache invalidation event when data changes. Subscribers delete or update their cached copies.

```typescript
interface CacheInvalidationEvent {
  key: string;
  action: 'delete' | 'update';
  newValue?: unknown;
  timestamp: number;
}

class EventDrivenCache<T> {
  private cache: Map<string, T> = new Map();

  handleEvent(event: CacheInvalidationEvent): void {
    if (event.action === 'delete') {
      this.cache.delete(event.key);
    } else if (event.action === 'update' && event.newValue !== undefined) {
      this.cache.set(event.key, event.newValue as T);
    }
  }

  get(key: string): T | undefined {
    return this.cache.get(key);
  }
}
```

#### Version-Based Invalidation

Each cache entry includes a version number. Reads compare the cached version against the source version, invalidating on mismatch.

```typescript
interface VersionedEntry<T> {
  value: T;
  version: number;
}

class VersionedCache<T> {
  private cache: Map<string, VersionedEntry<T>> = new Map();

  set(key: string, value: T, version: number): void {
    const existing = this.cache.get(key);
    // Only update if new version is higher
    if (!existing || version > existing.version) {
      this.cache.set(key, { value, version });
    }
  }

  get(key: string, currentVersion?: number): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    // If caller knows current version, check staleness
    if (currentVersion !== undefined && entry.version < currentVersion) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
```

#### Scale Tiers for Invalidation

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Delete cache key on write (same process) | Simple function call after DB write |
| **Growth** (1K-100K) | Redis Pub/Sub for invalidation events | Publish on write, all cache nodes subscribe |
| **Scale** (100K+) | Change Data Capture (CDC) + event stream | Debezium/DynamoDB Streams -> Kafka -> cache invalidation consumers |
