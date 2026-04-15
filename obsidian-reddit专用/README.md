# Codex Context

This folder is the durable context layer between Codex and Obsidian.

## What lives here

- `Projects/`: one workspace note per coding repository
- `Templates/`: reusable templates for workspace notes
- `Dashboard.md`: Dataview-based index for active project workspaces

For this repository, execution truth must live only in:

- `Projects/project.md`

## Automation model

- Codex restores project context from the matching workspace note at session start.
- Codex writes a task summary and next action back into the workspace note at task end.
- If the Obsidian `Local REST API` plugin is running, Codex syncs through the API.
- If the API is unavailable, Codex falls back to direct Markdown writes in this folder.

## Plugins used

- `obsidian-local-rest-api`
- `obsidian-advanced-uri`
- `dataview`
- `templater-obsidian`
- `quickadd`

## Notes

- The API key is managed by the `obsidian-local-rest-api` plugin inside Obsidian.
- The default API endpoint is `https://127.0.0.1:27124`.
- Project routing is tracked in `D:\Codex\.codex\skills\obsidian-vault\references\project-memory-map.json`.
