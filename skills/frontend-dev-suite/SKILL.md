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
5. `awesome-design-md-main/design-md/<brand>/DESIGN.md` (optional but recommended)
6. `skills/frontend-browser-review/SKILL.md`

## Design-MD Integration

Design template root:

- `awesome-design-md-main/design-md`

Default brand if user does not specify:

- `voltagent` (`awesome-design-md-main/design-md/voltagent/DESIGN.md`)

Selection rule:

1. If user names a brand, use that brand's `DESIGN.md`.
2. If no brand is given, use `voltagent`.
3. If brand folder does not exist, fallback to `voltagent`.

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

