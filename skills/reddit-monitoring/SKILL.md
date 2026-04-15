# Reddit Monitoring Skill

## When to use

Use this skill for:
- MVP scoping
- monitored object selection
- collection strategy
- data model design
- implementation sequencing

## Core rule

Always reduce the problem to:

1. one source
2. one monitored object
3. one primary value

## Order of work

1. define object
2. define value
3. define entities / snapshots
4. define collection path
5. define the smallest useful output

## Preferred outputs

- MVP brief
- data model draft
- collection strategy table
- weekly build plan
- risk / assumption list

## Skill routing

- Use this skill for MVP scope and pipeline boundary decisions.
- For scoring-model and trend-algorithm work, use `skills/reddit-trend-algo/SKILL.md`.

## Avoid

- multi-platform design too early
- full architecture discussions before MVP shape is clear
- generic brainstorming without a concrete monitored object


## Architecture default

Unless the task clearly needs otherwise, assume:
- modular monolith first
- stateless API
- async workers for collection / ranking / alerts
- source connectors isolated from product logic
- metrics stored as snapshots
