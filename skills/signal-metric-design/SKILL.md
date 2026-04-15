---
name: signal-metric-design
description: Define metric and threshold semantics before changing algorithm behavior. Use for score components, alert thresholds, clamps, and explainable signal design so tuning does not drift into blind parameter tweaking.
---

# Signal Metric Design

## Use When

- changing score components or weights
- changing thresholds or trigger conditions
- adding or adjusting clamps, caps, or floors
- changing anomaly, alert, reliability, or degradation signals

## Core Rule

Do not tune parameters until the signal contract is explicit.

Before implementation, write down:

1. what phenomenon the metric is trying to capture
2. whether higher values are better, worse, or context-dependent
3. expected range and whether it needs a floor, cap, or clamp
4. what false positive and false negative look like
5. which outward fields must remain explainable

## Minimum Output

For each changed signal, define:

- `name`
- `intent`
- `direction`
- `expected range`
- `clamp/bounds`
- `main failure mode`
- `affected tests`

## Guardrails

- Prefer additive clarification over silent semantic drift.
- If the signal meaning cannot be stated in 1-3 lines, the task is not ready for tuning.
- Keep formulas interpretable enough for `scoreComponents`, degraded reasons, or explain payloads.
- If a threshold depends on stage-specific policy, align it with `Projects/project.md` before editing code.
