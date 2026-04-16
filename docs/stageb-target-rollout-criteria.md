# Stage B Target Rollout Criteria (P1.6)

## Scope

Define explicit, target-level rollout rules using the controlled-promotion verifier output with separated:

- `globalReadinessStatus` / `globalDegradedReasons`
- `localTargetReadinessStatus` / `localTargetDegradedReasons`
- `globalOnlyDegradedReasons` / `localOnlyDegradedReasons`

Command baseline:

`npm run algo:promotion:verify`

Verifier note:

- local stale-head now uses an explicit target-head freshness guard in verifier output: if `targetFreshness.latestContentAgeSeconds <= 5400`, `provider_stale_head_elevated:*` is suppressed for local target readiness and recorded under `targetFreshness.staleHeadSuppressedProviders`.
- this keeps target-level rollout decisions aligned with "is head fresh now?" while preserving full global degraded-reason visibility.

## Decision rules

1. Promote and keep promoted (target-level pass):
   - `localTargetDegradedRuns == 0` across the verification window, and
   - no `localOnlyDegradedReasons` appear.

2. Keep in shadow lane (target-level hold):
   - `localTargetDegradedRuns > 0`, or
   - `localTargetDegradedReasonCounts` contains `provider_stale_head_elevated:scrapling` or `provider_data_stalled:scrapling`.

3. Treat global-only degradation as non-blocking for target promotion decisions:
   - reasons present in `globalOnlyReasonCounts` but absent from local reasons must not block a local target that is otherwise ready.

4. Stage B exit gate toward Stage C:
   - at least one hot-target set and one technical-target set satisfy Rule 1 in repeated windows, and
   - `npm run algo:phase1:full` remains green for the same revision.

## Current evidence (2026-04-16)

| Snapshot | Target set | runCount | globalDegradedRuns | localTargetDegradedRuns | Local result | Decision |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `live-controlled-promotion-2026-04-16T06-59-02-278Z.json` | `chatgpt,claudeai` | 4 | 4 | 0 | local ready in all cycles | keep promoted |
| `live-controlled-promotion-2026-04-16T07-00-52-231Z.json` | `machinelearning,datascience` | 4 | 4 | 4 | local degraded reason: `provider_stale_head_elevated:scrapling` | keep shadow |
| `live-controlled-promotion-2026-04-16T10-10-21-019Z.json` | `chatgpt,claudeai` | 4 | 4 | 0 | local ready; stale-head suppressed with fresh head (`latestContentAgeSeconds` about 1.8k) | keep promoted |
| `live-controlled-promotion-2026-04-16T10-10-55-835Z.json` | `machinelearning,datascience` | 4 | 4 | 4 | local degraded reason persists: `provider_stale_head_elevated:scrapling` (`latestContentAgeSeconds` > 14k) | keep shadow |
| `live-controlled-promotion-2026-04-16T10-19-17-380Z.json` | `programming,technology` | 4 | 4 | 0 | local ready in all cycles (technical set pass) | promotion candidate |
| `live-controlled-promotion-2026-04-16T10-22-54-916Z.json` | `python,javascript` | 4 | 4 | 2 | mixed: `python` stale-head degraded, `javascript` local ready | split decision by target |
| `live-controlled-promotion-2026-04-16T10-23-16-792Z.json` | `programming,technology` | 4 | 4 | 0 | local ready repeated again | keep promoted candidate |

## Immediate use

1. Continue promoted verification for `chatgpt,claudeai` as a positive control set.
2. Keep `machinelearning,datascience` in shadow lane until local stale-head degradation clears.
3. Use `programming,technology` as the current technical positive-control pair (`Rule 1` repeated pass).
4. Keep `python` in shadow while head freshness remains stale; `javascript` can follow promoted-candidate policy.
