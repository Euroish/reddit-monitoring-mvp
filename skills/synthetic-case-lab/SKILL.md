---
name: synthetic-case-lab
description: Build and use fixed synthetic algorithm cases before and after changes. Use for scoring, ranking, anomaly, and threshold work so behavior is verified against stable scenarios instead of ad hoc reruns.
---

# Synthetic Case Lab

## Use When

- changing scoring logic
- changing ranking behavior
- changing anomaly or alert detection
- tuning sampling or degraded thresholds

## Core Rule

Every algorithm change should be checked against stable synthetic cases, not only live or incidental fixtures.

## Default Case Set

Keep or extend focused coverage for:

1. steady low volume
2. steady high volume
3. gradual rise
4. single spike
5. spike then decay
6. low-sample noisy window
7. highly concentrated manipulation-like window
8. missing fields or incomplete window
9. backfill window vs live window
10. same heat with different dispersion

## Workflow

1. choose the smallest relevant subset of cases
2. encode the expected behavior before editing implementation
3. make the test fail for the intended reason
4. change implementation
5. rerun the same cases plus the nearest surrounding suite

## Guardrails

- Prefer unit or focused integration fixtures over live runs.
- Do not use scheduler/API end-to-end runs as the first validation layer for algorithm tuning.
- When behavior changes intentionally, update expectations explicitly instead of loosening assertions.
- If no stable synthetic case can be described, narrow the task before changing code.
