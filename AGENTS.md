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

