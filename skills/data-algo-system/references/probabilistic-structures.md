# Probabilistic Structures — System Design Reference

Derived from karanpratapsingh/system-design and ByteByteGoHq/system-design-101.

---

## Quick Selection Guide

| Need | Pattern | Trade-off | Use When |
|------|---------|-----------|----------|
| "Is X in the set?" (no false negatives) | Bloom Filter | False positives possible; no delete | Cache miss reduction, duplicate detection, spam filtering |
| Bloom filter with delete support | Counting Bloom Filter | 4x memory of standard Bloom | Need to remove elements from the filter |
| Better space efficiency + delete | Cuckoo Filter | Slightly more complex insertion | Space-constrained membership testing with deletes |
| "How often does X appear?" | Count-Min Sketch | Over-counts possible (never under) | Frequency estimation in streaming data, heavy hitters |
| "How many unique items?" | HyperLogLog | ~0.81% standard error | Unique visitor counting, cardinality estimation |
| Ordered probabilistic index | Skip List | O(log N) but simpler than balanced BST | Concurrent sorted index (Redis sorted sets, LevelDB memtable) |

---

## Detailed Entries

### Bloom Filter

- **What**: A space-efficient probabilistic data structure that tests whether an element is a member of a set. It can say "definitely not in set" or "probably in set" (false positives possible, false negatives impossible).
- **Complexity**: O(K) per insert and lookup (K = number of hash functions); O(M) space (M = bit array size)
- **CAP Trade-off**: Used locally per node; in distributed systems, reduces unnecessary cross-node lookups by filtering cache misses
- **Use when**: Cache miss reduction (check Bloom filter before hitting the database); duplicate URL detection in web crawlers; spell checking; reducing disk reads in LSM-tree databases (LevelDB, RocksDB)
- **Avoid when**: False positives are unacceptable; you need to delete elements (use counting Bloom or cuckoo filter); the set is small enough to store exactly
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See data-algo core for bit manipulation and hash function internals

#### False Positive Formula

The probability of a false positive after inserting N elements:

```
P(fp) = (1 - e^(-K*N/M))^K
```

Where:
- M = number of bits in the array
- K = number of hash functions
- N = number of inserted elements

**Optimal K** for a given M and N:

```
K_optimal = (M / N) * ln(2)
```

**Sizing guide** for target false positive rate P:

```
M = -(N * ln(P)) / (ln(2))^2
```

| Target FP Rate | Bits per Element (M/N) | Optimal K |
|---------------|----------------------|-----------|
| 1% | 9.6 | 7 |
| 0.1% | 14.4 | 10 |
| 0.01% | 19.2 | 13 |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory bit array with K hash functions | Standard implementation; works for sets up to millions |
| **Growth** (1K-100K) | Redis `BF.ADD` / `BF.EXISTS` (RedisBloom module) | Distributed Bloom filter with persistence |
| **Scale** (100K+) | Partitioned Bloom filters per shard + federated queries | Each shard has its own Bloom filter; query the right partition first |

**TypeScript Implementation** (Hobby tier):
```typescript
class BloomFilter {
  private bits: Uint8Array;
  private numBits: number;
  private numHashes: number;

  /**
   * @param expectedElements Expected number of elements
   * @param falsePositiveRate Target false positive rate (e.g., 0.01 for 1%)
   */
  constructor(expectedElements: number, falsePositiveRate = 0.01) {
    this.numBits = Math.ceil(
      -(expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2)
    );
    this.numHashes = Math.ceil((this.numBits / expectedElements) * Math.log(2));
    this.bits = new Uint8Array(Math.ceil(this.numBits / 8));
  }

  /** Generate K hash positions using double hashing */
  private getPositions(value: string): number[] {
    const h1 = this.fnv1a(value);
    const h2 = this.murmur3(value);
    const positions: number[] = [];
    for (let i = 0; i < this.numHashes; i++) {
      positions.push(Math.abs((h1 + i * h2) % this.numBits));
    }
    return positions;
  }

  add(value: string): void {
    for (const pos of this.getPositions(value)) {
      this.bits[pos >>> 3] |= 1 << (pos & 7);
    }
  }

  /** Returns true if the element MIGHT be in the set (false positives possible) */
  mightContain(value: string): boolean {
    for (const pos of this.getPositions(value)) {
      if ((this.bits[pos >>> 3] & (1 << (pos & 7))) === 0) {
        return false; // Definitely not in the set
      }
    }
    return true; // Probably in the set
  }

  private fnv1a(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
  }

  private murmur3(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      let k = input.charCodeAt(i);
      k = (k * 0xcc9e2d51) >>> 0;
      k = (k << 15) | (k >>> 17);
      k = (k * 0x1b873593) >>> 0;
      hash ^= k;
      hash = (hash << 13) | (hash >>> 19);
      hash = (hash * 5 + 0xe6546b64) >>> 0;
    }
    return hash;
  }

  get sizeInBits(): number {
    return this.numBits;
  }

  get hashCount(): number {
    return this.numHashes;
  }
}
```

**System design use case -- cache miss reduction**:
```typescript
class BloomFilterCacheGuard {
  private bloom: BloomFilter;
  private cache: Map<string, unknown> = new Map();
  private dbQuery: (key: string) => Promise<unknown>;

  constructor(dbQuery: (key: string) => Promise<unknown>, expectedKeys: number) {
    this.bloom = new BloomFilter(expectedKeys, 0.01);
    this.dbQuery = dbQuery;
  }

  /** Register a key as existing in the database */
  registerKey(key: string): void {
    this.bloom.add(key);
  }

  async get(key: string): Promise<unknown | null> {
    // Check Bloom filter first -- if not present, definitely not in DB
    if (!this.bloom.mightContain(key)) {
      return null; // Avoid hitting DB entirely
    }

    // Check cache
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // Bloom says maybe; query DB
    const value = await this.dbQuery(key);
    if (value !== null) {
      this.cache.set(key, value);
    }
    return value;
  }
}
```

---

### Counting Bloom Filter

- **What**: Extends the standard Bloom filter by replacing each bit with a counter (typically 4 bits). Supports deletion by decrementing counters instead of clearing bits.
- **Complexity**: O(K) per insert, delete, and lookup; O(M * C) space where C = bits per counter (typically 4)
- **CAP Trade-off**: Same as Bloom filter; adds delete capability at 4x memory cost
- **Use when**: Membership testing where elements are removed (e.g., invalidated cache keys); URL blocklist that needs real-time updates; any scenario needing Bloom filter + delete
- **Avoid when**: Deletions are rare (standard Bloom filter saves 4x memory); counter overflow is a concern (very high-frequency insertions of the same element); space is the primary constraint
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See data-algo core for bit manipulation and counter array internals

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory counter array (4-bit counters packed into bytes) | 4x memory of standard Bloom; supports delete |
| **Growth** (1K-100K) | Redis-based counting Bloom (RedisBloom `CF.*` commands) | Persistent, distributed counting Bloom filter |
| **Scale** (100K+) | Partitioned counting Bloom filters per service instance | Each instance maintains local filter; periodic sync |

**TypeScript Implementation** (Hobby tier):
```typescript
class CountingBloomFilter {
  private counters: Uint8Array; // Each byte holds two 4-bit counters
  private numCounters: number;
  private numHashes: number;

  constructor(expectedElements: number, falsePositiveRate = 0.01) {
    this.numCounters = Math.ceil(
      -(expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2)
    );
    this.numHashes = Math.ceil(
      (this.numCounters / expectedElements) * Math.log(2)
    );
    // Each byte holds two 4-bit counters
    this.counters = new Uint8Array(Math.ceil(this.numCounters / 2));
  }

  private getCounter(pos: number): number {
    const byteIdx = pos >>> 1;
    return pos & 1
      ? (this.counters[byteIdx] >>> 4) & 0xf
      : this.counters[byteIdx] & 0xf;
  }

  private setCounter(pos: number, value: number): void {
    const byteIdx = pos >>> 1;
    const clamped = Math.min(15, Math.max(0, value)); // 4-bit max = 15
    if (pos & 1) {
      this.counters[byteIdx] =
        (this.counters[byteIdx] & 0x0f) | (clamped << 4);
    } else {
      this.counters[byteIdx] =
        (this.counters[byteIdx] & 0xf0) | clamped;
    }
  }

  private getPositions(value: string): number[] {
    const h1 = this.hash1(value);
    const h2 = this.hash2(value);
    const positions: number[] = [];
    for (let i = 0; i < this.numHashes; i++) {
      positions.push(Math.abs((h1 + i * h2) % this.numCounters));
    }
    return positions;
  }

  add(value: string): void {
    for (const pos of this.getPositions(value)) {
      this.setCounter(pos, this.getCounter(pos) + 1);
    }
  }

  remove(value: string): boolean {
    const positions = this.getPositions(value);
    // Check if element exists first
    if (positions.some(pos => this.getCounter(pos) === 0)) {
      return false; // Element not in filter
    }
    for (const pos of positions) {
      this.setCounter(pos, this.getCounter(pos) - 1);
    }
    return true;
  }

  mightContain(value: string): boolean {
    return this.getPositions(value).every(pos => this.getCounter(pos) > 0);
  }

  private hash1(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
  }

  private hash2(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      let k = input.charCodeAt(i);
      k = (k * 0xcc9e2d51) >>> 0;
      k = (k << 15) | (k >>> 17);
      k = (k * 0x1b873593) >>> 0;
      hash ^= k;
      hash = (hash << 13) | (hash >>> 19);
      hash = (hash * 5 + 0xe6546b64) >>> 0;
    }
    return hash;
  }
}
```

---

### Cuckoo Filter

- **What**: A space-efficient probabilistic data structure that supports membership testing, insertion, and deletion. Uses cuckoo hashing to store fingerprints in a bucket array. Offers better space efficiency than counting Bloom filters while supporting deletes.
- **Complexity**: O(1) amortized per insert, delete, and lookup; O(M * B * F) space where M = buckets, B = bucket size, F = fingerprint bits
- **CAP Trade-off**: Same as Bloom filter; better space efficiency for the same false positive rate when deletions are needed
- **Use when**: Membership testing with frequent deletions; space-constrained environments needing better efficiency than counting Bloom; high lookup throughput needed
- **Avoid when**: Insert-heavy workloads (cuckoo eviction chains can be expensive); filter occupancy >95% (insertion failures increase); standard Bloom filter suffices (simpler)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See data-algo core for cuckoo hashing internals

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory bucket array with fingerprints | 2-4 entries per bucket, 8-16 bit fingerprints |
| **Growth** (1K-100K) | Redis-based (RedisBloom `CF.*` commands) | Native cuckoo filter support in RedisBloom |
| **Scale** (100K+) | Partitioned cuckoo filters with consistent hashing | Shard filter by key prefix; each shard maintains local filter |

**TypeScript Implementation** (Hobby tier):
```typescript
class CuckooFilter {
  private buckets: (number | null)[][];
  private numBuckets: number;
  private bucketSize: number;
  private maxKicks: number;
  private fingerprintBits: number;

  constructor(
    capacity: number,
    bucketSize = 4,
    fingerprintBits = 8,
    maxKicks = 500
  ) {
    this.bucketSize = bucketSize;
    this.fingerprintBits = fingerprintBits;
    this.maxKicks = maxKicks;
    this.numBuckets = Math.ceil(capacity / bucketSize);
    this.buckets = Array.from({ length: this.numBuckets }, () =>
      Array(bucketSize).fill(null)
    );
  }

  private fingerprint(value: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    // Ensure fingerprint is non-zero
    const fp = hash & ((1 << this.fingerprintBits) - 1);
    return fp === 0 ? 1 : fp;
  }

  private hash(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      let k = value.charCodeAt(i);
      k = (k * 0xcc9e2d51) >>> 0;
      k = (k << 15) | (k >>> 17);
      k = (k * 0x1b873593) >>> 0;
      hash ^= k;
      hash = (hash << 13) | (hash >>> 19);
      hash = (hash * 5 + 0xe6546b64) >>> 0;
    }
    return hash;
  }

  private altBucket(bucketIdx: number, fp: number): number {
    // Partial-key cuckoo hashing: alternate bucket = i XOR hash(fingerprint)
    return (bucketIdx ^ (fp * 0x5bd1e995)) % this.numBuckets;
  }

  add(value: string): boolean {
    const fp = this.fingerprint(value);
    const i1 = Math.abs(this.hash(value)) % this.numBuckets;
    const i2 = Math.abs(this.altBucket(i1, fp)) % this.numBuckets;

    // Try to insert in either bucket
    for (const idx of [i1, i2]) {
      const slot = this.buckets[idx].indexOf(null);
      if (slot !== -1) {
        this.buckets[idx][slot] = fp;
        return true;
      }
    }

    // Both full; evict and relocate
    let idx = Math.random() < 0.5 ? i1 : i2;
    let currentFp = fp;

    for (let kick = 0; kick < this.maxKicks; kick++) {
      const slot = Math.floor(Math.random() * this.bucketSize);
      const evicted = this.buckets[idx][slot]!;
      this.buckets[idx][slot] = currentFp;
      currentFp = evicted;
      idx = Math.abs(this.altBucket(idx, currentFp)) % this.numBuckets;

      const emptySlot = this.buckets[idx].indexOf(null);
      if (emptySlot !== -1) {
        this.buckets[idx][emptySlot] = currentFp;
        return true;
      }
    }

    return false; // Filter is too full
  }

  mightContain(value: string): boolean {
    const fp = this.fingerprint(value);
    const i1 = Math.abs(this.hash(value)) % this.numBuckets;
    const i2 = Math.abs(this.altBucket(i1, fp)) % this.numBuckets;

    return this.buckets[i1].includes(fp) || this.buckets[i2].includes(fp);
  }

  remove(value: string): boolean {
    const fp = this.fingerprint(value);
    const i1 = Math.abs(this.hash(value)) % this.numBuckets;
    const i2 = Math.abs(this.altBucket(i1, fp)) % this.numBuckets;

    for (const idx of [i1, i2]) {
      const slot = this.buckets[idx].indexOf(fp);
      if (slot !== -1) {
        this.buckets[idx][slot] = null;
        return true;
      }
    }
    return false;
  }
}
```

---

### Count-Min Sketch

- **What**: A probabilistic data structure for estimating the frequency of elements in a stream. Uses a 2D array of counters with multiple hash functions. Always over-counts (never under-counts). The minimum across all hash positions is the best estimate.
- **Complexity**: O(K) per insert and query (K = number of hash functions); O(W * K) space where W = width of each row
- **CAP Trade-off**: Used locally per node; in distributed systems, sketches from multiple nodes can be merged by summing corresponding counters
- **Use when**: Heavy hitter detection in network traffic; frequency estimation in streaming data; trending topic detection; any scenario needing approximate frequency counts without storing individual elements
- **Avoid when**: Exact counts are required; the number of distinct elements is small enough to count exactly; under-estimation must never happen (it doesn't, but verify this matches your semantics)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See data-algo core for 2D array and hash function internals

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory 2D counter array | Width and depth determine accuracy vs space trade-off |
| **Growth** (1K-100K) | Redis `CMS.INCRBY` / `CMS.QUERY` (RedisBloom module) | Persistent, distributed Count-Min Sketch |
| **Scale** (100K+) | Partitioned sketches merged periodically | Each stream processor maintains local sketch; merge during aggregation |

**TypeScript Implementation** (Hobby tier):
```typescript
class CountMinSketch {
  private table: Uint32Array[];
  private width: number;
  private depth: number;

  /**
   * @param width Number of counters per row (higher = more accurate, more space)
   * @param depth Number of hash functions/rows (higher = fewer collisions)
   */
  constructor(width = 1000, depth = 7) {
    this.width = width;
    this.depth = depth;
    this.table = Array.from({ length: depth }, () => new Uint32Array(width));
  }

  /** Create from error tolerance parameters */
  static fromErrorRate(epsilon: number, delta: number): CountMinSketch {
    // width = ceil(e / epsilon), depth = ceil(ln(1/delta))
    const width = Math.ceil(Math.E / epsilon);
    const depth = Math.ceil(Math.log(1 / delta));
    return new CountMinSketch(width, depth);
  }

  private hash(value: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h % this.width;
  }

  add(value: string, count = 1): void {
    for (let i = 0; i < this.depth; i++) {
      const pos = this.hash(value, i * 0x9e3779b9);
      this.table[i][pos] += count;
    }
  }

  /** Returns estimated frequency (always >= true count) */
  estimate(value: string): number {
    let min = Infinity;
    for (let i = 0; i < this.depth; i++) {
      const pos = this.hash(value, i * 0x9e3779b9);
      min = Math.min(min, this.table[i][pos]);
    }
    return min;
  }

  /** Merge another sketch into this one (for distributed aggregation) */
  merge(other: CountMinSketch): void {
    if (other.width !== this.width || other.depth !== this.depth) {
      throw new Error('Sketches must have same dimensions to merge');
    }
    for (let i = 0; i < this.depth; i++) {
      for (let j = 0; j < this.width; j++) {
        this.table[i][j] += other.table[i][j];
      }
    }
  }
}
```

**System design use case -- heavy hitter detection**:
```typescript
class HeavyHitterDetector {
  private sketch: CountMinSketch;
  private threshold: number;
  private candidates: Set<string> = new Set();

  constructor(threshold: number, epsilon = 0.001, delta = 0.01) {
    this.sketch = CountMinSketch.fromErrorRate(epsilon, delta);
    this.threshold = threshold;
  }

  observe(item: string): void {
    this.sketch.add(item);
    if (this.sketch.estimate(item) >= this.threshold) {
      this.candidates.add(item);
    }
  }

  getHeavyHitters(): Array<{ item: string; estimatedCount: number }> {
    return Array.from(this.candidates)
      .map(item => ({ item, estimatedCount: this.sketch.estimate(item) }))
      .filter(({ estimatedCount }) => estimatedCount >= this.threshold)
      .sort((a, b) => b.estimatedCount - a.estimatedCount);
  }
}
```

---

### HyperLogLog

- **What**: A probabilistic algorithm for cardinality estimation -- counting the number of distinct elements in a set. Uses only O(log log N) space per register (typically 12KB total for ~0.81% standard error) regardless of set size.
- **Complexity**: O(1) per insertion; O(M) per count (M = number of registers, typically 16384); O(1) space per register (6 bits)
- **CAP Trade-off**: Used locally; in distributed systems, HLL registers can be merged by taking the max of each register position (union operation)
- **Use when**: Unique visitor counting (web analytics); distinct IP counting (network monitoring); cardinality estimation for query planning; any scenario needing approximate distinct counts over billions of elements
- **Avoid when**: Exact counts are required; the set is small enough to count exactly (<10K elements); individual element lookup is needed (HLL only counts, doesn't store)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See data-algo core for hash function and bit manipulation internals

#### How It Works

1. Hash each element to a uniform random binary string
2. Use the first `p` bits to select one of `2^p` registers (buckets)
3. Count the leading zeros in the remaining bits; store the maximum count in that register
4. Estimate cardinality: `alpha * M^2 / sum(2^(-register[i]))` where alpha is a bias-correction constant

**Standard error**: `1.04 / sqrt(M)` where M = number of registers

| Registers (M) | Memory | Standard Error |
|---------------|--------|---------------|
| 1024 (2^10) | 768 bytes | 3.25% |
| 4096 (2^12) | 3 KB | 1.625% |
| 16384 (2^14) | 12 KB | 0.81% |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory register array | 16384 registers, 6 bits each = 12KB |
| **Growth** (1K-100K) | Redis `PFADD` / `PFCOUNT` / `PFMERGE` | Native HyperLogLog with 12KB per key |
| **Scale** (100K+) | Distributed HLL with periodic merge | Each node maintains local HLL; merge for global count |

**TypeScript Implementation** (Hobby tier):
```typescript
class HyperLogLog {
  private registers: Uint8Array;
  private numRegisters: number;
  private registerBits: number;
  private alpha: number;

  constructor(registerBits = 14) {
    this.registerBits = registerBits;
    this.numRegisters = 1 << registerBits; // 2^p
    this.registers = new Uint8Array(this.numRegisters);

    // Alpha bias-correction constant
    if (this.numRegisters === 16) this.alpha = 0.673;
    else if (this.numRegisters === 32) this.alpha = 0.697;
    else if (this.numRegisters === 64) this.alpha = 0.709;
    else this.alpha = 0.7213 / (1 + 1.079 / this.numRegisters);
  }

  private hash(value: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    // Mix the hash for better distribution
    h ^= h >>> 16;
    h = (h * 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = (h * 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h;
  }

  /** Count leading zeros + 1 in the remaining bits after register selection */
  private countLeadingZeros(hash: number, registerBits: number): number {
    const remainingBits = 32 - registerBits;
    const remaining = hash >>> registerBits;
    if (remaining === 0) return remainingBits + 1;

    let count = 1;
    let val = remaining;
    while ((val & (1 << (remainingBits - count))) === 0 && count <= remainingBits) {
      count++;
    }
    return count;
  }

  add(value: string): void {
    const hash = this.hash(value);
    const registerIdx = hash & (this.numRegisters - 1); // First p bits
    const leadingZeros = this.countLeadingZeros(hash, this.registerBits);
    this.registers[registerIdx] = Math.max(
      this.registers[registerIdx],
      leadingZeros
    );
  }

  count(): number {
    // Harmonic mean of 2^(-register[i])
    let harmonicSum = 0;
    let zeroRegisters = 0;

    for (let i = 0; i < this.numRegisters; i++) {
      harmonicSum += Math.pow(2, -this.registers[i]);
      if (this.registers[i] === 0) zeroRegisters++;
    }

    let estimate = this.alpha * this.numRegisters * this.numRegisters / harmonicSum;

    // Small range correction (linear counting)
    if (estimate <= 2.5 * this.numRegisters && zeroRegisters > 0) {
      estimate = this.numRegisters * Math.log(this.numRegisters / zeroRegisters);
    }

    return Math.round(estimate);
  }

  /** Merge another HLL into this one (union) */
  merge(other: HyperLogLog): void {
    if (other.numRegisters !== this.numRegisters) {
      throw new Error('HLLs must have same register count to merge');
    }
    for (let i = 0; i < this.numRegisters; i++) {
      this.registers[i] = Math.max(this.registers[i], other.registers[i]);
    }
  }

  get standardError(): number {
    return 1.04 / Math.sqrt(this.numRegisters);
  }

  get memoryBytes(): number {
    return this.numRegisters; // 1 byte per register (could be packed to 6 bits)
  }
}
```

**System design use case -- unique visitor counting**:
```typescript
class UniqueVisitorCounter {
  private daily: Map<string, HyperLogLog> = new Map();

  recordVisit(date: string, visitorId: string): void {
    if (!this.daily.has(date)) {
      this.daily.set(date, new HyperLogLog(14)); // ~12KB per day, 0.81% error
    }
    this.daily.get(date)!.add(visitorId);
  }

  /** Get unique visitors for a single day */
  getDailyCount(date: string): number {
    return this.daily.get(date)?.count() ?? 0;
  }

  /** Get unique visitors across a date range (merge HLLs) */
  getRangeCount(startDate: string, endDate: string): number {
    const merged = new HyperLogLog(14);
    for (const [date, hll] of this.daily) {
      if (date >= startDate && date <= endDate) {
        merged.merge(hll);
      }
    }
    return merged.count();
  }
}
```

---

### Skip List

- **What**: A probabilistic data structure that provides O(log N) search, insert, and delete in an ordered sequence. Uses multiple layers of linked lists where higher layers "skip" over elements, acting like a randomized balanced BST but simpler to implement.
- **Complexity**: O(log N) average for search, insert, delete; O(N) space on average (each element appears in ~2 levels)
- **CAP Trade-off**: Used locally per node; in distributed systems, skip lists enable efficient concurrent sorted indexing
- **Use when**: Concurrent sorted index (Redis sorted sets use skip lists); in-memory database index (LevelDB/RocksDB memtable); any scenario needing sorted data with O(log N) operations and simpler implementation than balanced BSTs
- **Avoid when**: Worst-case O(N) is unacceptable (balanced BST guarantees O(log N)); memory overhead of multiple pointers per node is too high; a simple hash map suffices (no ordering needed)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See data-algo core for linked list internals; skip list is the system-level pattern for concurrent ordered indexing

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory skip list | Standard probabilistic skip list with P=0.5 |
| **Growth** (1K-100K) | Redis sorted sets (`ZADD`, `ZRANGEBYSCORE`) | Redis uses skip lists internally for sorted sets |
| **Scale** (100K+) | Concurrent skip list (lock-free or fine-grained locking) | Java's `ConcurrentSkipListMap`; used in LSM-tree memtables |

**TypeScript Implementation** (Hobby tier):
```typescript
interface SkipNode<T> {
  key: number;
  value: T;
  forward: (SkipNode<T> | null)[];
}

class SkipList<T> {
  private head: SkipNode<T>;
  private maxLevel: number;
  private level: number;
  private probability: number;
  private size: number;

  constructor(maxLevel = 16, probability = 0.5) {
    this.maxLevel = maxLevel;
    this.probability = probability;
    this.level = 0;
    this.size = 0;
    this.head = {
      key: -Infinity,
      value: undefined as T,
      forward: new Array(maxLevel + 1).fill(null),
    };
  }

  private randomLevel(): number {
    let lvl = 0;
    while (Math.random() < this.probability && lvl < this.maxLevel) {
      lvl++;
    }
    return lvl;
  }

  insert(key: number, value: T): void {
    const update: (SkipNode<T> | null)[] = new Array(this.maxLevel + 1).fill(null);
    let current: SkipNode<T> = this.head;

    for (let i = this.level; i >= 0; i--) {
      while (current.forward[i] && current.forward[i]!.key < key) {
        current = current.forward[i]!;
      }
      update[i] = current;
    }

    const next = current.forward[0];
    if (next && next.key === key) {
      next.value = value; // Update existing
      return;
    }

    const newLevel = this.randomLevel();
    if (newLevel > this.level) {
      for (let i = this.level + 1; i <= newLevel; i++) {
        update[i] = this.head;
      }
      this.level = newLevel;
    }

    const newNode: SkipNode<T> = {
      key,
      value,
      forward: new Array(newLevel + 1).fill(null),
    };

    for (let i = 0; i <= newLevel; i++) {
      newNode.forward[i] = update[i]!.forward[i];
      update[i]!.forward[i] = newNode;
    }

    this.size++;
  }

  search(key: number): T | undefined {
    let current: SkipNode<T> = this.head;
    for (let i = this.level; i >= 0; i--) {
      while (current.forward[i] && current.forward[i]!.key < key) {
        current = current.forward[i]!;
      }
    }
    const candidate = current.forward[0];
    return candidate && candidate.key === key ? candidate.value : undefined;
  }

  delete(key: number): boolean {
    const update: (SkipNode<T> | null)[] = new Array(this.maxLevel + 1).fill(null);
    let current: SkipNode<T> = this.head;

    for (let i = this.level; i >= 0; i--) {
      while (current.forward[i] && current.forward[i]!.key < key) {
        current = current.forward[i]!;
      }
      update[i] = current;
    }

    const target = current.forward[0];
    if (!target || target.key !== key) return false;

    for (let i = 0; i <= this.level; i++) {
      if (update[i]!.forward[i] !== target) break;
      update[i]!.forward[i] = target.forward[i];
    }

    while (this.level > 0 && !this.head.forward[this.level]) {
      this.level--;
    }

    this.size--;
    return true;
  }

  /** Range query: return all entries with key in [min, max] */
  range(min: number, max: number): Array<{ key: number; value: T }> {
    const result: Array<{ key: number; value: T }> = [];
    let current: SkipNode<T> = this.head;

    for (let i = this.level; i >= 0; i--) {
      while (current.forward[i] && current.forward[i]!.key < min) {
        current = current.forward[i]!;
      }
    }

    current = current.forward[0]!;
    while (current && current.key <= max) {
      result.push({ key: current.key, value: current.value });
      current = current.forward[0]!;
    }

    return result;
  }

  get length(): number {
    return this.size;
  }
}
```
