---
name: frontend-browser-review
description: |
  Browser-based review workflow for user-visible frontend changes in this project.
  Use when UI behavior, layout, styling, navigation, or browser-visible regressions
  need final verification before signoff.
---

# Frontend Browser Review

Use this skill when a change affects what users see or do in the browser.

## Start Here

- Identify the frontend app entry in this repo (for example `apps/*`, `web/*`, or `src/*` frontend module).
- Start the frontend dev server using the project's actual script (for example `npm run dev` or framework-specific script).
- Use Playwright/browser automation only after the page is reachable locally.

## When To Use It

- UI changes in frontend code paths
- Layout, styling, or responsive behavior changes
- Changes to navigation or page flows
- Bug fixes where the failure mode is visible in the browser
- Final signoff for user-visible frontend work

## Review Loop

1. Start the frontend app with this repo's actual dev command unless an
   existing local server is already running.
2. Install Chromium with project Playwright setup command if Playwright has not
   been set up on the machine yet.
3. Open the primary changed flow with the Playwright MCP server.
4. Exercise the main happy path affected by the change.
5. Check for obvious visual regressions:
   - broken layout or spacing
   - banner overlap or viewport anchoring issues
   - missing loading, empty, or error states
   - broken responsive behavior on narrow widths
6. If the page changed materially, inspect the resulting UI state and compare
   it against the intended behavior from the task or existing patterns.
7. If the browser session fails, inspect traces and artifacts under
   `.playwright-mcp/`.

## Output Expectations

Report:

1. What flow you reviewed
2. Whether the primary flow worked
3. Any visible regressions or follow-up risks
4. If review was blocked, exactly what prevented browser verification

## Scope Notes

- This skill complements, not replaces, targeted tests and linting.
- For implementation details, stay in project AGENTS + frontend implementation skills.
- Use this as the browser-signoff workflow, not as a generic frontend coding
  guide.
