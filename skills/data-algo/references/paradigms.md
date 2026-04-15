# Algorithm Design Paradigms — Pattern Recognition Guide

Use this reference to identify WHICH paradigm fits a given problem. The key skill is recognizing the pattern from the problem description or code shape, then selecting the right approach.

---

## Paradigm Selection Flowchart

```
Does the problem ask for an optimal solution (min/max/best)?
├── YES → Can you make locally optimal choices that lead to global optimum?
│   ├── YES → GREEDY
│   └── NO → Does the problem have overlapping subproblems?
│       ├── YES → DYNAMIC PROGRAMMING
│       └── NO → DIVIDE AND CONQUER
└── NO → Does the problem ask to enumerate/find all valid configurations?
    ├── YES → BACKTRACKING (with pruning)
    └── NO → Does the problem involve exploring a space/graph?
        ├── YES → BFS (shortest) or DFS (existence/all paths)
        └── NO → Can you try all possibilities within time budget?
            ├── YES → BRUTE FORCE
            └── NO → Consider heuristic or approximation approaches
```

---

## Brute Force

**Pattern recognition**: "Check all possibilities", "try every combination", small input size (n < 20)

**When it's the right answer**: Input is tiny, implementation must be bulletproof, correctness > speed, no known better algorithm exists.

**When to upgrade**: Input grows beyond n ≈ 20-30 for exponential, n ≈ 10,000 for O(n²), n ≈ 1M for O(n log n)

**Algorithms that use this**:
- Linear Search
- Rain Terraces (naive O(n²))
- Recursive Staircase (naive exponential)
- Maximum Subarray (O(n³) triple loop)
- Travelling Salesman (O(n!) permutation check)
- DFT (O(n²) naive)

---

## Greedy

**Pattern recognition**: "At each step, take the locally best option." Works when the greedy choice property holds — local optima lead to global optimum.

**Red flags that greedy WILL work**:
- Problem has matroid structure
- Optimal substructure + greedy choice property proven
- Problems involving sorting + interval/scheduling
- MST (Kruskal/Prim)
- Huffman coding

**Red flags that greedy WON'T work**:
- You can construct a counterexample where greedy fails
- "Find all solutions" (greedy finds one)
- 0/1 Knapsack (greedy works for fractional, not 0/1)

**Algorithms that use this**:
- Jump Game — Track farthest reachable index. O(n)
- Unbound Knapsack — Take best value/weight ratio repeatedly
- Dijkstra — Always expand cheapest unvisited node
- Prim's MST — Always add cheapest edge to tree
- Kruskal's MST — Sort edges, add if no cycle
- Kadane's (Maximum Subarray) — Extend or restart subarray. O(n)
- Huffman Coding — Build optimal prefix code tree from lowest-frequency chars. O(n log n)
- Gale-Shapley — Proposers propose in preference order; stable matching guaranteed. O(n²)
- Merge Intervals — Sort by start, merge overlapping. O(n log n)
- A* Search — Always expand node with lowest f(n) = g(n) + h(n)

**Implementation pattern**:
```
sort items by some criterion
result = initial_value
for each item:
    if adding item is locally optimal:
        add item to result
return result
```

---

## Divide and Conquer

**Pattern recognition**: "Split problem in half (or parts), solve each independently, combine results."

**Key signals**:
- Array can be split and processed independently
- Problem on n reduces to same problem on n/2
- "Merge" step is well-defined
- Think: "What if I had the answer for each half?"

**Recurrence patterns**:
- T(n) = 2T(n/2) + O(n) → O(n log n) — Merge Sort
- T(n) = 2T(n/2) + O(1) → O(n) — Binary Search
- T(n) = T(n/2) + O(n) → O(n) — Selection (quickselect)

**Algorithms that use this**:
- Binary Search — Halve search space
- Merge Sort — Split, sort, merge
- Quicksort — Partition, recurse
- Tower of Hanoi — Move n-1, move 1, move n-1
- Fast Powering — x^n = (x^(n/2))²
- Strassen Matrix Multiplication — 7 sub-multiplications
- Closest Pair of Points — Split by x-coordinate
- Karatsuba multiplication — Fewer sub-multiplications
- Tree DFS/BFS — Process subtrees independently
- Pascal's Triangle — C(n,k) = C(n-1,k-1) + C(n-1,k)

**Implementation pattern**:
```
function solve(problem):
    if problem is small enough:
        return base_case_solution
    left, right = split(problem)
    left_result = solve(left)
    right_result = solve(right)
    return combine(left_result, right_result)
```

---

## Dynamic Programming

**Pattern recognition**: THE paradigm for optimization. Look for:
1. **Overlapping subproblems** — same sub-computation repeated many times
2. **Optimal substructure** — optimal solution contains optimal solutions to subproblems

**Key signals**:
- "Find the minimum/maximum/count of ways to..."
- Problem can be broken into stages/states
- Recursive solution has exponential time but many repeated calls
- Memoization table makes sense
- 1D or 2D state space

**Top-down (memoization) vs Bottom-up (tabulation)**:
- Top-down: easier to write, only computes needed states, risk of stack overflow
- Bottom-up: iterative, computes all states, often can optimize space
- Default to bottom-up for production code unless state space is sparse

**Common DP patterns**:

| Pattern | State | Example |
|---------|-------|---------|
| Linear DP | dp[i] = best answer using first i items | Fibonacci, Staircase, LIS |
| Two-sequence | dp[i][j] = answer for first i of seq1, first j of seq2 | LCS, Edit Distance, Regex |
| Knapsack | dp[i][w] = best value with first i items, capacity w | 0/1 Knapsack, Coin Change |
| Interval | dp[i][j] = answer for subarray from i to j | Matrix Chain, Palindrome |
| Grid | dp[i][j] = answer at position (i,j) | Unique Paths, Min Path Sum |
| Bitmask | dp[mask] = answer using subset encoded as bitmask | TSP, Assignment Problem |
| Digit | dp[pos][tight][...] = count of valid numbers | Number problems |

**Algorithms that use this**:
- Fibonacci — dp[i] = dp[i-1] + dp[i-2]
- Recursive Staircase — Same as Fibonacci
- Unique Paths — dp[i][j] = dp[i-1][j] + dp[i][j-1]
- Levenshtein Distance — dp[i][j] = edit distance of first i,j chars
- LCS — dp[i][j] = longest common subsequence length
- LIS — dp[i] = length of longest increasing subsequence ending at i
- Knapsack — dp[i][w] = max value with first i items, weight ≤ w
- Maximum Subarray — dp[i] = max sum ending at i (Kadane's)
- Rain Terraces — Precompute left_max, right_max arrays
- Seam Carving — Minimum energy path through image
- Integer Partition — Ways to write n as sum of positive integers
- Floyd-Warshall — dp[k][i][j] = shortest path using first k intermediate nodes
- Bellman-Ford — dp[v] = shortest distance to v, relax V-1 times
- Regular Expression Matching — dp[i][j] = does text[0..i] match pattern[0..j]
- Coin Change — dp[i] = min coins for amount i, try each denomination
- Egg Drop — dp[k][n] = min trials with k eggs, n floors
- Rod Cutting — dp[i] = max revenue for rod of length i
- Word Break — dp[i] = can first i chars be segmented into dictionary words
- Matrix Chain Multiplication — dp[i][j] = min ops to multiply matrices i..j (interval DP)
- House Robber — dp[i] = max(dp[i-1], dp[i-2] + arr[i]) — non-adjacent selection
- Max Product Subarray — track both max_product and min_product at each position

**Implementation pattern**:
```
// Bottom-up template
dp = initialize base cases
for each state in topological order:
    dp[state] = combine(dp[sub-states]) using recurrence
return dp[final_state]
```

**Space optimization**: Many 2D DPs only look at the previous row → compress to 1D.

---

## Backtracking

**Pattern recognition**: "Find ALL valid configurations" or "Does a valid configuration exist?"

**Key signals**:
- Choices at each step with constraints
- Solution is built incrementally
- Some choices lead to dead ends that need reversal
- Constraint satisfaction problems
- "Generate all", "find all", "enumerate"

**Pruning is essential**: Backtracking without pruning = brute force. Always add:
- Feasibility check before recursing
- Bound checking (branch and bound for optimization)
- Symmetry breaking to avoid duplicate states

**Algorithms that use this**:
- N-Queens — Place queens row by row, check conflicts
- Knight's Tour — Visit all squares, backtrack on dead ends
- Hamiltonian Cycle — Visit all vertices exactly once
- Combination Sum — Find all combos summing to target
- Power Set — Include or exclude each element
- Permutations — Choose each unused element for next position
- Sudoku Solver — Fill cells, check constraints
- Jump Game — Try each jump length (though greedy is better)

**Implementation pattern**:
```
function backtrack(state, choices):
    if state is a solution:
        record/return solution
    for each choice in choices:
        if choice is valid (pruning):
            make choice
            backtrack(next_state, remaining_choices)
            undo choice  // backtrack
```

---

## Common Algorithmic Patterns (Not Paradigms)

These are recurring implementation patterns that cross paradigm boundaries:

### Two Pointers
- **When**: Sorted array, finding pairs/triplets, palindromes, container with most water
- **How**: Two indices moving toward each other or in same direction
- **Complexity**: Usually O(n) for what would be O(n²) brute force

### Sliding Window
- **When**: Contiguous subarray/substring of fixed or variable size
- **How**: Maintain window boundaries, slide right, shrink from left when constraint violated
- **Complexity**: O(n) for what would be O(n × k) brute force
- **Variants**: Fixed-size window, variable-size with constraint

### Fast & Slow Pointers
- **When**: Cycle detection in linked list/sequence, finding middle element
- **How**: Two pointers at different speeds (1x, 2x)
- **Complexity**: O(n) time, O(1) space

### Monotonic Stack/Queue
- **When**: "Next greater/smaller element", "max in sliding window"
- **How**: Maintain stack/queue with monotonic (increasing/decreasing) property
- **Complexity**: O(n) amortized

### Prefix Sums
- **When**: Repeated range sum queries
- **How**: Precompute cumulative sums, answer query in O(1)
- **Complexity**: O(n) build, O(1) per query

### Binary Search on Answer
- **When**: "Find minimum/maximum value that satisfies condition", answer space is monotonic
- **How**: Binary search over possible answer values, check feasibility
- **Complexity**: O(log(range) × check_cost)

### Topological Sort
- **When**: Dependency resolution, task ordering, build systems
- **How**: DFS post-order reverse, or Kahn's algorithm (BFS with in-degree)
- **Complexity**: O(V + E)

### Union-Find Pattern
- **When**: Dynamic connectivity, "are these connected?", grouping
- **How**: Disjoint Set with path compression + union by rank
- **Complexity**: Near O(1) per operation (amortized)

---

## Network Flow

### When to Recognize
- Maximum matching in bipartite graphs
- Minimum cut problems
- Assignment/allocation problems
- Supply chain / transportation optimization
- "What is the maximum amount of X that can flow from A to B?"
- "What is the minimum number of X to remove to disconnect Y from Z?"

### Decision Guide

| Problem Shape | Algorithm | Complexity |
|--------------|-----------|------------|
| Max flow, unweighted | Ford-Fulkerson (BFS = Edmonds-Karp) | O(VE²) |
| Max flow, dense graphs | Dinic's algorithm | O(V²E) |
| Max flow, large capacities | Capacity Scaling | O(E² log C) |
| Min-cost max-flow | Successive shortest paths (Johnson's) | O(V²E log V) |
| Bipartite matching | Hopcroft-Karp | O(E√V) |
| Min vertex cover | König's theorem (reduce to max matching) | O(E√V) |
| Assignment with costs | Hungarian algorithm / min-cost flow | O(n³) |

### Key Insight
Every max-flow problem has a dual min-cut problem (max-flow min-cut theorem). If you're asked "what's the minimum number of X to remove to disconnect Y from Z" — that's min-cut, which is max-flow.

### Common Reductions
- **Bipartite matching** → max flow with unit capacities from source to left, left to right, right to sink
- **Vertex capacity** → split each vertex into v_in and v_out with edge of that capacity
- **Multiple sources/sinks** → add super-source and super-sink
- **Minimum path cover in DAG** → n - maximum matching in corresponding bipartite graph
- **Project selection (max profit)** → min-cut formulation

### Implementation Pattern
```
function max_flow(graph, source, sink):
    total_flow = 0
    while augmenting_path exists from source to sink in residual graph:
        bottleneck = min capacity along path
        total_flow += bottleneck
        update residual graph (forward - bottleneck, backward + bottleneck)
    return total_flow
```
