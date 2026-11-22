# SIFTLINE AI Verified History Dataset (`data/ai/history/`)

## Purpose

This directory stores versioned, schema-validated, evidence-backed AI model and product release baselines (`v1/`) for offline cold-start seeding into PostgreSQL (`ai_vendor`, `ai_model`, `ai_model_alias`, `ai_release_event`, `ai_event_reference`).

## Date Precision & Integrity Rules

- **`day` precision**: Used only when an official vendor announcement, changelog, or release note explicitly states the calendar day (`YYYY-MM-DD`).
- **`month` precision**: Used when only the year and month are confirmed; stored as `YYYY-MM-01` placeholder with `date.precision = "month"`. UI displays `YYYY-MM` only.
- **No fabricated dates**: `OpenRouter.created`, `HuggingFace.createdAt`, `LiteLLM` git commit timestamps, and `Epoch AI` `YYYY-MM-15` / `YYYY-07-01` padded dates are **never** promoted to official release dates.
- **Immutability**: `v1/manifest.json` pins exact byte lengths and SHA-256 checksums for all JSON files. `npm run build:api` verifies these offline and copies `v1/` into `dist/data/ai/history/v1/`.

## CLI Usage

```bash
npm run ai:history:validate -- --json
npm run ai:history:plan -- --json
npm run ai:history:apply -- --json
npm run ai:history:backfill -- --source content_history --batch 50 --max-items 500
```
