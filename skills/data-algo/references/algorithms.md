# Algorithms — Domain Reference

Use this reference when you need to select or implement an algorithm. Organized by problem domain. Each entry includes complexity, when to use, and the source reference.

---

## Table of Contents

1. [Sorting](#sorting)
2. [Searching](#searching)
3. [Graphs](#graphs)
4. [Network Flow](#network-flow)
5. [Strings](#strings)
6. [Math](#math)
7. [Numerical Methods](#numerical-methods)
8. [Linear Algebra](#linear-algebra)
9. [Linear Programming](#linear-programming)
10. [Sets & Combinatorics](#sets--combinatorics)
11. [Dynamic Programming Problems](#dynamic-programming-problems)
12. [Backtracking Problems](#backtracking-problems)
13. [Machine Learning](#machine-learning)
14. [Cryptography](#cryptography)
15. [Hashing](#hashing)
16. [Compression & Encoding](#compression--encoding)
17. [Streaming & Probabilistic](#streaming--probabilistic)
18. [Geometry & Navigation](#geometry--navigation)
19. [Range Queries](#range-queries)
20. [Bit Manipulation (Advanced)](#bit-manipulation-advanced)
21. [Probability & Statistics](#probability--statistics)
22. [Physics Simulations](#physics-simulations)
23. [CPU Scheduling](#cpu-scheduling)
24. [Cellular Automata](#cellular-automata)
25. [Digital Image Processing](#digital-image-processing)
26. [Audio & Signal Processing](#audio--signal-processing)
27. [Fractals](#fractals)
28. [Quantum Computing](#quantum-computing)
29. [Geodesy](#geodesy)
30. [Other Classic Problems](#other-classic-problems)

---

## Sorting

### Quick Selection Guide

| Scenario | Algorithm | Why |
|----------|----------|-----|
| General purpose, good average | Quicksort | O(n log n) avg, in-place, cache-friendly |
| Guaranteed O(n log n) | Merge Sort | Stable, predictable, good for linked lists |
| Nearly sorted data | Insertion Sort | O(n) best case, adaptive |
| Small arrays (< 20 elements) | Insertion Sort | Low overhead beats O(n log n) algorithms |
| Integer keys, known range | Counting Sort | O(n + k), linear time |
| Integer keys, multiple digits | Radix Sort | O(d × (n + k)), linear for fixed-width |
| Uniformly distributed data | Bucket Sort | O(n) average with good distribution |
| Need stable sort + low memory | Merge Sort | Stable, O(n) extra space |
| Priority queue operations | Heap Sort | O(n log n), in-place, but not stable |
| Almost sorted, small gaps | Shell Sort | Adaptive, in-place |
| Production default (Python/JS) | Tim Sort | Hybrid merge+insert, stable, O(n) best |
| C++ STL default | Intro Sort | Hybrid quick+heap+insert, O(n log n) guaranteed |
| Minimize writes (flash/EEPROM) | Cycle Sort | O(n) writes, O(n²) time |
| Three-way partition (few values) | Dutch National Flag | O(n) single pass |
| Bidirectional bubble | Cocktail Sort | Slightly better than Bubble on nearly sorted |

### Detailed Entries

**Bubble Sort** `B` — O(n²) time, O(1) space. Only useful for educational purposes or tiny arrays. Ref: `src/algorithms/sorting/bubble-sort`

**Selection Sort** `B` — O(n²) time, O(1) space. Minimizes swaps (O(n) swaps). Use when writes are expensive. Ref: `src/algorithms/sorting/selection-sort`

**Insertion Sort** `B` — O(n²) worst, O(n) best (nearly sorted). Stable, in-place, adaptive. Excellent for small arrays or as base case in hybrid sorts. Ref: `src/algorithms/sorting/insertion-sort`

**Heap Sort** `B` — O(n log n) guaranteed, O(1) space. In-place but not stable. Good when guaranteed performance + no extra memory needed. Ref: `src/algorithms/sorting/heap-sort`

**Merge Sort** `B` — O(n log n) guaranteed, O(n) space. Stable. Best for linked lists (no random access needed), external sorting (disk), and when stability matters. Ref: `src/algorithms/sorting/merge-sort`

**Quicksort** `B` — O(n log n) avg, O(n²) worst (mitigated with random pivot), O(log n) space. In-place, cache-friendly. The default "go-to" sort for arrays. Ref: `src/algorithms/sorting/quick-sort`

**Shell Sort** `B` — O(n log² n) to O(n^1.5) depending on gap sequence, O(1) space. Generalization of insertion sort. Good for medium-sized arrays where simplicity matters. Ref: `src/algorithms/sorting/shell-sort`

**Counting Sort** `B` — O(n + k) time/space where k = range. Not comparison-based. Use when k is small relative to n. Ref: `src/algorithms/sorting/counting-sort`

**Radix Sort** `B` — O(d × (n + k)) where d = digits. Use for integers or fixed-length strings. Ref: `src/algorithms/sorting/radix-sort`

**Bucket Sort** `B` — O(n) average, O(n²) worst, O(n + k) space. Use when data is uniformly distributed over a range. Ref: `src/algorithms/sorting/bucket-sort`

**Tim Sort** `B` — O(n log n) worst, O(n) best (already sorted). Hybrid of merge sort + insertion sort. Stable, adaptive. Default sort in Python and JavaScript. Divides array into "runs", sorts each with insertion sort, merges with merge sort. Ref: `keon/algorithms/sorting/tim_sort` | `src/algorithms/sorting/tim-sort`

**Cocktail Sort (Bidirectional Bubble Sort)** `B` — O(n²) time, O(1) space. Bubble sort that traverses in both directions each pass. Slightly better than bubble sort on nearly sorted data with "turtles" (small values at the end). Primarily educational. Ref: `keon/algorithms/sorting/cocktail_sort`

**Bogo Sort** `B` — O((n+1)!) expected, O(∞) worst, O(1) space. Randomly shuffles array until sorted. Never use in production. Useful only as a theoretical worst-case baseline and joke algorithm. Ref: `keon/algorithms/sorting/bogo_sort`

**Binary Insertion Sort** `B` — O(n²) time (O(n log n) comparisons, O(n²) shifts), O(1) space. Uses binary search to find insertion position. Better than plain insertion sort when comparisons are expensive relative to moves. Source: `TheAlgorithms/JavaScript/Sorts/BinaryInsertionSort.js`

**Comb Sort** `B` — O(n²) worst, O(n log n) average, O(1) space. Generalization of bubble sort using a shrinking gap (factor ~1.3). Eliminates "turtles" (small values at end) early. Simple implementation, decent improvement over bubble sort. Source: `TheAlgorithms/JavaScript/Sorts/CombSort.js`

**Cycle Sort** `B` — O(n²) time, O(1) space. Theoretically optimal for minimizing writes — performs exactly O(n) writes. Use when writes are extremely expensive (flash memory, EEPROM). Not stable. Source: `TheAlgorithms/JavaScript/Sorts/CycleSort.js`

**Gnome Sort** `B` — O(n²) time, O(1) space. Similar to insertion sort but with a simpler single-loop implementation. Moves backward to find correct position, then forward. Educational only. Source: `TheAlgorithms/JavaScript/Sorts/GnomeSort.js`

**Odd-Even Sort (Brick Sort)** `B` — O(n²) time, O(1) space. Alternates between comparing odd-indexed and even-indexed adjacent pairs. Naturally parallelizable — each pass can run in parallel. Use in parallel computing contexts. Source: `TheAlgorithms/JavaScript/Sorts/OddEvenSort.js`

**Pancake Sort** `B` — O(n²) time, O(1) space. Only operation allowed is prefix reversal (flip). Minimizes flips to sort. Constraint-based sorting studied by Gates and Papadimitriou. Source: `TheAlgorithms/JavaScript/Sorts/PancakeSort.js`

**Pigeonhole Sort** `B` — O(n + k) time, O(n + k) space where k = range. Distributes elements into "pigeonholes" matching their key values, then collects. Similar to counting sort. Use when range of keys is approximately equal to number of elements. Source: `TheAlgorithms/JavaScript/Sorts/PigeonHoleSort.js`

**Bead Sort (Gravity Sort)** `B` — O(n × m) time where m = max value, O(n × m) space. Physical analogy: beads on abacus rods falling under gravity. Only works on non-negative integers. Theoretical curiosity. Source: `TheAlgorithms/JavaScript/Sorts/BeadSort.js`

**Stooge Sort** `B` — O(n^2.71) time, O(n) space. Recursively sorts first 2/3, last 2/3, then first 2/3 again. Slower than bubble sort. Theoretical/educational interest only. Source: `TheAlgorithms/JavaScript/Sorts/StoogeSort.js`

**Flash Sort** `B` — O(n) average, O(n²) worst, O(n) space. Distribution-based sort using linear interpolation to classify into buckets, then insertion-sorts within each. Good for uniformly distributed numeric data. Source: `TheAlgorithms/JavaScript/Sorts/FlashSort.js`

**Intro Sort (Introspective Sort)** `A` — O(n log n) guaranteed, O(log n) space. Hybrid: quicksort that switches to heap sort when recursion depth exceeds 2·log(n), uses insertion sort for small partitions. Default sort in C++ STL (std::sort). Best general-purpose sort. Source: `TheAlgorithms/JavaScript/Sorts/IntroSort.js`

**Dutch National Flag Sort** `B` — O(n) time, O(1) space. Three-way partitioning for arrays with three distinct values. Foundation of three-way quicksort (handles many duplicates). Classic interview problem. Source: `TheAlgorithms/JavaScript/Sorts/DutchNationalFlagSort.js`

**Wiggle Sort** `B` — O(n) time, O(1) space. Rearrange array so that a[0] <= a[1] >= a[2] <= a[3] >= ... Alternating peaks and valleys. Single pass with swaps. Source: `TheAlgorithms/JavaScript/Sorts/SimplifiedWiggleSort.js`

**Bitonic Sort** `A` — O(n log² n) time, O(n log² n) comparisons, O(1) space. Sorting network based on bitonic sequences (first ascending then descending). Highly parallelizable — each stage is independent. Use for: GPU/SIMD parallel sorting, hardware sorting networks, FPGA implementations. Source: `TheAlgorithms/C-Plus-Plus/sorting/bitonic_sort.cpp`

**Library Sort (Gapped Insertion Sort)** `B` — O(n log n) expected, O(n²) worst, O(n) space. Insertion sort with gaps left in the array for future insertions (like shelving library books with spaces). Reduces shifts compared to standard insertion sort. Source: `TheAlgorithms/C-Plus-Plus/sorting/library_sort.cpp`

**Strand Sort** `B` — O(n²) worst, O(n) best (sorted), O(n) space. Extracts sorted sublists (strands) from input, then merges them. Natural sort: performs well on partially sorted data. Source: `TheAlgorithms/C-Plus-Plus/sorting/strand_sort.cpp`

**Slow Sort** `B` — O(n^(log n / (2 + ε))) time. Multiply-and-surrender paradigm (opposite of divide and conquer). Recursively finds maximum, places it at end, recurses on rest. Deliberately inefficient — educational counterexample to efficient algorithm design. Source: `TheAlgorithms/C-Plus-Plus/sorting/slow_sort.cpp`

**Wave Sort** `B` — O(n) time, O(1) space. Rearrange array so a[0] >= a[1] <= a[2] >= a[3] <= ... (wave pattern). Similar to wiggle sort but with descending peaks. Single pass comparing adjacent pairs. Source: `TheAlgorithms/C-Plus-Plus/sorting/wave_sort.cpp`

**Merge Insertion Sort (Ford-Johnson)** `A` — O(n log n) time. Theoretically optimal comparison sort that minimizes comparisons. Combines merge sort and binary insertion. Approaches information-theoretic lower bound ⌈log₂(n!)⌉. Use for: when comparison cost dominates (e.g., human sorting). Source: `TheAlgorithms/C-Plus-Plus/sorting/merge_insertion_sort.cpp`

**Count Inversions** `A` — O(n log n) using modified merge sort. Count pairs (i, j) where i < j but arr[i] > arr[j]. Measures how far array is from sorted. Use for: ranking similarity, array sortedness metric, competitive programming. Source: `TheAlgorithms/C-Plus-Plus/sorting/count_inversions.cpp`

---

## Searching

| Scenario | Algorithm | Complexity |
|----------|----------|-----------|
| Unsorted data | Linear Search | O(n) |
| Sorted array | Binary Search | O(log n) |
| Sorted, uniformly distributed | Interpolation Search | O(log log n) avg |
| Sorted, large blocks | Jump Search | O(√n) |
| Sorted 2D matrix | Search in Sorted Matrix | O(m + n) |
| Sorted, unknown size | Exponential Search | O(log n) |
| Sorted, unimodal function | Ternary Search | O(log n) |
| Sorted, Fibonacci-indexed | Fibonacci Search | O(log n) |
| Unsorted, find k-th element | QuickSelect | O(n) avg |

**Linear Search** `B` — O(n). The baseline. Use when data is unsorted or array is tiny. Ref: `src/algorithms/search/linear-search`

**Binary Search** `B` — O(log n). Requires sorted data. The workhorse of searching. Variants: lower/upper bound, rotated array, search insert position. Ref: `src/algorithms/search/binary-search`

**Jump Search** `B` — O(√n). Block-based search in sorted arrays. Useful when backward seeking is cheap but random access isn't (linked structures). Ref: `src/algorithms/search/jump-search`

**Interpolation Search** `B` — O(log log n) avg for uniform data, O(n) worst. Estimates position based on value distribution. Use when data is uniformly distributed and large. Ref: `src/algorithms/search/interpolation-search`

**Search in Sorted Matrix** `B` — O(m + n). Start from top-right corner: go left if target is smaller, down if larger. Works when each row and column is sorted. Use for: 2D range lookups, database-style table queries. Ref: `keon/algorithms/matrix/search_in_sorted_matrix`

**Exponential Search** `B` — O(log n). Find range where element lies by doubling index (1, 2, 4, 8...), then binary search within that range. Use when element is near the beginning of a large sorted array, or when array size is unknown/unbounded. Source: `TheAlgorithms/JavaScript/Search/ExponentialSearch.js`

**Fibonacci Search** `B` — O(log n). Divides search range using Fibonacci numbers instead of halving. Uses only addition/subtraction (no division). Use when division is expensive, or for disk-based searches where sequential access is preferred. Source: `TheAlgorithms/JavaScript/Search/FibonacciSearch.js`

**Ternary Search** `B` — O(log n). Divides sorted range into thirds. Useful for finding min/max of unimodal functions (single peak/valley). For sorted arrays, binary search is faster (fewer comparisons). Source: `TheAlgorithms/JavaScript/Search/TernarySearch.js`

**QuickSelect** `B` — O(n) average, O(n²) worst. Find k-th smallest element without fully sorting. Uses quicksort-style partitioning. Use for: finding median, k-th order statistics, top-k problems. Avoid when: worst-case guarantee needed (use median-of-medians for O(n) guaranteed). Source: `TheAlgorithms/JavaScript/Data-Structures/Array/QuickSelect.js`

---

## Graphs

### Traversal

**Depth-First Search (DFS)** `B` — O(V + E). Use for: path finding, cycle detection, topological sort, connected components, maze solving, tree traversal. Stack-based (recursive or explicit). Ref: `src/algorithms/graph/depth-first-search`

**Breadth-First Search (BFS)** `B` — O(V + E). Use for: shortest path in unweighted graphs, level-order traversal, finding nearest nodes, web crawling. Queue-based. Ref: `src/algorithms/graph/breadth-first-search`

### Shortest Path

| Scenario | Algorithm | Complexity |
|----------|----------|-----------|
| Single source, non-negative weights | Dijkstra | O((V + E) log V) with min-heap |
| Single source, negative weights allowed | Bellman-Ford | O(V × E) |
| Single source with heuristic | A* Search | O(E) best, depends on heuristic |
| All pairs | Floyd-Warshall | O(V³) |
| Unweighted graph | BFS | O(V + E) |

**Dijkstra** `A` — Single-source shortest path. No negative edges. Use for: GPS routing, network routing, game pathfinding. Ref: `src/algorithms/graph/dijkstra`

**Bellman-Ford** `A` — Handles negative edge weights. Detects negative cycles. Slower than Dijkstra but more general. Ref: `src/algorithms/graph/bellman-ford`

**A* Search** `A` — O(E) best case, depends on heuristic quality. Dijkstra + heuristic (estimated cost to goal). Optimal when heuristic is admissible (never overestimates). Use for: game pathfinding, robotics navigation, GPS routing where goal is known. Avoid when: no good heuristic exists (falls back to Dijkstra). Ref: `keon/algorithms/graph/a_star`

**Floyd-Warshall** `A` — All-pairs shortest paths. O(V³). Use when you need distances between ALL pairs and V is small. Ref: `src/algorithms/graph/floyd-warshall`

### Minimum Spanning Tree

**Kruskal's** `B` — O(E log E). Sort edges, use Union-Find. Better for sparse graphs. Ref: `src/algorithms/graph/kruskal`

**Prim's** `A` — O((V + E) log V) with min-heap. Better for dense graphs. Ref: `src/algorithms/graph/prim`

### Other Graph Algorithms

**Topological Sort** `A` — O(V + E). Linear ordering of DAG vertices. Use for: task scheduling, dependency resolution, build systems. Ref: `src/algorithms/graph/topological-sorting`

**Detect Cycle** `A` — DFS-based (directed) or Union-Find (undirected). Essential for dependency validation. Ref: `src/algorithms/graph/detect-cycle`

**Strongly Connected Components (Kosaraju)** `A` — O(V + E). Find maximal strongly connected subgraphs. Ref: `src/algorithms/graph/strongly-connected-components`

**Articulation Points (Tarjan)** `A` — O(V + E). Find vertices whose removal disconnects the graph. Network reliability analysis. Ref: `src/algorithms/graph/articulation-points`

**Bridges** `A` — O(V + E). Find edges whose removal disconnects the graph. Ref: `src/algorithms/graph/bridges`

**Eulerian Path/Circuit** `A` — O(V + E). Visit every edge exactly once. Use for: route optimization, circuit design. Ref: `src/algorithms/graph/eulerian-path`

**Hamiltonian Cycle** `A` — NP-complete. Visit every vertex exactly once. Backtracking solution. Ref: `src/algorithms/graph/hamiltonian-cycle`

**Travelling Salesman** `A` — NP-hard. Shortest route visiting all vertices. Use DP for small n, heuristics for large n. Ref: `src/algorithms/graph/travelling-salesman`

**Maximum Flow (Ford-Fulkerson / Edmonds-Karp)** `A` — Ford-Fulkerson: O(E × max_flow) with DFS. Edmonds-Karp (BFS variant): O(V × E²). Find maximum flow from source to sink in a flow network. Use for: network capacity, bipartite matching, min-cut problems, resource allocation. Ref: `keon/algorithms/graph/maximum_flow`

**Check Bipartite** `A` — O(V + E). BFS/DFS 2-coloring. Determine if graph can be split into two disjoint sets where all edges cross between sets. Use for: task assignment, scheduling, matching problems. Ref: `keon/algorithms/graph/check_bipartite`

**Transitive Closure (Warshall's Algorithm)** `A` — O(V³). Compute reachability matrix: can vertex i reach vertex j? Variant of Floyd-Warshall using boolean OR instead of min. Use for: access control, dependency analysis. Ref: `keon/algorithms/graph/transitive_closure`

**Count Islands** `B` — O(m × n). Find connected components in a 2D grid using BFS, DFS, or Union-Find. Classic interview problem. Use for: image segmentation, region detection, flood fill. Ref: `keon/algorithms/graph/count_islands`

**Gale-Shapley (Stable Matching)** `A` — O(n²). Find stable matching between two equal-sized groups with preference lists. No pair would prefer each other over their assigned partners. Use for: hospital-resident matching, college admissions, market design. Ref: `keon/algorithms/greedy/gale_shapley`

**Binary Lifting / LCA** `A` — O(n log n) preprocessing, O(log n) per query. Precompute 2^k-th ancestors for every node using DP. Enables O(log n) Lowest Common Ancestor queries on trees. Use for: tree path queries, distance between tree nodes, phylogenetic analysis. Source: `TheAlgorithms/JavaScript/Graphs/BinaryLifting.js` | `TheAlgorithms/JavaScript/Graphs/LCABinaryLifting.js`

**Graph Density** `B` — O(1). Ratio of actual edges to maximum possible edges. density = 2|E| / (|V|(|V|-1)) for undirected. Use for: choosing between adjacency list vs matrix representation, analyzing network structure. Source: `TheAlgorithms/JavaScript/Graphs/Density.js`

**Bidirectional Dijkstra** `A` — O((V + E) log V). Run Dijkstra simultaneously from source and target, stop when search frontiers meet. Up to 2x faster than standard Dijkstra for point-to-point queries. Use for: road network routing, social network distance, any point-to-point shortest path. Source: `TheAlgorithms/C-Plus-Plus/graph/bidirectional_dijkstra.cpp`

**Hopcroft-Karp** `A` — O(E × √V). Maximum matching in bipartite graphs. Uses BFS to find augmenting paths layer by layer, then DFS to augment. Faster than Hungarian algorithm for sparse bipartite graphs. Use for: job assignment, resource allocation, network flow reduction. Source: `TheAlgorithms/C-Plus-Plus/graph/hopcroft_karp.cpp`

**Boruvka's MST** `A` — O(E log V). Each iteration, every component adds its cheapest outgoing edge. Parallelizable — all components process independently. Use for: parallel/distributed MST computation, when edges are already sorted, geometric MST. Source: `TheAlgorithms/C-Plus-Plus/greedy_algorithms/boruvkas_minimum_spanning_tree.cpp`

**Bridge Finding (Tarjan)** `A` — O(V + E). Find all bridge edges whose removal disconnects the graph. Extension of Tarjan's DFS with low-link values. Use for: network vulnerability analysis, identifying critical connections, biconnected components. Source: `TheAlgorithms/C-Plus-Plus/graph/bridge_finding_with_tarjan_algorithm.cpp`

**Tarjan's SCC (Strongly Connected Components)** `A` — O(V + E). Single-pass DFS algorithm using a stack and low-link values to find all SCCs. More efficient than Kosaraju in practice (single DFS pass vs two). Use for: compiler dependency analysis, 2-SAT reduction, circuit analysis, social network community detection. Source: `TheAlgorithms/Python/graphs/tarjans_scc.py` | `williamfiset/Algorithms/graphtheory/TarjanSccSolverAdjacencyList.java`

**2-SAT Solver** `A` — O(V + E). Determine satisfiability of boolean formula in 2-CNF form. Build implication graph, find SCCs with Tarjan/Kosaraju — satisfiable iff no variable and its negation are in same SCC. Use for: constraint satisfaction, scheduling with pairwise constraints, configuration validation. Source: `williamfiset/Algorithms/graphtheory/TwoSatSolverAdjacencyList.java`

**Steiner Tree** `A` — NP-hard in general. Find minimum-weight tree connecting a given subset of vertices (terminal nodes). Exact DP solution: O(3^k × n + 2^k × n² + n × m × log n) where k = number of terminals. Use for: network design (connecting specific nodes), VLSI routing, phylogenetics. Source: `williamfiset/Algorithms/graphtheory/SteinerTree.java`

**Chinese Postman Problem** `A` — O(V³) for undirected graphs. Find minimum-weight closed walk that traverses every edge at least once. For undirected: find minimum-weight perfect matching on odd-degree vertices. Use for: mail route optimization, snow plowing, street sweeping, garbage collection. Source: `williamfiset/Algorithms/graphtheory/ChinesePostmanProblem.java`

**Eager Prim's MST** `A` — O(E log V). Improved Prim's using indexed priority queue — updates existing entries instead of lazy insertion. Avoids stale edges in priority queue. Use for: dense graphs where lazy Prim's creates too many stale entries. Source: `williamfiset/Algorithms/graphtheory/EagerPrimsAdjacencyList.java`

---

## Network Flow

Algorithms for computing maximum flow, minimum cut, and related problems in flow networks.

### Quick Selection Guide

| Scenario | Algorithm | Complexity |
|----------|-----------|-----------|
| Max flow, integer capacities | Ford-Fulkerson (DFS) | O(E × max_flow) |
| Max flow, general | Edmonds-Karp (BFS) | O(V × E²) |
| Max flow, dense graphs | Dinic's algorithm | O(V² × E) |
| Max flow, large capacities | Capacity Scaling | O(E² × log(max_cap)) |
| Min-cost max-flow | Successive Shortest Paths (Johnson's) | O(V² × E × log V) |
| Min-cost max-flow, simple | Bellman-Ford based MCMF | O(V × E × max_flow) |
| Bipartite matching | Hopcroft-Karp | O(E × √V) |
| Multi-source/multi-sink flow | Edmonds-Karp with super-source/sink | O(V × E²) |

**Dinic's Algorithm** `A` — O(V² × E) time. Layered network approach: BFS builds level graph, DFS finds blocking flows. Much faster than Edmonds-Karp on dense graphs. O(E × √V) for unit-capacity graphs (bipartite matching). Use for: max flow on dense networks, bipartite matching, competitive programming. Avoid when: graph is very sparse (Edmonds-Karp may suffice). Source: `TheAlgorithms/Python/graphs/dinic.py` | `williamfiset/Algorithms/graphtheory/networkflow/Dinics.java`

**Capacity Scaling** `A` — O(E² × log(max_cap)) time. Ford-Fulkerson variant that only uses augmenting paths with capacity >= delta, halving delta each phase. Avoids many small augmentations. Use for: networks with large capacity values where Ford-Fulkerson would be slow, practical max-flow implementations. Source: `williamfiset/Algorithms/graphtheory/networkflow/CapacityScalingSolverAdjacencyList.java`

**Min-Cost Max-Flow (Johnson's)** `A` — O(V² × E × log V) time. Find maximum flow with minimum total cost. Uses Johnson's algorithm (Dijkstra with potentials) for shortest path computation. Use for: assignment problems with costs, transportation optimization, supply chain allocation. Source: `williamfiset/Algorithms/graphtheory/networkflow/MinCostMaxFlowJohnsons.java`

**Min-Cost Max-Flow (Bellman-Ford)** `A` — O(V × E × max_flow) time. Simpler min-cost max-flow using Bellman-Ford to find shortest augmenting paths. Handles negative edge weights naturally. Use for: min-cost flow when graph has negative costs, simpler implementation when performance is not critical. Source: `williamfiset/Algorithms/graphtheory/networkflow/MinCostMaxFlowWithBellmanFord.java`

**Edmonds-Karp (Multi-Source/Sink)** `A` — O(V × E²) time. Extension of Edmonds-Karp for multiple sources and sinks by adding virtual super-source and super-sink. Use for: supply/demand networks, multiple factory-to-warehouse routing, water distribution. Source: `TheAlgorithms/Python/graphs/edmonds_karp_multiple_source_and_sink.py`

**Minimum Cut** `A` — O(V × E²) via max-flow min-cut theorem. Find minimum weight set of edges whose removal disconnects source from sink. Compute max flow, then BFS from source in residual graph to find cut. Use for: network reliability, image segmentation, community detection, "minimum removals to disconnect" problems. Source: `TheAlgorithms/Python/networking_flow/minimum_cut.py`

---

## Strings

| Problem | Algorithm | Complexity |
|---------|----------|-----------|
| Pattern matching (single pattern) | KMP | O(n + m) |
| Pattern matching (bad char heuristic) | Boyer-Moore | O(n/m) best, O(n × m) worst |
| Pattern matching (hash-based) | Rabin-Karp | O(n + m) avg |
| Substring search (multiple positions) | Z Algorithm | O(n + m) |
| Edit distance | Levenshtein | O(n × m) |
| Longest common substring | DP | O(n × m) |
| Regex matching | DP | O(n × m) |
| Wildcard matching (? and *) | DP | O(n × m) |
| Longest common prefix | Vertical scan / D&C | O(S) total chars |
| Minimum window with all chars | Sliding Window | O(n) |

**Hamming Distance** `B` — Count differing positions in equal-length strings. O(n). Ref: `src/algorithms/string/hamming-distance`

**Palindrome Check** `B` — Multiple approaches: reverse compare, two-pointer, expand around center. Ref: `src/algorithms/string/palindrome`

**Levenshtein Distance** `A` — Minimum edit operations (insert, delete, replace) between two strings. O(n × m). Use for: fuzzy matching, spell correction, diff algorithms. Ref: `src/algorithms/string/levenshtein-distance`

**KMP (Knuth-Morris-Pratt)** `A` — O(n + m) pattern matching with failure function. No backtracking. Use for: single pattern search in large text. Ref: `src/algorithms/string/knuth-morris-pratt`

**Z Algorithm** `A` — O(n + m). Builds Z-array of matching prefix lengths. Alternative to KMP for pattern matching. Ref: `src/algorithms/string/z-algorithm`

**Rabin-Karp** `A` — O(n + m) avg with rolling hash. Good for multiple pattern search. Ref: `src/algorithms/string/rabin-karp`

**Longest Common Substring** `A` — O(n × m) DP. Find longest shared contiguous sequence. Ref: `src/algorithms/string/longest-common-substring`

**Regular Expression Matching** `A` — O(n × m) DP. Support for `.` and `*` wildcards. Ref: `src/algorithms/string/regular-expression-matching`

**Wildcard Matching** `A` — O(n × m) DP. Pattern matching with `?` (single char) and `*` (any sequence). Simpler than full regex. Use for: glob patterns, file matching, simple query filters. Ref: `keon/algorithms/string/wildcard_matching`

**Longest Common Prefix** `B` — O(S) where S = sum of all character lengths. Vertical scan: compare column by column. Use for: autocomplete, command-line tab completion, IP routing tables. Ref: `keon/algorithms/string/longest_common_prefix`

**Minimum Window Substring** `A` — O(n). Sliding window + hash map. Find smallest substring containing all characters of target string. Use for: text search, bioinformatics sequence alignment. Classic two-pointer interview problem. Ref: `keon/algorithms/string/min_window_substring`

**Decode String** `A` — O(n) with stack. Expand encoded strings like `3[a2[c]]` → `accaccacc`. Use for: data decompression, template expansion. Ref: `keon/algorithms/string/decode_string`

**Boyer-Moore** `A` — O(n/m) best, O(n × m) worst. Uses bad character rule and good suffix rule to skip sections of text. Often sub-linear in practice — fastest single-pattern string search for large alphabets. Use for: text editors, grep implementations, large text search. Source: `TheAlgorithms/JavaScript/String/BoyerMoore.js`

**Dice Coefficient** `B` — O(n + m). Measures similarity between two strings using bigram overlap: 2|X ∩ Y| / (|X| + |Y|). Returns value between 0 (no similarity) and 1 (identical). Use for: fuzzy string matching, duplicate detection, spell checking alternatives to Levenshtein. Source: `TheAlgorithms/JavaScript/String/DiceCoefficient.js`

**Check Anagram** `B` — O(n). Determine if two strings are anagrams using frequency counting (hash map or array). Use for: word games, cryptography basics, interview problems. Source: `TheAlgorithms/JavaScript/String/CheckAnagram.js`

**Check Pangram** `B` — O(n). Determine if a string contains every letter of the alphabet at least once. Use a set or boolean array. Source: `TheAlgorithms/JavaScript/String/CheckPangram.js`

**Longest Substring Without Repeating Characters** `B` — O(n). Sliding window with hash set. Track window of unique characters, expand right, shrink left when duplicate found. Classic interview problem. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/Sliding-Window/LongestSubstringWithoutRepeatingCharacters.js`

**Manacher's Algorithm** `A` — O(n). Find longest palindromic substring in linear time. Exploits symmetry: reuses previously computed palindrome radii to avoid redundant work. Transform string with separators to handle even-length palindromes uniformly. Use for: palindrome detection, DNA sequence analysis, competitive programming. Source: `TheAlgorithms/C-Plus-Plus/strings/manacher_algorithm.cpp`

**Horspool Algorithm** `A` — O(n/m) best, O(n × m) worst. Simplified Boyer-Moore using only the bad character rule. Preprocessing builds shift table from last occurrence of each character in pattern. Simpler to implement than full Boyer-Moore with competitive practical performance. Use for: text editors, simple string search where implementation simplicity matters. Source: `TheAlgorithms/C-Plus-Plus/strings/horspool.cpp`

**Duval Algorithm (Lyndon Factorization)** `A` — O(n) time, O(1) space. Decompose string into non-increasing sequence of Lyndon words (primitive strings that are lexicographically smaller than all their rotations). Use for: computing lexicographically smallest rotation, suffix array construction (Lyndon-based), string combinatorics. Source: `TheAlgorithms/C-Plus-Plus/strings/duval.cpp`

**Suffix Array** `A` — O(n log n) build (O(n log² n) simpler), O(m log n) search where m = pattern length. Sorted array of all suffixes of a string. Space-efficient alternative to suffix tree. Use for: pattern matching, longest repeated substring, longest common prefix array construction, bioinformatics genome analysis. Source: `williamfiset/Algorithms/datastructures/suffixarray`

**Aho-Corasick** `A` — O(n + m + z) where n = text length, m = total pattern length, z = matches. Multi-pattern string matching using a trie with failure links (automaton). Processes all patterns simultaneously in one pass over text. Use for: dictionary matching, intrusion detection, DNA motif finding, content filtering. Source: `TheAlgorithms/Python/strings/aho_corasick.py`

---

## Math

**Factorial** `B` — O(n). Iterative preferred over recursive for large n. Ref: `src/algorithms/math/factorial`

**Fibonacci** `B` — O(n) iterative/DP, O(log n) with matrix exponentiation, O(1) with Binet's formula (loses precision). Ref: `src/algorithms/math/fibonacci`

**Primality Test** `B` — O(√n) trial division. For large numbers: Miller-Rabin. Ref: `src/algorithms/math/primality-test`

**Sieve of Eratosthenes** `B` — O(n log log n). Generate all primes up to n. Ref: `src/algorithms/math/sieve-of-eratosthenes`

**Euclidean Algorithm (GCD)** `B` — O(log min(a,b)). Foundation for LCM, modular inverse. Ref: `src/algorithms/math/euclidean-algorithm`

**LCM** `B` — Via GCD: lcm(a,b) = a × b / gcd(a,b). Ref: `src/algorithms/math/least-common-multiple`

**Fast Powering** `B` — O(log n). Exponentiation by squaring. Essential for modular arithmetic. Ref: `src/algorithms/math/fast-powering`

**Bit Manipulation** `B` — O(1) per operation. Set/get/clear/toggle bits, count set bits, is power of 2, multiply/divide by 2. Ref: `src/algorithms/math/bits`

**Pascal's Triangle** `B` — O(n²). Binomial coefficients. Use for: combinations, probability. Ref: `src/algorithms/math/pascal-triangle`

**Horner's Method** `B` — O(n). Polynomial evaluation. Minimizes multiplications. Ref: `src/algorithms/math/horner-method`

**Matrix Operations** `B` — Multiplication O(n³) naive, O(n^2.37) Strassen. Use for: linear transformations, graph algorithms, Fibonacci. Ref: `src/algorithms/math/matrix`

**Euclidean Distance** `B` — O(d) for d dimensions. Point/vector distance. Ref: `src/algorithms/math/euclidean-distance`

**Integer Partition** `A` — Number of ways to sum to n. DP solution. Ref: `src/algorithms/math/integer-partition`

**Square Root (Newton's Method)** `A` — Iterative approximation. O(log n) iterations for n digits of precision. Ref: `src/algorithms/math/square-root`

**Discrete Fourier Transform** `A` — O(n²) naive, O(n log n) FFT. Signal processing, polynomial multiplication. Ref: `src/algorithms/math/fourier-transform`

**Chinese Remainder Theorem** `A` — O(n log m). Solve system of simultaneous congruences x ≡ a₁ (mod m₁), x ≡ a₂ (mod m₂), ... Requires pairwise coprime moduli. Use for: cryptography (RSA optimization), distributed systems (secret sharing), calendar calculations. Ref: `keon/algorithms/math/chinese_remainder_theorem`

**Euler's Totient Function** `A` — O(√n). Count integers from 1 to n that are coprime to n. φ(p) = p-1 for prime p. Use for: RSA key generation, modular arithmetic, group theory. Ref: `keon/algorithms/math/euler_totient`

**Extended Euclidean Algorithm** `A` — O(log min(a,b)). Finds GCD plus Bezout coefficients (x, y) such that ax + by = gcd(a,b). Foundation for modular inverse computation. Ref: `keon/algorithms/math/extended_gcd`

**Modular Inverse** `A` — O(log m). Find x such that (a × x) ≡ 1 (mod m). Exists only when gcd(a, m) = 1. Via Extended GCD or Fermat's little theorem (when m is prime). Use for: modular division, cryptography, competitive programming. Ref: `keon/algorithms/math/mod_inverse`

**Base Conversion** `B` — O(log_b(n)). Convert integer between arbitrary number bases (binary, octal, hex, etc.). Repeated division by target base. Use for: number representation, encoding, CS fundamentals. Ref: `keon/algorithms/math/base_conversion`

**Gray Code** `A` — O(2^n). Generate sequence where consecutive numbers differ by exactly one bit. n-bit Gray code has 2^n entries. Use for: error correction, rotary encoders, genetic algorithms, Karnaugh maps. Ref: `keon/algorithms/bit/gray_code`

**Fermat Primality Test** `A` — O(k log² n). Probabilistic primality test using Fermat's little theorem: if n is prime, a^(n-1) ≡ 1 (mod n). Fast but can be fooled by Carmichael numbers. Use for: quick probable-prime checks, cryptographic key generation. Source: `TheAlgorithms/JavaScript/Maths/FermatPrimalityTest.js`

**Linear Sieve** `A` — O(n). Generates all primes up to n with each composite marked exactly once. Faster than Sieve of Eratosthenes by constant factor. Also computes smallest prime factor for each number. Use for: competitive programming, bulk factorization. Source: `TheAlgorithms/JavaScript/Maths/LinearSieve.js`

**Collatz Sequence (3n+1)** `B` — Unproven termination. If even: n/2, if odd: 3n+1. Conjecture: always reaches 1. Use for: mathematical exploration, sequence analysis. Source: `TheAlgorithms/JavaScript/Maths/CollatzSequence.js`

**Catalan Numbers** `A` — O(n) time. C(n) = C(2n,n)/(n+1). Counts: valid parentheses sequences, BST shapes, triangulations of polygon, paths in grid. Appears in surprisingly many combinatorial problems. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/CatalanNumbers.js`

**Binomial Coefficient** `B` — O(min(k, n-k)). C(n,k) = n! / (k!(n-k)!). Compute efficiently via multiplicative formula to avoid overflow. Foundation for combinations, probability, Pascal's triangle. Source: `TheAlgorithms/JavaScript/Maths/BinomialCoefficient.js`

**Armstrong Number (Narcissistic)** `B` — O(d) where d = digits. A number equal to sum of its digits each raised to power d (e.g., 153 = 1³ + 5³ + 3³). Use for: number theory puzzles. Source: `TheAlgorithms/JavaScript/Maths/ArmstrongNumber.js`

**Perfect Number** `B` — O(√n). A number equal to sum of its proper divisors (e.g., 6 = 1+2+3). Related to Mersenne primes. Source: `TheAlgorithms/JavaScript/Maths/PerfectNumber.js`

**Aliquot Sum** `B` — O(√n). Sum of proper divisors of n. Foundation for perfect, abundant, and deficient number classification. Source: `TheAlgorithms/JavaScript/Maths/AliquotSum.js`

**Lucas Series** `B` — O(n). Like Fibonacci but starts with 2, 1: L(n) = L(n-1) + L(n-2). Related to Fibonacci by identity: L(n) = F(n-1) + F(n+1). Source: `TheAlgorithms/JavaScript/Maths/LucasSeries.js`

**Mobius Function** `A` — O(√n). μ(n) = 0 if n has squared prime factor, (-1)^k if n is product of k distinct primes. Foundation for Mobius inversion. Use for: number theory, combinatorics, inclusion-exclusion. Source: `TheAlgorithms/JavaScript/Maths/MobiusFunction.js`

**Liouville Function** `A` — O(√n). λ(n) = (-1)^Ω(n) where Ω(n) = total prime factors with multiplicity. Completely multiplicative. Related to Riemann zeta function. Source: `TheAlgorithms/JavaScript/Maths/LiouvilleFunction.js`

**Shor's Algorithm** `A` — Quantum algorithm for integer factorization in polynomial time. Classical simulation is exponential. Theoretical significance: breaks RSA if quantum computers scale. Source: `TheAlgorithms/JavaScript/Maths/ShorsAlgorithm.js`

**Bisection Method** `B` — O(log((b-a)/ε)). Root-finding by repeatedly halving interval where function changes sign. Simple, guaranteed convergence. Use for: solving equations numerically, finding zeros. Source: `TheAlgorithms/JavaScript/Maths/BisectionMethod.js`

**Simpson's Rule (Integration)** `B` — O(n). Numerical integration using parabolic approximation over subintervals. More accurate than trapezoidal rule for same number of points. Source: `TheAlgorithms/JavaScript/Maths/SimpsonIntegration.js`

**Midpoint Integration** `B` — O(n). Numerical integration using rectangle rule with midpoint evaluation. Simple approximation for definite integrals. Source: `TheAlgorithms/JavaScript/Maths/MidpointIntegration.js`

**Euler Method** `B` — O(n). Simplest numerical method for solving ODEs: y(t+h) ≈ y(t) + h·f(t,y). First-order accuracy. Use for: physics simulations, population models, simple differential equations. Source: `TheAlgorithms/JavaScript/Maths/EulerMethod.js`

**Matrix Determinant** `A` — O(n³) via Gaussian elimination, O(n!) naive expansion. Scalar value encoding whether matrix is invertible. det = 0 means singular. Use for: solving linear systems, computing inverse, geometric transformations. Source: `TheAlgorithms/JavaScript/Maths/Determinant.js`

**Row Echelon Form** `A` — O(n²m) Gaussian elimination. Transform matrix to upper triangular form. Foundation for solving linear systems, computing rank, finding inverse. Source: `TheAlgorithms/JavaScript/Maths/RowEchelon.js`

**Reverse Polish Notation Evaluator** `B` — O(n) with stack. Evaluate postfix expressions (3 4 + 2 × = 14). No parentheses needed. Use for: calculator implementations, compiler expression evaluation. Source: `TheAlgorithms/JavaScript/Maths/ReversePolishNotation.js`

**Softmax Function** `B` — O(n). Converts vector of real numbers to probability distribution: softmax(x_i) = e^x_i / Σe^x_j. Use for: neural network output layers, multi-class classification, attention mechanisms. Source: `TheAlgorithms/JavaScript/Maths/Softmax.js`

**Pi Approximation (Monte Carlo)** `B` — O(n) for n random points. Estimate π by ratio of points inside unit circle to total points in unit square. Accuracy ≈ O(1/√n). Use for: demonstrating Monte Carlo methods, statistical sampling. Source: `TheAlgorithms/JavaScript/Maths/PiApproximationMonteCarlo.js`

**Zeller's Congruence** `B` — O(1). Calculate day of week for any date. Direct formula using year, month, day. Use for: calendar applications, date validation. Source: `TheAlgorithms/JavaScript/Maths/ZellersCongruenceAlgorithm.js`

**Arithmetic-Geometric Mean** `B` — O(log(1/ε)) iterations. Iteratively compute arithmetic and geometric means until convergence. Converges quadratically. Use for: computing π, elliptic integrals, high-precision arithmetic. Source: `TheAlgorithms/JavaScript/Maths/ArithmeticGeometricMean.js`

**Figurate Numbers** `B` — O(1). Polygonal numbers (triangular, square, pentagonal, etc.). Formula: P(s,n) = n((s-2)n - (s-4))/2. Use for: number theory, combinatorics. Source: `TheAlgorithms/JavaScript/Maths/FigurateNumber.js`

**Miller-Rabin Primality Test** `A` — O(k log² n). Probabilistic primality test stronger than Fermat's. Based on properties of strong pseudoprimes. No Carmichael number problem. Use for: cryptographic key generation, large prime verification, competitive programming. Source: `TheAlgorithms/C-Plus-Plus/math/miller_rabin.cpp`

**N-Bonacci Numbers** `B` — O(n). Generalization of Fibonacci: each term is sum of previous n terms. F(n) = F(n-1) + F(n-2) + ... + F(n-k). Tribonacci (k=3), Tetranacci (k=4), etc. Use for: generalized recurrence analysis, combinatorial counting. Source: `TheAlgorithms/C-Plus-Plus/math/n_bonacci.cpp`

**NCR Modulo P** `A` — O(n) preprocessing, O(1) per query. Compute C(n, r) mod p efficiently using precomputed factorials and modular inverse. Essential for combinatorics in modular arithmetic. Use for: competitive programming, cryptography, counting problems with large numbers. Source: `TheAlgorithms/C-Plus-Plus/math/ncr_modulo_p.cpp`

**Quadratic Equation Solver** `B` — O(1). Solve ax² + bx + c = 0 including complex roots. Discriminant-based: real roots when D >= 0, complex when D < 0. Use for: physics, engineering calculations, geometric computations. Source: `TheAlgorithms/C-Plus-Plus/math/quadratic_equations_complex_numbers.cpp`

**Linear Recurrence via Matrix Exponentiation** `A` — O(k³ log n) where k = order of recurrence. Compute nth term of any linear recurrence using matrix exponentiation. Generalization of Fibonacci matrix method. Use for: computing large terms in O(log n), competitive programming. Source: `TheAlgorithms/C-Plus-Plus/math/linear_recurrence_matrix.cpp`

**Inverse Square Root (Fast)** `B` — O(1). Quake III's famous 0x5F3759DF magic number approximation. Uses bit-level floating point manipulation + one Newton iteration. Historical curiosity — modern hardware has fast rsqrt instructions. Source: `TheAlgorithms/C-Plus-Plus/math/inv_sqrt.cpp`

---

## Numerical Methods

### Quick Selection Guide

| Need | Algorithm | Complexity | Why |
|------|-----------|-----------|-----|
| Root of f(x) = 0, simple | Bisection Method | O(log((b-a)/ε)) | Guaranteed convergence |
| Root of f(x) = 0, fast | Newton-Raphson | O(log n) iterations | Quadratic convergence |
| Root, no derivative needed | False Position (Regula Falsi) | O(log((b-a)/ε)) | Faster than bisection usually |
| Root, robust for tough functions | Brent's Method | superlinear | Combines bisection + secant |
| All roots of polynomial | Durand-Kerner | varies | Finds all roots simultaneously |
| Solve linear system Ax=b | Gaussian Elimination | O(n³) | Direct method |
| Matrix factorization | LU Decomposition | O(n³) | Reuse for multiple right-hand sides |
| Eigenvalues | QR Algorithm | O(n³) per iteration | Standard eigenvalue method |
| Numerical integration | Simpson's Rule | O(n) | Parabolic approximation |
| Solve ODE dy/dt = f(t,y) | Runge-Kutta (RK4) | O(n) | Fourth-order accuracy |
| Minimize f(x) on interval | Golden Section Search | O(log((b-a)/ε)) | No derivatives needed |
| Orthogonal basis | Gram-Schmidt | O(n²m) | QR factorization building block |

### Detailed Entries

**Newton-Raphson Method** `A` — O(log n) iterations with quadratic convergence. Root finding: x_{n+1} = x_n - f(x_n)/f'(x_n). Requires derivative. Converges very fast near root but can diverge with bad initial guess. Use for: solving nonlinear equations, optimization (finding where gradient = 0), numerical analysis. Avoid when: derivative is expensive/unavailable (use secant method), function has flat regions or multiple roots nearby. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/newton_raphson_method.cpp`

**False Position (Regula Falsi)** `A` — O(log((b-a)/ε)). Root finding using linear interpolation between endpoints where f changes sign. Faster than bisection on average but can stall on one side. Use for: root finding when function is approximately linear near root. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/false_position.cpp`

**Babylonian Method (Square Root)** `B` — O(log(1/ε)) iterations. Ancient algorithm equivalent to Newton's method applied to f(x) = x² - S. x_{n+1} = (x_n + S/x_n) / 2. Quadratic convergence. Use for: fast square root computation, hardware implementations. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/babylonian_method.cpp`

**Successive Approximation (Fixed-Point Iteration)** `B` — O(log(1/ε)). Solve x = g(x) by iteration: x_{n+1} = g(x). Converges when |g'(x)| < 1 near fixed point. Simplest iterative method. Use for: solving implicit equations, simple iterative schemes. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/successive_approximation.cpp`

**Brent's Method (Extrema)** `A` — Superlinear convergence. Combines inverse quadratic interpolation, secant method, and bisection. Robust root finder that adapts strategy based on convergence behavior. Use for: production-quality root finding, when robustness matters more than simplicity. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/brent_method_extrema.cpp`

**Durand-Kerner Method** `A` — Finds ALL roots of a polynomial simultaneously. Iteratively refines n initial guesses for an nth-degree polynomial. Works for complex roots. Use for: finding all zeros of a polynomial, control systems, signal processing. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/durand_kerner_roots.cpp`

**Golden Section Search** `A` — O(log((b-a)/ε)). Find minimum/maximum of unimodal function without derivatives. Divides interval using golden ratio φ = (1+√5)/2 for optimal convergence. Use for: optimization of expensive-to-evaluate functions, when derivatives are unavailable. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/golden_search_extrema.cpp`

**Gaussian Elimination** `A` — O(n³). Solve systems of linear equations Ax = b by row reduction to row echelon form, then back-substitution. Can also compute determinant and matrix inverse. Use for: linear system solving, matrix rank computation, engineering simulations. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/gaussian_elimination.cpp`

**LU Decomposition** `A` — O(n³) factorization, O(n²) per solve. Factor matrix A = LU (lower × upper triangular). Solve by forward + back substitution. Use for: solving Ax = b for multiple right-hand sides b efficiently, matrix inversion, determinant computation. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/lu_decompose.cpp`

**QR Decomposition** `A` — O(n²m) where A is m×n. Factor A = QR where Q is orthogonal and R is upper triangular. Foundation for QR eigenvalue algorithm. Use for: least squares problems, eigenvalue computation, numerical stability. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/qr_decompose.cpp`

**QR Eigenvalue Algorithm** `A` — O(n³) per iteration, typically O(n) iterations with shifts. Iteratively compute QR decomposition to converge to eigenvalues. The standard numerical method for eigenvalue problems. Use for: principal component analysis, vibration analysis, stability analysis. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/qr_eigenvalues.cpp`

**Gram-Schmidt Orthogonalization** `A` — O(n²m). Transform a set of linearly independent vectors into an orthonormal basis. Foundation for QR decomposition. Use for: constructing orthogonal bases, numerical linear algebra, signal processing. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/gram_schmidt.cpp`

**Composite Simpson's Rule** `B` — O(n). Numerical integration using parabolic approximation over subintervals: ∫f(x)dx ≈ (h/3)[f(x₀) + 4f(x₁) + 2f(x₂) + ... + f(xₙ)]. Fourth-order accuracy O(h⁴). More accurate than trapezoidal rule for same computational cost. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/composite_simpson_rule.cpp`

**Runge-Kutta Method (RK4)** `A` — O(n). Fourth-order method for solving ordinary differential equations. Uses four slope evaluations per step: k1, k2, k3, k4 weighted average. Global error O(h⁴). Use for: physics simulations, population dynamics, circuit analysis, any ODE initial value problem. Superior to Euler method in accuracy. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/runge_kutta.cpp`

**ODE Midpoint Euler** `B` — O(n). Second-order ODE solver. Evaluate slope at midpoint of interval: y_{n+1} = y_n + h·f(t_n + h/2, y_n + (h/2)·f(t_n, y_n)). Better accuracy than forward Euler with same step count. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/ode_midpoint_euler.cpp`

**ODE Semi-Implicit Euler** `B` — O(n). Symplectic integrator for Hamiltonian systems. Updates velocity first, then uses new velocity for position. Conserves energy over long simulations. Use for: orbital mechanics, molecular dynamics, game physics where energy conservation matters. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/ode_semi_implicit_euler.cpp`

**Inverse FFT** `A` — O(n log n). Inverse of Fast Fourier Transform: recover time-domain signal from frequency-domain representation. Same algorithm as FFT with conjugate and normalization. Use for: signal reconstruction, polynomial multiplication (complement to FFT), audio processing. Source: `TheAlgorithms/C-Plus-Plus/numerical_methods/inverse_fast_fourier_transform.cpp`

---

## Linear Algebra

Algorithms for matrix operations, linear systems, and vector computations beyond basic matrix multiplication.

**Jacobi Iteration Method** `A` — O(n² × k) where k = iterations. Iterative solver for diagonally dominant linear systems Ax = b. Each variable updated independently using previous iteration values. Naturally parallelizable. Use for: large sparse systems, parallel computing, when direct methods are too expensive. Avoid when: matrix is not diagonally dominant (may not converge). Source: `TheAlgorithms/Python/linear_algebra/jacobi_iteration_method.py`

**Matrix Inversion** `A` — O(n³). Compute A⁻¹ such that A × A⁻¹ = I. Via Gauss-Jordan elimination or LU decomposition. Use for: solving linear systems (though direct solve is preferred), computing pseudoinverse, control theory. Avoid when: matrix is ill-conditioned (use SVD instead). Source: `TheAlgorithms/Python/linear_algebra/matrix_inversion.py`

**Strassen Matrix Multiplication** `A` — O(n^2.807) time. Divide-and-conquer: splits matrices into quadrants, uses 7 sub-multiplications instead of 8. Practical speedup for large matrices (n > 64). Use for: large matrix multiplication, computational geometry, graph algorithms on dense adjacency matrices. Ref: `TheAlgorithms/Python/divide_and_conquer/strassen_matrix_multiplication.py`

---

## Linear Programming

**Simplex Method** `A` — O(2^n) worst case, polynomial in practice. Solve linear optimization problems: maximize c^T x subject to Ax <= b, x >= 0. Traverses vertices of feasible polytope. The workhorse of operations research. Use for: resource allocation, scheduling, transportation, diet problems, portfolio optimization. Avoid when: problem is non-linear (use convex optimization). Source: `TheAlgorithms/Python/linear_programming/simplex.py`

---

## Sets & Combinatorics

**Cartesian Product** `B` — All ordered pairs from two sets. O(n × m). Ref: `src/algorithms/sets/cartesian-product`

**Fisher-Yates Shuffle** `B` — O(n). Unbiased random permutation. The correct way to shuffle. Ref: `src/algorithms/sets/fisher-yates`

**Power Set** `A` — All 2^n subsets. Bitwise or recursive. Ref: `src/algorithms/sets/power-set`

**Permutations** `A` — O(n!). With/without repetitions. Ref: `src/algorithms/sets/permutations`

**Combinations** `A` — O(C(n,k)). With/without repetitions. Ref: `src/algorithms/sets/combinations`

**Longest Common Subsequence** `A` — O(n × m) DP. Use for: diff algorithms, version control, DNA sequence alignment. Ref: `src/algorithms/sets/longest-common-subsequence`

**Longest Increasing Subsequence** `A` — O(n log n) with patience sorting. Use for: sequence analysis, optimization. Ref: `src/algorithms/sets/longest-increasing-subsequence`

**Shortest Common Supersequence** `A` — Via LCS. O(n × m). Ref: `src/algorithms/sets/shortest-common-supersequence`

**Knapsack Problem** `A` — 0/1: O(n × W) DP. Unbounded: O(n × W). Resource allocation under constraints. Ref: `src/algorithms/sets/knapsack-problem`

**Maximum Subarray (Kadane's)** `A` — O(n). Find contiguous subarray with largest sum. Classic DP/greedy. Ref: `src/algorithms/sets/maximum-subarray`

**Combination Sum** `A` — Backtracking. Find all combinations summing to target. Ref: `src/algorithms/sets/combination-sum`

**Coin Change** `A` — O(n × amount) DP. Minimum coins to make a target amount (unbounded knapsack variant). Use for: cash register systems, resource minimization. Ref: `keon/algorithms/dp/coin_change`

**Max Product Subarray** `A` — O(n). Track both max and min products (negative × negative = positive). Variant of Kadane's. Use for: stock analysis, signal processing. Ref: `keon/algorithms/dp/max_product_subarray`

---

## Dynamic Programming Problems

**Longest Palindromic Subsequence** `A` — O(n²) DP. Find longest subsequence that reads same forwards and backwards. dp[i][j] = LPS length for substring i..j. Interval DP pattern. Use for: DNA analysis, text processing. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/LongestPalindromicSubsequence.js`

**Longest Valid Parentheses** `A` — O(n). Find length of longest valid parentheses substring. Stack-based or DP. dp[i] = length of longest valid ending at i. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/LongestValidParentheses.js`

**Max Non-Adjacent Sum** `A` — O(n) DP. Maximum sum of non-adjacent elements. Same as House Robber. dp[i] = max(dp[i-1], dp[i-2] + arr[i]). Source: `TheAlgorithms/JavaScript/Dynamic-Programming/MaxNonAdjacentSum.js`

**Minimum Cost Path** `A` — O(m × n) DP. Find minimum cost path from top-left to bottom-right of grid (can move right/down/diagonal). dp[i][j] = min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + cost[i][j]. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/MinimumCostPath.js`

**Subset Sum Count** `A` — O(n × sum) DP. Count number of subsets that sum to a given value. Variant of 0/1 knapsack. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/NumberOfSubsetEqualToGivenSum.js`

**Unique Paths with Obstacles** `A` — O(m × n) DP. Grid path counting with blocked cells. dp[i][j] = 0 if obstacle, else dp[i-1][j] + dp[i][j-1]. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/UniquePaths2.js`

**Edit Distance** `A` — O(n × m) DP. Minimum operations (insert, delete, replace) to transform one string into another. Same as Levenshtein but commonly used name in DP problem sets. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/EditDistance.js`

**Abbreviation** `A` — O(n × m) DP. Can string a be transformed to string b by capitalizing some lowercase letters and deleting remaining lowercase letters? Hackerrank classic. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/Abbreviation.js`

**Tribonacci Number** `B` — O(n). T(n) = T(n-1) + T(n-2) + T(n-3), with T(0)=0, T(1)=T(2)=1. Generalization of Fibonacci to three terms. Source: `TheAlgorithms/JavaScript/Dynamic-Programming/TribonacciNumber.js`

**Palindrome Partitioning (DP)** `A` — O(n²). Find minimum cuts to partition string into palindromes. Precompute palindrome table, then dp[i] = min cuts for substring 0..i. Use for: text processing, string decomposition, competitive programming. Source: `TheAlgorithms/C-Plus-Plus/dynamic_programming/palindrome_partitioning.cpp`

**Maximum Circular Subarray** `A` — O(n). Maximum sum subarray that can wrap around circular array. max(Kadane's max, total_sum - Kadane's min). Edge case: all negative → use standard Kadane's. Use for: circular buffer analysis, ring-structured data. Source: `TheAlgorithms/C-Plus-Plus/dynamic_programming/maximum_circular_subarray.cpp`

**Partition Problem** `A` — O(n × sum) DP. Determine if array can be partitioned into two subsets with equal sum. Variant of subset sum where target = total/2. Use for: balanced workload distribution, fair division problems. Source: `TheAlgorithms/C-Plus-Plus/dynamic_programming/partition_problem.cpp`

---

## Backtracking Problems

**Rat in a Maze** `A` — O(2^(n²)) worst. Find path from top-left to bottom-right in binary grid. Move right or down only. Classic backtracking with pruning. Source: `TheAlgorithms/JavaScript/Backtracking/RatInAMaze.js`

**M-Coloring Problem** `A` — O(m^V). Assign m colors to graph vertices such that no adjacent vertices share a color. Graph coloring is NP-complete for m >= 3. Use for: register allocation, scheduling, map coloring. Source: `TheAlgorithms/JavaScript/Backtracking/MColoringProblem.js`

**Sum of Subset** `A` — O(2^n). Find all subsets that sum to a given target. Backtracking with sorting + pruning. Source: `TheAlgorithms/JavaScript/Backtracking/SumOfSubset.js`

**Generate Parentheses** `A` — O(4^n / √n) (Catalan number). Generate all valid combinations of n pairs of parentheses. Backtracking with open/close count tracking. Classic interview problem. Source: `TheAlgorithms/JavaScript/Backtracking/generateParentheses.js`

**Palindrome Partitioning** `A` — O(n × 2^n). Partition string such that every substring is a palindrome. Backtracking with palindrome check memoization. Source: `TheAlgorithms/JavaScript/Recursive/PalindromePartitioning.js`

**Flood Fill** `B` — O(m × n). Fill connected region of same color starting from a pixel. BFS or DFS. Use for: paint bucket tool, image segmentation, connected component labeling. Source: `TheAlgorithms/JavaScript/Recursive/FloodFill.js`

**Letter Combinations of Phone Number** `A` — O(4^n). Generate all possible letter combinations from phone digit mapping. Backtracking/recursion. Classic interview problem. Source: `TheAlgorithms/JavaScript/Recursive/LetterCombination.js`

**Minimax** `A` — O(b^d) where b = branching factor, d = depth. Game tree search algorithm for two-player zero-sum games. Maximizing player alternates with minimizing player. With alpha-beta pruning: O(b^(d/2)) best case. Use for: chess, tic-tac-toe, Connect Four, any adversarial game AI. Source: `TheAlgorithms/C-Plus-Plus/backtracking/minimax.cpp`

**Graph Coloring** `A` — O(m^V). Assign m colors to graph vertices such that no adjacent vertices share the same color. NP-complete for m >= 3. Use for: register allocation in compilers, scheduling, map coloring, frequency assignment. Source: `TheAlgorithms/C-Plus-Plus/backtracking/graph_coloring.cpp`

**Magic Sequence** `A` — Backtracking with constraint propagation. Find a sequence where each index i contains the count of how many times i appears in the sequence. Self-describing sequence. Use for: constraint satisfaction demonstrations, mathematical puzzles. Source: `TheAlgorithms/C-Plus-Plus/backtracking/magic_sequence.cpp`

---

## Machine Learning

**k-Nearest Neighbors (k-NN)** `B` — O(n × d) per query. Classification by majority vote of k closest points. Simple, no training. Ref: `src/algorithms/ml/knn`

**k-Means Clustering** `B` — O(n × k × d × i) where i = iterations. Unsupervised clustering. Ref: `src/algorithms/ml/k-means`

---

## Cryptography

**Polynomial Hash** `B` — Rolling hash function. O(n) to compute, O(1) to roll. Foundation for Rabin-Karp. Ref: `src/algorithms/cryptography/polynomial-hash`

**Caesar Cipher** `B` — O(n) substitution cipher. Shift-based. Ref: `src/algorithms/cryptography/caesar-cipher`

**Rail Fence Cipher** `B` — O(n) transposition cipher. Ref: `src/algorithms/cryptography/rail-fence-cipher`

**Hill Cipher** `B` — Matrix-based cipher. Linear algebra encryption. Ref: `src/algorithms/cryptography/hill-cipher`

**RSA** `A` — Public-key cryptosystem based on the difficulty of factoring large primes. Uses Euler's totient, modular inverse, and fast powering. Key generation + encrypt/decrypt. Foundation of modern internet security. Ref: `keon/algorithms/math/rsa`

**Affine Cipher** `B` — O(n). Encryption: E(x) = (ax + b) mod 26, Decryption: D(x) = a⁻¹(x - b) mod 26. Generalization of Caesar cipher with multiply + shift. Requires gcd(a, 26) = 1. Source: `TheAlgorithms/JavaScript/Ciphers/AffineCipher.js`

**Atbash Cipher** `B` — O(n). Simple substitution: A↔Z, B↔Y, etc. Self-inverse (encrypt = decrypt). Hebrew origin. Source: `TheAlgorithms/JavaScript/Ciphers/Atbash.js`

**Vigenere Cipher** `B` — O(n). Polyalphabetic substitution using a keyword. Each letter shifted by corresponding keyword letter. Harder to break than Caesar. Foundation for modern stream ciphers. Source: `TheAlgorithms/JavaScript/Ciphers/VigenereCipher.js`

**XOR Cipher** `B` — O(n). Bitwise XOR of plaintext with key. Self-inverse: encrypt = decrypt. Perfect secrecy if key is random, same length as message, and used once (one-time pad). Source: `TheAlgorithms/JavaScript/Ciphers/XORCipher.js`

**ROT13** `B` — O(n). Special case of Caesar cipher with shift of 13. Self-inverse (ROT13(ROT13(x)) = x). Used for spoiler text, Usenet posts. Source: `TheAlgorithms/JavaScript/Ciphers/ROT13.js`

---

## Hashing

**MD5** `B` — O(n). 128-bit hash. Broken for collision resistance but still used for checksums and non-security file integrity. Source: `TheAlgorithms/JavaScript/Hashes/MD5.js`

**SHA-1** `B` — O(n). 160-bit hash. Deprecated for security (collision found 2017). Still used in git for content addressing. Source: `TheAlgorithms/JavaScript/Hashes/SHA1.js`

**SHA-256** `A` — O(n). 256-bit hash from SHA-2 family. Current standard for cryptographic hashing. Used in Bitcoin, TLS, digital signatures. Source: `TheAlgorithms/JavaScript/Hashes/SHA256.js`

---

## Compression & Encoding

**Huffman Coding** `A` — O(n log n). Variable-length prefix codes based on character frequency. Greedy: build binary tree from least-frequent characters up. Optimal lossless compression for known frequency distributions. Use for: file compression (ZIP, GZIP foundation), data transmission. Ref: `keon/algorithms/compression/huffman_coding`

**Run-Length Encoding (RLE)** `B` — O(n). Replace consecutive repeated characters with count + character (`AAABBC` → `3A2B1C`). Simplest lossless compression. Use for: bitmap images, fax transmission, simple data compression where long runs are common. Avoid when: data has few repeats (can increase size). Ref: `keon/algorithms/compression/rle_compression` | `TheAlgorithms/JavaScript/Compression/RLE.js`

**Elias Coding (Gamma/Delta)** `A` — Universal codes for positive integers. Gamma: O(2⌊log₂n⌋+1) bits. Delta: more efficient for larger numbers. Use for: variable-length integer encoding, information retrieval, data compression of integer sequences. Ref: `keon/algorithms/compression/elias`

**Burrows-Wheeler Transform (BWT)** `A` — O(n log n) time, O(n) space. Reversible permutation that groups similar characters together, making data more compressible by subsequent algorithms (e.g., RLE, Huffman). Foundation of bzip2 compression. Use for: text compression preprocessing, bioinformatics (FM-index for genome alignment). Source: `TheAlgorithms/Python/data_compression/burrows_wheeler.py`

**Lempel-Ziv (LZ77)** `A` — O(n) time. Dictionary-based lossless compression using a sliding window. Replaces repeated sequences with (distance, length) back-references. Foundation of gzip, PNG, ZIP. Use for: general-purpose file compression, network protocol compression. Source: `TheAlgorithms/Python/data_compression/lz77.py`

**Lempel-Ziv-Welch (LZW)** `A` — O(n) time. Dictionary-based compression that builds dictionary dynamically during encoding. No dictionary transmitted — decoder rebuilds it. Used in GIF and early Unix compress. Use for: image compression (GIF), legacy systems. Source: `TheAlgorithms/Python/data_compression/lempel_ziv.py`

**Coordinate Compression** `B` — O(n log n) time. Map large coordinate values to smaller range while preserving relative order. Sort unique values, assign sequential indices. Use for: segment tree on large ranges, computational geometry with large coordinates, competitive programming. Source: `TheAlgorithms/Python/data_compression/coordinate_compression.py`

**PSNR (Peak Signal-to-Noise Ratio)** `B` — O(n) time. Measures quality of lossy compression by comparing original and compressed signals: PSNR = 10·log₁₀(MAX²/MSE). Higher = better quality. Use for: image/video compression quality assessment, codec comparison. Source: `TheAlgorithms/Python/data_compression/peak_signal_to_noise_ratio.py`

---

## Streaming & Probabilistic

**Reservoir Sampling** `A` — O(n) time, O(k) space. Select k random items from a stream of unknown length with uniform probability. Each item has k/n chance of being selected. Use for: random sampling from large files/streams, database sampling, A/B test assignment. Ref: `keon/algorithms/streaming/reservoir_sampling`

**Count-Min Sketch** `A` — O(1) update, O(1) query. Probabilistic frequency estimation using hash functions + counter matrix. Space: O(w × d) where w = width, d = depth (hash functions). May overestimate but never underestimates. Use for: network traffic monitoring, trending topic detection, frequency estimation in data streams. Ref: `keon/algorithms/streaming/count_min_sketch`

---

## Geometry & Navigation

**Convex Hull (Graham Scan)** `A` — O(n log n). Find the convex hull (smallest convex polygon enclosing all points). Sort by polar angle, then process with stack maintaining left turns. Use for: collision detection, image processing, geographic boundaries, computational geometry. Source: `TheAlgorithms/JavaScript/Geometry/ConvexHullGraham.js`

**Haversine Formula** `B` — O(1). Calculate great-circle distance between two latitude/longitude points on Earth. Accounts for spherical geometry. Use for: GPS applications, geofencing, nearest-location queries, delivery routing. Source: `TheAlgorithms/JavaScript/Navigation/Haversine.js`

**Convex Hull (Jarvis March / Gift Wrapping)** `A` — O(n × h) where h = hull vertices. Start from leftmost point, repeatedly find the most counterclockwise point. Output-sensitive: faster than Graham Scan when hull has few vertices. Use for: convex hull when h << n, simple implementation, 3D extension is straightforward. Source: `TheAlgorithms/C-Plus-Plus/geometry/jarvis_algorithm.cpp`

**Line Segment Intersection** `A` — O(1) per pair, O(n²) brute force for n segments. Determine if two line segments intersect using cross-product orientation tests. Handles collinear and endpoint cases. Use for: computational geometry, collision detection, geographic information systems, polygon clipping. Source: `TheAlgorithms/C-Plus-Plus/geometry/line_segment_intersection.cpp`

**Smallest Enclosing Circle** `A` — O(n) expected (Welzl's algorithm). Find the smallest circle that encloses all given points. Randomized incremental algorithm with expected linear time. Use for: facility location, coverage problems, bounding volumes, wireless network coverage. Source: `TheAlgorithms/C-Plus-Plus/others/smallest_circle.cpp`

**Point in Polygon (Ray Casting)** `B` — O(n) where n = polygon vertices. Cast ray from point, count edge crossings — odd = inside, even = outside. Works for any simple polygon (convex or concave). Use for: geographic containment queries, click detection in UI, geofencing. Source: `TheAlgorithms/Python/geometry/geometry.py`

**Polygon Area (Shoelace Formula)** `B` — O(n). Compute area of simple polygon from vertex coordinates: A = ½|Σ(xᵢyᵢ₊₁ - xᵢ₊₁yᵢ)|. Works for any simple polygon. Use for: land area calculation, computational geometry, CAD applications. Source: `TheAlgorithms/Python/geometry/geometry.py`

---

## Range Queries

Specialized data structures and algorithms for efficient range-based operations on arrays.

| Need | Approach | Query | Update | Space | Build |
|------|----------|-------|--------|-------|-------|
| Static range min/max/GCD | Sparse Table | O(1) | N/A (static) | O(n log n) | O(n log n) |
| Range queries with updates | Segment Tree | O(log n) | O(log n) | O(n) | O(n) |
| Offline range queries | Mo's Algorithm | O((n + q)√n) | N/A | O(n) | — |
| Tree path queries | Heavy-Light Decomposition | O(log² n) | O(log² n) | O(n) | O(n) |
| Persistent range queries | Persistent Segment Tree | O(log n) | O(log n) | O(n log n) | O(n log n) |

**Sparse Table** `A` — O(n log n) build, O(1) query. Precompute answers for all power-of-2 ranges. For overlap-friendly functions (min, max, GCD), combine two overlapping ranges for O(1) query. Use for: static range minimum queries (RMQ), LCA reduction, competitive programming. Avoid when: array is updated frequently (use Segment Tree instead). Source: `TheAlgorithms/C-Plus-Plus/range_queries/sparse_table.cpp`

**Mo's Algorithm** `A` — O((n + q)√n) where q = queries. Answer offline range queries by sorting queries by (block, right endpoint) and maintaining a current window. Extends range by adding/removing one element at a time. Use for: offline range frequency queries, count of distinct elements, any problem where adding/removing single elements is cheap. Avoid when: online answers required, or updates exist between queries. Source: `TheAlgorithms/C-Plus-Plus/range_queries/mo.cpp`

**Heavy-Light Decomposition** `A` — O(n) build, O(log² n) per path query/update. Decompose tree into chains such that any root-to-leaf path crosses O(log n) chains. Combine with Segment Tree on chains for path queries. Use for: tree path sum/min/max queries with updates, tree path modification, LCA queries. Source: `TheAlgorithms/C-Plus-Plus/range_queries/heavy_light_decomposition.cpp`

**Persistent Segment Tree** `A` — O(n log n) build, O(log n) per query/update, O(n log n) space. Create new version of tree for each update by copying only the O(log n) changed nodes. Access any historical version. Use for: range queries on historical versions, K-th smallest in range, version control for data structures. Source: `TheAlgorithms/C-Plus-Plus/range_queries/persistent_seg_tree_lazy_prop.cpp`

---

## Bit Manipulation (Advanced)

Beyond basic set/get/clear/toggle operations.

**Next Higher Number with Same Set Bits** `A` — O(1). Given a number, find the next larger number with the same number of 1-bits. Uses bit tricks: isolate rightmost set bit, compute carry, rearrange lowest bits. Use for: combinatorial enumeration in bit-order, Gosper's hack, competitive programming. Source: `TheAlgorithms/C-Plus-Plus/bit_manipulation/next_higher_number_with_same_number_of_set_bits.cpp`

**Count Bits to Flip** `A` — O(k) where k = differing bits. Count minimum bit flips to convert integer A to integer B. XOR A and B, then count set bits in result (Brian Kernighan's method: n &= n-1). Use for: error correction, Hamming distance between integers, communication cost analysis. Source: `TheAlgorithms/C-Plus-Plus/bit_manipulation/count_bits_flip.cpp`

**Travelling Salesman with Bitmask DP** `A` — O(2^n × n²). Solve TSP exactly using DP with bitmask to represent visited cities. dp[mask][i] = min cost to visit cities in mask ending at i. Practical for n <= 20. Use for: small TSP instances, routing optimization, Hamiltonian path problems. Source: `TheAlgorithms/C-Plus-Plus/bit_manipulation/travelling_salesman_using_bit_manipulation.cpp`

**Find Non-Repeating Number** `B` — O(n) time, O(1) space. XOR all elements — paired elements cancel out, leaving the unique one. Extend to two non-repeating: partition by a differing bit. Use for: finding unique elements, detecting single changes, interview classic. Source: `TheAlgorithms/C-Plus-Plus/bit_manipulation/find_non_repeating_number.cpp`

**Count Trailing Zeros in N!** `A` — O(log n). Count trailing zeros in factorial by counting factors of 5: Σ⌊n/5^i⌋. Each factor of 5 paired with abundant factor of 2 produces a trailing zero. Use for: number theory, competitive programming. Source: `TheAlgorithms/C-Plus-Plus/bit_manipulation/count_of_trailing_ciphers_in_factorial_n.cpp`

---

## Probability & Statistics

**Bayes' Theorem** `B` — O(1). P(A|B) = P(B|A)·P(A)/P(B). Update belief about hypothesis A given new evidence B. Foundation of Bayesian inference. Use for: spam filtering, medical diagnosis, machine learning classifiers, A/B test analysis. Source: `TheAlgorithms/C-Plus-Plus/probability/bayes_theorem.cpp`

**Binomial Distribution** `B` — O(k) per PMF evaluation. P(X=k) = C(n,k)·p^k·(1-p)^(n-k). Models number of successes in n independent trials with probability p. Use for: quality control, clinical trials, conversion rate analysis, A/B testing. Source: `TheAlgorithms/C-Plus-Plus/probability/binomial_dist.cpp`

**Poisson Distribution** `B` — O(1) per PMF evaluation. P(X=k) = (λ^k · e^(-λ))/k!. Models number of events in fixed interval when events occur independently at constant rate λ. Use for: server request modeling, rare event analysis, queuing theory. Source: `TheAlgorithms/C-Plus-Plus/probability/poisson_dist.cpp`

**Geometric Distribution** `B` — O(1). P(X=k) = (1-p)^(k-1)·p. Models number of trials until first success. Memoryless property. Use for: retry analysis, expected number of attempts, coupon collector variants. Source: `TheAlgorithms/C-Plus-Plus/probability/geometric_dist.cpp`

**Exponential Distribution** `B` — O(1). f(x) = λe^(-λx). Continuous analog of geometric distribution. Models time between events in Poisson process. Memoryless. Use for: reliability engineering, queuing theory, radioactive decay. Source: `TheAlgorithms/C-Plus-Plus/probability/exponential_dist.cpp`

**Windowed Median** `A` — O(n log k) where k = window size. Maintain running median over a sliding window using two heaps (max-heap for lower half, min-heap for upper half). Use for: signal smoothing, outlier detection, streaming statistics. Source: `TheAlgorithms/C-Plus-Plus/probability/windowed_median.cpp`

**Addition Rule of Probability** `B` — O(1). P(A ∪ B) = P(A) + P(B) - P(A ∩ B). For mutually exclusive events: P(A ∪ B) = P(A) + P(B). Foundation for compound event probability. Source: `TheAlgorithms/C-Plus-Plus/probability/addition_rule.cpp`

---

## Physics Simulations

**Ground-to-Ground Projectile Motion** `B` — O(1). Compute range, max height, and time of flight for projectile launched from ground level at angle θ with initial velocity v. Range = v²sin(2θ)/g, Max height = v²sin²(θ)/(2g), Time = 2v·sin(θ)/g. Use for: physics simulations, game ballistics, trajectory planning. Source: `TheAlgorithms/C-Plus-Plus/physics/ground_to_ground_projectile_motion.cpp`

**N-Body Simulation** `A` — O(n²) per timestep (brute force), O(n log n) with Barnes-Hut tree. Simulate gravitational (or electrostatic) interactions between n bodies. Each body exerts force on every other. Use for: galaxy simulations, molecular dynamics, particle systems, orbital mechanics. Source: `TheAlgorithms/Python/physics/n_body_simulation.py`

**Reynolds Number Calculation** `B` — O(1). Re = ρvL/μ. Dimensionless number predicting flow regime: laminar (Re < 2300), transitional, or turbulent (Re > 4000). Use for: fluid dynamics simulation, pipe flow analysis, aerodynamic design. Source: `TheAlgorithms/Python/physics/reynolds_number.py`

**Lorentz Transformation** `A` — O(1). Transform spacetime coordinates between inertial reference frames in special relativity. Handles four-vectors (time, x, y, z) with Lorentz factor γ = 1/√(1 - v²/c²). Use for: relativistic physics simulations, particle physics, GPS satellite corrections. Source: `TheAlgorithms/Python/physics/lorentz_transformation_four_vector.py`

**Escape Velocity** `B` — O(1). v_escape = √(2GM/r). Minimum velocity for an object to escape gravitational field without further propulsion. Use for: space mission planning, orbital mechanics, planetary science. Source: `TheAlgorithms/Python/physics/escape_velocity.py`

**Terminal Velocity** `B` — O(1). v_t = √(2mg/(ρAC_d)). Maximum falling speed when drag force equals gravitational force. Use for: parachute design, skydiving physics, atmospheric re-entry calculations. Source: `TheAlgorithms/Python/physics/terminal_velocity.py`

---

## CPU Scheduling

Algorithms used by operating systems to allocate CPU time to processes.

**First Come First Served (FCFS)** `B` — O(n). Non-preemptive scheduling: processes executed in arrival order. Simple FIFO queue. Average waiting time can be high (convoy effect). Use for: batch systems, simple task queues, understanding scheduling fundamentals. Source: `TheAlgorithms/C-Plus-Plus/cpu_scheduling_algorithms/fcfs_scheduling.cpp`

**Shortest Job First (SJF) — Non-Preemptive** `B` — O(n log n). Execute shortest process first from ready queue. Minimizes average waiting time (provably optimal among non-preemptive). Requires knowing burst times in advance. Risk of starvation for long processes. Use for: batch scheduling, job shop scheduling, understanding optimal scheduling theory. Source: `TheAlgorithms/C-Plus-Plus/cpu_scheduling_algorithms/non_preemptive_sjf_scheduling.cpp`

---

## Cellular Automata

**Conway's Game of Life** `B` — O(m × n) per generation. 2D cellular automaton with birth/survival rules (B3/S23). Turing-complete. Each cell is alive or dead based on neighbor count. Use for: simulation, emergence demonstrations, computational theory. Source: `TheAlgorithms/JavaScript/Cellular-Automata/ConwaysGameOfLife.js`

**Elementary Cellular Automaton** `B` — O(n) per generation. 1D automaton with 256 possible rules (Wolfram's classification). Rule 110 is Turing-complete. Use for: pattern generation, complexity theory, pseudorandom sequences. Source: `TheAlgorithms/JavaScript/Cellular-Automata/Elementary.js`

**Langton's Ant** `B` — O(1) per step. Simple 2-state cellular automaton: ant on grid turns right on white (flips to black), left on black (flips to white), then moves forward. Produces emergent highway pattern after ~10,000 steps. Use for: emergence demonstrations, chaotic systems, Turing machine equivalence. Source: `TheAlgorithms/Python/cellular_automata/langtons_ant.py`

**Nagel-Schreckenberg Traffic Model** `B` — O(n) per timestep. Cellular automaton modeling vehicular traffic flow. Rules: accelerate, random braking, decelerate for other cars, move. Reproduces phantom traffic jams. Use for: traffic simulation, urban planning, transportation engineering. Source: `TheAlgorithms/Python/cellular_automata/nagel_schrekenberg.py`

**Wa-Tor (Predator-Prey Simulation)** `B` — O(m × n) per generation. 2D cellular automaton simulating predator-prey ecosystem dynamics on a toroidal grid. Fish breed, sharks eat fish or starve. Models population oscillations (Lotka-Volterra dynamics). Use for: ecological modeling, population dynamics education. Source: `TheAlgorithms/Python/cellular_automata/wa_tor.py`

---

## Digital Image Processing

Algorithms for analyzing, transforming, and extracting information from digital images.

**Canny Edge Detection** `A` — O(m × n) per image. Multi-stage edge detector: Gaussian blur → gradient computation (Sobel) → non-maximum suppression → double thresholding → hysteresis edge tracking. Gold standard for edge detection. Use for: object boundary detection, feature extraction, computer vision preprocessing. Source: `TheAlgorithms/Python/digital_image_processing/edge_detection/canny.py`

**Sobel Filter** `B` — O(m × n). Computes gradient magnitude using 3x3 convolution kernels for horizontal and vertical edges. First-order derivative approximation. Use for: edge detection, image gradient computation, feature detection preprocessing. Source: `TheAlgorithms/Python/digital_image_processing/filters/sobel_filter.py`

**Gaussian Filter (Blur)** `B` — O(m × n × k²) where k = kernel size. Convolve image with Gaussian kernel for smoothing/noise reduction. Separable: can apply 1D filter horizontally then vertically for O(m × n × k). Use for: noise reduction, image preprocessing, scale-space construction. Source: `TheAlgorithms/Python/digital_image_processing/filters/gaussian_filter.py`

**Median Filter** `B` — O(m × n × k²). Replace each pixel with median of its k×k neighborhood. Superior to Gaussian for removing salt-and-pepper noise while preserving edges. Use for: noise removal, image denoising, preprocessing for segmentation. Source: `TheAlgorithms/Python/digital_image_processing/filters/median_filter.py`

**Bilateral Filter** `A` — O(m × n × k²). Edge-preserving smoothing: weights based on both spatial distance and intensity difference. Smooths flat regions while preserving sharp edges. Use for: photo enhancement, HDR imaging, depth map refinement. Source: `TheAlgorithms/Python/digital_image_processing/filters/bilateral_filter.py`

**Gabor Filter** `A` — O(m × n × k²). Bandpass filter tuned to specific frequency and orientation. Combines Gaussian envelope with sinusoidal carrier. Use for: texture analysis, fingerprint recognition, iris recognition, visual cortex modeling. Source: `TheAlgorithms/Python/digital_image_processing/filters/gabor_filter.py`

**Local Binary Pattern (LBP)** `A` — O(m × n). Texture descriptor: compare each pixel with neighbors, encode as binary number. Rotation-invariant and grayscale-invariant. Use for: face recognition, texture classification, material inspection. Source: `TheAlgorithms/Python/digital_image_processing/filters/local_binary_pattern.py`

**Harris Corner Detection** `A` — O(m × n). Detect corner features using structure tensor eigenvalues. Corners have large eigenvalues in both directions. Use for: feature detection, image matching, panorama stitching, SLAM. Source: `TheAlgorithms/Python/computer_vision/harris_corner.py`

**Horn-Schunck Optical Flow** `A` — O(m × n × k) where k = iterations. Estimate dense motion field between consecutive frames using global smoothness constraint. Variational method. Use for: motion estimation, video stabilization, action recognition, autonomous driving. Source: `TheAlgorithms/Python/computer_vision/horn_schunck.py`

**Haralick Texture Descriptors** `A` — O(m × n × L²) where L = gray levels. Extract texture features from gray-level co-occurrence matrix (GLCM): contrast, correlation, energy, homogeneity. Use for: texture classification, medical image analysis, satellite imagery. Source: `TheAlgorithms/Python/computer_vision/haralick_descriptors.py`

---

## Audio & Signal Processing

**Butterworth Filter** `A` — O(n) per sample (IIR). Maximally flat magnitude response in passband — no ripple. Design via analog prototype + bilinear transform. Use for: audio smoothing, anti-aliasing, biomedical signal filtering. Source: `TheAlgorithms/Python/audio_filters/butterworth_filter.py`

**IIR Filter (Infinite Impulse Response)** `A` — O(n × (a + b)) where a, b = filter orders. Recursive filter using both input and previous output values: y[n] = Σ(b_k·x[n-k]) - Σ(a_k·y[n-k]). Computationally efficient but can be unstable. Use for: real-time audio processing, equalization, control systems. Source: `TheAlgorithms/Python/audio_filters/iir_filter.py`

---

## Fractals

Self-similar geometric patterns generated by iterative mathematical processes.

**Mandelbrot Set** `B` — O(n × max_iter) where n = pixels. For each point c in complex plane, iterate z = z² + c and check if |z| diverges. Color by iteration count at divergence. Use for: fractal visualization, chaos theory education, mathematical art generation. Source: `TheAlgorithms/Python/fractals/mandelbrot.py`

**Julia Sets** `B` — O(n × max_iter). Like Mandelbrot but fix c and vary initial z₀. Each value of c produces a different Julia set. Connected Julia sets correspond to c values inside Mandelbrot set. Use for: fractal art, dynamical systems exploration, mathematical visualization. Source: `TheAlgorithms/Python/fractals/julia_sets.py`

**Koch Snowflake** `B` — O(4^n) segments at iteration n. Start with triangle, recursively replace each line segment's middle third with two sides of equilateral triangle. Infinite perimeter, finite area. Use for: fractal geometry education, antenna design (fractal antennas), coastline modeling. Source: `TheAlgorithms/Python/fractals/koch_snowflake.py`

**Sierpinski Triangle** `B` — O(3^n) triangles at iteration n. Recursively subdivide equilateral triangle into 4, remove center. Self-similar at all scales. Use for: fractal education, chaos game demonstration, antenna design. Source: `TheAlgorithms/Python/fractals/sierpinski_triangle.py`

---

## Quantum Computing

Algorithms designed for quantum computers, often with exponential speedup over classical counterparts.

**Quantum Fourier Transform (QFT)** `A` — O(n²) quantum gates for n qubits. Quantum analog of discrete Fourier transform. Operates on quantum superposition of all 2^n states simultaneously. Foundation of Shor's algorithm and quantum phase estimation. Use for: period finding, phase estimation, quantum simulation. Source: `TheAlgorithms/Python/quantum/q_fourier_transform.py`

**BB84 Quantum Key Distribution** `A` — O(n) qubits for n-bit key. Protocol for secure key exchange using quantum mechanics. Alice sends qubits in random bases, Bob measures in random bases. Eavesdropping introduces detectable errors. Use for: quantum cryptography, secure communication, post-quantum security. Source: `TheAlgorithms/Python/quantum/bb84.py`

**Deutsch-Jozsa Algorithm** `A` — O(1) quantum queries (vs O(2^(n-1) + 1) classical). Determine if a function f:{0,1}^n → {0,1} is constant (same output for all inputs) or balanced (equal 0s and 1s). First algorithm showing exponential quantum speedup. Use for: quantum computing education, oracle problem demonstrations. Source: `TheAlgorithms/Python/quantum/deutsch_jozsa.py`

**Superdense Coding** `B` — O(1). Transmit 2 classical bits by sending 1 qubit, using a pre-shared entangled pair. Reversal of quantum teleportation. Use for: quantum communication, quantum information theory education. Source: `TheAlgorithms/Python/quantum/superdense_coding.py`

---

## Geodesy

Algorithms for computing distances and positions on Earth's surface.

**Lambert's Ellipsoidal Distance** `A` — O(1) per computation (iterative convergence). Geodesic distance on an oblate spheroid (WGS-84 ellipsoid). More accurate than Haversine for long distances. Accounts for Earth's polar flattening. Use for: high-precision navigation, surveying, aviation route planning. Source: `TheAlgorithms/Python/geodesy/lamberts_ellipsoidal_distance.py`

---

## Other Classic Problems

**Tower of Hanoi** `B` — O(2^n). Recursive decomposition. Ref: `src/algorithms/uncategorized/hanoi-tower`

**Matrix Rotation** `B` — O(n²). In-place 90° rotation. Transpose + reverse rows. Ref: `src/algorithms/uncategorized/square-matrix-rotation`

**Jump Game** `B` — Greedy O(n). Can you reach the end? Ref: `src/algorithms/uncategorized/jump-game`

**Unique Paths** `B` — O(m × n) DP. Grid path counting. Ref: `src/algorithms/uncategorized/unique-paths`

**Rain Terraces (Trapping Water)** `B` — O(n). Two-pointer or DP. Classic interview problem. Ref: `src/algorithms/uncategorized/rain-terraces`

**Recursive Staircase** `B` — O(n) DP. Ways to climb n stairs with 1-2 steps. Ref: `src/algorithms/uncategorized/recursive-staircase`

**Best Time to Buy/Sell Stocks** `B` — O(n) one-pass or divide-and-conquer. Ref: `src/algorithms/uncategorized/best-time-to-buy-sell-stocks`

**Valid Parentheses** `B` — O(n) with stack. Bracket matching/validation. Ref: `src/algorithms/uncategorized/valid-parentheses`

**N-Queens** `A` — Backtracking. O(n!). Constraint satisfaction. Ref: `src/algorithms/uncategorized/n-queens`

**Knight's Tour** `A` — Backtracking + Warnsdorff's heuristic. O(8^(n²)) worst. Ref: `src/algorithms/uncategorized/knight-tour`

**Seam Carving** `B` — DP for content-aware image resizing. O(W × H). Ref: `src/algorithms/image-processing/seam-carving`

**Weighted Random** `B` — O(n) setup, O(log n) query with prefix sums + binary search. Or O(1) with alias method. Ref: `src/algorithms/statistics/weighted-random`

**Genetic Algorithm** `A` — Evolutionary optimization. Population → selection → crossover → mutation → repeat. Ref: `src/algorithms/evolutionary/genetic`

**Egg Drop Problem** `A` — O(n × k) DP where n = floors, k = eggs. Find minimum trials to determine critical floor. State: dp[eggs][floors]. Classic DP interview problem. Use for: testing strategies, binary search with limited retries. Ref: `keon/algorithms/dp/egg_drop`

**Rod Cutting** `A` — O(n²) DP. Given a rod of length n and price table, find maximum revenue from cutting. Unbounded knapsack variant. Use for: resource partitioning, pricing optimization. Ref: `keon/algorithms/dp/rod_cut`

**Word Break** `A` — O(n² × m) DP where m = dict lookup. Determine if string can be segmented into dictionary words. dp[i] = can first i characters be segmented? Use for: NLP tokenization, search query parsing. Ref: `keon/algorithms/dp/word_break`

**Matrix Chain Multiplication** `A` — O(n³) DP. Find optimal parenthesization to minimize scalar multiplications. Interval DP: dp[i][j] = min cost to multiply matrices i through j. Use for: query optimization, expression evaluation. Ref: `keon/algorithms/dp/matrix_chain_order`

**House Robber** `A` — O(n) DP. Maximum sum of non-adjacent elements in array. dp[i] = max(dp[i-1], dp[i-2] + arr[i]). Use for: resource selection with constraints, scheduling non-conflicting jobs. Ref: `keon/algorithms/dp/house_robber`

**Largest Rectangle in Histogram** `A` — O(n) with monotonic stack. Find largest rectangular area under histogram bars. Stack maintains increasing bar heights. Use for: maximal rectangle in binary matrix, container problems. Ref: `keon/algorithms/stack/largest_rectangle`

**Spiral Matrix Traversal** `B` — O(m × n). Traverse 2D matrix in spiral order (right → down → left → up → repeat). Use for: matrix linearization, image processing, puzzle problems. Ref: `keon/algorithms/matrix/spiral_traversal`

**Merge Intervals** `B` — O(n log n). Sort intervals by start, merge overlapping ones. Use for: calendar scheduling, genomic ranges, time-series consolidation. Ref: `keon/algorithms/array/merge_intervals`

**Infix to Postfix Conversion** `B` — O(n) with stack. Convert infix expressions (a + b) to postfix (a b +) using Shunting Yard algorithm. Foundation for expression evaluation, compiler design. Ref: `keon/algorithms/stack/infix_to_postfix`

**Josephus Problem** `A` — O(n) with recurrence: J(n,k) = (J(n-1,k) + k) mod n. Find last survivor when every k-th person is eliminated from a circle of n. Use for: mathematical puzzles, round-robin elimination. Ref: `keon/algorithms/array/josephus`

**Floyd Cycle Detection** `B` — O(n) time, O(1) space. Tortoise-and-hare algorithm: slow pointer moves 1 step, fast pointer moves 2 steps. If cycle exists, they meet. Then reset one to start to find cycle entry point. Use for: linked list cycle detection, detecting infinite loops in sequences, finding duplicate in array. Source: `TheAlgorithms/C-Plus-Plus/search/floyd_cycle_detection_algo.cpp`

**Morris Inorder Traversal** `A` — O(n) time, O(1) space. Traverse binary tree in-order without stack or recursion by using threaded binary tree technique (temporarily modifying tree structure). Use for: space-constrained tree traversal, competitive programming, embedded systems. Source: `TheAlgorithms/C-Plus-Plus/data_structures/morris_inorder_traversal.cpp`

**Saddleback Search** `A` — O(m + n). Search for element in matrix where each row and column is sorted. Start from top-right (or bottom-left) corner, move left if too big, down if too small. Equivalent to Search in Sorted Matrix. Source: `TheAlgorithms/C-Plus-Plus/search/saddleback_search.cpp`
