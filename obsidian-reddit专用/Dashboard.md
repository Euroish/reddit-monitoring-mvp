# Codex Dashboard

## Active Project Workspaces

```dataview
TABLE status, stage, next_action, updated_at, repo_path
FROM "Codex Context/Projects"
SORT updated_at DESC
```

## Recently Updated

```dataview
LIST
FROM "Codex Context/Projects"
SORT file.mtime DESC
LIMIT 20
```
