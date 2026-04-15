# Project Skills

Execution authority: `obsidian-reddit专用/Projects/project.md`

This file is static skill routing only.
It must not duplicate active phase, next action, freeze state, or temporary task policy.

## First Rule

- Read `Projects/project.md` first.
- If `skills/README.md` conflicts with `project.md`, `project.md` wins.

## Core Routing

### Scope and product boundary

Start with:

1. `reddit-monitoring`

Use for:

- task scoping
- MVP boundary control
- deciding whether a request belongs to P1.5 or later work

### Collector / job / provider semantics

Start with:

1. `algorithm-dev-suite`

Add when needed:

2. `tool-design`

Use for:

- crawl mode
- cursor semantics
- provider/fallback contract tightening
- duplicate/filter/quality path fixes
- rate-limit/cache/probabilistic structures only when truly necessary

### Trend scoring and explainable ranking

Start with:

1. `algorithm-dev-suite`

Use for:

- score components
- threshold logic
- anomaly/surge/trend explainability
- conservative ranking-path optimization

### Unified algorithm work

Start with:

1. `algorithm-dev-suite`

Use for:

- choosing between truth-layer and ranking-layer algorithm work
- keeping future algorithm skill installs behind one project entrypoint
- routing bounded support from `data-algo` / `data-algo-social` / `data-algo-system` / `reddit-trend-algo`
- routing support guards from `signal-metric-design` / `synthetic-case-lab` / `read-model-contract-guard` / `worker-boundary-for-algorithm`

### Large-output context handling

Use:

1. `filesystem-context`

Use for:

- scratch files
- large-output offloading
- durable file-based context

### Frontend work

Start with:

1. `frontend-dev-suite`
2. `senior-frontend`

Add when needed:

3. `frontend-patterns`
4. `frontend-design`
5. `frontend-ui-ux`
6. `frontend-browser-review`

## Keep Stable

- Do not move existing skill directories unless startup docs are updated first.
- Add new project-local skills as direct children of `skills/`.
- Add `.import-source.txt` for imported third-party skills.
- Do not write current execution state here; write it only in `Projects/project.md`.
