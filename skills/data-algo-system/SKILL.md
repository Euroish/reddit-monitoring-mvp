---
name: data-algo-system
description: >-
  System design algorithm consultant — applies production-grade distributed systems
  patterns to your infrastructure. Use when building load balancers, rate limiters,
  caches, distributed databases, consensus systems, or any feature where system-level
  algorithm selection affects scalability, availability, or consistency. Also trigger
  when the user says "system design", "distributed", "load balancing", "rate limiting",
  "consistent hashing", "sharding", "replication", "consensus", "Bloom filter",
  "HyperLogLog", "分布式", "限流", "一致性哈希", "分片", "缓存策略",
  or describes a problem that maps to a classic system design pattern.
---

# Data-Algo-System: System Design Algorithm Consultant

Specialized branch of `data-algo` for infrastructure-level distributed systems patterns. Encodes algorithmic patterns from production systems documented in [karanpratapsingh/system-design](https://github.com/karanpratapsingh/system-design) and [ByteByteGoHq/system-design-101](https://github.com/ByteByteGoHq/system-design-101) as reusable standards for any infrastructure project.

Where `data-algo` handles general algorithm selection (sorting, searching, graph traversal, data structures), `data-algo-system` specializes in the six pillars that every distributed system eventually needs: load balancing, rate limiting, caching, data partitioning, consensus & replication, and probabilistic structures. The patterns here are derived from production-tested architectures and adapted with three scale tiers so they work whether you're handling 100 req/s or 1M+.

## Language Adaptation

Inherited from `data-algo`. All output matches the user's language. Technical terms (algorithm names, Big-O, code identifiers) stay in English regardless.

**System-design-specific Chinese mappings** (use when user writes in Chinese):

| English | Chinese |
|---------|---------|
| Distributed System | 分布式系统 |
| Load Balancing | 负载均衡 |
| Rate Limiting | 限流 |
| Consistent Hashing | 一致性哈希 |
| Sharding / Partitioning | 分片 / 分区 |
| Caching Strategy | 缓存策略 |
| Consensus Algorithm | 共识算法 |
| Replication | 数据复制 |
| Leader Election | 领导者选举 |
| Quorum | 法定人数 |
| Bloom Filter | 布隆过滤器 |
| HyperLogLog | 基数估计 |
| CAP Theorem | CAP 定理 |
| Eventual Consistency | 最终一致性 |
| Strong Consistency | 强一致性 |
| Availability | 可用性 |
| Partition Tolerance | 分区容错 |
| Throughput | 吞吐量 |
| Latency | 延迟 |
| Hot Spot | 热点 |
| Rebalancing | 再平衡 |
| Circuit Breaker | 熔断器 |
| Backpressure | 背压 |

These supplement the base `data-algo` Chinese templates (`## 诊断`, `## 推荐方案`, `## 已交付`, etc.). When generating reports, use these system-design-specific terms in section headers and descriptions.

## Knowledge Base

This skill is backed by 6 reference files covering the core algorithmic pillars of distributed system design. Each file covers one domain with detailed pattern entries, TypeScript implementations, and three scale tiers:

| Reference File | Source Systems | Covers |
|---------------|---------------|--------|
| `references/load-balancing.md` | karanpratapsingh/system-design, ByteByteGoHq/system-design-101 | Round-robin (basic, weighted), least connections, IP hash, consistent hashing with virtual nodes, rendezvous hashing |
| `references/rate-limiting.md` | karanpratapsingh/system-design, ByteByteGoHq/system-design-101 | Token bucket, leaky bucket, fixed window counter, sliding window log, sliding window counter |
| `references/caching-strategies.md` | karanpratapsingh/system-design, ByteByteGoHq/system-design-101 | Cache-aside, read-through, write-through, write-back, write-around, LRU/LFU eviction, TTL strategies, cache invalidation patterns |
| `references/data-partitioning.md` | karanpratapsingh/system-design, ByteByteGoHq/system-design-101 | Horizontal/vertical partitioning, hash-based/range-based/directory-based sharding, consistent hashing for sharding, rebalancing, hot spot mitigation |
| `references/consensus-replication.md` | karanpratapsingh/system-design, ByteByteGoHq/system-design-101 | Raft, Paxos, leader election (bully, ring), gossip protocol, vector clocks, CRDT, primary-replica, multi-leader, leaderless quorum |
| `references/probabilistic-structures.md` | karanpratapsingh/system-design, ByteByteGoHq/system-design-101 | Bloom filter, counting Bloom filter, cuckoo filter, Count-Min Sketch, HyperLogLog, skip list |

**Routing guide** -- read the reference(s) that match the user's problem:

- **Building a load balancer** (distributing traffic, server health, failover) -> `load-balancing.md`
- **Implementing rate limiting** (API throttling, DDoS protection, fair usage) -> `rate-limiting.md`
- **Designing a caching layer** (cache invalidation, eviction, consistency) -> `caching-strategies.md`
- **Sharding a database** (partition keys, rebalancing, cross-shard queries) -> `data-partitioning.md`
- **Building a distributed database** (replication, consensus, conflict resolution) -> `consensus-replication.md`
- **Approximate counting or membership testing** (Bloom filters, HyperLogLog, sketches) -> `probabilistic-structures.md`
- **Full system audit** (end-to-end infrastructure evaluation) -> read all 6, diagnose each layer

You don't need to load all 6 for every invocation. Pick the one(s) that match the user's immediate problem. For multi-layer projects, start with the bottleneck layer and expand outward.

## System Design Workflow

Same 4-phase structure adapted for infrastructure-level decisions. Every recommendation frames trade-offs in terms of CAP theorem (Consistency, Availability, Partition tolerance) and PACELC (Partition: Availability vs Consistency; Else: Latency vs Consistency).

### Phase 1: Diagnose

Read the code and infrastructure context. Identify:

1. **Bottleneck type** -- What is the primary constraint?
   - **Throughput** -- system cannot handle request volume
   - **Consistency** -- data diverges across nodes
   - **Latency** -- response times exceed SLA
   - **Availability** -- single points of failure
   - **Storage** -- data volume exceeds single-node capacity

2. **Scale tier** -- Current and target traffic profile:
   - **Hobby** (<1K req/s) -- single-node solutions are fine
   - **Growth** (1K-100K req/s) -- need distributed coordination
   - **Scale** (100K+ req/s) -- need production-grade distributed patterns

3. **CAP position** -- Which trade-off does this system need?
   - **CP** (Consistency + Partition tolerance) -- banking, inventory
   - **AP** (Availability + Partition tolerance) -- social feeds, analytics
   - **CA** (Consistency + Availability) -- single-datacenter, no partitions expected

4. **Pattern match** -- Which reference file solves this?

Present the diagnosis as:

```
## Diagnose

- Bottleneck: [throughput / consistency / latency / availability / storage]
- Scale tier: [hobby / growth / scale]
- Current: [what it does now] -> O(?) complexity
- CAP position: [CP / AP / CA]
- Target: [what it needs to achieve]
- Matched patterns: [reference file(s)]
```

### Phase 2: Recommend

Consult the matched reference file(s). Propose 2-3 approaches, each framed as a CAP/PACELC trade-off:

```
## Recommend

### Option A: [Name] -- Recommended (Scale tier: [hobby/growth/scale])
- Complexity: O(?) time / O(?) space
- CAP trade-off: [what you gain vs what you sacrifice]
- PACELC: [P: A/C; E: L/C]
- Why it fits: [connects to diagnosed bottleneck]
- Production precedent: [which systems use this]

### Option B: [Name] (Scale tier: [hobby/growth/scale])
- ...
```

Every recommendation should reference which production systems use the pattern and link to the relevant reference file. This grounds the recommendation in battle-tested infrastructure, not theory.

### Phase 3: Decide

Ask the user which approach, or proceed if one is clearly dominant. When the user has stated a preference for consistency vs availability, auto-select the matching approach and confirm.

### Phase 4: Ship

Implement the chosen pattern. TypeScript implementations with:

- Clear type definitions for configuration
- Error handling and edge cases
- Monitoring hooks (metrics emission points)
- Scale tier annotations (comments marking where to upgrade for next tier)

Profile cards use system-design-specific categories:

| Category | Use For |
|----------|---------|
| `system-load-balancing` | Traffic distribution patterns |
| `system-rate-limiting` | Throttling and fairness patterns |
| `system-caching` | Cache strategies and eviction |
| `system-partitioning` | Sharding and data distribution |
| `system-consensus` | Consensus, replication, conflict resolution |
| `system-probabilistic` | Approximate data structures for scale |

Profile card frontmatter example:

```yaml
---
algorithm: Consistent Hashing with Virtual Nodes
category: system-load-balancing
complexity_time: O(log N)
complexity_space: O(N * V)
used_in: src/lib/load-balancer.ts
date: 2026-03-26
cap_tradeoff: AP (availability + partition tolerance)
scale_tier: growth
---
```

## Scale Tier Reference

Every pattern in the reference files is annotated with three scale tiers. Use this to match recommendations to the user's actual traffic:

| Tier | Traffic | Typical Infra | Approach |
|------|---------|--------------|----------|
| **Hobby** | <1K req/s | Single node, in-memory | Simple implementations, no distribution overhead |
| **Growth** | 1K-100K req/s | 2-10 nodes, Redis/similar | Distributed coordination, eventual consistency acceptable |
| **Scale** | 100K+ req/s | 10+ nodes, dedicated infra | Production-grade distributed patterns, strong monitoring |

When the user's ambition exceeds their current scale, recommend the current-tier implementation with a clear graduation path. Document trigger points ("when you hit 10K req/s, switch from in-memory LRU to Redis-backed cache") in the profile card.

## Boundary Rules

### What belongs here (data-algo-system)

- HOW to distribute load across servers (load balancing algorithms)
- HOW to throttle requests at scale (rate limiting patterns)
- HOW to cache data across distributed nodes (caching strategies)
- HOW to partition data across machines (sharding algorithms)
- HOW to keep distributed copies consistent (consensus, replication)
- HOW to use approximate structures at system scale (Bloom filters for cache miss reduction, HyperLogLog for unique visitor counting)

### What belongs in data-algo core

- The data structure itself (hash map internals, linked list operations, tree rotations)
- Single-node algorithm optimization (sorting, searching, dynamic programming)
- Complexity analysis fundamentals

### Cross-references

When a system pattern relies on a core data structure, reference it:
- "LRU eviction uses a doubly-linked list + hash map -- see data-algo core for DS internals"
- "Consistent hashing uses a balanced BST for the ring -- see data-algo core for tree operations"
- "Skip list internals -- see data-algo core; system-level usage for concurrent indexing covered here"

Do not duplicate data structure implementations. Reference `data-algo` for the DS, then show the system-level wrapper here.

## Integration

### Parallel Activation

`data-algo-system` can be triggered alongside `data-algo` -- they complement, not conflict:

- `data-algo` handles general algorithmic questions (sorting, caching data structures, searching, graph traversal)
- `data-algo-system` handles infrastructure-level patterns (how to distribute, replicate, partition, and coordinate at scale)

When both are active on the same codebase, `data-algo` optimizes the implementation details (e.g., switching a linear scan to a hash lookup) while `data-algo-system` optimizes the architecture (e.g., adding a caching layer or switching from single-node to sharded storage).

### Visualization Compatibility

All viz templates from `data-algo-viz` work directly with system design profile cards. The JSON spec format is identical. System-specific panels can use:

- `BarChart` for comparing throughput across load balancing algorithms
- `Table` for displaying latency percentiles per caching strategy
- `Badge` for scale tier labels (hobby / growth / scale)
- `KeyValue` for CAP trade-off summaries

## Edge Cases

### Single-node projects

If the project runs on a single server with no distribution needs, most patterns here are premature. Recommend:
1. In-memory implementations from the Hobby tier
2. Document the graduation trigger to distributed patterns
3. Cross-reference `data-algo` core for single-node optimizations

### Cloud-managed services

When the user uses managed services (AWS ElastiCache, Cloud SQL, managed Kafka), the algorithm still matters for:
1. Choosing the right managed service configuration
2. Understanding the trade-offs the managed service makes
3. Client-side patterns (retry logic, circuit breakers, connection pooling)

### Hybrid consistency requirements

Some systems need strong consistency for writes but eventual consistency for reads (e.g., e-commerce inventory). Recommend:
1. Write path: synchronous replication or consensus (Raft/Paxos)
2. Read path: read replicas with acceptable staleness
3. Document the consistency boundary clearly in the profile card
