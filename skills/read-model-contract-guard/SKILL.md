---
name: read-model-contract-guard
description: Protect outward read-model and API semantics while algorithm internals change. Use when score fields, summaries, explain payloads, timelines, movers, or anomaly outputs could be affected.
---

# Read Model Contract Guard

## Use When

- changing fields used by read models or API responses
- changing semantics of `timeline`, `summary`, `topMovers`, or `recentAnomalies`
- changing `scoreComponents`, `heatIndex`, `surgeScore`, or related explain fields

## Core Rule

Outward contracts are more stable than internal formulas.

## Required Checks

Before merging a change, confirm:

1. which outward fields are touched
2. whether the change is additive or semantic
3. whether old fields still mean the same thing
4. which tests and docs must move with the change

## Guardrails

- Prefer adding fields over deleting fields.
- Do not silently repurpose an existing outward field for a new meaning.
- If semantics change, update tests and docs in the same round.
- Keep backward-compatible read paths working unless the task explicitly authorizes a contract change.

## Delivery Note

State explicitly:

- touched outward fields
- untouched outward fields
- whether any semantic contract changed
