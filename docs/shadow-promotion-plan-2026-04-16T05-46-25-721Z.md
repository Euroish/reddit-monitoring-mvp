# Shadow Promotion Plan

- Generated at: 2026-04-16T05:46:25.721Z
- Snapshot count: 1
- Eligible subreddits: 0
- Included snapshots: live-shadow-compare-2026-04-16T05-43-51-898Z.json

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

| Subreddit | Samples | Baseline Success | Shadow Success | Gate Pass | Jaccard P50 | Jaccard Min | Extracted Delta P95 | Lag Delta P95 (s) | Duration Ratio P95 | Eligible | Recommendation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| datascience | 2 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 0.000 | 1.404 | no | keep_shadow_only |
| machinelearning | 2 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 0.000 | 1.428 | no | keep_shadow_only |

## Blocking Reasons

### datascience

- sample_count_below_min:2<4

### machinelearning

- sample_count_below_min:2<4
