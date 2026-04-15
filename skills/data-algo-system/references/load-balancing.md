# Load Balancing — System Design Reference

Derived from karanpratapsingh/system-design and ByteByteGoHq/system-design-101.

---

## Quick Selection Guide

| Need | Pattern | Trade-off | Use When |
|------|---------|-----------|----------|
| Simplest possible distribution | Round-Robin | No server awareness | All servers identical, stateless requests |
| Heterogeneous server capacity | Weighted Round-Robin | Configuration overhead | Servers differ in CPU/RAM |
| Minimize response time | Least Connections | Health check overhead | Long-lived connections (WebSocket, DB) |
| Session affinity without cookies | IP Hash | Uneven distribution risk | Stateful services, sticky sessions |
| Dynamic cluster membership | Consistent Hashing | Implementation complexity | Cache clusters, sharded databases |
| Multi-site failover | Rendezvous Hashing | Higher per-request computation | CDN node selection, multi-datacenter routing |

---

## Detailed Entries

### Round-Robin

- **What**: Distributes requests to servers sequentially in rotation, cycling back to the first after reaching the last.
- **Complexity**: O(1) per routing decision
- **CAP Trade-off**: Not directly CAP-related; improves availability by spreading load
- **Use when**: All servers are identical in capacity; requests are stateless and roughly equal in cost
- **Avoid when**: Servers have different capacities; requests vary significantly in processing time; session affinity is needed
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Simple counter with modulo | Array of server addresses, index++ % length |
| **Growth** (1K-100K) | Nginx/HAProxy round-robin | Built-in health checks, automatic server removal |
| **Scale** (100K+) | L4 hardware LB + L7 software LB chain | DNS round-robin across L4 LBs, each L4 round-robins to L7 pool |

**TypeScript Implementation** (Hobby tier):
```typescript
class RoundRobinBalancer {
  private servers: string[];
  private current = 0;

  constructor(servers: string[]) {
    this.servers = servers;
  }

  next(): string {
    const server = this.servers[this.current];
    this.current = (this.current + 1) % this.servers.length;
    return server;
  }

  addServer(server: string): void {
    this.servers.push(server);
  }

  removeServer(server: string): void {
    this.servers = this.servers.filter(s => s !== server);
    if (this.current >= this.servers.length) {
      this.current = 0;
    }
  }
}
```

---

### Weighted Round-Robin

- **What**: Extends round-robin by assigning weights to servers proportional to their capacity, so more powerful servers receive more requests.
- **Complexity**: O(1) amortized per routing decision (O(N) initialization where N = number of servers)
- **CAP Trade-off**: Not directly CAP-related; improves resource utilization
- **Use when**: Servers have different CPU, memory, or network capacity; you want proportional load distribution without runtime metrics
- **Avoid when**: Server capacity changes dynamically; request costs vary significantly (use least-connections instead)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Expanded server list by weight | Simple but memory-proportional to total weight |
| **Growth** (1K-100K) | Nginx `weight` directive | `upstream backend { server a weight=3; server b weight=1; }` |
| **Scale** (100K+) | Smooth weighted round-robin (SWRR) | Nginx's actual algorithm; avoids burst to high-weight servers |

**TypeScript Implementation** (Hobby tier):
```typescript
interface WeightedServer {
  address: string;
  weight: number;
}

class WeightedRoundRobinBalancer {
  private servers: WeightedServer[];
  private currentWeights: number[];
  private totalWeight: number;

  constructor(servers: WeightedServer[]) {
    this.servers = servers;
    this.currentWeights = servers.map(() => 0);
    this.totalWeight = servers.reduce((sum, s) => sum + s.weight, 0);
  }

  /** Smooth Weighted Round-Robin (Nginx algorithm) */
  next(): string {
    let maxIdx = 0;
    for (let i = 0; i < this.servers.length; i++) {
      this.currentWeights[i] += this.servers[i].weight;
      if (this.currentWeights[i] > this.currentWeights[maxIdx]) {
        maxIdx = i;
      }
    }
    this.currentWeights[maxIdx] -= this.totalWeight;
    return this.servers[maxIdx].address;
  }
}
```

---

### Least Connections

- **What**: Routes each new request to the server currently handling the fewest active connections, accounting for server load dynamically.
- **Complexity**: O(N) per routing decision (scan all servers), or O(log N) with a min-heap
- **CAP Trade-off**: Not directly CAP-related; improves latency by avoiding overloaded servers
- **Use when**: Requests have highly variable processing times; long-lived connections (WebSocket, database pools, streaming); servers have similar capacity
- **Avoid when**: All requests are fast and uniform (round-robin is simpler); connection count is not a good proxy for load (CPU-bound workloads)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory connection counter per server | Simple Map<server, count> with linear scan |
| **Growth** (1K-100K) | HAProxy `leastconn` / Nginx `least_conn` | Built-in tracking with health checks |
| **Scale** (100K+) | Distributed connection tracking via shared state | Redis counters or gossip-based load sharing across LB nodes |

**TypeScript Implementation** (Hobby tier):
```typescript
class LeastConnectionsBalancer {
  private connections: Map<string, number>;
  private servers: string[];

  constructor(servers: string[]) {
    this.servers = servers;
    this.connections = new Map(servers.map(s => [s, 0]));
  }

  next(): string {
    let minServer = this.servers[0];
    let minCount = this.connections.get(minServer) ?? Infinity;

    for (const server of this.servers) {
      const count = this.connections.get(server) ?? 0;
      if (count < minCount) {
        minCount = count;
        minServer = server;
      }
    }

    this.connections.set(minServer, minCount + 1);
    return minServer;
  }

  release(server: string): void {
    const count = this.connections.get(server) ?? 0;
    this.connections.set(server, Math.max(0, count - 1));
  }

  addServer(server: string): void {
    this.servers.push(server);
    this.connections.set(server, 0);
  }

  removeServer(server: string): void {
    this.servers = this.servers.filter(s => s !== server);
    this.connections.delete(server);
  }
}
```

---

### IP Hash

- **What**: Hashes the client's IP address to deterministically route all requests from the same client to the same server, providing session affinity without cookies.
- **Complexity**: O(1) per routing decision (hash + modulo)
- **CAP Trade-off**: Not directly CAP-related; enables stateful services without external session stores
- **Use when**: Session affinity is needed (shopping carts, user sessions); no external session store available; stateful application servers
- **Avoid when**: Clients share IPs (NAT, corporate proxies) causing uneven distribution; server count changes frequently (causes mass reassignment); stateless services (unnecessary complexity)
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Simple hash modulo server count | `hash(ip) % servers.length` |
| **Growth** (1K-100K) | Nginx `ip_hash` directive | Automatic failover to next server on failure |
| **Scale** (100K+) | Consistent hashing (see below) | Avoids mass reassignment when servers change |

**TypeScript Implementation** (Hobby tier):
```typescript
class IpHashBalancer {
  private servers: string[];

  constructor(servers: string[]) {
    this.servers = servers;
  }

  /** FNV-1a hash for consistent string hashing */
  private hash(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
  }

  next(clientIp: string): string {
    const index = this.hash(clientIp) % this.servers.length;
    return this.servers[index];
  }
}
```

---

### Consistent Hashing (with Virtual Nodes)

- **What**: Maps both servers and request keys onto a circular hash ring. Each key is assigned to the nearest server clockwise on the ring. Virtual nodes (vnodes) ensure even distribution by mapping each physical server to multiple ring positions.
- **Complexity**: O(log N) per lookup (binary search on sorted ring positions), O(N * V) space where V = virtual nodes per server
- **CAP Trade-off**: AP-leaning; enables partition-tolerant data distribution with minimal key reassignment during node changes. Only K/N keys need remapping when a node joins or leaves (vs K keys with modulo hashing).
- **Use when**: Cache clusters (Memcached, Redis) where key reassignment is expensive; sharded databases with dynamic membership; any system where nodes join/leave frequently
- **Avoid when**: Cluster is static and small (simple modulo hashing is easier); all data fits on one node; strong ordering guarantees needed across partitions
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory sorted array + binary search | 100-150 vnodes per server is a good default |
| **Growth** (1K-100K) | Library-backed (e.g., `hashring` npm) with health checks | Auto-remove failed nodes, rebalance on topology change |
| **Scale** (100K+) | Production ring (Cassandra/DynamoDB-style) with token ranges | Hardware-aware placement, rack/zone-aware vnodes, anti-entropy repair |

**TypeScript Implementation** (Hobby tier):
```typescript
import { createHash } from 'crypto';

class ConsistentHashRing {
  private ring: Map<number, string> = new Map();
  private sortedKeys: number[] = [];
  private vnodeCount: number;

  constructor(vnodeCount = 150) {
    this.vnodeCount = vnodeCount;
  }

  private hash(key: string): number {
    const h = createHash('md5').update(key).digest();
    return h.readUInt32BE(0);
  }

  addNode(node: string): void {
    for (let i = 0; i < this.vnodeCount; i++) {
      const vnodeKey = this.hash(`${node}:${i}`);
      this.ring.set(vnodeKey, node);
      this.sortedKeys.push(vnodeKey);
    }
    this.sortedKeys.sort((a, b) => a - b);
  }

  removeNode(node: string): void {
    for (let i = 0; i < this.vnodeCount; i++) {
      const vnodeKey = this.hash(`${node}:${i}`);
      this.ring.delete(vnodeKey);
    }
    this.sortedKeys = this.sortedKeys.filter(k => this.ring.has(k));
  }

  getNode(key: string): string | undefined {
    if (this.sortedKeys.length === 0) return undefined;

    const hash = this.hash(key);

    // Binary search for the first ring position >= hash
    let low = 0;
    let high = this.sortedKeys.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.sortedKeys[mid] < hash) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    // Wrap around to the first node if past the end
    const index = low % this.sortedKeys.length;
    return this.ring.get(this.sortedKeys[index]);
  }

  /** Returns N distinct nodes for replication */
  getNodes(key: string, count: number): string[] {
    if (this.sortedKeys.length === 0) return [];

    const hash = this.hash(key);
    const nodes = new Set<string>();

    let low = 0;
    let high = this.sortedKeys.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.sortedKeys[mid] < hash) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    let idx = low;
    while (nodes.size < count && nodes.size < this.ring.size) {
      const ringIdx = idx % this.sortedKeys.length;
      const node = this.ring.get(this.sortedKeys[ringIdx])!;
      nodes.add(node);
      idx++;
    }

    return Array.from(nodes);
  }
}
```

---

### Rendezvous Hashing (Highest Random Weight)

- **What**: For each key, computes a weighted hash against every server and picks the server with the highest score. Unlike consistent hashing, no ring structure is needed -- each key independently selects its server.
- **Complexity**: O(N) per lookup (must hash against all N servers), O(1) space per lookup
- **CAP Trade-off**: AP-leaning; like consistent hashing, only keys assigned to a departing server need remapping
- **Use when**: CDN node selection; multi-datacenter routing where you want deterministic failover order; small to medium server counts (<100) where O(N) per lookup is acceptable
- **Avoid when**: Very large server counts (>1000) where O(N) per lookup becomes expensive; high-throughput hot paths where O(log N) consistent hashing is preferred
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Simple loop over all servers with hash comparison | Straightforward, no ring maintenance |
| **Growth** (1K-100K) | Weighted rendezvous with server capacity scores | Multiply hash by server weight for heterogeneous clusters |
| **Scale** (100K+) | Skeleton-based rendezvous (top-K precomputation) | Precompute top candidates per key prefix to amortize O(N) cost |

**TypeScript Implementation** (Hobby tier):
```typescript
import { createHash } from 'crypto';

class RendezvousHashBalancer {
  private servers: string[];

  constructor(servers: string[]) {
    this.servers = servers;
  }

  private score(server: string, key: string): number {
    const h = createHash('md5').update(`${server}:${key}`).digest();
    return h.readUInt32BE(0);
  }

  getNode(key: string): string | undefined {
    if (this.servers.length === 0) return undefined;

    let bestServer = this.servers[0];
    let bestScore = this.score(bestServer, key);

    for (let i = 1; i < this.servers.length; i++) {
      const s = this.score(this.servers[i], key);
      if (s > bestScore) {
        bestScore = s;
        bestServer = this.servers[i];
      }
    }

    return bestServer;
  }

  /** Returns servers ranked by score (deterministic failover order) */
  getRankedNodes(key: string): string[] {
    return [...this.servers].sort(
      (a, b) => this.score(b, key) - this.score(a, key)
    );
  }

  addServer(server: string): void {
    this.servers.push(server);
  }

  removeServer(server: string): void {
    this.servers = this.servers.filter(s => s !== server);
  }
}
```
