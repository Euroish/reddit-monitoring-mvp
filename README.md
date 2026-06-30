# Reddit Monitoring MVP

Reddit monitoring and research toolkit built with TypeScript, Node.js, PostgreSQL, and React. It collects subreddit posts and comments, materializes trend and anomaly data, exposes an API, and provides a web workbench for analysis.

## Repository layout

- `apps/api` — HTTP API server
- `apps/web` — React and Vite web application
- `src/connectors/reddit` — Reddit data providers and connector contracts
- `src/domain`, `src/application` — domain logic and use cases
- `src/storage` — PostgreSQL repositories and migrations
- `src/workers`, `workers` — collection and scheduling workers
- `scripts` — verification, operations, and research export tools
- `tests` — unit and integration tests
- `deploy` — example environment, Nginx, and systemd configuration
- `docs` — architecture and deployment documentation

## Prerequisites

- Node.js 22 or newer
- npm
- PostgreSQL for database-backed workflows

## Setup

```bash
npm install
npm --prefix apps/web install
```

Copy the relevant examples from `deploy/env/` and provide the required environment variables for the API or workers you intend to run. Do not commit secrets or local `.env` files.

## Development

```bash
# API
npm run app:api

# Web application
npm --prefix apps/web run dev

# Run one collection cycle
npm run worker:phase1:once

# Run the scheduler
npm run worker:phase1:scheduler
```

## Research exports

The repository includes tools for exporting Reddit posts and bounded comment trees to CSV and JSON:

```bash
npm run research:export:reddit
npm run research:export:reddit-search
```

Generated datasets and documents belong under `output/`, which is intentionally excluded from Git.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Use `npm run verify:repo` to run the repository-level typecheck, build, and compiled smoke test together.

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment runbook](docs/deployment-runbook.md)
- [Data model](docs/data-model.md)
- [Collection strategy](docs/collection-strategy.md)
