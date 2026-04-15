# Project Skills

Execution authority: `obsidian-reddit专用/项目上下文存储/Codex Context/Projects/project.md`

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

1. `reddit-monitoring`
2. `tool-design`
3. `data-algo-social`

Add when needed:

4. `data-algo`
5. `data-algo-system`

Use for:

- crawl mode
- cursor semantics
- provider/fallback contract tightening
- duplicate/filter/quality path fixes
- rate-limit/cache/probabilistic structures only when truly necessary

### Trend scoring and explainable ranking

Start with:

1. `reddit-monitoring`
2. `reddit-trend-algo`
3. `data-algo`

Use for:

- score components
- threshold logic
- anomaly/surge/trend explainability
- conservative ranking-path optimization

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
