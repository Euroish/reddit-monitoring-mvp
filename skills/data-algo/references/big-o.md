# Big-O Complexity Reference

Quick lookup for complexity analysis. Use this when diagnosing bottlenecks or comparing algorithm options.

Source: [javascript-algorithms](https://github.com/trekhleb/javascript-algorithms)

---

## Growth Rate Table

How different complexities scale with input size:

| Big-O | Type | n=10 | n=100 | n=1,000 | n=10,000 | n=100,000 |
|-------|------|------|-------|---------|----------|-----------|
| O(1) | Constant | 1 | 1 | 1 | 1 | 1 |
| O(log n) | Logarithmic | 3 | 7 | 10 | 13 | 17 |
| O(n) | Linear | 10 | 100 | 1,000 | 10,000 | 100,000 |
| O(n log n) | Linearithmic | 30 | 664 | 9,966 | 132,877 | 1,660,964 |
| O(n^2) | Quadratic | 100 | 10,000 | 1,000,000 | 100,000,000 | 10,000,000,000 |
| O(2^n) | Exponential | 1,024 | 1.26e+30 | 1.07e+301 | --- | --- |
| O(n!) | Factorial | 3,628,800 | 9.3e+157 | --- | --- | --- |

**Rule of thumb**: Modern hardware does ~10^8-10^9 simple operations/second.
- O(n^2) is fine for n < 10,000
- O(n log n) is fine for n < 10,000,000
- O(n) is fine for n < 100,000,000
- O(2^n) is only practical for n < 25-30

---

## Data Structure Operations Complexity

All complexities are **worst case** unless noted.

| Data Structure | Access | Search | Insert | Delete | Notes |
|---------------|--------|--------|--------|--------|-------|
| Array | O(1) | O(n) | O(n) | O(n) | Insert/delete at end: O(1) amortized |
| Stack | O(n) | O(n) | O(1) | O(1) | LIFO — push/pop are O(1) |
| Queue | O(n) | O(n) | O(1) | O(1) | FIFO — enqueue/dequeue are O(1) |
| Linked List | O(n) | O(n) | O(1) | O(n) | Insert O(1) at head or known position |
| Doubly Linked List | O(n) | O(n) | O(1) | O(1) | Delete O(1) given node reference |
| Hash Table | — | O(n) | O(n) | O(n) | Average: O(1) for search/insert/delete |
| Binary Search Tree | O(n) | O(n) | O(n) | O(n) | Balanced: O(log n) for all ops |
| AVL Tree | O(log n) | O(log n) | O(log n) | O(log n) | Guaranteed balanced |
| Red-Black Tree | O(log n) | O(log n) | O(log n) | O(log n) | Cheaper rebalancing than AVL |
| B-Tree | O(log n) | O(log n) | O(log n) | O(log n) | Disk-optimized |
| Heap | O(n) | O(n) | O(log n) | O(log n) | Find min/max: O(1) |
| Priority Queue | — | — | O(log n) | O(log n) | Extract-min/max: O(log n) |
| Trie | — | O(m) | O(m) | O(m) | m = key length |
| Segment Tree | O(log n) | O(log n) | O(log n) | — | Range queries + point updates |
| Fenwick Tree | — | O(log n) | O(log n) | — | Prefix sums + point updates |
| Graph (Adj List) | — | O(V+E) | O(1) | O(E) | Space: O(V+E) |
| Graph (Adj Matrix) | — | O(1) | O(1) | O(1) | Space: O(V^2) |
| Disjoint Set | — | O(α(n)) | O(α(n)) | — | α ≈ inverse Ackermann ≈ O(1) |
| Bloom Filter | — | O(k) | O(k) | — | k = hash functions; false positives |
| LRU Cache | — | O(1) | O(1) | O(1) | Hash Map + Doubly Linked List |
| KD Tree | — | O(log n) avg | O(log n) | O(log n) | k-dimensional; O(n) worst |
| Sqrt Decomposition | O(1) | O(√n) | O(1) | — | Block-based; simpler than Segment Tree |
| van Emde Boas | — | O(log log U) | O(log log U) | O(log log U) | U = universe size; O(U) space |
| Skip List | — | O(log n) avg | O(log n) avg | O(log n) avg | Probabilistic; O(n) worst |
| Treap | O(log n) avg | O(log n) avg | O(log n) avg | O(log n) avg | Random priorities; O(n) worst |
| Sparse Table | O(1) | O(1) min/max | — | — | Build O(n log n); static only |

---

## Sorting Algorithms Complexity

| Algorithm | Best | Average | Worst | Space | Stable | In-place | Notes |
|-----------|------|---------|-------|-------|--------|----------|-------|
| Bubble Sort | O(n) | O(n^2) | O(n^2) | O(1) | Yes | Yes | Adaptive — early exit if sorted |
| Insertion Sort | O(n) | O(n^2) | O(n^2) | O(1) | Yes | Yes | Best for small or nearly sorted |
| Selection Sort | O(n^2) | O(n^2) | O(n^2) | O(1) | No | Yes | Minimizes swaps |
| Shell Sort | O(n log n) | O(n^1.5) | O(n^2) | O(1) | No | Yes | Gap-dependent |
| Merge Sort | O(n log n) | O(n log n) | O(n log n) | O(n) | Yes | No | Guaranteed performance |
| Quick Sort | O(n log n) | O(n log n) | O(n^2) | O(log n) | No | Yes | Fastest in practice (avg case) |
| Heap Sort | O(n log n) | O(n log n) | O(n log n) | O(1) | No | Yes | No extra memory |
| Counting Sort | O(n+k) | O(n+k) | O(n+k) | O(n+k) | Yes | No | k = range of values |
| Radix Sort | O(n*d) | O(n*d) | O(n*d) | O(n+k) | Yes | No | d = digits, k = base |
| Bucket Sort | O(n+k) | O(n+k) | O(n^2) | O(n+k) | Yes | No | Uniform distribution |
| Tim Sort | O(n) | O(n log n) | O(n log n) | O(n) | Yes | No | JS/Python default; hybrid |
| Cocktail Sort | O(n) | O(n^2) | O(n^2) | O(1) | Yes | Yes | Bidirectional bubble sort |
| Bogo Sort | O(n) | O((n+1)!) | O(∞) | O(1) | No | Yes | Random shuffle; joke only |
| Bitonic Sort | O(n log² n) | O(n log² n) | O(n log² n) | O(1) | No | Yes | Sorting network; parallelizable |
| Strand Sort | O(n) | O(n²) | O(n²) | O(n) | Yes | No | Extracts sorted strands |
| Library Sort | O(n log n) | O(n log n) | O(n²) | O(n) | Yes | No | Gapped insertion sort |

---

## Graph Algorithm Complexity

| Algorithm | Time | Space | Use Case |
|-----------|------|-------|----------|
| BFS | O(V+E) | O(V) | Shortest path (unweighted), level order |
| DFS | O(V+E) | O(V) | Path existence, cycle detection, topo sort |
| Dijkstra (min-heap) | O((V+E) log V) | O(V) | Shortest path (non-negative weights) |
| Bellman-Ford | O(V*E) | O(V) | Shortest path (negative weights OK) |
| Floyd-Warshall | O(V^3) | O(V^2) | All-pairs shortest path |
| Kruskal | O(E log E) | O(V) | MST — better for sparse graphs |
| Prim (min-heap) | O((V+E) log V) | O(V) | MST — better for dense graphs |
| Topological Sort | O(V+E) | O(V) | DAG ordering, dependencies |
| Kosaraju (SCC) | O(V+E) | O(V) | Strongly connected components |
| Tarjan (Art. Points) | O(V+E) | O(V) | Network reliability |
| A* Search | O(E) best | O(V) | Shortest path with heuristic |
| Edmonds-Karp (Max Flow) | O(V*E^2) | O(V^2) | Maximum flow in network |
| Check Bipartite | O(V+E) | O(V) | 2-coloring graph test |
| Transitive Closure | O(V^3) | O(V^2) | Reachability matrix |
| Gale-Shapley | O(n^2) | O(n) | Stable matching |
| Bidirectional Dijkstra | O((V+E) log V) | O(V) | Point-to-point shortest path |
| Hopcroft-Karp | O(E√V) | O(V) | Max bipartite matching |
| Boruvka | O(E log V) | O(V) | MST — parallelizable |

---

## String Algorithm Complexity

| Algorithm | Time | Space | Use Case |
|-----------|------|-------|----------|
| Brute Force Match | O(n*m) | O(1) | Simple, short patterns |
| KMP | O(n+m) | O(m) | Single pattern, no backtracking |
| Rabin-Karp | O(n+m) avg | O(1) | Multiple pattern search |
| Z Algorithm | O(n+m) | O(n) | Pattern matching alternative |
| Levenshtein | O(n*m) | O(n*m) | Edit distance, fuzzy match |
| Wildcard Matching | O(n*m) | O(n*m) | Pattern with ? and * |
| Min Window Substring | O(n) | O(k) | Smallest window with all chars |
| Longest Common Prefix | O(S) | O(1) | Shared prefix, S = total chars |
| Manacher | O(n) | O(n) | Longest palindromic substring |
| Horspool | O(n/m) best, O(n*m) worst | O(k) | Simplified Boyer-Moore |
| Duval (Lyndon) | O(n) | O(1) | Lyndon factorization |

---

## Complexity Computation Helpers

Use these formulas to compute operation counts for the `data-algo-viz` complexity comparison charts:

```javascript
const complexityFunctions = {
  'O(1)':       (n) => 1,
  'O(log n)':   (n) => Math.log2(n),
  'O(n)':       (n) => n,
  'O(n log n)': (n) => n * Math.log2(n),
  'O(n^2)':     (n) => n * n,
  'O(n^3)':     (n) => n * n * n,
  'O(2^n)':     (n) => Math.pow(2, Math.min(n, 30)),
  'O(n!)':      (n) => n <= 12 ? factorial(n) : Infinity,
};
```
