# Data Partitioning — System Design Reference

Derived from karanpratapsingh/system-design and ByteByteGoHq/system-design-101.

---

## Quick Selection Guide

| Need | Pattern | Trade-off | Use When |
|------|---------|-----------|----------|
| Scale reads and writes horizontally | Horizontal Partitioning (Sharding) | Cross-shard query complexity | Data volume exceeds single-node capacity |
| Separate concerns by data type | Vertical Partitioning | Cross-partition joins needed | Different columns have different access patterns |
| Even distribution, no range queries | Hash-Based Sharding | Loses range scan ability | Uniform access, no range queries needed |
| Range scans on partition key | Range-Based Sharding | Hot spots on popular ranges | Time-series, alphabetical, or numeric range queries |
| Flexible routing with lookup | Directory-Based Sharding | Lookup service is SPOF | Complex routing rules, heterogeneous shards |
| Dynamic cluster membership | Consistent Hashing for Sharding | Implementation complexity | Elastic scaling, nodes join/leave frequently |
| Fix uneven data distribution | Rebalancing Strategies | Migration overhead | Skewed shards, post-growth redistribution |
| Prevent overloaded shards | Hot Spot Mitigation | Added key complexity | Celebrity problem, viral content, temporal spikes |

---

## Detailed Entries

### Horizontal Partitioning (Sharding)

- **What**: Splits table rows across multiple database instances (shards). Each shard holds a subset of rows with the same schema. The partition key determines which shard a row belongs to.
- **Complexity**: O(1) for single-shard queries (route by partition key); O(N) for scatter-gather across N shards
- **CAP Trade-off**: Increases partition tolerance by distributing data; cross-shard operations sacrifice consistency or availability depending on protocol
- **Use when**: Data volume exceeds single-node storage or throughput; write-heavy workloads that bottleneck on one node; geographic distribution requirements
- **Avoid when**: Data fits on one node with headroom; application relies heavily on cross-row joins; sharding key selection is unclear
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Application-level routing with 2-4 DB instances | Simple `shardId = hash(key) % numShards` |
| **Growth** (1K-100K) | Middleware proxy (Vitess, ProxySQL) | Automatic routing, connection pooling, online resharding |
| **Scale** (100K+) | Native sharding (CockroachDB, TiDB, Spanner) | Built-in distributed SQL with automatic rebalancing |

**TypeScript Implementation** (Hobby tier):
```typescript
interface ShardConfig {
  id: number;
  connectionString: string;
}

class HorizontalPartitioner {
  private shards: ShardConfig[];

  constructor(shards: ShardConfig[]) {
    this.shards = shards;
  }

  /** FNV-1a hash for consistent key hashing */
  private hash(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h;
  }

  getShard(partitionKey: string): ShardConfig {
    const index = this.hash(partitionKey) % this.shards.length;
    return this.shards[index];
  }

  /** Scatter query across all shards (expensive) */
  getAllShards(): ShardConfig[] {
    return [...this.shards];
  }
}
```

---

### Vertical Partitioning

- **What**: Splits a table by columns rather than rows. Frequently accessed columns go in one partition, rarely accessed or large columns (BLOBs, text) go in another. Each partition has the same number of rows but different columns.
- **Complexity**: O(1) for single-partition queries; join cost when columns from multiple partitions are needed
- **CAP Trade-off**: Not directly CAP-related; optimizes storage and query performance by separating hot and cold columns
- **Use when**: Some columns are accessed far more frequently than others; large columns (BLOBs, JSON) slow down queries for small columns; different columns have different caching/indexing needs
- **Avoid when**: Most queries need all columns (constant joins negate the benefit); table is already narrow; the ORM doesn't support split-table access patterns
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Separate tables in same DB joined by primary key | `users_core` (id, name, email) + `users_profile` (id, bio, avatar_url) |
| **Growth** (1K-100K) | Separate databases for hot vs cold data | Hot data in fast SSD-backed DB; cold data in cheaper storage |
| **Scale** (100K+) | Polyglot persistence | Hot columns in Redis/DynamoDB; cold columns in S3/Glacier; metadata in PostgreSQL |

**TypeScript Implementation** (Hobby tier):
```typescript
interface UserCore {
  id: string;
  name: string;
  email: string;
}

interface UserProfile {
  id: string;
  bio: string;
  avatarUrl: string;
  preferences: Record<string, unknown>;
}

class VerticalPartitionedUserStore {
  private coreStore: Map<string, UserCore> = new Map();
  private profileStore: Map<string, UserProfile> = new Map();

  /** Fast path: only core fields (90% of queries) */
  getCore(id: string): UserCore | undefined {
    return this.coreStore.get(id);
  }

  /** Slow path: full user with join */
  getFull(id: string): (UserCore & Partial<UserProfile>) | undefined {
    const core = this.coreStore.get(id);
    if (!core) return undefined;
    const profile = this.profileStore.get(id);
    return { ...core, ...profile };
  }

  setCore(user: UserCore): void {
    this.coreStore.set(user.id, user);
  }

  setProfile(profile: UserProfile): void {
    this.profileStore.set(profile.id, profile);
  }
}
```

---

### Hash-Based Sharding

- **What**: Applies a hash function to the partition key and uses modulo (or consistent hashing) to determine the target shard. Produces an even distribution regardless of key patterns.
- **Complexity**: O(1) per routing decision (hash + modulo)
- **CAP Trade-off**: Good for AP systems; even distribution improves availability. Loses range query ability (adjacent keys land on different shards).
- **Use when**: Uniform access patterns; no range query requirement on the partition key; need even load distribution across shards
- **Avoid when**: Range queries on the partition key are needed (e.g., "all users with ID 1000-2000"); adding/removing shards causes massive key redistribution (mitigate with consistent hashing)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | `hash(key) % numShards` | Simple, deterministic, but resharding requires full migration |
| **Growth** (1K-100K) | Consistent hashing (cross-ref: load-balancing.md) | Only K/N keys migrate on shard addition |
| **Scale** (100K+) | Virtual buckets (pre-shard into 1000+ virtual shards mapped to physical nodes) | Rebalance by moving virtual shards between physical nodes |

**TypeScript Implementation** (Hobby tier):
```typescript
class HashBasedPartitioner {
  private numShards: number;

  constructor(numShards: number) {
    this.numShards = numShards;
  }

  private hash(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h;
  }

  getShardId(partitionKey: string): number {
    return this.hash(partitionKey) % this.numShards;
  }
}
```

---

### Range-Based Sharding

- **What**: Partitions data based on contiguous ranges of the partition key. Each shard holds a range (e.g., users A-M on shard 1, N-Z on shard 2). Supports efficient range queries within a single shard.
- **Complexity**: O(log N) per routing decision (binary search on range boundaries), O(1) for range queries within a shard
- **CAP Trade-off**: Can create hot spots if ranges have uneven data density; good for CP systems needing ordered access
- **Use when**: Time-series data (partition by date range); alphabetical or numeric range queries; data has a natural ordering that queries exploit
- **Avoid when**: Data distribution across ranges is highly skewed (e.g., all users start with 'S'); access patterns don't align with key ordering; even load distribution is more important than range queries
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Static range boundaries in config | `[{min: 0, max: 999, shard: 0}, {min: 1000, max: 1999, shard: 1}]` |
| **Growth** (1K-100K) | Dynamic range splitting (HBase-style) | Auto-split shards that exceed size threshold |
| **Scale** (100K+) | Adaptive range partitioning (Spanner/CockroachDB) | Automatic range splitting, merging, and rebalancing |

**TypeScript Implementation** (Hobby tier):
```typescript
interface RangeShard {
  shardId: number;
  minKey: string; // Inclusive
  maxKey: string; // Exclusive
}

class RangeBasedPartitioner {
  private ranges: RangeShard[];

  constructor(ranges: RangeShard[]) {
    // Ranges must be sorted by minKey
    this.ranges = ranges.sort((a, b) => a.minKey.localeCompare(b.minKey));
  }

  getShardId(key: string): number {
    // Binary search for the range containing the key
    let low = 0;
    let high = this.ranges.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const range = this.ranges[mid];

      if (key < range.minKey) {
        high = mid - 1;
      } else if (key >= range.maxKey) {
        low = mid + 1;
      } else {
        return range.shardId;
      }
    }

    throw new Error(`No shard found for key: ${key}`);
  }

  /** Get all shards that overlap with a range query */
  getShardsForRange(minKey: string, maxKey: string): number[] {
    return this.ranges
      .filter(r => r.minKey < maxKey && r.maxKey > minKey)
      .map(r => r.shardId);
  }
}
```

---

### Directory-Based Sharding

- **What**: A lookup service (directory) maps each partition key to its shard. The directory is queried before every data access. This allows arbitrary routing rules without being constrained to hash or range logic.
- **Complexity**: O(1) per lookup (directory is a key-value store), but directory itself is a dependency on every request
- **CAP Trade-off**: The directory is a single point of failure; must be highly available (replicated). CP if directory is strongly consistent, AP if eventually consistent.
- **Use when**: Routing rules are complex or change frequently; tenant-based sharding where tenants move between shards; gradual migration between shard strategies
- **Avoid when**: Directory lookup adds unacceptable latency; simpler hash-based or range-based routing suffices; the directory becomes a bottleneck or SPOF
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory Map<key, shardId> | Simple lookup table loaded from config |
| **Growth** (1K-100K) | Redis or ZooKeeper as directory service | Fast lookups, replicated for availability |
| **Scale** (100K+) | Distributed directory with caching | etcd/Consul for directory; local cache with invalidation for hot-path performance |

**TypeScript Implementation** (Hobby tier):
```typescript
class DirectoryBasedPartitioner {
  private directory: Map<string, number> = new Map();
  private defaultShard: number;

  constructor(defaultShard = 0) {
    this.defaultShard = defaultShard;
  }

  /** Register a key-to-shard mapping */
  assign(key: string, shardId: number): void {
    this.directory.set(key, shardId);
  }

  /** Bulk assign (e.g., tenant migration) */
  assignBulk(entries: Array<{ key: string; shardId: number }>): void {
    for (const { key, shardId } of entries) {
      this.directory.set(key, shardId);
    }
  }

  getShardId(key: string): number {
    return this.directory.get(key) ?? this.defaultShard;
  }

  /** Move a key to a different shard */
  migrate(key: string, newShardId: number): void {
    this.directory.set(key, newShardId);
  }
}
```

---

### Consistent Hashing for Sharding

- **What**: Uses a consistent hash ring to assign data partitions to shards. When a shard is added or removed, only K/N keys need to be redistributed (where K = total keys, N = total shards). Virtual nodes ensure even distribution.
- **Complexity**: O(log N) per lookup (binary search on ring), O(K/N) key migration on topology change
- **CAP Trade-off**: AP-leaning; minimizes data movement during scaling, favoring availability during topology changes
- **Use when**: Elastic scaling (shards added/removed dynamically); cache clusters (Memcached, Redis); distributed databases (Cassandra, DynamoDB)
- **Avoid when**: Shard count is static (simple modulo is easier); strong range query support is needed; shard count is very small (<3)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101
- **Cross-reference**: See `load-balancing.md` for consistent hashing implementation with virtual nodes

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Same as load-balancing.md ConsistentHashRing | Use `getNode(key)` to route to shard |
| **Growth** (1K-100K) | Library-backed with replication factor | `getNodes(key, 3)` for 3-way replication |
| **Scale** (100K+) | Token-range assignment (Cassandra-style) | Pre-defined token ranges, rack-aware placement |

---

### Rebalancing Strategies

- **What**: When data distribution becomes uneven across shards, rebalancing redistributes data to restore balance. Strategies include: fixed number of partitions, dynamic splitting, proportional to node count.
- **Complexity**: O(D) where D = amount of data to move; rebalancing is expensive and must be done incrementally
- **CAP Trade-off**: Rebalancing temporarily reduces availability for affected partitions; CP systems may block writes during migration; AP systems allow stale reads
- **Use when**: Shard sizes diverge by >2x; new shards are added to the cluster; old shards are decommissioned
- **Avoid when**: Imbalance is minor (<20% skew); rebalancing cost exceeds the performance benefit; system is in peak traffic period
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Rebalancing Approaches

| Approach | How It Works | Trade-off |
|----------|-------------|-----------|
| **Fixed partitions** | Pre-create many partitions (e.g., 1000), assign to nodes. Rebalance by moving whole partitions. | Simple, but partition count is fixed at creation time |
| **Dynamic splitting** | Split a partition when it exceeds a size threshold; merge when too small. | Adapts to data growth, but splitting is expensive |
| **Proportional to nodes** | Each node gets a fixed number of partitions. New node steals partitions from existing nodes. | Scales naturally, but temporary hotspots during migration |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Manual resharding with downtime | Export, re-hash, import. Acceptable for hobby projects |
| **Growth** (1K-100K) | Online migration with double-write | Write to old and new shard; read from new; cut over when synced |
| **Scale** (100K+) | Live resharding (Vitess, CockroachDB) | Background migration with no downtime; traffic follows the data |

**TypeScript Implementation** (Hobby tier):
```typescript
interface PartitionAssignment {
  partitionId: number;
  nodeId: string;
}

class FixedPartitionRebalancer {
  private numPartitions: number;
  private assignments: Map<number, string> = new Map();

  constructor(numPartitions: number) {
    this.numPartitions = numPartitions;
  }

  /** Initial assignment: round-robin across nodes */
  initialize(nodeIds: string[]): void {
    for (let i = 0; i < this.numPartitions; i++) {
      this.assignments.set(i, nodeIds[i % nodeIds.length]);
    }
  }

  /** Add a node: steal partitions from most-loaded nodes */
  addNode(nodeId: string): PartitionAssignment[] {
    const nodeCounts = new Map<string, number>();
    for (const [, node] of this.assignments) {
      nodeCounts.set(node, (nodeCounts.get(node) ?? 0) + 1);
    }

    const targetPerNode = Math.floor(
      this.numPartitions / (nodeCounts.size + 1)
    );
    const moves: PartitionAssignment[] = [];

    for (const [partId, node] of this.assignments) {
      if (moves.length >= targetPerNode) break;
      const count = nodeCounts.get(node) ?? 0;
      if (count > targetPerNode) {
        this.assignments.set(partId, nodeId);
        nodeCounts.set(node, count - 1);
        moves.push({ partitionId: partId, nodeId });
      }
    }

    return moves; // Caller executes data migration for these partitions
  }

  getNode(partitionKey: string): string {
    const partId = this.hash(partitionKey) % this.numPartitions;
    return this.assignments.get(partId)!;
  }

  private hash(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h;
  }
}
```

---

### Hot Spot Mitigation

- **What**: Techniques to handle disproportionately popular partition keys (the "celebrity problem"). A single key receiving massive traffic can overload the shard it resides on.
- **Complexity**: Varies by technique; adds O(1) key transformation overhead
- **CAP Trade-off**: Mitigation techniques trade simplicity for even load distribution; some approaches add write fan-out
- **Use when**: Certain keys receive >10x average traffic (viral content, celebrity users); temporal spikes (flash sales, breaking news); system has measurable hot shards
- **Avoid when**: Access pattern is already uniform; the mitigation overhead exceeds the benefit; the system can scale the individual shard vertically
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Mitigation Techniques

| Technique | How It Works | Trade-off |
|-----------|-------------|-----------|
| **Key salting** | Append a random suffix (0-N) to the hot key, spreading writes across N shards. Reads must scatter-gather across all N suffixed keys. | Increases read cost by N; reduces write hot spot |
| **Read replicas per shard** | Add read replicas to the hot shard specifically. | Increases infrastructure cost; only helps read-heavy hot spots |
| **Local aggregation** | Buffer writes in-memory, flush aggregated counts periodically. | Eventual consistency for counters; reduces write pressure |
| **Dedicated shard** | Move the hot key to a dedicated, scaled-up shard. | Operational complexity; manual intervention |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Unlikely to have hot spots at this scale | Monitor and address if it appears |
| **Growth** (1K-100K) | Key salting with small N (3-5) | `key:${random(0,4)}` on writes; merge on reads |
| **Scale** (100K+) | Combination: salting + dedicated shards + local aggregation | Multi-technique approach for extreme hot spots |

**TypeScript Implementation** (Hobby tier):
```typescript
class HotSpotMitigator {
  private saltRange: number;
  private hotKeys: Set<string>;

  constructor(saltRange = 5, hotKeys: string[] = []) {
    this.saltRange = saltRange;
    this.hotKeys = new Set(hotKeys);
  }

  /** Transform key for writing: add salt if hot */
  writeKey(key: string): string {
    if (this.hotKeys.has(key)) {
      const salt = Math.floor(Math.random() * this.saltRange);
      return `${key}:salt:${salt}`;
    }
    return key;
  }

  /** Get all possible keys for reading (scatter) */
  readKeys(key: string): string[] {
    if (this.hotKeys.has(key)) {
      return Array.from({ length: this.saltRange }, (_, i) => `${key}:salt:${i}`);
    }
    return [key];
  }

  markHot(key: string): void {
    this.hotKeys.add(key);
  }

  markCold(key: string): void {
    this.hotKeys.delete(key);
  }
}
```
