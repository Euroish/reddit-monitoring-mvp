# Shadow Promotion Plan

- Generated at: 2026-04-16T05:21:17.601Z
- Snapshot count: 2
- Eligible subreddits: 0
- Included snapshots: live-shadow-compare-2026-04-16T04-14-33-511Z.json, live-shadow-compare-2026-04-16T04-15-55-498Z.json

## Policy

```json
{
  "minSamples": 4,
  "minBaselineSuccessRate": 0.99,
  "minShadowSuccessRate": 0.99,
  "minParityGatePassRate": 0.95,
  "minJaccardP50": 0.95,
  "minJaccardMin": 0.9,
  "maxAbsExtractedDeltaP95": 3,
  "maxAbsLagDeltaSecondsP95": 120,
  "maxDurationRatioP95": 6
}
```

## Decisions

| Subreddit | Samples | Baseline Success | Shadow Success | Gate Pass | Jaccard P50 | Jaccard Min | Extracted Δ P95 | Lag Δ P95 (s) | Duration Ratio P95 | Eligible | Recommendation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| datascience | 2 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 0.000 | 3.834 | no | keep_shadow_only |
| machinelearning | 3 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 0.000 | 3.699 | no | keep_shadow_only |

## Blocking Reasons

### datascience

- sample_count_below_min:2<4

### machinelearning

- sample_count_below_min:3<4
