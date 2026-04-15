---
name: algorithm-dev-suite
description: Unified algorithm orchestration skill for this project. Use this as the single entrypoint for algorithm work so truth-layer calibration, trend scoring, system-level data structures, and social-data heuristics are routed consistently.
---

# Algorithm Dev Suite

## Purpose

Use one entrypoint for algorithm tasks in this repo:
- P1.5 truth-layer calibration
- provider / cursor / duplicate / lag threshold work
- adaptive sampling and degraded-signal tuning
- trend scoring and explainable ranking
- bounded algorithm-related data-structure changes

Read `obsidian-reddit专用/Projects/project.md` first.
Treat that file as the authority for current stage, freeze policy, and next action.

## Activate When

- user asks for algorithm fixes or algorithm hardening
- user asks to tune thresholds, scoring, ranking, anomaly, or sampling behavior
- user asks to improve duplicate / lag / fallback / provider-switch / cursor-stall handling
- user asks to install or unify multiple algorithm skills for this repo

## Mandatory Routing

Start with:

1. `skills/reddit-monitoring/SKILL.md`

Then choose exactly one primary branch:

2. Truth-layer branch:
   `skills/data-algo-social/SKILL.md`

3. Scoring/ranking branch:
   `skills/reddit-trend-algo/SKILL.md`

Add secondary support only when the task truly needs it:

4. `skills/data-algo/SKILL.md`
5. `skills/data-algo-system/SKILL.md`
6. `skills/signal-metric-design/SKILL.md`
7. `skills/synthetic-case-lab/SKILL.md`
8. `skills/read-model-contract-guard/SKILL.md`
9. `skills/worker-boundary-for-algorithm/SKILL.md`

## Branch Selection

Choose `data-algo-social` first when the task is about:
- collection truth
- provider behavior
- duplicate / filter / fallback semantics
- cursor advancement / stall detection
- observability thresholds
- live-vs-mock verification boundaries

Choose `reddit-trend-algo` first when the task is about:
- trend-score formulas
- explain payloads
- ranking consistency
- anomaly or change-point logic
- read-model algorithm fields

Add `data-algo` only for bounded algorithmic mechanics such as:
- search/sort/filter strategy
- complexity reduction
- cache/set/map/queue choices

Add `data-algo-system` only for bounded system primitives such as:
- rate limiting
- probabilistic structures
- caching strategy
- partitioning or load-shaping logic

Use `signal-metric-design` when the task changes:
- score components
- thresholds
- weights
- clamps
- alert conditions

Use `synthetic-case-lab` when the task changes:
- scoring behavior
- ranking behavior
- anomaly behavior
- sampling thresholds

Use `read-model-contract-guard` when the task could affect:
- API payload shape
- read-model field semantics
- explain payload semantics
- timeline / summary / mover / anomaly contracts

Use `worker-boundary-for-algorithm` when the task description starts pulling on:
- worker logic
- scheduler logic
- materialization flow
- runtime/env wiring

## Stage Guard

Until `project.md` says `P1.5` is closed:
- prefer truth-layer fixes over ranking expansion
- do not open Stage C or Stage D work
- do not widen scope from worker/runtime/readiness fixes into product features

If a request mixes truth-layer work with later-stage ranking work:
1. close the truth-layer ambiguity first
2. defer the later-stage portion explicitly

## Delivery Contract

For each algorithm task:

1. state which branch was selected and why in 1-2 lines
2. define the metric or threshold intent before changing implementation
3. keep the change bounded to the current stage
4. verify with synthetic cases or focused tests first
5. run full `typecheck` and `test` before close-out when code changed
6. write one concise activity entry back to `Projects/project.md`

## Default Command Surface

For routine algorithm work, use only:

1. `npm run algo:fast`
2. `npm run algo:phase1` when the change touches truth-layer behavior
3. `npm run algo:full` before close-out
4. `npm run algo:live:verify` only when live calibration is explicitly required

Do not widen into worker/scheduler/API/manual operations unless the task explicitly requires that boundary.

## Skill Unification Rule

When new project-local algorithm skills are added later:
- do not point startup docs directly at each new skill
- register them under this suite as either a primary branch or secondary support skill
- keep `algorithm-dev-suite` as the only user-facing algorithm entrypoint
