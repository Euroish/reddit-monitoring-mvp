---
name: worker-boundary-for-algorithm
description: Prevent algorithm tasks from drifting into worker, scheduler, runtime, and env rewrites. Use when a scoring or threshold task starts pulling on execution boundaries or materialization flow.
---

# Worker Boundary For Algorithm

## Use When

- an algorithm task starts touching worker files
- a threshold or scoring change appears to require scheduler edits
- materialization or runtime wiring is being considered for an algorithm fix

## Core Rule

Algorithm tasks do not enter worker/runtime boundaries by default.

## Default Boundary

Prefer this order:

1. domain/service logic
2. focused tests
3. read-model contract alignment
4. worker/materialization changes only if inputs are truly missing

## Proof Required Before Crossing Boundary

Before editing worker or scheduler code, state:

1. what algorithm input is missing
2. why domain/read-model code cannot solve it
3. the smallest boundary change that would supply the missing input
4. how the change will be validated in mock/focused tests first

## Guardrails

- Do not widen a formula-tuning task into scheduler cleanup.
- Do not change env/runtime wiring unless the requirement is explicit.
- Prefer mock or deterministic verification before any live-path verification.
- Keep boundary edits minimal and directly tied to the missing algorithm input.
