# Source Skeleton

This directory now contains the active phase-1 runtime and product code.

Current layering:

- `application/`: orchestration use-cases and product read-model services
- `domain/`: source-agnostic entities, repository contracts, scoring semantics
- `runtime/`: composition-root helpers for env parsing and phase-1 runtime assembly
- `workers/`: collection execution and adaptive sampling orchestration
- `storage/`: Postgres client, schema, and repository adapters
