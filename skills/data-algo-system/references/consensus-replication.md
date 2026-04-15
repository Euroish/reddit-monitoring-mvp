# Consensus & Replication — System Design Reference

Derived from karanpratapsingh/system-design and ByteByteGoHq/system-design-101.

---

## Quick Selection Guide

| Need | Pattern | Trade-off | Use When |
|------|---------|-----------|----------|
| Understandable strong consensus | Raft | CP: blocks during leader election | Metadata stores, config management, leader election |
| Proven theoretical consensus | Paxos (Basic) | Complex to implement correctly | Foundational understanding; rarely implemented directly |
| Practical multi-value consensus | Multi-Paxos | CP: high message overhead | Google Spanner, Chubby; when you need Paxos semantics |
| Simple leader election | Bully Algorithm | Highest-ID node always wins | Small clusters with clear node ranking |
| Decentralized leader election | Ring Algorithm | O(N) messages per election | Token-ring networks, ordered node topologies |
| Peer-to-peer state propagation | Gossip Protocol | Eventual consistency, convergence delay | Cluster membership, failure detection, metrics aggregation |
| Causality tracking | Vector Clocks | O(N) space per event (N = nodes) | Conflict detection in multi-leader/leaderless replication |
| Conflict-free merging | CRDT | Limited data types, higher space cost | Collaborative editing, offline-first apps, counters |
| Simple read scaling | Primary-Replica | Replication lag, write bottleneck at primary | Read-heavy workloads, reporting replicas |
| Write scaling + availability | Multi-Leader | Conflict resolution complexity | Multi-datacenter, offline-capable clients |
| Maximum availability | Leaderless (Quorum) | Tunable consistency via R + W > N | Dynamo-style DBs (Cassandra, Riak, DynamoDB) |

---

## Detailed Entries

### Raft

- **What**: A consensus algorithm designed for understandability. Elects a single leader that manages log replication to followers. Guarantees safety (never returns incorrect result) as long as a majority of nodes are alive.
- **Complexity**: O(1) per committed entry (leader appends, followers replicate); O(N) messages per heartbeat round
- **CAP Trade-off**: CP -- strong consistency through leader-based log replication; unavailable during leader election (typically 150-300ms)
- **Use when**: Distributed metadata stores (etcd, Consul); leader election for stateful services; replicated state machines; any system needing strong consistency with understandable semantics
- **Avoid when**: Availability during network partitions is more important than consistency; very large clusters (>7 nodes, Raft doesn't scale well); write throughput is the primary bottleneck (single leader is the bottleneck)
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Key Concepts

| Concept | Description |
|---------|-------------|
| **Term** | Monotonically increasing election epoch; each term has at most one leader |
| **Leader** | Handles all client requests; replicates log entries to followers |
| **Candidate** | Node seeking election; requests votes from peers |
| **Follower** | Passive; responds to leader RPCs and candidate vote requests |
| **Log replication** | Leader appends entry, sends to followers, commits when majority acknowledges |
| **Election timeout** | Randomized timer (150-300ms); follower becomes candidate if no heartbeat received |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Single Raft group with 3 nodes | Sufficient for config management, leader election |
| **Growth** (1K-100K) | Multi-Raft with sharded groups | Each shard has its own Raft group (TiKV approach) |
| **Scale** (100K+) | Multi-Raft + pipelining + batching | Pipeline log replication; batch entries; parallel apply |

**TypeScript Implementation** (Hobby tier):
```typescript
type NodeState = 'follower' | 'candidate' | 'leader';

interface LogEntry {
  term: number;
  index: number;
  command: string;
}

interface RaftNode {
  id: string;
  state: NodeState;
  currentTerm: number;
  votedFor: string | null;
  log: LogEntry[];
  commitIndex: number;
  lastApplied: number;
}

class SimpleRaftNode {
  private node: RaftNode;
  private peers: string[];
  private electionTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private onSendMessage: (to: string, msg: RaftMessage) => void;

  constructor(
    id: string,
    peers: string[],
    onSendMessage: (to: string, msg: RaftMessage) => void
  ) {
    this.node = {
      id,
      state: 'follower',
      currentTerm: 0,
      votedFor: null,
      log: [],
      commitIndex: -1,
      lastApplied: -1,
    };
    this.peers = peers;
    this.onSendMessage = onSendMessage;
    this.resetElectionTimeout();
  }

  private resetElectionTimeout(): void {
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    // Randomized timeout: 150-300ms
    const timeout = 150 + Math.random() * 150;
    this.electionTimeout = setTimeout(() => this.startElection(), timeout);
  }

  private startElection(): void {
    this.node.state = 'candidate';
    this.node.currentTerm++;
    this.node.votedFor = this.node.id;
    let votesReceived = 1; // Vote for self

    const lastLog = this.node.log[this.node.log.length - 1];
    for (const peer of this.peers) {
      this.onSendMessage(peer, {
        type: 'requestVote',
        term: this.node.currentTerm,
        candidateId: this.node.id,
        lastLogIndex: lastLog?.index ?? -1,
        lastLogTerm: lastLog?.term ?? 0,
      });
    }

    // In real implementation, collect votes asynchronously
    // Become leader if majority votes received
  }

  private becomeLeader(): void {
    this.node.state = 'leader';
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    // Send heartbeats to all peers
    this.heartbeatInterval = setInterval(() => {
      for (const peer of this.peers) {
        this.onSendMessage(peer, {
          type: 'appendEntries',
          term: this.node.currentTerm,
          leaderId: this.node.id,
          entries: [],
          leaderCommit: this.node.commitIndex,
        });
      }
    }, 50); // Heartbeat every 50ms
  }

  /** Append a new command (only if leader) */
  propose(command: string): boolean {
    if (this.node.state !== 'leader') return false;
    const entry: LogEntry = {
      term: this.node.currentTerm,
      index: this.node.log.length,
      command,
    };
    this.node.log.push(entry);
    // In real implementation: replicate to followers, commit when majority acknowledges
    return true;
  }

  get state(): NodeState {
    return this.node.state;
  }

  get term(): number {
    return this.node.currentTerm;
  }

  destroy(): void {
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }
}

type RaftMessage =
  | { type: 'requestVote'; term: number; candidateId: string; lastLogIndex: number; lastLogTerm: number }
  | { type: 'appendEntries'; term: number; leaderId: string; entries: LogEntry[]; leaderCommit: number };
```

---

### Paxos (Basic)

- **What**: A consensus protocol that allows a group of nodes to agree on a single value despite failures. Uses three roles: Proposers (propose values), Acceptors (vote on proposals), and Learners (learn the chosen value). Two phases: Prepare and Accept.
- **Complexity**: O(N) messages per consensus round (N = number of acceptors)
- **CAP Trade-off**: CP -- guarantees agreement (safety) as long as a majority of acceptors are alive; sacrifices availability during insufficient quorum
- **Use when**: Understanding foundational consensus theory; systems that require single-value agreement; as the basis for Multi-Paxos
- **Avoid when**: Practically always prefer Raft for new implementations (equivalent guarantees, much simpler); Paxos is notoriously difficult to implement correctly
- **Source**: karanpratapsingh/system-design

#### Key Concepts

| Concept | Description |
|---------|-------------|
| **Proposer** | Initiates consensus by sending Prepare requests with a proposal number |
| **Acceptor** | Votes on proposals; promises not to accept lower-numbered proposals |
| **Learner** | Learns the chosen value after a majority of acceptors agree |
| **Prepare phase** | Proposer sends proposal number N; acceptors promise not to accept < N |
| **Accept phase** | Proposer sends value with number N; acceptors accept if no higher promise |
| **Majority quorum** | Agreement requires > N/2 acceptors |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Use Raft instead | Paxos is unnecessarily complex for small systems |
| **Growth** (1K-100K) | Library-backed Paxos (if required by existing system) | Google Chubby uses Paxos internally |
| **Scale** (100K+) | Multi-Paxos with leader optimization | Stable leader skips Prepare phase; used in Spanner |

**TypeScript Implementation** (Hobby tier -- educational):
```typescript
interface PaxosProposal {
  number: number;
  value: string | null;
}

class PaxosAcceptor {
  private promisedNumber = -1;
  private acceptedProposal: PaxosProposal | null = null;

  /** Phase 1: Prepare -- promise not to accept lower proposals */
  prepare(proposalNumber: number): { promised: boolean; accepted: PaxosProposal | null } {
    if (proposalNumber > this.promisedNumber) {
      this.promisedNumber = proposalNumber;
      return { promised: true, accepted: this.acceptedProposal };
    }
    return { promised: false, accepted: null };
  }

  /** Phase 2: Accept -- accept if no higher promise */
  accept(proposal: PaxosProposal): boolean {
    if (proposal.number >= this.promisedNumber) {
      this.promisedNumber = proposal.number;
      this.acceptedProposal = proposal;
      return true;
    }
    return false;
  }
}

class PaxosProposer {
  private acceptors: PaxosAcceptor[];
  private proposalCounter = 0;

  constructor(acceptors: PaxosAcceptor[]) {
    this.acceptors = acceptors;
  }

  private get majority(): number {
    return Math.floor(this.acceptors.length / 2) + 1;
  }

  propose(value: string): string | null {
    const proposalNumber = ++this.proposalCounter;

    // Phase 1: Prepare
    const promises = this.acceptors.map(a => a.prepare(proposalNumber));
    const promisedCount = promises.filter(p => p.promised).length;
    if (promisedCount < this.majority) return null; // Failed to get majority

    // Use the value from the highest-numbered accepted proposal (if any)
    const highestAccepted = promises
      .filter(p => p.accepted)
      .sort((a, b) => (b.accepted?.number ?? 0) - (a.accepted?.number ?? 0))[0];

    const proposedValue = highestAccepted?.accepted?.value ?? value;

    // Phase 2: Accept
    const proposal: PaxosProposal = { number: proposalNumber, value: proposedValue };
    const acceptedCount = this.acceptors.filter(a => a.accept(proposal)).length;

    if (acceptedCount >= this.majority) {
      return proposedValue; // Consensus reached
    }
    return null; // Failed
  }
}
```

---

### Leader Election (Bully Algorithm)

- **What**: When a leader failure is detected, any node can initiate an election. The node with the highest ID always wins. Lower-ID nodes yield to higher-ID challengers.
- **Complexity**: O(N^2) messages in the worst case (every node challenges every higher node)
- **CAP Trade-off**: CP during election (system may be briefly unavailable); deterministic leader selection based on node ID
- **Use when**: Small clusters (<10 nodes) with clear node ranking; simple leader election without consensus overhead; nodes have comparable capability
- **Avoid when**: Large clusters (message overhead); node IDs don't correlate with capability; network partitions are frequent (can produce split brain)
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory bully election with 3-5 nodes | Direct message passing between nodes |
| **Growth** (1K-100K) | ZooKeeper/etcd-based leader election | Use built-in primitives (ephemeral nodes, leases) |
| **Scale** (100K+) | Raft-based leader election | Subsumes bully algorithm with stronger guarantees |

**TypeScript Implementation** (Hobby tier):
```typescript
class BullyElection {
  private nodeId: number;
  private allNodeIds: number[];
  private leaderId: number | null = null;
  private onMessage: (targetId: number, msg: ElectionMessage) => void;

  constructor(
    nodeId: number,
    allNodeIds: number[],
    onMessage: (targetId: number, msg: ElectionMessage) => void
  ) {
    this.nodeId = nodeId;
    this.allNodeIds = allNodeIds.sort((a, b) => a - b);
    this.onMessage = onMessage;
  }

  /** Initiate election when leader failure detected */
  startElection(): void {
    const higherNodes = this.allNodeIds.filter(id => id > this.nodeId);

    if (higherNodes.length === 0) {
      // This node has the highest ID; declare self as leader
      this.declareLeader();
      return;
    }

    // Send election message to all higher-ID nodes
    for (const id of higherNodes) {
      this.onMessage(id, { type: 'election', fromId: this.nodeId });
    }

    // If no response within timeout, declare self as leader
    setTimeout(() => {
      if (this.leaderId === null) {
        this.declareLeader();
      }
    }, 1000);
  }

  private declareLeader(): void {
    this.leaderId = this.nodeId;
    // Announce to all nodes
    for (const id of this.allNodeIds) {
      if (id !== this.nodeId) {
        this.onMessage(id, { type: 'coordinator', leaderId: this.nodeId });
      }
    }
  }

  handleMessage(msg: ElectionMessage): void {
    if (msg.type === 'election') {
      // Respond to lower-ID node that we're alive
      this.onMessage(msg.fromId, { type: 'alive', fromId: this.nodeId });
      // Start our own election
      this.startElection();
    } else if (msg.type === 'coordinator') {
      this.leaderId = msg.leaderId;
    }
  }

  get currentLeader(): number | null {
    return this.leaderId;
  }
}

type ElectionMessage =
  | { type: 'election'; fromId: number }
  | { type: 'alive'; fromId: number }
  | { type: 'coordinator'; leaderId: number };
```

---

### Leader Election (Ring Algorithm)

- **What**: Nodes are arranged in a logical ring. A node detects leader failure and passes an election message around the ring. Each node appends its ID. When the message returns to the initiator, the highest ID wins.
- **Complexity**: O(N) messages per election (one full traversal of the ring)
- **CAP Trade-off**: CP during election; deterministic but slower than bully for small clusters
- **Use when**: Token-ring network topologies; systems where nodes are arranged in a logical order; lower message overhead than bully algorithm for large rings
- **Avoid when**: Ring topology is not natural for the system; quick elections are needed (ring traversal adds latency); ring breaks easily on node failure
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory ring with direct connections | Each node knows its successor |
| **Growth** (1K-100K) | Use Raft or ZooKeeper instead | Ring election is rarely used in modern distributed systems |
| **Scale** (100K+) | Not recommended | Use Raft for production leader election |

**TypeScript Implementation** (Hobby tier):
```typescript
class RingElection {
  private nodeId: number;
  private successor: number; // Next node in ring
  private allNodeIds: number[];
  private leaderId: number | null = null;
  private onSend: (targetId: number, msg: RingMessage) => void;

  constructor(
    nodeId: number,
    allNodeIds: number[],
    onSend: (targetId: number, msg: RingMessage) => void
  ) {
    this.nodeId = nodeId;
    this.allNodeIds = allNodeIds.sort((a, b) => a - b);
    const myIndex = this.allNodeIds.indexOf(nodeId);
    this.successor = this.allNodeIds[(myIndex + 1) % this.allNodeIds.length];
    this.onSend = onSend;
  }

  startElection(): void {
    this.onSend(this.successor, {
      type: 'election',
      candidates: [this.nodeId],
      initiator: this.nodeId,
    });
  }

  handleMessage(msg: RingMessage): void {
    if (msg.type === 'election') {
      if (msg.candidates.includes(this.nodeId)) {
        // Message has gone full circle; elect the highest ID
        const leader = Math.max(...msg.candidates);
        this.leaderId = leader;
        this.onSend(this.successor, { type: 'elected', leaderId: leader });
      } else {
        // Add self and forward
        msg.candidates.push(this.nodeId);
        this.onSend(this.successor, msg);
      }
    } else if (msg.type === 'elected') {
      this.leaderId = msg.leaderId;
      // Forward until it reaches the leader
      if (msg.leaderId !== this.nodeId) {
        this.onSend(this.successor, msg);
      }
    }
  }

  get currentLeader(): number | null {
    return this.leaderId;
  }
}

type RingMessage =
  | { type: 'election'; candidates: number[]; initiator: number }
  | { type: 'elected'; leaderId: number };
```

---

### Gossip Protocol

- **What**: A peer-to-peer communication protocol where each node periodically picks a random peer and exchanges state information. State propagates epidemically through the cluster, eventually reaching all nodes.
- **Complexity**: O(log N) rounds for information to reach all N nodes (epidemic convergence); O(1) per gossip round per node (fixed fan-out)
- **CAP Trade-off**: AP -- high availability, eventual consistency; no single point of failure. State may be temporarily inconsistent across nodes.
- **Use when**: Cluster membership and failure detection; distributed metrics aggregation; eventually consistent state sharing; systems where nodes join/leave frequently
- **Avoid when**: Strong consistency is required; state changes must propagate immediately; very small clusters (<3 nodes) where broadcast is simpler
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Gossip Variants

| Variant | How It Works |
|---------|-------------|
| **Push** | Node sends its state to random peer |
| **Pull** | Node requests state from random peer |
| **Push-Pull** | Both directions; fastest convergence |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory gossip with 3-5 nodes | Periodic timer picks random peer, exchanges full state |
| **Growth** (1K-100K) | Library-backed (Memberlist, SWIM) | Optimized failure detection, compressed state transfer |
| **Scale** (100K+) | Gossip + digest (Cassandra-style) | Exchange digests first, then only transfer deltas |

**TypeScript Implementation** (Hobby tier):
```typescript
interface GossipState {
  [key: string]: { value: unknown; version: number };
}

class GossipNode {
  private nodeId: string;
  private state: GossipState = {};
  private peers: string[];
  private gossipInterval: ReturnType<typeof setInterval> | null = null;
  private onSend: (peerId: string, state: GossipState) => void;

  constructor(
    nodeId: string,
    peers: string[],
    onSend: (peerId: string, state: GossipState) => void
  ) {
    this.nodeId = nodeId;
    this.peers = peers;
    this.onSend = onSend;
  }

  start(intervalMs = 1000): void {
    this.gossipInterval = setInterval(() => this.gossipRound(), intervalMs);
  }

  stop(): void {
    if (this.gossipInterval) clearInterval(this.gossipInterval);
  }

  /** Set local state (will propagate via gossip) */
  set(key: string, value: unknown): void {
    const existing = this.state[key];
    this.state[key] = {
      value,
      version: (existing?.version ?? 0) + 1,
    };
  }

  get(key: string): unknown | undefined {
    return this.state[key]?.value;
  }

  /** Merge incoming state (keep higher versions) */
  handleGossip(remoteState: GossipState): void {
    for (const [key, remote] of Object.entries(remoteState)) {
      const local = this.state[key];
      if (!local || remote.version > local.version) {
        this.state[key] = remote;
      }
    }
  }

  private gossipRound(): void {
    if (this.peers.length === 0) return;
    // Pick a random peer
    const peer = this.peers[Math.floor(Math.random() * this.peers.length)];
    // Push-Pull: send our state, receive theirs (handled by handleGossip)
    this.onSend(peer, { ...this.state });
  }

  getFullState(): GossipState {
    return { ...this.state };
  }
}
```

---

### Vector Clocks

- **What**: A vector of logical timestamps, one per node in the system. Each node increments its own counter on every event. Used to determine causal ordering and detect concurrent events (potential conflicts).
- **Complexity**: O(N) per comparison and merge (N = number of nodes); O(N) space per event
- **CAP Trade-off**: Enables conflict detection in AP systems; does not resolve conflicts (application must decide). Used in leaderless replication to detect write-write conflicts.
- **Use when**: Multi-leader or leaderless replication where conflicts must be detected; Dynamo-style databases; any system needing causal ordering without a central clock
- **Avoid when**: Single-leader replication (no concurrent writes); N is very large (space per event grows linearly); simple last-writer-wins is acceptable
- **Source**: karanpratapsingh/system-design

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory vector clock per data item | Map<nodeId, counter> attached to each value |
| **Growth** (1K-100K) | Dotted version vectors (Riak-style) | Compressed representation; prune inactive nodes |
| **Scale** (100K+) | Hybrid logical clocks (HLC) | Combines physical time + logical counter; bounded space |

**TypeScript Implementation** (Hobby tier):
```typescript
class VectorClock {
  private clock: Map<string, number>;

  constructor(initial?: Map<string, number>) {
    this.clock = new Map(initial ?? []);
  }

  /** Increment this node's counter */
  increment(nodeId: string): VectorClock {
    const newClock = new Map(this.clock);
    newClock.set(nodeId, (newClock.get(nodeId) ?? 0) + 1);
    return new VectorClock(newClock);
  }

  /** Merge two vector clocks (take max of each component) */
  merge(other: VectorClock): VectorClock {
    const merged = new Map(this.clock);
    for (const [nodeId, counter] of other.clock) {
      merged.set(nodeId, Math.max(merged.get(nodeId) ?? 0, counter));
    }
    return new VectorClock(merged);
  }

  /** Returns true if this clock happened-before other */
  happenedBefore(other: VectorClock): boolean {
    let atLeastOneLess = false;
    for (const [nodeId, counter] of this.clock) {
      const otherCounter = other.clock.get(nodeId) ?? 0;
      if (counter > otherCounter) return false;
      if (counter < otherCounter) atLeastOneLess = true;
    }
    // Check if other has nodes not in this clock
    for (const [nodeId] of other.clock) {
      if (!this.clock.has(nodeId)) atLeastOneLess = true;
    }
    return atLeastOneLess;
  }

  /** Returns true if the two clocks are concurrent (neither happened-before the other) */
  isConcurrentWith(other: VectorClock): boolean {
    return !this.happenedBefore(other) && !other.happenedBefore(this);
  }

  toString(): string {
    const entries = Array.from(this.clock.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`);
    return `[${entries.join(', ')}]`;
  }
}
```

---

### CRDT (Conflict-free Replicated Data Type)

- **What**: Data structures that can be replicated across multiple nodes, updated independently, and merged automatically without conflicts. The merge operation is mathematically guaranteed to converge to the same state.
- **Complexity**: Varies by CRDT type; typically O(1) per operation, O(N) per merge (N = nodes or operations)
- **CAP Trade-off**: AP -- strong eventual consistency without coordination. Nodes can operate independently during partitions and converge when reconnected.
- **Use when**: Collaborative editing (Google Docs-style); offline-first mobile apps; distributed counters and sets; any system needing conflict-free merges
- **Avoid when**: Application logic requires sequential operations (CRDTs are commutative); complex invariants that CRDTs cannot express; simpler conflict resolution (last-writer-wins) is sufficient
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Common CRDT Types

| Type | Description | Merge Rule |
|------|-------------|------------|
| **G-Counter** | Grow-only counter | Sum of per-node counters |
| **PN-Counter** | Increment/decrement counter | G-Counter for increments + G-Counter for decrements |
| **G-Set** | Grow-only set | Union |
| **OR-Set** | Observed-Remove set | Add wins over concurrent remove |
| **LWW-Register** | Last-Writer-Wins register | Highest timestamp wins |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory CRDT with manual sync | Periodic merge between 2-3 nodes |
| **Growth** (1K-100K) | Library-backed (Yjs, Automerge) | Handles CRDT internals; focus on application logic |
| **Scale** (100K+) | Database-native CRDTs (Riak, Redis CRDT) | Managed CRDT types with built-in replication |

**TypeScript Implementation** (Hobby tier):
```typescript
/** G-Counter: Grow-only distributed counter */
class GCounter {
  private counters: Map<string, number>;

  constructor(initial?: Map<string, number>) {
    this.counters = new Map(initial ?? []);
  }

  increment(nodeId: string, amount = 1): void {
    this.counters.set(nodeId, (this.counters.get(nodeId) ?? 0) + amount);
  }

  value(): number {
    let sum = 0;
    for (const count of this.counters.values()) sum += count;
    return sum;
  }

  merge(other: GCounter): GCounter {
    const merged = new Map(this.counters);
    for (const [nodeId, count] of other.counters) {
      merged.set(nodeId, Math.max(merged.get(nodeId) ?? 0, count));
    }
    return new GCounter(merged);
  }
}

/** PN-Counter: Increment/decrement distributed counter */
class PNCounter {
  private positive: GCounter;
  private negative: GCounter;

  constructor(positive?: GCounter, negative?: GCounter) {
    this.positive = positive ?? new GCounter();
    this.negative = negative ?? new GCounter();
  }

  increment(nodeId: string, amount = 1): void {
    this.positive.increment(nodeId, amount);
  }

  decrement(nodeId: string, amount = 1): void {
    this.negative.increment(nodeId, amount);
  }

  value(): number {
    return this.positive.value() - this.negative.value();
  }

  merge(other: PNCounter): PNCounter {
    return new PNCounter(
      this.positive.merge(other.positive),
      this.negative.merge(other.negative)
    );
  }
}

/** OR-Set: Observed-Remove Set (add-wins semantics) */
class ORSet<T> {
  private elements: Map<string, Set<string>> = new Map(); // value -> set of unique tags
  private tombstones: Set<string> = new Set(); // removed tags

  add(value: T, nodeId: string): void {
    const key = String(value);
    const tag = `${nodeId}:${Date.now()}:${Math.random()}`;
    if (!this.elements.has(key)) {
      this.elements.set(key, new Set());
    }
    this.elements.get(key)!.add(tag);
  }

  remove(value: T): void {
    const key = String(value);
    const tags = this.elements.get(key);
    if (tags) {
      for (const tag of tags) {
        this.tombstones.add(tag);
      }
      this.elements.delete(key);
    }
  }

  has(value: T): boolean {
    const key = String(value);
    const tags = this.elements.get(key);
    if (!tags) return false;
    // Remove tombstoned tags
    for (const tag of tags) {
      if (this.tombstones.has(tag)) tags.delete(tag);
    }
    return tags.size > 0;
  }

  values(): T[] {
    const result: T[] = [];
    for (const [key, tags] of this.elements) {
      const liveTags = new Set([...tags].filter(t => !this.tombstones.has(t)));
      if (liveTags.size > 0) result.push(key as unknown as T);
    }
    return result;
  }
}
```

---

### Primary-Replica Replication

- **What**: A single primary (master) node handles all writes. One or more replica (slave) nodes asynchronously replicate the primary's changes and serve read traffic. This scales reads linearly with replica count.
- **Complexity**: O(1) per write (to primary); O(R) replication delay where R = number of replicas
- **CAP Trade-off**: Async replication: AP (high availability, stale reads possible). Sync replication: CP (consistent reads, lower availability).
- **Use when**: Read-heavy workloads (>90% reads); read scaling without write scaling; reporting replicas that don't impact production writes
- **Avoid when**: Write-heavy workloads (primary is bottleneck); strong read-after-write consistency is required (replication lag); multi-region with low-latency writes in all regions
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Single primary + 1 read replica | PostgreSQL streaming replication or MySQL binlog replication |
| **Growth** (1K-100K) | Primary + 3-5 replicas with connection routing | Read/write splitting at application or proxy layer (PgBouncer, ProxySQL) |
| **Scale** (100K+) | Primary + cascading replicas + cross-region replicas | Cascading prevents primary from being overwhelmed by replication connections |

**TypeScript Implementation** (Hobby tier):
```typescript
interface ReplicaConfig {
  id: string;
  isPrimary: boolean;
}

class PrimaryReplicaRouter {
  private primary: string;
  private replicas: string[];
  private currentReplica = 0;

  constructor(primary: string, replicas: string[]) {
    this.primary = primary;
    this.replicas = replicas;
  }

  /** Route write to primary */
  getWriteTarget(): string {
    return this.primary;
  }

  /** Route read to replica (round-robin) */
  getReadTarget(): string {
    if (this.replicas.length === 0) return this.primary;
    const target = this.replicas[this.currentReplica];
    this.currentReplica = (this.currentReplica + 1) % this.replicas.length;
    return target;
  }

  /** Route read-after-write to primary for consistency */
  getConsistentReadTarget(): string {
    return this.primary;
  }

  promoteReplica(replicaId: string): void {
    this.replicas = this.replicas.filter(r => r !== replicaId);
    this.primary = replicaId;
  }
}
```

---

### Multi-Leader Replication

- **What**: Multiple nodes accept writes independently. Each leader replicates its changes to all other leaders. Conflict resolution is needed when the same data is modified on different leaders concurrently.
- **Complexity**: O(L) replication per write (L = number of leaders); conflict resolution cost depends on strategy
- **CAP Trade-off**: AP -- high availability (writes succeed even during partitions between leaders), but conflicts must be resolved (eventual consistency)
- **Use when**: Multi-datacenter deployments (each DC has a local leader); offline-capable clients (each client is a leader); collaborative editing
- **Avoid when**: Strong consistency is required (conflict resolution is complex); single-datacenter deployment (unnecessary complexity); conflict resolution logic is too domain-specific
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Conflict Resolution Strategies

| Strategy | How It Works | Trade-off |
|----------|-------------|-----------|
| **Last-Writer-Wins (LWW)** | Highest timestamp wins | Simple but loses concurrent writes |
| **Custom merge function** | Application-specific merge logic | Most correct but most complex |
| **CRDT** | Conflict-free data types that auto-merge | Limited data types but no conflicts |
| **Operational Transform (OT)** | Transform concurrent operations against each other | Complex but handles text editing well |

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | Not recommended | Use primary-replica instead; multi-leader adds unnecessary complexity |
| **Growth** (1K-100K) | 2-3 leaders across datacenters with LWW | MySQL Group Replication, PostgreSQL BDR |
| **Scale** (100K+) | Multi-leader with CRDTs or custom conflict resolution | CockroachDB (multi-active), Cassandra with LWW timestamps |

---

### Leaderless Replication (Quorum Reads/Writes)

- **What**: No designated leader. Any node can accept reads and writes. Consistency is tuned through quorum parameters: W (write quorum), R (read quorum), N (replication factor). As long as R + W > N, the reader is guaranteed to see the most recent write.
- **Complexity**: O(W) per write, O(R) per read; conflict resolution via read repair or anti-entropy
- **CAP Trade-off**: Tunable: R + W > N gives strong consistency; R + W <= N gives eventual consistency with higher availability. Classic Dynamo setting: N=3, W=2, R=2.
- **Use when**: Dynamo-style systems (Cassandra, Riak, DynamoDB); high availability with tunable consistency; write-heavy workloads distributed across nodes
- **Avoid when**: Single-datacenter with strong consistency needs (use primary-replica + sync replication); application cannot handle conflict resolution; simple read/write patterns that don't need quorum flexibility
- **Source**: karanpratapsingh/system-design | ByteByteGoHq/system-design-101

#### Quorum Configurations

| Configuration | W | R | Consistency | Availability | Use Case |
|--------------|---|---|-------------|--------------|----------|
| Strong consistency | 2 | 2 | Strong (R+W=4>3) | Lower | Default; balanced |
| Write-heavy | 1 | 3 | Strong (R+W=4>3) | Writes available | Log ingestion, metrics |
| Read-heavy | 3 | 1 | Strong (R+W=4>3) | Reads available | Content serving |
| Eventual consistency | 1 | 1 | Eventual (R+W=2<3) | Highest | Best-effort reads/writes |

(Assuming N=3 for all configurations)

#### Scale Tiers

| Tier | Implementation | Notes |
|------|---------------|-------|
| **Hobby** (<1K req/s) | In-memory 3-node quorum | Educational; use primary-replica for production hobby tier |
| **Growth** (1K-100K) | Cassandra or DynamoDB with tuned quorum | Choose consistency level per query (ONE, QUORUM, ALL) |
| **Scale** (100K+) | Multi-DC quorum with LOCAL_QUORUM + EACH_QUORUM | Local reads for latency; cross-DC writes for durability |

**TypeScript Implementation** (Hobby tier):
```typescript
interface QuorumConfig {
  replicationFactor: number; // N
  writeQuorum: number;       // W
  readQuorum: number;        // R
}

interface VersionedValue<T> {
  value: T;
  version: number;
  nodeId: string;
}

class QuorumStore<T> {
  private nodes: Map<string, Map<string, VersionedValue<T>>> = new Map();
  private config: QuorumConfig;
  private nodeIds: string[];

  constructor(nodeIds: string[], config: QuorumConfig) {
    this.nodeIds = nodeIds;
    this.config = config;
    for (const id of nodeIds) {
      this.nodes.set(id, new Map());
    }
  }

  /** Write to W nodes */
  write(key: string, value: T): boolean {
    const version = Date.now();
    const targetNodes = this.getPreferenceList(key);
    let successCount = 0;

    for (const nodeId of targetNodes) {
      if (successCount >= this.config.writeQuorum) break;
      const store = this.nodes.get(nodeId);
      if (store) {
        store.set(key, { value, version, nodeId });
        successCount++;
      }
    }

    return successCount >= this.config.writeQuorum;
  }

  /** Read from R nodes, return most recent value */
  read(key: string): T | undefined {
    const targetNodes = this.getPreferenceList(key);
    const responses: VersionedValue<T>[] = [];

    for (const nodeId of targetNodes) {
      if (responses.length >= this.config.readQuorum) break;
      const store = this.nodes.get(nodeId);
      const entry = store?.get(key);
      if (entry) responses.push(entry);
    }

    if (responses.length === 0) return undefined;

    // Return the value with the highest version (most recent write)
    responses.sort((a, b) => b.version - a.version);
    const latest = responses[0];

    // Read repair: update stale nodes with the latest value
    for (const nodeId of targetNodes) {
      const store = this.nodes.get(nodeId);
      const entry = store?.get(key);
      if (!entry || entry.version < latest.version) {
        store?.set(key, latest);
      }
    }

    return latest.value;
  }

  /** Simple preference list: hash to starting node, take N consecutive nodes */
  private getPreferenceList(key: string): string[] {
    const hash = this.hash(key);
    const startIdx = hash % this.nodeIds.length;
    const list: string[] = [];
    for (let i = 0; i < this.config.replicationFactor; i++) {
      list.push(this.nodeIds[(startIdx + i) % this.nodeIds.length]);
    }
    return list;
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
