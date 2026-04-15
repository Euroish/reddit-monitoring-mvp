# PROJECT

## One-line goal

Build a **Reddit single-source monitoring MVP** for content / topic / subreddit tracking.

## Current product shape

This is a **data product / monitoring tool**, not a pure content-operations project.

## Scope now

- Source: Reddit only
- Stage: MVP
- Architecture direction: modular monolith first, worker later if needed
- Priority outputs:
  - MVP brief
  - data model
  - collection strategy
  - minimal implementation plan

## Do now

- Narrow the first monitored object:
  - subreddit
  - keyword
  - account
  - post
- Narrow the first core value:
  - trend change
  - growth ranking
  - anomaly alert

## Do not do now

- Do not expand to TikTok
- Do not design a full multi-platform system
- Do not over-engineer infra
- Do not mix product monitoring with unrelated content posting workflows

## Success for the current phase

A clear, buildable MVP definition with:
1. one source
2. one monitored object
3. one primary value
4. one usable data model
5. one realistic collection plan


## Architecture baseline

- Product/API: modular monolith
- Async work: separate worker processes
- Source integration: connector / adapter boundary
- Data layers:
  - raw payload
  - normalized entities
  - metrics snapshots

See `docs/architecture-sketch.md`.
