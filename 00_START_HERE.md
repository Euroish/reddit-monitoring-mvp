# START HERE

Read only these files before starting work:

1. `AGENTS.md`
2. `obsidian-reddit专用/Projects/project.md`
3. `skills/README.md`
4. `skills/reddit-monitoring/SKILL.md`
5. `skills/algorithm-dev-suite/SKILL.md` (only for algorithm / scoring / threshold / observability tasks)
6. `docs/architecture-sketch.md` (only for architecture / data-model / implementation tasks)

Execution truth lives only in `obsidian-reddit专用/Projects/project.md`.
Current planning harness is constrained by the three active markdowns in `obsidian-reddit专用/Projects`: `数据库优化与重复命中分析.md`, `reddit-monitoring-mvp-optimal-plan.md`, and `开发方案分析.md`.
Do not depend on `PROJECT.md`, `context/decision-log.md`, or old Obsidian export paths; they are not present in this repo. If a task references an advisory context file such as `context/codex-issue.md`, read it when present, but reconcile it against the current repository state before changing code or plans. If the file is missing, report that and proceed from current repo evidence unless the task truly depends on it.

## Default working style

- Prefer the smallest valid change.
- Do not expand scope on your own.
- Do not introduce new architecture unless the current task requires it.
- When uncertain, inspect files first, then propose the narrowest next step.
- Keep summaries short and factual.
- Update `obsidian-reddit专用/Projects/project.md` once at the end of real execution with `Scope`, `Why now`, `Verify`, and `Next`.
- Product analytics changes must pass the data-coverage truth gate: do not add charts or global-sounding labels before the backing collection, materialization, API contract, and coverage/degraded states are honest.
- For algorithm work, use `skills/algorithm-dev-suite/SKILL.md` as the single entrypoint.
- For algorithm work, default to `npm run algo:fast`, then `algo:phase1` (unit), then `algo:phase1:full` (phase1 integration only when boundary is touched), then `algo:full` before close-out. Ignore other run modes unless the task explicitly requires them.

## What not to do

- Do not treat this repo as a generic AI workflow experiment.
- Do not mix GEO content operations with product development unless the task explicitly asks for both.
- Do not create many new docs unless they directly help execution.
- Do not turn "agent roles" into theatrical personas.
