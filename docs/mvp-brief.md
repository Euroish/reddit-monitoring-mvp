# MVP Brief (Reddit-only, Phase 1)

## Single-source definition

- Source: `Reddit`
- Monitored object: `subreddit`
- Primary value: `trend change`

## Problem statement

Users need a fast way to see whether a watched subreddit is accelerating or cooling down, without manually checking pages throughout the day.

## MVP output

For each monitored subreddit, provide:
- 15-minute trend timeline
- key deltas vs previous window
- top new posts in current window

## Minimal user flow

1. add subreddit to watchlist
2. scheduler collects metrics continuously
3. user opens trend view
4. user sees current window vs previous window change

## Non-goals in this phase

- account-level monitoring
- keyword-level monitoring
- anomaly alert automation
- cross-platform comparison

## Success criteria

- one-command onboarding for a new subreddit target
- reliable collection for 24h without manual intervention
- trend timeline data available for at least 95% of windows
- no Reddit-specific fields leaking into API contracts

