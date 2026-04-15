# Data Structures — Decision Guide

Use this reference when the problem involves choosing or implementing a data structure. Each entry includes: what it is, when to use it, when NOT to use it, and complexity.

---

## Quick Selection Matrix

| Need | Best Structure | Why |
|------|---------------|-----|
| Key-value lookup O(1) | Hash Table | Amortized constant time |
| Ordered key-value | BST / AVL / Red-Black Tree | O(log n) with ordering |
| FIFO processing | Queue | Order preservation |
| LIFO / undo / parsing | Stack | Natural recursion replacement |
| Priority-based processing | Heap / Priority Queue | O(log n) insert + extract-min/max |
| Prefix matching / autocomplete | Trie | O(m) where m = key length |
| Range queries / segment updates | Segment Tree / Fenwick Tree | O(log n) query + update |
| Graph relationships | Adjacency List / Matrix | Depends on density |
| Set membership (probabilistic) | Bloom Filter | Space-efficient, allows false positives |
| Recent-item eviction | LRU Cache | O(1) get + put with eviction |
| Connected components / union | Disjoint Set (Union-Find) | Near O(1) amortized with path compression |
| Sequential traversal | Linked List | O(1) insert/delete at known position |
| Bidirectional traversal | Doubly Linked List | O(1) forward + backward |
| Frequency-based eviction | LFU Cache | O(1) get + put, evicts least used |
| Fixed-size circular buffer | Circular Queue | O(1) enqueue/dequeue, no resize |
| Round-robin scheduling | Circular Linked List | Natural cycle with no null end |
| Multidimensional nearest-neighbor | KD Tree | O(log n) avg search in k dimensions |
| Block-based range queries | Sqrt Decomposition | O(√n) query, simpler than Segment Tree |
| Disk-optimized ordered data | B-Tree | O(log n), high branching, fewer disk reads |
| Integer universe, predecessor/successor | van Emde Boas Tree | O(log log U) operations |
| Probabilistic BST, no rotations | Treap | Random priorities maintain balance |
| Balanced with 2-4 children | 2-3-4 Tree | Precursor to Red-Black Tree |
| Fast search in sorted linked list | Skip List | O(log n) search with O(n) space |
| Static range min/max/GCD queries | Sparse Table | O(1) query after O(n log n) build |
| Decrease-key in O(1) amortized | Fibonacci Heap | Optimal for Dijkstra/Prim's |
| All suffixes of string, sorted | Suffix Array | O(n log n) build, O(m log n) search |
| 2D spatial partitioning | Quadtree | O(log n) search in 2D space |
| Suffix-based string operations | Suffix Tree | O(n) build with Ukkonen's |

---

## Detailed Entries

### Linked List `B`
- **What**: Sequential nodes, each pointing to the next
- **Time**: Access O(n), Search O(n), Insert O(1) at head/known position, Delete O(1) at known position
- **Space**: O(n)
- **Use when**: Frequent insertions/deletions at arbitrary positions; implementing stacks/queues; don't need random access
- **Avoid when**: Need random access by index; cache locality matters (arrays win for iteration)
- **Ref**: `src/data-structures/linked-list`

### Doubly Linked List `B`
- **What**: Nodes with forward and backward pointers
- **Time**: Same as Linked List but O(1) delete given node reference (no need to find previous)
- **Space**: O(n), slightly more per node (extra pointer)
- **Use when**: Need bidirectional traversal; implementing LRU cache (with hash map); browser history navigation
- **Avoid when**: Memory is tight; unidirectional traversal is sufficient
- **Ref**: `src/data-structures/doubly-linked-list`

### Queue `B`
- **What**: FIFO (First In, First Out) collection
- **Time**: Enqueue O(1), Dequeue O(1), Peek O(1)
- **Space**: O(n)
- **Use when**: BFS, task scheduling, event processing, buffering, rate limiting
- **Avoid when**: Need priority ordering (use Priority Queue); need random access
- **Ref**: `src/data-structures/queue`

### Stack `B`
- **What**: LIFO (Last In, First Out) collection
- **Time**: Push O(1), Pop O(1), Peek O(1)
- **Space**: O(n)
- **Use when**: Undo/redo, expression parsing, balanced parentheses, DFS (iterative), function call simulation, backtracking
- **Avoid when**: Need FIFO ordering; need access to arbitrary elements
- **Ref**: `src/data-structures/stack`

### Hash Table `B`
- **What**: Key-value store using hash function for O(1) average lookups
- **Time**: Insert O(1) avg, Search O(1) avg, Delete O(1) avg. Worst case O(n) with collisions
- **Space**: O(n)
- **Use when**: Fast lookup by key; counting/frequency maps; deduplication; caching; any "have I seen this before?" question
- **Avoid when**: Need ordered iteration; keys aren't hashable; worst-case O(1) is required (use balanced BST)
- **Common patterns**: Two-sum, anagram grouping, frequency counting, memoization
- **Ref**: `src/data-structures/hash-table`

### Heap / Priority Queue `B`
- **What**: Complete binary tree where parent ≥ children (max-heap) or parent ≤ children (min-heap)
- **Time**: Insert O(log n), Extract-min/max O(log n), Peek O(1)
- **Space**: O(n)
- **Use when**: "Top K" problems, task scheduling by priority, Dijkstra's algorithm, merge K sorted lists, median finding (two heaps)
- **Avoid when**: Need to search for arbitrary elements (O(n)); need sorted iteration of all elements
- **Ref**: `src/data-structures/heap`

### Trie (Prefix Tree) `A`
- **What**: Tree where each node represents a character; paths from root = stored strings
- **Time**: Insert O(m), Search O(m), Prefix search O(m) where m = key length
- **Space**: O(ALPHABET_SIZE × m × n) worst case, much less with compression
- **Use when**: Autocomplete, spell checking, IP routing (longest prefix match), word games, dictionary with prefix queries
- **Avoid when**: Simple exact-match lookups (hash table is simpler); very few strings; memory constrained
- **Ref**: `src/data-structures/trie`

### Binary Search Tree (BST) `A`
- **What**: Binary tree where left < parent < right
- **Time**: Search/Insert/Delete O(log n) average, O(n) worst (degenerate)
- **Space**: O(n)
- **Use when**: Need ordered data with dynamic inserts/deletes; range queries; predecessor/successor queries
- **Avoid when**: Data is inserted in sorted order (degenerates to linked list — use balanced BST)
- **Ref**: `src/data-structures/tree/binary-search-tree`

### AVL Tree `A`
- **What**: Self-balancing BST with height difference ≤ 1 between subtrees
- **Time**: Search/Insert/Delete O(log n) guaranteed
- **Space**: O(n)
- **Use when**: Need guaranteed O(log n) with frequent lookups; database indexing where reads >> writes
- **Avoid when**: Write-heavy workloads (Red-Black tree has cheaper rebalancing)
- **Ref**: `src/data-structures/tree/avl-tree`

### Red-Black Tree `A`
- **What**: Self-balancing BST with color-based rebalancing rules
- **Time**: Search/Insert/Delete O(log n) guaranteed
- **Space**: O(n)
- **Use when**: General-purpose balanced BST; write-heavy workloads; implementing `std::map`/`TreeMap`
- **Avoid when**: Read-heavy and AVL's tighter balance helps; simpler hash table suffices
- **Ref**: `src/data-structures/tree/red-black-tree`

### Segment Tree `A`
- **What**: Tree for range query operations (sum, min, max) with point/range updates
- **Time**: Build O(n), Query O(log n), Update O(log n)
- **Space**: O(n)
- **Use when**: Repeated range queries with updates (range sum, range min/max); competitive programming; interval scheduling
- **Avoid when**: Static data (prefix sums are simpler); single queries (just iterate)
- **Ref**: `src/data-structures/tree/segment-tree`

### Fenwick Tree (Binary Indexed Tree) `A`
- **What**: Compact array-based structure for prefix sums with point updates
- **Time**: Build O(n), Query O(log n), Update O(log n)
- **Space**: O(n) — more compact than Segment Tree
- **Use when**: Prefix sum queries with frequent updates; simpler alternative to Segment Tree when only prefix operations needed
- **Avoid when**: Need range updates (Segment Tree with lazy propagation); need min/max queries (Segment Tree)
- **Ref**: `src/data-structures/tree/fenwick-tree`

### Graph `A`
- **What**: Nodes (vertices) connected by edges; directed or undirected
- **Representations**:
  - Adjacency List: Space O(V + E), good for sparse graphs
  - Adjacency Matrix: Space O(V²), good for dense graphs, O(1) edge lookup
- **Use when**: Modeling relationships, networks, dependencies, state machines, maps
- **Choice guide**: Sparse (E << V²) → Adjacency List; Dense (E ≈ V²) → Matrix; Need edge weights → List with weight property
- **Ref**: `src/data-structures/graph`

### Disjoint Set (Union-Find) `A`
- **What**: Tracks elements partitioned into non-overlapping sets
- **Time**: Union O(α(n)) ≈ O(1), Find O(α(n)) ≈ O(1) with path compression + union by rank
- **Space**: O(n)
- **Use when**: Connected components, cycle detection in undirected graphs, Kruskal's MST, equivalence classes, network connectivity
- **Avoid when**: Need to enumerate members of a set efficiently; need to split sets (only supports merge)
- **Ref**: `src/data-structures/disjoint-set`

### Bloom Filter `A`
- **What**: Probabilistic set membership test using bit array + multiple hash functions
- **Time**: Insert O(k), Query O(k) where k = number of hash functions
- **Space**: O(m) bits, much smaller than storing actual elements
- **Properties**: No false negatives, tunable false positive rate
- **Use when**: Spell checking, cache filtering, duplicate detection at scale, "definitely not in set" checks
- **Avoid when**: Need exact membership; need to delete elements (use Counting Bloom Filter); need to enumerate elements
- **Ref**: `src/data-structures/bloom-filter`

### LRU Cache `A`
- **What**: Fixed-size cache that evicts least recently used entries
- **Implementation**: Hash Map + Doubly Linked List
- **Time**: Get O(1), Put O(1)
- **Space**: O(capacity)
- **Use when**: Caching with bounded memory; memoization with size limit; page replacement; API response caching
- **Avoid when**: Access pattern is random (no temporal locality); all items accessed equally; need LFU instead
- **Ref**: `src/data-structures/lru-cache`

### LFU Cache `A`
- **What**: Fixed-size cache that evicts least frequently used entries. Tracks access count per key
- **Implementation**: Hash Map + frequency-to-keys map (doubly linked list per frequency)
- **Time**: Get O(1), Put O(1)
- **Space**: O(capacity)
- **Use when**: Access patterns have hot/cold items with stable popularity; CDN caching; database query cache
- **Avoid when**: Access patterns are bursty (recently popular items may be evicted); simpler LRU suffices; frequency tracking overhead not justified
- **Source**: `TheAlgorithms/JavaScript/Cache/LFUCache.js`

### Circular Queue (Ring Buffer) `B`
- **What**: Fixed-size queue using circular array with head/tail pointers wrapping around
- **Time**: Enqueue O(1), Dequeue O(1), Peek O(1)
- **Space**: O(capacity)
- **Use when**: Fixed-size buffering (audio/video streaming); producer-consumer patterns; bounded task queues; embedded systems with fixed memory
- **Avoid when**: Need unbounded growth; need random access to elements
- **Source**: `TheAlgorithms/JavaScript/Data-Structures/Queue/CircularQueue.js`

### Circular Linked List `B`
- **What**: Singly linked list where last node points back to first (no null terminator)
- **Time**: Same as Linked List. Traversal cycles forever without stop condition
- **Space**: O(n)
- **Use when**: Round-robin scheduling; circular buffers; turn-based game loops; Josephus problem; playlist repeat
- **Avoid when**: Need clear start/end; traversal without careful termination condition is dangerous
- **Source**: `TheAlgorithms/JavaScript/Data-Structures/Linked-List/SinglyCircularLinkedList.js`

### Vector2 (2D Vector) `B`
- **What**: Mathematical 2D vector with x, y components and standard operations (add, subtract, scale, dot product, magnitude, normalize)
- **Time**: All operations O(1)
- **Space**: O(1)
- **Use when**: 2D game physics; graphics rendering; geometric computations; force/velocity calculations
- **Avoid when**: Need higher dimensions (use general vector/matrix library)
- **Source**: `TheAlgorithms/JavaScript/Data-Structures/Vectors/Vector2.js`

### KD Tree (k-Dimensional Tree) `A`
- **What**: Space-partitioning tree for organizing points in k-dimensional space. Each level splits on a different dimension (cycle through x, y, z, ...)
- **Time**: Build O(n log n), Search O(log n) avg / O(n) worst, Nearest neighbor O(log n) avg
- **Space**: O(n)
- **Use when**: Nearest-neighbor search in low dimensions (k < 20); range search in multidimensional data; computational geometry; spatial databases; game collision detection
- **Avoid when**: High dimensionality (curse of dimensionality — use approximate methods instead); data changes frequently (rebalancing is expensive)
- **Ref**: `keon/algorithms/data_structures/kd_tree`

### Sqrt Decomposition `A`
- **What**: Divide array into √n blocks, precompute aggregate per block. Query combines at most 2 partial blocks + √n full blocks
- **Time**: Build O(n), Query O(√n), Update O(1) point / O(√n) block
- **Space**: O(n)
- **Use when**: Range queries where Segment Tree feels overkill; need simpler implementation; range sum/min/max with moderate update frequency
- **Avoid when**: Need O(log n) performance (use Segment Tree); very frequent updates on ranges (use Segment Tree with lazy propagation)
- **Ref**: `keon/algorithms/data_structures/sqrt_decomposition`

### B-Tree `A`
- **What**: Self-balancing tree with variable number of children per node (high branching factor). All leaves at same depth
- **Time**: Search/Insert/Delete O(log n) — very few disk reads due to high fanout
- **Space**: O(n)
- **Use when**: Database indexing (MySQL, PostgreSQL use B+ trees); filesystem metadata; any scenario where data is on disk and minimizing I/O is critical
- **Avoid when**: Data fits in RAM (BST/hash table simpler); don't need ordered access (hash table is faster)
- **Ref**: `keon/algorithms/data_structures/b_tree`

### van Emde Boas (vEB) Tree `A`
- **What**: Tree structure for integer keys from universe {0, 1, ..., U-1}. Recursively divides universe into √U clusters
- **Time**: Insert/Delete/Search/Predecessor/Successor all O(log log U)
- **Space**: O(U) — can be large
- **Use when**: Integer keys from bounded universe; need extremely fast predecessor/successor queries; priority queue with integer keys; router IP lookup tables
- **Avoid when**: Universe size U is very large (space prohibitive); keys are not integers; simpler structures (heap, BST) suffice
- **Ref**: `keon/algorithms/data_structures/veb_tree`

### Skip List `A`
- **What**: Layered linked list with express lanes. Each level skips over elements, enabling binary-search-like performance on a linked structure
- **Time**: Search O(log n) avg, Insert O(log n) avg, Delete O(log n) avg. Worst case O(n) but probabilistically rare
- **Space**: O(n) expected
- **Use when**: Need sorted dynamic set with simpler implementation than balanced BST; concurrent access (lock-free skip lists); Redis sorted sets; replacing balanced trees where simpler code matters
- **Avoid when**: Guaranteed worst-case O(log n) needed (use AVL/Red-Black); memory overhead of pointers per level is concern
- **Source**: `TheAlgorithms/C-Plus-Plus/data_structures/skip_list.cpp`

### Treap (Tree + Heap) `A`
- **What**: BST where each node has a key (BST property) and a random priority (heap property). Random priorities ensure expected O(log n) height without explicit rotations
- **Time**: Search/Insert/Delete O(log n) expected
- **Space**: O(n)
- **Use when**: Need simple balanced BST implementation; randomized algorithms acceptable; split/merge operations needed (implicit treap); competitive programming
- **Avoid when**: Deterministic worst-case guarantees needed; priority values cannot be random
- **Source**: `TheAlgorithms/C-Plus-Plus/data_structures/treap.cpp`

### 2-3-4 Tree `A`
- **What**: Self-balancing search tree where nodes have 2, 3, or 4 children. All leaves at same depth. Isomorphic to Red-Black trees (direct correspondence between node types)
- **Time**: Search/Insert/Delete O(log n) guaranteed
- **Space**: O(n)
- **Use when**: Understanding Red-Black tree theory; educational purposes; when direct multi-way branching is natural; precursor to B-trees (2-3-4 tree is B-tree of order 4)
- **Avoid when**: Practical code — Red-Black tree is the standard implementation of this concept
- **Source**: `TheAlgorithms/C-Plus-Plus/data_structures/tree_234.cpp`

### Sparse Table `A`
- **What**: Static data structure for range queries on idempotent functions (min, max, GCD). Precompute answers for all ranges of length 2^k
- **Time**: Build O(n log n), Query O(1) for overlap-friendly operations (min/max/GCD), O(log n) for non-idempotent (sum)
- **Space**: O(n log n)
- **Use when**: Static arrays with many range min/max/GCD queries; LCA reduction to RMQ; competitive programming where O(1) query matters
- **Avoid when**: Array is updated (use Segment Tree); need range sum (prefix sums are simpler for static); memory-constrained (uses O(n log n))
- **Source**: `TheAlgorithms/C-Plus-Plus/data_structures/sparse_table.cpp`

### Fibonacci Heap `A`
- **What**: Lazy-merge heap with O(1) amortized insert, decrease-key, and merge. Collection of heap-ordered trees with lazy consolidation
- **Time**: Insert O(1) amortized, Find-min O(1), Decrease-key O(1) amortized, Delete/Extract-min O(log n) amortized, Merge O(1)
- **Space**: O(n)
- **Use when**: Dijkstra's algorithm (improves to O(V log V + E)), Prim's MST (O(E + V log V)), any algorithm that performs many decrease-key operations; theoretically optimal for comparison-based priority queues
- **Avoid when**: Practical implementations — constant factors are large and cache behavior is poor; binary heap is simpler and faster in practice for most inputs; when decrease-key is infrequent
- **Source**: `williamfiset/Algorithms/datastructures/fibonacciheap`

### Suffix Array `A`
- **What**: Sorted array of all suffixes of a string, stored as starting indices. Space-efficient alternative to suffix tree
- **Time**: Build O(n log n) typical (O(n) with SA-IS), Search O(m log n) where m = pattern length, LCP array construction O(n)
- **Space**: O(n) integers
- **Use when**: Pattern matching in large texts, longest repeated substring, longest common prefix queries, bioinformatics (genome analysis), building FM-index for compressed text search
- **Avoid when**: Need online construction (suffix tree supports this); need frequent insertions/deletions to text
- **Source**: `williamfiset/Algorithms/datastructures/suffixarray`

### Suffix Tree `A`
- **What**: Compressed trie of all suffixes of a string. Every internal node (except root) has at least 2 children. Edges labeled with substrings
- **Time**: Build O(n) with Ukkonen's algorithm, Search O(m) where m = pattern length
- **Space**: O(n) but with large constant factor (many pointers per node)
- **Use when**: Multiple pattern matching queries on same text, longest common substring of two strings, palindrome finding, online suffix construction, generalized suffix tree for multiple strings
- **Avoid when**: Memory is constrained (suffix array uses less space); single pattern search (KMP/Boyer-Moore are simpler); text changes frequently
- **Source**: `TheAlgorithms/Python/data_structures/suffix_tree` | `williamfiset/Algorithms/datastructures/suffixarray` (SA can substitute)

### Quadtree `A`
- **What**: Tree where each internal node has exactly 4 children, recursively subdividing 2D space into quadrants. Point quadtree stores points; region quadtree partitions space uniformly
- **Time**: Insert O(log n) avg, Search O(log n) avg, Range query O(√n + k) where k = results
- **Space**: O(n) for point quadtree, O(resolution²) for region quadtree
- **Use when**: 2D spatial indexing, collision detection in games, image compression (region quadtree), geographic information systems (GIS), adaptive mesh refinement
- **Avoid when**: Data is in 1D (use BST/segment tree); high dimensions (use KD-tree for k > 2 but < 20); data is uniformly distributed with no spatial queries needed
- **Source**: `williamfiset/Algorithms/datastructures/quadtree`
