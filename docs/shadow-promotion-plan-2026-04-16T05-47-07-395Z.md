# Shadow Promotion Plan

- Generated at: 2026-04-16T05:47:07.395Z
- Snapshot count: 2
- Eligible subreddits: 2
- Included snapshots: live-shadow-compare-2026-04-16T05-43-51-898Z.json, live-shadow-compare-2026-04-16T05-46-53-400Z.json

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
| datascience | 4 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 0.000 | 1.533 | yes | promote_scrapling_primary_with_http_fallback |
| machinelearning | 4 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 0.000 | 1.413 | yes | promote_scrapling_primary_with_http_fallback |

## Blocking Reasons
