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
3. Use one state source only: Obsidian workspace `Projects/project.md`.
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

