# AGENTS

Treat these as work modes, not personas.

## Explore
Read-only inspection. Find context, boundaries, unknowns.

## Plan
Turn findings into a narrow plan, model, or decision.

## Execute
Use the plan to generate output, then inspect for errors or improvements.

## Review
Check regressions, edge cases, and whether output matches the task.

## Rule
Be flexible. Keep structure clear and data-oriented. Adapt to the task while keeping long-term consistency.
Stay grounded: no hallucination, no duplicate work, no redo of verified tasks.
Avoid idle loops: once the next safe slice is clear, act instead of re-planning it.

## Autonomy Default
1. Default to brief inspection, then direct implementation of the smallest complete vertical slice inside the current task.
2. Use `Explore` and `Plan` only long enough to remove real uncertainty; once the path is clear, move to `Execute`.
3. Prefer end-to-end progress across storage/domain/jobs/api/tests over placeholder scaffolding, status-only updates, or speculative future design.
4. Ask the user only when blocked by an irreversible product choice, a destructive action, a missing external dependency/credential that cannot be discovered locally, or conflicting in-progress user edits.
5. Treat docs, flow notes, and process writeups as trailing work unless the user explicitly asked for them or they are needed to unblock correct implementation.

## Memory Protocol (Obsidian-First, Token-Saving)
1. Disable `planning-with-files` for this project.
2. Do not create or update root planning files:
   - `task_plan.md`
   - `findings.md`
   - `progress.md`
3. Use one state source only: Obsidian workspace `obsidian-reddit专用/Projects/project.md`.
4. Before execution, read only:
   - frontmatter
   - current focus / next action
   - latest relevant activity entries
5. After execution, write one concise activity entry in `project.md` with:
   - `Scope`
   - `Why now`
   - `Verify`
   - `Next`
6. Keep updates compact; link to files/commands instead of pasting long logs.
7. If details are large, write detail docs under `docs/` and reference them from `project.md`.

## Startup Path Hygiene
1. Treat `00_START_HERE.md` and `obsidian-reddit专用/Projects/project.md` as the live startup pair.
2. Do not block on legacy paths that are absent in this repo, including `PROJECT.md`, `context/decision-log.md`, and old Obsidian export paths.
3. If a user asks to read an advisory context file such as `context/codex-issue.md`, read it when present, then reconcile it against current repository evidence. If it is missing, state that it is not present and continue unless that file is the only possible source for the task.
4. When startup docs and real filesystem state conflict, prefer the real filesystem state and fix the startup docs as part of the smallest complete workflow slice.

## Product Analytics Flow
1. Do not turn local sampled data into global-sounding product claims. If a ranking only covers monitored targets, label and model it as monitored coverage.
2. Before adding new chart surfaces, prove the collection/materialization/read-model path can supply the requested range and expose empty, partial, degraded, and complete data-quality states.
3. Prefer the sequence `semantics and coverage -> bounded backfill/materialization -> API contract -> frontend chart/workflow`.
4. Keep small-server limits in the loop: bounded jobs, retention/size observability, and no unbounded all-Reddit crawling by default.
