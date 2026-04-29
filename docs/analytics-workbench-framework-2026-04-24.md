# Analytics Workbench Framework

Date: 2026-04-24
Status: historical product-direction source; current execution truth is `obsidian-reddit专用/Projects/project.md` plus `docs/frontend-upgrade-workflow-2026-04-29.md`

Current reconciliation note, 2026-04-29:

- The target workbench contract and target detail UI described below have materially advanced since this note was written.
- `apps/web/src/features/workbench/components/WorkbenchChart.tsx` is no longer a thin ECharts/SVG chart path; it now wraps `lightweight-charts` behind the product-level `chartOptions.ts` model.
- Use this document for product direction and guardrails only. Use the current frontend upgrade workflow for active sequencing and implementation status.

## 1. Current State

The project now has a working Reddit collection lane on Linux:

- `sing-box-collector.service` exposes a local collector-only proxy at `127.0.0.1:1080`.
- API and scheduler use `REDDIT_HTTP_PROXY`.
- Backend-triggered proxy failover can switch collector nodes without changing the host default route.
- The latest scheduled cycle processed six targets and materialized six targets with zero failed targets.

The product shell already exists:

- `/login`
- `/dashboard`
- `/queries`
- `/target/:targetId`
- `/ops`

The target detail page has moved beyond the original thin chart surface. As of 2026-04-29, it uses the workbench endpoint and a `lightweight-charts` adapter for multi-series charting. Browser-level acceptance for the new target workbench remains pending.

## 2. Product Direction

The next product goal is a TradingView-like analytics workbench for Reddit signals, not a generic dashboard.

The workbench should support repeated analyst workflows:

1. Find active or emerging targets from a market/watchlist view.
2. Open a target detail workbench.
3. Switch timeframes and overlays.
4. Compare related subreddits or keywords.
5. Inspect driver posts and anomaly events for explanation.
6. Save or revisit watchlist/query contexts.

## 3. Architecture Rule

Do not build chart features as frontend-only transformations.

Every workbench feature should flow through:

```text
persisted facts/materialized rows
  -> read-model service
  -> contract DTO
  -> API endpoint
  -> frontend panel/chart
  -> browser/API smoke
```

## 4. Workbench Layers

### 4.1 Data Plane

Existing responsibilities:

- Reddit collection
- provider health
- scheduler runs
- content ingestion
- daily facts
- trend points
- keyword trend daily rows
- driver/anomaly read paths

This layer should stay operationally boring. It should not know about chart layout.

### 4.2 Indicator Model

Initial indicator families:

| Family | Examples |
| --- | --- |
| Trend | heat price, trend score, EMA 7, EMA 30 |
| Activity | new posts, qualified posts, active users |
| Audience | subscribers, subscriber delta |
| Keyword | auto keyword heat, explicit query heat, global keyword heat |
| Explanation | driver score, matched queries, anomaly score |
| Reliability | provider, duplicate rate, ingest lag, stale head |

Indicators must be named and versioned in read-model output. The frontend should render known indicator ids rather than recomputing formulas.

### 4.3 Chart DTO v2

The first new contract should not expose a chart-library-specific object. It should expose stable product data:

```ts
interface TargetWorkbenchResponse {
  target: TargetSummary;
  range: {
    from: string;
    to: string;
    grain: "day" | "hour";
  };
  series: WorkbenchSeries[];
  overlays: WorkbenchOverlay[];
  panels: WorkbenchPanel[];
  annotations: WorkbenchAnnotation[];
  drivers: DriverPostSummary[];
  anomalies: AnomalySummary[];
  reliability: ReliabilitySummary;
}
```

Required first-slice series:

- `heat_price`
- `ema_7`
- `ema_30`
- `total_new_posts`
- `qualified_post_count`

Required first-slice overlays:

- keyword heat overlay for selected explicit queries
- anomaly markers

Required first-slice side panels:

- top driver posts
- keyword heat table
- collection/reliability status

### 4.4 Frontend Workbench

The target detail route should evolve into the workbench. First version:

- target selector context remains URL-based
- timeframe control starts with `30d/day`
- chart panel supports multiple y-series
- keyword overlay is controlled by query params
- drivers/anomalies appear beside or below the chart
- reliability state is visible but not dominant

Avoid creating a new landing page. The first screen after login should remain operational.

### 4.5 Workflow Objects

Later, but not first slice:

- watchlists
- saved query contexts
- chart presets
- alert rules
- target comparison sets

These should be built only after the target workbench has a stable read-model contract.

## 5. Development Sequence

### W1: Target Workbench Contract

Status: complete on 2026-04-24.

Scope:

- Add `TargetWorkbenchResponse` to `packages/contracts`.
- Add read-model service assembling existing daily facts, trend points, keyword rows, drivers, anomalies, and provider reliability.
- Add `GET /v1/workbench/target/:targetId`.
- Add focused API contract tests.

Acceptance:

- `npm run typecheck` passed.
- `node --import tsx --test tests/integration/api-server-trends.test.ts` passed.
- Live host smoke against `/v1/workbench/target/askreddit?keywords=ai&driverLimit=5&anomalyLimit=5` returned stable series ids, one keyword overlay, drivers, anomalies, and `provider=http`.

### W2: Target Detail Workbench UI

Status: partially complete as of 2026-04-29.

Scope:

- Replace the thin target detail chart data path with the workbench endpoint.
- Render series toggles, multi-series chart, driver panel, keyword table, reliability strip.
- Keep existing route `/target/:targetId`.

Acceptance:

- `npm --prefix apps/web run build`: passed on 2026-04-29.
- `npm --prefix apps/web run lint`: passed on 2026-04-29.
- browser smoke covering chart render, panel render, and mobile overflow: pending.

### W3: Query Overlay

Scope:

- Add query-param driven keyword overlays.
- Reuse normalization v2 and explicit query materialization.
- Show matched query context in drivers.

Acceptance:

- API tests for scoped query overlay
- browser smoke for keyword overlay toggle

### W4: Comparison Mode

Scope:

- Compare multiple targets on normalized heat/trend/activity series.
- Keep comparison read model explicit; do not join in the frontend.

Acceptance:

- contract tests for multiple targets
- chart smoke with two or more target series

## 6. Guardrails

- Do not change provider policy while building workbench UI unless live collection regresses.
- Do not add new formulas only in React.
- Do not make cards inside cards or marketing-style pages.
- Do not expose subscription URLs, proxy node credentials, or bearer tokens.
- Do not let historical dead-letter jobs block analytics design; handle them as operational cleanup debt.

## 7. Current Operational Debt

`/readyz` reports `dead_letter_jobs_present` because 105 live jobs from the pre-proxy failure window are still dead-lettered.

Decision needed:

- replay them if their payloads are still useful, or
- archive/clear them if they only represent the known historical Reddit 403 outage.
