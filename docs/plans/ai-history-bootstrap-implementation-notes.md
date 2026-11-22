# AI Verified History Bootstrap — Implementation Notes

> Branch: `feat/ai-verified-history-bootstrap`
> Base: `origin/fix/ai-release-readiness@21f2c33d32afb8470e0f359435a2dc1a59eceabb` (PR #16, unmerged)
> `origin/main` at branch creation: `b6bd21e7901fc5b0a37af054faa2daaa20330094`

## 1. Repository Audit Summary

1. **Database Schema (`054` & `055`)**:
   - `054_ai_release_intelligence.sql` and `055_ai_automation_and_ops.sql` define 17 AI tables (`ai_vendor`, `ai_vendor_source`, `ai_model`, `ai_model_alias`, `ai_registry_source`, `ai_registry_listing`, `ai_registry_change`, `ai_model_spec_observation`, `ai_event_candidate`, `ai_release_event`, `ai_event_reference`, `ai_sync_run`, `ai_benchmark_snapshot`, `ai_benchmark_entry`, `ai_llm_extraction_cache`, `ai_auto_publish_audit`, `ai_ops_alert`), bringing the total public tables to 41.
   - `054` seeds 10 core vendors (`openai`, `anthropic`, `google`, `meta`, `deepseek`, `qwen`, `moonshot`, `zai`, `mistral`, `xai`) and 5 registry sources (`openrouter`, `litellm`, `huggingface`, `epoch`, `artificial_analysis`). `055` adds `official_domains` and `official_discovery`.
   - Neither `054` nor `055` seeds verified historical `ai_model` or `ai_release_event` records.

2. **Deduplication & Discovery (`ai-discovery.ts` & `ai-sync.ts`)**:
   - `runOfficialEventDiscovery` currently computes `official:<vendor>:<sha256(vendor|eventType|modelName|date).slice(0,40)>` locally and scans only `lookbackHours=168` (`LIMIT 200`).
   - `applyRegistryItems` uses `isInitialSnapshot` to avoid flooding candidates on first registry sync.
   - Shared identity logic will be extracted to `src/modules/content/ai-event-identity.ts` and reused by `ai-discovery.ts`, history seed import (`ai-history-import.ts`), and history backfill (`ai-history-backfill.ts`).

3. **Migrations & Packaging**:
   - `src/storage/schema/run-migrations.ts` enforces SHA-256 immutability on applied migrations. New tables (`ai_history_import_run`, `ai_history_backfill_run`) will be added in `056_ai_history_bootstrap_and_backfill.sql` (+2 tables, total 43 public tables).
   - `scripts/build-api.mjs` must validate `data/ai/history/v1/manifest.json` offline and copy `data/ai/history/v1/*.json` into `dist/data/ai/history/v1/`.
   - `scripts/release-package-lib.mjs` `allowed()` must explicitly allow `dist/data/ai/history/v1/*.json` without opening `data/**`.
   - `Dockerfile` runtime stage copies only `/app/dist` and will execute `run-migrations.js` -> `ai-history-cli.js apply --dataset v1 --trigger startup` -> `server.js`.
   - `docker-compose.yml` `app.environment` will forward `AI_SYNC_ENABLED`, `AI_SYNC_INTERVAL_SECONDS`, `AI_AUTO_PUBLISH_SHADOW`, `ARTIFICIAL_ANALYSIS_API_KEY`, and `ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION` with safe defaults.

4. **Module & Code Quality Constraints**:
   - `scripts/check-docs.ts` enforces `<= 450` lines/file and `<= 220` chars/line, no classes or `*Repository` interfaces in `src/modules/content/`.
