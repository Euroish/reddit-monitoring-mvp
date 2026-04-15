# Reddit Trend Algorithm Skill

## When to use

Use this skill for:
- trend scoring model design
- trend score schema upgrades
- read-model fields for explainable ranking
- anomaly/change-point signal integration

## Hard constraints

- Keep Reddit-only MVP scope.
- Keep monitored object as `subreddit`.
- Do not redesign architecture.
- Keep worker + repository boundaries stable.
- Keep scoring interpretable and tunable.

## Scoring model target

For each `(target_id, window_start, window_end)` produce:
- `velocity_score`
- `acceleration_score`
- `baseline_deviation_score`
- `change_score`
- optional `anomaly_score`
- final `trend_score`

## Required data contracts

- Preserve backward compatibility for `subreddit_trend_point`.
- Add explicit algorithm metadata:
  - `algorithm_version`
  - `algorithm_params`
  - `sample_count`
  - `window_complete`
  - `build_job_id`
- Store explainable components in structured form:
  - scalar columns for main components
  - optional JSON payload for debug components

## SQL migration rules

- Never edit already-applied migration files.
- Add new numbered migration files only.
- Prefer additive schema changes.
- Add indexes for:
  - timeline reads
  - ranking reads
  - algorithm-version filtered reads

## Acceptance checklist

- Existing workers still write `subreddit_trend_point` without failures.
- New columns have safe defaults.
- Read path for old fields still works unchanged.
- New schema supports A/B algorithm experiments.

