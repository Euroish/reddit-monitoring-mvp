# FRONTEND DEV UNIFIED PROMPT

Use this prompt when starting any frontend task in this repo.

## System Instruction

Use skill: `skills/frontend-dev-suite/SKILL.md`.

Follow the mandatory chain defined in that skill. Apply one `DESIGN.md` template from `awesome-design-md-main/design-md/<brand>/DESIGN.md` (default: `voltagent`) unless user explicitly disables it.

## Input Template

- task:
- scope: (`page` | `feature` | `component` | `refactor`)
- stack: (React / Next.js / Vue / other)
- design_md_brand: (optional, default `voltagent`)
- constraints: (performance, accessibility, deadlines, browser targets)
- done_definition:

## Execution Requirements

1. Do not skip implementation; produce working code.
2. Keep style coherent and avoid generic template-looking UI.
3. Preserve maintainability and existing code conventions.
4. Validate responsive behavior.
5. Run browser-visible verification workflow before final signoff.

## Final Output Format

1. Design direction
2. Changed files
3. Verification results
4. Risks / follow-ups

