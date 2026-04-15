# Rate Limiting — System Design Reference

Derived from karanpratapsingh/system-design and ByteByteGoHq/system-design-101.

---

## Quick Selection Guide

| Need | Pattern | Trade-off | Use When |
|------|---------|-----------|----------|
| Smooth burst handling | Token Bucket | Allows short bursts up to bucket size | API rate limiting with burst tolerance |
| Strict constant-rate output | Leaky Bucket | No burst tolerance, queues excess | Network traffic shaping, strict SLA enforcement |
| Simplest counter approach | Fixed Window Counter | Boundary spike (2x burst at window edge) | Simple analytics, non-critical rate limits |
| Exact rolling window | Sliding Window Log | High memory (stores every timestamp) | Audit-grade rate limiting, per-user tracking |
| Balanced accuracy/memory | Sliding Window Counter | Approximation near window edges | Production API rate limiting (best general-purpose choice) |

---

## Detailed Entries

### Token Bucket

- **What**: A bucket holds tokens that refill at a fixed rate. Each request consumes one token. Requests are rejected when the bucket is empty, but short bursts are allowed when the bucket is full.
- **Complexity**: O(1) per request (check + decrement)
- **CAP Trade-off**: Stateful per-client; in distributed settings, token state must be synchronized (CP for exact limits, AP for approximate)
- **Use when**: API rate limiting where short bursts are acceptable; payment processing with burst tolerance; any scenario needing smooth average rate with burst headroom
- **Avoid when**: You need strict constant-rate output (use leaky bucket); you cannot tolerate any burst above the average rate
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory per-client bucket | Map<clientId, {tokens, lastRefill}> |
| **Growth** (1K-100K) | Redis-backed with Lua script | Atomic check-and-decrement; `EVALSHA` for atomicity |
| **Scale** (100K+) | Distributed token bucket with local + global sync | Local fast-path with periodic global reconciliation |

**TypeScript Implementation** (Hobby tier):
```typescript
interface TokenBucketConfig {
  maxTokens: number;       // Bucket capacity
  refillRate: number;      // Tokens added per second
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private config: TokenBucketConfig;

  constructor(config: TokenBucketConfig) {
    this.config = config;
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.config.maxTokens,
      this.tokens + elapsed * this.config.refillRate
    );
    this.lastRefill = now;
  }

  tryConsume(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  /** Seconds until N tokens are available */
  retryAfter(tokens = 1): number {
    this.refill();
    if (this.tokens >= tokens) return 0;
    return (tokens - this.tokens) / this.config.refillRate;
  }
}

/** Per-client rate limiter using token buckets */
class TokenBucketRateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private config: TokenBucketConfig;

  constructor(config: TokenBucketConfig) {
    this.config = config;
  }

  isAllowed(clientId: string): boolean {
    let bucket = this.buckets.get(clientId);
    if (!bucket) {
      bucket = new TokenBucket(this.config);
      this.buckets.set(clientId, bucket);
    }
    return bucket.tryConsume();
  }
}
```

---

### Leaky Bucket

- **What**: Requests enter a FIFO queue (the bucket). The queue drains at a fixed constant rate. If the queue is full, new requests are discarded (leaked). This produces a perfectly smooth output rate.
- **Complexity**: O(1) per request (enqueue or reject)
- **CAP Trade-off**: Similar to token bucket; state must be shared for distributed enforcement
- **Use when**: Network traffic shaping where constant output rate is required; strict SLA enforcement; scenarios where downstream can only handle a fixed rate
- **Avoid when**: Burst handling is desirable (use token bucket); request latency from queuing is unacceptable; requests are time-sensitive and cannot wait in queue
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory queue with timer-based drain | Array queue, `setInterval` to process |
| **Growth** (1K-100K) | Redis list with Lua-based dequeue | `LPUSH` + `RPOP` with rate-controlled consumer |
| **Scale** (100K+) | Message queue (SQS, Kafka) with consumer rate control | Decouple intake from processing entirely |

**TypeScript Implementation** (Hobby tier):
```typescript
interface LeakyBucketConfig {
  capacity: number;    // Max queue size
  drainRate: number;   // Requests processed per second
}

class LeakyBucket {
  private queue: Array<() => void> = [];
  private config: LeakyBucketConfig;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: LeakyBucketConfig) {
    this.config = config;
    this.startDrain();
  }

  private startDrain(): void {
    const intervalMs = 1000 / this.config.drainRate;
    this.timer = setInterval(() => {
      const task = this.queue.shift();
      if (task) task();
    }, intervalMs);
  }

  /** Returns true if request was accepted into the queue */
  tryEnqueue(task: () => void): boolean {
    if (this.queue.length >= this.config.capacity) {
      return false; // Bucket full, request leaked (dropped)
    }
    this.queue.push(task);
    return true;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
```

---

### Fixed Window Counter

- **What**: Divides time into fixed windows (e.g., 60-second intervals). A counter tracks requests per window. Requests are rejected when the counter exceeds the threshold. The counter resets at each window boundary.
- **Complexity**: O(1) per request (increment + compare)
- **CAP Trade-off**: Simple to distribute (each window is a single counter), but boundary spikes can allow 2x the limit across two adjacent windows
- **Use when**: Simple rate limiting where boundary precision is not critical; analytics counters; non-security-critical limits
- **Avoid when**: Exact per-second limits are required (boundary spike problem: a client can send `limit` requests at the end of window N and `limit` requests at the start of window N+1); security-critical rate limiting (use sliding window instead)
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory Map<clientId, {count, windowStart}> | Reset counter when window boundary crossed |
| **Growth** (1K-100K) | Redis `INCR` + `EXPIRE` | `INCR client:window_id` with TTL = window size |
| **Scale** (100K+) | Distributed counters with eventual consistency | Accept slight over-count; use sliding window for precision |

**TypeScript Implementation** (Hobby tier):
```typescript
interface FixedWindowConfig {
  windowMs: number;   // Window duration in milliseconds
  maxRequests: number; // Max requests per window
}

class FixedWindowCounter {
  private windows: Map<string, { count: number; windowStart: number }> = new Map();
  private config: FixedWindowConfig;

  constructor(config: FixedWindowConfig) {
    this.config = config;
  }

  isAllowed(clientId: string): boolean {
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;
    const entry = this.windows.get(clientId);

    if (!entry || entry.windowStart !== windowStart) {
      this.windows.set(clientId, { count: 1, windowStart });
      return true;
    }

    if (entry.count < this.config.maxRequests) {
      entry.count++;
      return true;
    }

    return false;
  }

  /** Seconds until current window resets */
  retryAfter(clientId: string): number {
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;
    const windowEnd = windowStart + this.config.windowMs;
    return Math.ceil((windowEnd - now) / 1000);
  }
}
```

---

### Sliding Window Log

- **What**: Stores the exact timestamp of every request per client. To check the limit, counts timestamps within the trailing window. Old timestamps outside the window are discarded.
- **Complexity**: O(N) per request in the worst case (scan timestamps), or O(log N) with a sorted structure. Space: O(N) where N = max requests per window per client.
- **CAP Trade-off**: CP-leaning in distributed settings (exact counts require consistent state); high memory cost scales with request volume
- **Use when**: Audit-grade rate limiting where exact precision is required; per-user API billing where every request counts; low-volume, high-value endpoints (payment APIs, auth endpoints)
- **Avoid when**: High request volume per client (memory grows linearly); the slight approximation of sliding window counter is acceptable; memory is constrained
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory array of timestamps per client | Shift out expired entries on each check |
| **Growth** (1K-100K) | Redis sorted set per client | `ZADD client ts ts` + `ZRANGEBYSCORE` + `ZREMRANGEBYSCORE` |
| **Scale** (100K+) | Redis sorted set with periodic compaction | TTL on the sorted set key; shard clients across Redis nodes |

**TypeScript Implementation** (Hobby tier):
```typescript
interface SlidingWindowLogConfig {
  windowMs: number;     // Window duration in milliseconds
  maxRequests: number;  // Max requests per window
}

class SlidingWindowLog {
  private logs: Map<string, number[]> = new Map();
  private config: SlidingWindowLogConfig;

  constructor(config: SlidingWindowLogConfig) {
    this.config = config;
  }

  isAllowed(clientId: string): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let timestamps = this.logs.get(clientId) ?? [];

    // Remove timestamps outside the window
    timestamps = timestamps.filter(ts => ts > windowStart);

    if (timestamps.length < this.config.maxRequests) {
      timestamps.push(now);
      this.logs.set(clientId, timestamps);
      return true;
    }

    this.logs.set(clientId, timestamps);
    return false;
  }

  /** Seconds until the oldest request in window expires */
  retryAfter(clientId: string): number {
    const now = Date.now();
    const timestamps = this.logs.get(clientId) ?? [];
    if (timestamps.length < this.config.maxRequests) return 0;
    const oldest = timestamps[0];
    const expiresAt = oldest + this.config.windowMs;
    return Math.max(0, Math.ceil((expiresAt - now) / 1000));
  }
}
```

---

### Sliding Window Counter

- **What**: Combines fixed window counter with proportional weighting from the previous window. The request count is: `previous_window_count * overlap_ratio + current_window_count`. This approximates a true sliding window with O(1) space per client.
- **Complexity**: O(1) per request (arithmetic + compare)
- **CAP Trade-off**: Easy to distribute (two counters per client); slight approximation near window boundaries but no 2x boundary spike
- **Use when**: Production API rate limiting (best general-purpose choice); high-volume endpoints where sliding window log is too expensive; any scenario needing better accuracy than fixed window without the memory cost of sliding log
- **Avoid when**: Exact per-request audit trail is needed (use sliding window log); the approximation error is unacceptable for billing/compliance
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory two-counter per client | Previous window count + current window count |
| **Growth** (1K-100K) | Redis with two keys per client per window | `INCR client:prev_window`, `INCR client:curr_window` with TTL |
| **Scale** (100K+) | Distributed sliding window with local counters + periodic sync | Local fast-path, global reconciliation every N seconds |

**TypeScript Implementation** (Hobby tier):
```typescript
interface SlidingWindowCounterConfig {
  windowMs: number;     // Window duration in milliseconds
  maxRequests: number;  // Max requests per window
}

class SlidingWindowCounter {
  private clients: Map<string, {
    prevCount: number;
    currCount: number;
    currWindowStart: number;
  }> = new Map();
  private config: SlidingWindowCounterConfig;

  constructor(config: SlidingWindowCounterConfig) {
    this.config = config;
  }

  isAllowed(clientId: string): boolean {
    const now = Date.now();
    const currWindowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;

    let entry = this.clients.get(clientId);

    if (!entry || currWindowStart - entry.currWindowStart >= 2 * this.config.windowMs) {
      // Two or more windows have passed, reset everything
      entry = { prevCount: 0, currCount: 0, currWindowStart };
      this.clients.set(clientId, entry);
    } else if (currWindowStart !== entry.currWindowStart) {
      // New window: rotate current -> previous
      entry.prevCount = entry.currCount;
      entry.currCount = 0;
      entry.currWindowStart = currWindowStart;
    }

    // Calculate weighted count
    const elapsedInWindow = now - currWindowStart;
    const overlapRatio = 1 - elapsedInWindow / this.config.windowMs;
    const estimatedCount = entry.prevCount * overlapRatio + entry.currCount;

    if (estimatedCount < this.config.maxRequests) {
      entry.currCount++;
      return true;
    }

    return false;
  }

  /** Approximate seconds until a slot opens */
  retryAfter(clientId: string): number {
    const now = Date.now();
    const currWindowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;
    const windowEnd = currWindowStart + this.config.windowMs;
    return Math.max(0, Math.ceil((windowEnd - now) / 1000));
  }
}
```
