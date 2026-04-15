# START HERE

Read only these files before starting work:

1. `AGENTS.md`
2. `obsidian-reddit专用/Projects/project.md`
3. `PROJECT.md`
4. `skills/README.md`
5. `skills/reddit-monitoring/SKILL.md`
6. `skills/algorithm-dev-suite/SKILL.md` (for algorithm / scoring / threshold / observability tasks)
7. `docs/architecture-sketch.md` (only for architecture / data-model / implementation tasks)

Execution truth lives only in `Projects/project.md`.
Use `context/decision-log.md` only when a historical decision must be read or a new durable decision must be recorded.

## Default working style

- Prefer the smallest valid change.
- Do not expand scope on your own.
- Do not introduce new architecture unless the current task requires it.
- When uncertain, inspect files first, then propose the narrowest next step.
- Keep summaries short and factual.
- For algorithm work, use `skills/algorithm-dev-suite/SKILL.md` as the single entrypoint.
- For algorithm work, default to `npm run algo:fast`, then `algo:phase1`, then `algo:full`. Ignore other run modes unless the task explicitly requires them.

## What not to do

- Do not treat this repo as a generic AI workflow experiment.
- Do not mix GEO content operations with product development unless the task explicitly asks for both.
- Do not create many new docs unless they directly help execution.
- Do not turn "agent roles" into theatrical personas.
