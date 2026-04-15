# ADR-001: Start as a Modular Monolith with Workers

## Status
Accepted

## Context
The product starts as a Reddit-only monitoring MVP.
The team is small.
The system must remain easy for Codex / AI-assisted iteration.
Future expansion to TikTok is expected.

## Decision
Use a **modular monolith** for product and API logic.
Use one or more **worker processes** for collection and async processing.
Keep platform integrations behind connector / adapter boundaries.

## Why
- fastest path to a buildable MVP
- fewer repos and less orchestration overhead
- easier context continuity for AI-assisted development
- can still split collector / ranking / alert modules later

## Consequences
### Positive
- simpler development workflow
- clearer module boundaries than an ad-hoc monolith
- future source expansion is easier

### Negative
- strong internal boundaries must be maintained by discipline
- some future splits will still require refactoring
