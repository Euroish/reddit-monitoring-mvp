# SIFTLINE — Semrush-Style Market & Community Intelligence Prototype

A full-featured React + TypeScript + Vite frontend prototype adhering strictly to `frontend-backend-integration-manual.md` (`prod@dd2feb2`) and designed around the visual, typographic, interactive, and visualization language of Semrush (`https://www.semrush.com/`), combined with the SIFTLINE brand identity, palette (`#20271F`, `#D4E9E5`, `#B7A5ED`, `#DBF477`, `#F5AE78`, `#7659BD`, `#258C89`), and 30 switchable SVG logo concepts from `新原型设计语言定义稿.html`.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

- **Homepage (`/`)**: Public Semrush-style landing page with concentric-circle radial backdrop texture, Mega-Menus (`Product`, `Solutions`, `Resources`), Hero query pill with platform dropdown, interactive Signal Overview widget, Enterprise dark prism showcase, 9 expandable capability cards, interactive Stats & Facts rows, Community Signal Index leaderboard, Testimonials, Resources carousel, and signature full-width wordmark footer.
- **Split-Screen Auth (`/projects` unauthenticated or Log In)**: Full-viewport split-screen login & 72-char invite-code registration with live `EN / 中文` switcher, color skin selector, interactive ECharts `Signal Overview` preview card, and 1-click Demo Sandbox role login.
- **Logo Switcher (30 Concepts)**: Click the `01/30 ▾` badge in the homepage header, auth chip, or workbench rail to switch across all 30 SVG marks from `新原型设计语言定义稿.html` (supports category tabs and `←` / `→` arrow keys).
- **Color Replacement Studio & Anti-Clash Presets**: Swap across **17 curated presets** (5 Core baselines, 6 Gradient editions, and 6 zero-gradient Flat Solid editions) or customize individual color roles & gradient mode with live **EN / 中文** + ECharts palette sync across Homepage, Auth, and Workbench.
- **Authenticated Workbench (`/projects`, `/content`, `/sources`, `/workspace`, `/settings`)**:
  - Collapsible two-level left navigation, `Ctrl+K` command palette, ECharts-powered multi-chart visualizations (KPI mini sparklines, UTC stacked bar with hatched uncollected gap `markArea` / stream area / platform×day heatmap, circular Signal Score gauge / 5-axis radar, platform bar / Nightingale rose, kind stack / sunburst, non-exclusive provider attribution bars, scatter bubble matrix, treemap / Sankey / funnel, split-axis observation trajectory, dual-quota meters, and review progress gauge).
  - Supports **Demo Sandbox** (stateful local engine matching all 31 endpoints, RBAC roles `owner` / `admin` / `viewer`, cursor pagination, `409` optimistic locking, `Idempotency-Key` checks, and `stored_sample` data) and **Live `/api/v1` Proxy** (`vite.config.ts` forwards `/api/v1/*`, `/healthz`, `/readyz` to `VITE_API_PROXY_TARGET`, default `http://localhost:3000`).

## Production Build

```bash
pnpm build
```
