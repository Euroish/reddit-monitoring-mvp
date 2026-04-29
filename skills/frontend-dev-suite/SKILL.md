---
name: frontend-dev-suite
description: Unified frontend orchestration skill for this project. Use this as the single entrypoint for frontend implementation so design, engineering patterns, optimization, and browser review are executed consistently.
---

# Frontend Dev Suite

## Purpose

Use one entrypoint for frontend tasks in this repo:
- design direction
- UI implementation
- React/Next patterns
- performance/accessibility hardening
- browser verification

Current execution truth for the frontend slice is:

1. `obsidian-reddit专用/Projects/project.md`
2. `docs/frontend-upgrade-workflow-2026-04-29.md`
3. current `apps/web` code

Do not treat `obsidian-reddit专用/Projects/后端能力盘点与前端后台规划-2026-04-28.md` as the live frontend execution contract unless `project.md` explicitly promotes it again.

## Activate When

- user asks for frontend page/component/app development
- user asks for UI/UX redesign
- user asks for frontend performance or polish
- user asks for frontend pre-release review

## Mandatory Skill Chain

Run in this order:

1. `skills/frontend-patterns/SKILL.md`
2. `skills/senior-frontend/SKILL.md`
3. `skills/frontend-design/SKILL.md`
4. `skills/frontend-ui-ux/SKILL.md`
5. `web-design-engineer` for visual implementation workflow and stronger HTML/CSS/React presentation patterns
6. `awesome-design-md-main/design-md/<brand>/DESIGN.md`
7. `awesome-design-md-main/design-md/<brand>/preview-dark.html` or `preview.html`
8. `gpt-image-2` only when the task needs raster art, mockup assets, or generated textures
9. `skills/frontend-browser-review/SKILL.md`

Do not load every resource blindly. Start with `DESIGN.md`, then open the matching preview HTML only when you need visual confirmation of tokens, spacing, or component treatments.

## Design-MD Integration

Design template root:

- `awesome-design-md-main/design-md`

Default brand if user does not specify:

- `voltagent` (`awesome-design-md-main/design-md/voltagent/DESIGN.md`)

Selection rule:

1. If user names a brand, use that brand's `DESIGN.md`.
2. If no brand is given, use `voltagent`.
3. If brand folder does not exist, fallback to `voltagent`.

Recommended brand mapping for this repo:

- `kraken`, `linear.app`, `raycast`: market/workbench density and chart-adjacent product surfaces
- `sentry`, `clickhouse`, `hashicorp`: admin and ops surfaces
- `voltagent`, `warp`, `vercel`: shell, navigation, and refined developer-product framing

Preview workflow:

1. Read the selected `DESIGN.md`.
2. Open `preview-dark.html` first for dark-surface products like this repo.
3. Open `preview.html` only if you need the light-surface comparison.
4. Extract only the tokens and interaction patterns that fit the current product surface.

## Chart Upgrade Rule

For TradingView-like interactive charts, prefer `lightweight-charts` as the chart engine upgrade path.

Rules:

1. Keep API/read-model DTOs library-agnostic.
2. Keep `apps/web/src/features/workbench/model/chartOptions.ts` as the product-facing chart model until the adapter layer is replaced.
3. Put chart-library specifics behind a workbench chart adapter/component boundary.
4. Preserve current captured-count semantics: `Captured New Posts` and `Captured Qualified Posts` remain the primary target-detail language.
5. Do not invent frontend-only indicators, anomaly math, or comparison normalization rules.

## Conflict Resolution

If instructions conflict, resolve by priority:

1. Existing project design system and component conventions
2. Accessibility/performance constraints
3. Selected `DESIGN.md`
4. `frontend-design` and `frontend-ui-ux` style guidance

## Frontend Delivery Contract

For each frontend task, output should include:

1. chosen visual direction and why (1-3 lines)
2. concrete implementation in code
3. responsiveness check notes (desktop + mobile)
4. accessibility minimum check (semantic roles, keyboard focus, contrast)
5. browser verification result and remaining risks

## Quick Trigger

When starting frontend work, explicitly call:

- `Use skill: frontend-dev-suite`
