# Graph Analysis Reference

Patterns derived from Twitter/X's **real-graph**, **graph-feature-service**, and **tweepcred** systems. These subsystems power interaction prediction, reputation scoring, follower graph analysis, and graph-based content discovery at billions-scale. The patterns below are adapted with scale-appropriate tiers (Hobby, Growth, Scale) for reuse in any social platform project.

---

## 1. User Graph Patterns

Twitter's **real-graph** predicts the probability of interaction between two users: `P(engage | user_a, user_b)`. The **graph-feature-service** extracts features from the follow graph for downstream ranking. **TwHIN** produces dense graph embeddings via graph neural networks trained on the heterogeneous interaction graph.

### 1.1 Interaction Probability Prediction

The core question: given user A and user B, how likely is A to engage with B's content? Twitter's real-graph answers this with a logistic regression model over graph features.

**Feature set for interaction prediction:**

| Feature | Description | Weight Signal |
|---------|-------------|---------------|
| Mutual follow | A follows B AND B follows A | Strong positive |
| Follow age | How long A has followed B | Decays over time |
| Interaction recency | Days since last like/reply/retweet | Decays exponentially |
| Interaction frequency | Engagements per week over trailing 90 days | Strong positive |
| Topic overlap | Jaccard similarity of inferred topic interests | Moderate positive |
| Follower ratio | B's followers / B's following | Authority signal |
| Shared connections | Number of mutual follows between A and B | Community signal |

### 1.2 Bipartite Graph Representation

Social platforms naturally form a bipartite graph: **users** on one side, **content** on the other. Edges represent interactions (view, like, comment, share, follow-author).

```
Users           Content
  A ──like──→   post_1
  A ──view──→   post_2
  B ──like──→   post_1
  B ──share──→  post_3
  C ──like──→   post_2
```

This bipartite structure enables:
- **User similarity**: users who engage with the same content are similar
- **Content similarity**: content engaged by the same users is similar
- **Collaborative filtering**: recommend content liked by users similar to you

### 1.3 TwHIN Dense Embeddings (Scale Tier)

Twitter's TwHIN (Twitter Heterogeneous Information Network) trains graph neural networks on the full interaction graph to produce dense vector embeddings for every user and content node. These embeddings capture structural position in the graph and enable nearest-neighbor lookup for recommendation.

At smaller scale, you approximate this with simpler embeddings (see Section 5 on random walks).

### 1.4 Simplified Implementations

#### Adjacency List for Follow Graph

The simplest graph representation. Sufficient for Hobby and Growth tiers.

```typescript
/**
 * Follow graph stored as adjacency list.
 * Key = user ID, Value = set of user IDs they follow.
 */
type FollowGraph = Map<string, Set<string>>;

function buildFollowGraph(
  followEdges: Array<{ follower: string; followed: string }>
): FollowGraph {
  const graph: FollowGraph = new Map();
  for (const { follower, followed } of followEdges) {
    if (!graph.has(follower)) graph.set(follower, new Set());
    graph.get(follower)!.add(followed);
  }
  return graph;
}

function getMutualFollows(graph: FollowGraph, userA: string, userB: string): boolean {
  const aFollows = graph.get(userA);
  const bFollows = graph.get(userB);
  return (aFollows?.has(userB) ?? false) && (bFollows?.has(userA) ?? false);
}

function getSharedConnections(graph: FollowGraph, userA: string, userB: string): string[] {
  const aFollows = graph.get(userA);
  const bFollows = graph.get(userB);
  if (!aFollows || !bFollows) return [];
  const shared: string[] = [];
  for (const userId of aFollows) {
    if (bFollows.has(userId)) shared.push(userId);
  }
  return shared;
}
```

#### Interaction Frequency Matrix

Tracks how often user A engages with user B's content. Used to compute interaction probability without ML.

```typescript
/**
 * Interaction frequency tracker.
 * Outer key = source user, inner key = target user, value = interaction count.
 */
type InteractionMatrix = Map<string, Map<string, number>>;

function createInteractionMatrix(): InteractionMatrix {
  return new Map();
}

function recordInteraction(
  matrix: InteractionMatrix,
  source: string,
  target: string,
  weight: number = 1
): void {
  if (!matrix.has(source)) matrix.set(source, new Map());
  const row = matrix.get(source)!;
  row.set(target, (row.get(target) ?? 0) + weight);
}

/**
 * Compute interaction probability as normalized frequency.
 * P(engage | source, target) = interactions(source, target) / total_interactions(source)
 */
function interactionProbability(
  matrix: InteractionMatrix,
  source: string,
  target: string
): number {
  const row = matrix.get(source);
  if (!row) return 0;
  const pairCount = row.get(target) ?? 0;
  let totalCount = 0;
  for (const count of row.values()) totalCount += count;
  return totalCount === 0 ? 0 : pairCount / totalCount;
}

/**
 * Get top-N users that the source user interacts with most.
 */
function topInteractions(
  matrix: InteractionMatrix,
  source: string,
  n: number = 10
): Array<{ userId: string; count: number }> {
  const row = matrix.get(source);
  if (!row) return [];
  return Array.from(row.entries())
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
```

#### Community Detection via Label Propagation

Identifies clusters of densely connected users. Twitter uses SimClusters (matrix factorization over the bipartite graph) at scale; label propagation is the Hobby/Growth-tier equivalent.

```typescript
/**
 * Label propagation community detection.
 * Each node starts with its own label. Iteratively, each node adopts
 * the most frequent label among its neighbors. Converges when labels stabilize.
 *
 * Time: O(iterations * |E|) where |E| = number of edges
 * Space: O(|V|) where |V| = number of nodes
 */
function detectCommunities(
  graph: FollowGraph,
  maxIterations: number = 20
): Map<string, string> {
  // Initialize: each node gets its own label
  const labels = new Map<string, string>();
  const allNodes = new Set<string>();
  for (const [node, neighbors] of graph) {
    allNodes.add(node);
    for (const neighbor of neighbors) allNodes.add(neighbor);
  }
  for (const node of allNodes) {
    labels.set(node, node);
  }

  // Build undirected neighbor list for propagation
  const neighbors = new Map<string, Set<string>>();
  for (const node of allNodes) neighbors.set(node, new Set());
  for (const [node, follows] of graph) {
    for (const followed of follows) {
      neighbors.get(node)!.add(followed);
      neighbors.get(followed)!.add(node);
    }
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    // Shuffle node order for better convergence
    const nodeList = Array.from(allNodes);
    for (let i = nodeList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodeList[i], nodeList[j]] = [nodeList[j], nodeList[i]];
    }

    for (const node of nodeList) {
      const nodeNeighbors = neighbors.get(node);
      if (!nodeNeighbors || nodeNeighbors.size === 0) continue;

      // Count label frequencies among neighbors
      const labelCounts = new Map<string, number>();
      for (const neighbor of nodeNeighbors) {
        const label = labels.get(neighbor)!;
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }

      // Adopt the most frequent label
      let maxCount = 0;
      let maxLabel = labels.get(node)!;
      for (const [label, count] of labelCounts) {
        if (count > maxCount) {
          maxCount = count;
          maxLabel = label;
        }
      }

      if (maxLabel !== labels.get(node)) {
        labels.set(node, maxLabel);
        changed = true;
      }
    }

    if (!changed) break; // Converged
  }

  return labels;
}

/**
 * Group users by their community label.
 */
function groupByCommunity(labels: Map<string, string>): Map<string, string[]> {
  const communities = new Map<string, string[]>();
  for (const [node, label] of labels) {
    if (!communities.has(label)) communities.set(label, []);
    communities.get(label)!.push(node);
  }
  return communities;
}
```

### 1.5 Scale-Tier Summary

| Tier | Interaction Prediction | Community Detection | Embeddings |
|------|----------------------|--------------------| -----------|
| Hobby | Frequency-based probability | Label propagation | N/A |
| Growth | Logistic regression on graph features | Label propagation + modularity | TF-IDF on interaction history |
| Scale | Neural network (real-graph) | SimClusters (matrix factorization) | TwHIN graph neural network |

---

## 2. Reputation Scoring (PageRank)

Twitter's **tweepcred** computes user reputation using a modified PageRank on the follow graph. Users with high-reputation followers accumulate higher scores. This score feeds into ranking (authoritative users' content ranks higher) and trust & safety (low-reputation accounts get more scrutiny).

### 2.1 How PageRank Works on Social Graphs

PageRank models a "random surfer" traversing the follow graph:
1. Start at a random user
2. With probability `d` (damping factor, typically 0.85), follow a random outgoing edge (follow link)
3. With probability `1 - d`, jump to a completely random user
4. After infinite steps, the fraction of time spent at each user is their PageRank score

The intuition: your reputation score is the sum of reputation passed to you by your followers, weighted by how selective those followers are (a follower who follows 10 people passes more reputation per follow than one who follows 10,000).

### 2.2 Full TypeScript Implementation

```typescript
/**
 * Compute PageRank-based reputation scores on a follow graph.
 *
 * @param followers - Map from user ID to list of that user's follower IDs.
 *                    followers.get("alice") = ["bob", "carol"] means bob and carol follow alice.
 * @param iterations - Number of PageRank iterations (20 is typically sufficient).
 * @param damping - Damping factor. 0.85 is standard. Higher values weight graph
 *                  structure more; lower values distribute score more uniformly.
 * @returns Map from user ID to reputation score (sums to 1.0 across all users).
 *
 * Time complexity: O(iterations * |E|) where |E| = total follow edges
 * Space complexity: O(|V|) where |V| = number of users
 */
function computeReputation(
  followers: Map<string, string[]>,
  iterations: number = 20,
  damping: number = 0.85
): Map<string, number> {
  // Collect all unique user IDs
  const allUsers = new Set<string>();
  for (const [user, followerList] of followers) {
    allUsers.add(user);
    for (const f of followerList) allUsers.add(f);
  }
  const n = allUsers.size;
  if (n === 0) return new Map();

  // Initialize scores uniformly
  const scores = new Map<string, number>();
  for (const user of allUsers) {
    scores.set(user, 1 / n);
  }

  // Precompute outgoing edge counts (how many people each user follows).
  // If user X appears in followers.get(Y), then X follows Y.
  // outDegree[X] = number of people X follows.
  const outDegree = new Map<string, number>();
  for (const user of allUsers) outDegree.set(user, 0);
  for (const [_user, followerList] of followers) {
    for (const f of followerList) {
      outDegree.set(f, (outDegree.get(f) ?? 0) + 1);
    }
  }

  // Iterative PageRank computation
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();
    // Base score from random jumps
    const baseScore = (1 - damping) / n;
    for (const user of allUsers) {
      newScores.set(user, baseScore);
    }

    // Distribute scores through follow edges.
    // For each user U with followers [F1, F2, ...]:
    //   Each follower Fi contributes score(Fi) / outDegree(Fi) to U
    for (const [user, followerList] of followers) {
      for (const follower of followerList) {
        const followerScore = scores.get(follower) ?? 0;
        const followerOutDegree = outDegree.get(follower) ?? 1;
        const contribution = damping * (followerScore / followerOutDegree);
        newScores.set(user, (newScores.get(user) ?? baseScore) + contribution);
      }
    }

    // Handle dangling nodes (users who follow nobody).
    // Their score "leaks" out of the graph. Redistribute uniformly.
    let danglingSum = 0;
    for (const user of allUsers) {
      if ((outDegree.get(user) ?? 0) === 0) {
        danglingSum += scores.get(user) ?? 0;
      }
    }
    const danglingContribution = damping * danglingSum / n;
    for (const user of allUsers) {
      newScores.set(user, (newScores.get(user) ?? 0) + danglingContribution);
    }

    // Update scores
    for (const [user, score] of newScores) {
      scores.set(user, score);
    }
  }

  return scores;
}
```

### 2.3 Convergence Detection

For production use, replace the fixed iteration count with convergence detection:

```typescript
function hasConverged(
  oldScores: Map<string, number>,
  newScores: Map<string, number>,
  epsilon: number = 1e-6
): boolean {
  let totalDelta = 0;
  for (const [user, newScore] of newScores) {
    totalDelta += Math.abs(newScore - (oldScores.get(user) ?? 0));
  }
  return totalDelta < epsilon;
}
```

Typical convergence: 15-25 iterations for graphs under 1M nodes. Twitter runs ~50 iterations on their full graph (hundreds of millions of nodes) using distributed MapReduce.

### 2.4 Scale-Tier Adaptations

| Tier | Approach | Complexity | When to Graduate |
|------|----------|------------|-----------------|
| Hobby | Simple follower-count ranking: `score = log(1 + followerCount)` | O(1) per user | When follower count alone fails to distinguish quality (spam accounts with bought followers) |
| Growth | PageRank on follow graph (implementation above) | O(iter * edges) | When graph exceeds memory (~10M edges) or iteration time exceeds batch window |
| Scale | Distributed PageRank (MapReduce/Spark) + TwHIN embeddings | O(iter * edges / workers) | When you need sub-second updates or the graph changes continuously |

**Hobby-tier shortcut:**

```typescript
function simpleReputationScore(followerCount: number, followingCount: number): number {
  // Penalize users who follow vastly more than they are followed (likely spam)
  const ratio = followerCount / Math.max(followingCount, 1);
  const logFollowers = Math.log10(1 + followerCount);
  return logFollowers * Math.min(ratio, 10); // Cap ratio contribution
}
```

---

## 3. Growth Pattern Analysis

Patterns for tracking follower growth and engagement trends over time. These are not directly from Twitter's open-source code but are derived from the same signal types that feed into Twitter's ranking and trust systems.

### 3.1 Rolling Window Engagement Rate

Track engagement rate using exponential moving average (EMA) for smooth trend detection.

```typescript
interface EngagementSnapshot {
  date: string;          // ISO date
  impressions: number;
  engagements: number;   // likes + comments + shares
}

/**
 * Compute exponential moving average of engagement rate.
 *
 * @param snapshots - Daily engagement data, chronologically ordered.
 * @param span - EMA span in days (7 for weekly, 30 for monthly).
 * @returns Array of { date, ema } pairs.
 */
function engagementEMA(
  snapshots: EngagementSnapshot[],
  span: number = 7
): Array<{ date: string; ema: number }> {
  const alpha = 2 / (span + 1); // EMA smoothing factor
  const results: Array<{ date: string; ema: number }> = [];
  let ema = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const rate = snapshots[i].impressions > 0
      ? snapshots[i].engagements / snapshots[i].impressions
      : 0;
    if (i === 0) {
      ema = rate;
    } else {
      ema = alpha * rate + (1 - alpha) * ema;
    }
    results.push({ date: snapshots[i].date, ema });
  }

  return results;
}
```

### 3.2 Growth Velocity Detection

Distinguish between steady growth (constant rate) and accelerating growth (increasing rate). Acceleration is a stronger signal for trending accounts.

```typescript
interface GrowthSignal {
  velocity: number;      // First derivative: change in metric per period
  acceleration: number;  // Second derivative: change in velocity per period
  trend: 'accelerating' | 'steady' | 'decelerating' | 'declining';
}

function detectGrowthTrend(
  values: number[],    // e.g., daily follower counts, chronologically ordered
  windowSize: number = 7
): GrowthSignal {
  if (values.length < windowSize * 2 + 1) {
    return { velocity: 0, acceleration: 0, trend: 'steady' };
  }

  // Compute recent and previous window averages
  const recent = values.slice(-windowSize);
  const previous = values.slice(-windowSize * 2, -windowSize);
  const older = values.slice(-windowSize * 3, -windowSize * 2);

  const recentAvg = recent.reduce((a, b) => a + b, 0) / windowSize;
  const previousAvg = previous.reduce((a, b) => a + b, 0) / windowSize;

  const velocity = recentAvg - previousAvg;

  let acceleration = 0;
  if (older.length === windowSize) {
    const olderAvg = older.reduce((a, b) => a + b, 0) / windowSize;
    const prevVelocity = previousAvg - olderAvg;
    acceleration = velocity - prevVelocity;
  }

  let trend: GrowthSignal['trend'];
  if (velocity > 0 && acceleration > 0) trend = 'accelerating';
  else if (velocity > 0 && acceleration <= 0) trend = 'steady';
  else if (velocity <= 0 && acceleration < 0) trend = 'declining';
  else trend = 'decelerating';

  return { velocity, acceleration, trend };
}
```

### 3.3 Anomaly Detection: Z-Score on Engagement Deltas

Flag unusual spikes or drops in engagement. Useful for detecting viral content, bot activity, or algorithm changes.

```typescript
/**
 * Detect anomalies in a time series using Z-score on day-over-day deltas.
 *
 * @param values - Chronologically ordered daily values.
 * @param threshold - Z-score threshold for flagging anomalies (default 2.0).
 * @returns Indices of anomalous data points and their Z-scores.
 */
function detectAnomalies(
  values: number[],
  threshold: number = 2.0
): Array<{ index: number; zScore: number; direction: 'spike' | 'drop' }> {
  if (values.length < 3) return [];

  // Compute day-over-day deltas
  const deltas: number[] = [];
  for (let i = 1; i < values.length; i++) {
    deltas.push(values[i] - values[i - 1]);
  }

  // Compute mean and standard deviation of deltas
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const variance = deltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / deltas.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return []; // No variation

  const anomalies: Array<{ index: number; zScore: number; direction: 'spike' | 'drop' }> = [];
  for (let i = 0; i < deltas.length; i++) {
    const zScore = (deltas[i] - mean) / stdDev;
    if (Math.abs(zScore) >= threshold) {
      anomalies.push({
        index: i + 1, // Index in original values array
        zScore,
        direction: zScore > 0 ? 'spike' : 'drop',
      });
    }
  }

  return anomalies;
}
```

### 3.4 Plateau Detection

Identify when growth has stalled -- consecutive periods below a growth threshold.

```typescript
/**
 * Detect growth plateaus: consecutive periods where growth rate
 * stays below a threshold.
 *
 * @param values - Chronologically ordered periodic values (e.g., weekly follower counts).
 * @param growthThreshold - Minimum growth rate to not be considered plateau (default 1%).
 * @param minPeriods - Minimum consecutive periods to qualify as a plateau (default 3).
 */
function detectPlateau(
  values: number[],
  growthThreshold: number = 0.01,
  minPeriods: number = 3
): { isPlateau: boolean; plateauLength: number; since: number } {
  let consecutiveLow = 0;
  let plateauStart = -1;

  for (let i = values.length - 1; i >= 1; i--) {
    const prev = values[i - 1];
    if (prev === 0) break;
    const growthRate = (values[i] - prev) / prev;

    if (Math.abs(growthRate) < growthThreshold) {
      consecutiveLow++;
      plateauStart = i - 1;
    } else {
      break; // Growth resumed; no current plateau
    }
  }

  return {
    isPlateau: consecutiveLow >= minPeriods,
    plateauLength: consecutiveLow,
    since: plateauStart,
  };
}
```

### 3.5 Cross-Platform Correlation

Do gains on one platform predict gains on another? Compute Pearson correlation between growth time series across platforms.

```typescript
/**
 * Pearson correlation between two equal-length numeric arrays.
 * Returns value in [-1, 1]. Values > 0.5 suggest meaningful positive correlation.
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  return denominator === 0 ? 0 : numerator / denominator;
}

// Usage: align daily follower deltas from two platforms and compute correlation
// const douyinGrowth = [+50, +30, +80, +120, +60];
// const xhsGrowth =    [+20, +15, +45, +55, +30];
// pearsonCorrelation(douyinGrowth, xhsGrowth) → ~0.97 (highly correlated)
```

---

## 4. Influence Scoring

Moving beyond simple follower count to composite influence metrics. Twitter internally uses multiple signals to weight user authority in ranking; these patterns distill the approach into implementable formulas.

### 4.1 Component Metrics

| Metric | Formula | What It Captures |
|--------|---------|-----------------|
| Engagement Rate | `(likes + comments + shares) / impressions` | Content resonance -- how much of the audience actually responds |
| Authority Score | `pageRank(followGraph) / max(pageRank)` | Network position -- are your followers themselves influential? |
| Reach Score | `followerCount * avgEngagementRate` | Effective audience -- how many people actually see and respond |
| Niche Authority | `categoryEngagementRate / globalAvgEngagementRate` | Category-specific influence -- high in cooking, low in tech |

### 4.2 Composite Influence Score

```typescript
interface UserMetrics {
  userId: string;
  followerCount: number;
  impressions: number;       // Total impressions across recent content
  likes: number;
  comments: number;
  shares: number;
  pageRankScore: number;     // From computeReputation(), normalized 0-1
  categoryScores: Map<string, number>; // Category → engagement rate in that category
}

interface InfluenceScore {
  overall: number;            // 0-100 composite score
  engagementRate: number;     // 0-1
  authorityScore: number;     // 0-1 (normalized PageRank)
  reachScore: number;         // Raw effective reach
  topCategories: Array<{ category: string; nicheAuthority: number }>;
}

/**
 * Compute composite influence score.
 *
 * Weights are tunable. Defaults based on empirical observation that
 * engagement rate is the strongest signal of genuine influence, followed
 * by authority (PageRank), then raw reach.
 */
function computeInfluence(
  metrics: UserMetrics,
  globalAvgEngagementRate: number = 0.03, // 3% is typical across platforms
  weights: { engagement: number; authority: number; reach: number } = {
    engagement: 0.45,
    authority: 0.35,
    reach: 0.20,
  }
): InfluenceScore {
  // Engagement rate
  const engagementRate = metrics.impressions > 0
    ? (metrics.likes + metrics.comments + metrics.shares) / metrics.impressions
    : 0;

  // Authority score (already normalized 0-1 from PageRank)
  const authorityScore = metrics.pageRankScore;

  // Reach score: follower count * engagement rate, log-scaled to tame outliers
  const rawReach = metrics.followerCount * engagementRate;
  // Normalize reach to 0-1 using log scale (1M effective reach = 1.0)
  const reachScore = Math.min(1, Math.log10(1 + rawReach) / 6);

  // Niche authority: per-category engagement rate vs global average
  const topCategories = Array.from(metrics.categoryScores.entries())
    .map(([category, rate]) => ({
      category,
      nicheAuthority: globalAvgEngagementRate > 0 ? rate / globalAvgEngagementRate : 0,
    }))
    .sort((a, b) => b.nicheAuthority - a.nicheAuthority)
    .slice(0, 5);

  // Composite: weighted sum, scaled to 0-100
  // Engagement rate is capped at 0.3 (30%) to avoid gaming via low-impression posts
  const cappedEngagement = Math.min(engagementRate / 0.3, 1);
  const overall = (
    weights.engagement * cappedEngagement +
    weights.authority * authorityScore +
    weights.reach * reachScore
  ) * 100;

  return {
    overall: Math.round(overall * 10) / 10,
    engagementRate,
    authorityScore,
    reachScore: rawReach,
    topCategories,
  };
}
```

### 4.3 Interpretation Guide

| Overall Score | Interpretation |
|---------------|---------------|
| 0-15 | Low influence. New or inactive account. |
| 15-40 | Emerging. Active but limited reach or authority. |
| 40-65 | Established. Consistent engagement, recognized in niche. |
| 65-85 | High influence. Strong authority and reach. |
| 85-100 | Top-tier. Category leader with broad reach and high engagement. |

---

## 5. Graph-Based Content Discovery

Derived from Twitter's **UTEG** (User-Tweet Entity Graph). UTEG performs random walks on the user-content bipartite graph to discover content that your network engaged with but you haven't seen yet.

### 5.1 Random Walk on Bipartite Graph

The algorithm:
1. Start at the target user node
2. Walk to a content node they engaged with (weighted by engagement type)
3. Walk to another user who also engaged with that content
4. Walk to content that second user engaged with
5. The content node you land on is a recommendation candidate
6. Repeat many walks, count landing frequency per content node
7. Rank content by landing frequency

This naturally produces "neighbor-of-neighbor" recommendations: content liked by people who like the same things you like.

```typescript
interface BipartiteGraph {
  /** User -> list of content IDs they engaged with (weighted) */
  userToContent: Map<string, Array<{ contentId: string; weight: number }>>;
  /** Content -> list of user IDs who engaged with it (weighted) */
  contentToUser: Map<string, Array<{ userId: string; weight: number }>>;
}

/**
 * Random walk content discovery on the user-content bipartite graph.
 *
 * @param graph - Bipartite graph of user-content interactions.
 * @param startUser - User to generate recommendations for.
 * @param numWalks - Number of random walks to perform (more = better coverage).
 * @param walkLength - Steps per walk (2 = direct neighbors, 4 = two hops out).
 * @returns Content IDs ranked by visit frequency, excluding content the user already engaged with.
 */
function randomWalkRecommend(
  graph: BipartiteGraph,
  startUser: string,
  numWalks: number = 1000,
  walkLength: number = 4
): Array<{ contentId: string; score: number }> {
  const visitCounts = new Map<string, number>();
  const userContent = graph.userToContent.get(startUser);
  if (!userContent || userContent.length === 0) return [];

  // Content the user already engaged with (exclude from results)
  const seenContent = new Set(userContent.map(e => e.contentId));

  for (let walk = 0; walk < numWalks; walk++) {
    let currentType: 'user' | 'content' = 'user';
    let currentId = startUser;

    for (let step = 0; step < walkLength; step++) {
      if (currentType === 'user') {
        // Walk from user to content (weighted random selection)
        const edges = graph.userToContent.get(currentId);
        if (!edges || edges.length === 0) break;
        currentId = weightedRandomSelect(edges);
        currentType = 'content';
      } else {
        // Walk from content to user (weighted random selection)
        const edges = graph.contentToUser.get(currentId);
        if (!edges || edges.length === 0) break;
        currentId = weightedRandomSelect(
          edges.map(e => ({ contentId: e.userId, weight: e.weight }))
        );
        currentType = 'user';
      }
    }

    // If we ended on a content node, record the visit
    if (currentType === 'content' && !seenContent.has(currentId)) {
      visitCounts.set(currentId, (visitCounts.get(currentId) ?? 0) + 1);
    }
  }

  // Rank by visit frequency
  return Array.from(visitCounts.entries())
    .map(([contentId, count]) => ({ contentId, score: count / numWalks }))
    .sort((a, b) => b.score - a.score);
}

function weightedRandomSelect(
  edges: Array<{ contentId: string; weight: number }>
): string {
  const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0);
  let r = Math.random() * totalWeight;
  for (const edge of edges) {
    r -= edge.weight;
    if (r <= 0) return edge.contentId;
  }
  return edges[edges.length - 1].contentId;
}
```

### 5.2 Entity Nodes as Bridges

Twitter's UTEG extends the bipartite graph with entity nodes: hashtags, mentions, URLs. These act as bridges between otherwise disconnected user clusters.

```
Users           Entities        Content
  A ──used──→  #cooking  ←──tagged── post_1
  B ──used──→  #cooking  ←──tagged── post_4
  C ──mention→  @chef    ←──mention── post_1
```

To add entities to the random walk:
- When walking from content, sometimes (e.g., 30% probability) jump to an entity node instead of a user node
- From an entity node, walk to another content node tagged with the same entity
- This crosses community boundaries: user A's cooking content reaches user C who only shares the @chef mention, not the #cooking hashtag

### 5.3 Graph Pruning for Performance

At scale, the bipartite graph can have billions of edges. Pruning strategies:

| Strategy | Description | When to Apply |
|----------|-------------|---------------|
| **Recency pruning** | Drop interactions older than N days | Always. 90 days is a good default. |
| **Weight threshold** | Drop edges below a minimum weight | When edge count exceeds memory budget. |
| **Degree capping** | Limit each node to top-K edges by weight | For power-law graphs where some nodes have millions of edges. Cap at 500-1000. |
| **Sampling** | Random sample of edges per node | When you need further reduction after capping. |

```typescript
/**
 * Prune a bipartite graph to fit within memory/performance budget.
 */
function pruneGraph(
  graph: BipartiteGraph,
  options: {
    maxEdgesPerNode?: number;   // Degree cap (default 500)
    minWeight?: number;         // Minimum edge weight to keep (default 1)
    maxAgeDays?: number;        // Not implemented here -- filter before building graph
  } = {}
): BipartiteGraph {
  const maxEdges = options.maxEdgesPerNode ?? 500;
  const minWeight = options.minWeight ?? 1;

  function pruneEdges<T extends { weight: number }>(edges: T[]): T[] {
    return edges
      .filter(e => e.weight >= minWeight)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxEdges);
  }

  const prunedUserToContent = new Map<string, Array<{ contentId: string; weight: number }>>();
  for (const [userId, edges] of graph.userToContent) {
    const pruned = pruneEdges(edges);
    if (pruned.length > 0) prunedUserToContent.set(userId, pruned);
  }

  const prunedContentToUser = new Map<string, Array<{ userId: string; weight: number }>>();
  for (const [contentId, edges] of graph.contentToUser) {
    const pruned = pruneEdges(edges);
    if (pruned.length > 0) prunedContentToUser.set(contentId, pruned);
  }

  return {
    userToContent: prunedUserToContent,
    contentToUser: prunedContentToUser,
  };
}
```

### 5.4 Scale-Tier Summary for Content Discovery

| Tier | Approach | Nodes | Walks |
|------|----------|-------|-------|
| Hobby | Direct neighbor lookup (skip random walk, just show content from followed users) | < 10K | N/A |
| Growth | Random walk on pruned bipartite graph (implementation above) | 10K-1M | 1,000-10,000 per user |
| Scale | Distributed random walk + TwHIN embedding nearest-neighbor | 1M+ | Precomputed embeddings, ANN index |

---

## Quick Reference: When to Use Each Pattern

| Problem | Pattern | Section |
|---------|---------|---------|
| Predict if user A will engage with user B | Interaction frequency matrix | 1.4 |
| Find clusters of related users | Label propagation community detection | 1.4 |
| Rank users by authority / reputation | PageRank (computeReputation) | 2.2 |
| Simple user ranking without graph traversal | Follower-count heuristic | 2.4 |
| Track engagement trends over time | Engagement EMA | 3.1 |
| Detect if growth is accelerating | Growth velocity detection | 3.2 |
| Flag unusual spikes or drops | Z-score anomaly detection | 3.3 |
| Detect growth stalls | Plateau detection | 3.4 |
| Check if platforms move together | Pearson cross-platform correlation | 3.5 |
| Score user influence beyond follower count | Composite influence scoring | 4.2 |
| Discover content via network effects | Random walk on bipartite graph | 5.1 |
| Cross community boundaries in discovery | Entity nodes as bridges | 5.2 |
| Keep graph operations fast | Graph pruning strategies | 5.3 |
