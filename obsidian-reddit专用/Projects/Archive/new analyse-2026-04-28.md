**ChatGPT:**

最新主线已经推进到：**coverage facts + read-model/UI 语义落地后的 P2 阶段**。

不是只完成了 P0，也不是还停在“加字段/改入库”。从 `project.md` 当前状态看，阶段已经更新为：

```
stage: coverage-facts-readmodel-p2-landed
```

并且当前状态明确写了：

```
content provenance / total_eligible 已存在
new listing = total_eligible=true
top supplement = total_eligible=false
candidate filters 不再影响 total denominator
daily facts 只读 total-eligible content
day-level coverage facts 已 materialize
API/read-model/chart 只在 coverage complete 时暴露 complete totals，否则暴露 observed counts
```

[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

[project](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

## 已推进到哪个流程

### P0：已完成

P0 是“采集来源语义 + total eligibility”。

现在已经完成：

```
P0.1 content provenance / total_eligible
P0.2 new_listing 和 top_supplement 分开
P0.3 candidate filter 不再缩小 total denominator
P0.4 daily facts 只统计 total-eligible new listing posts
```

`project.md` 已标记全部 Done。[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

[project](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

这意味着之前最大的污染源已经拆开：

```
new listing = 可进入 total 候选
top supplement = discovery only
```

### P1：主体已完成，但 operational fixture 还没补齐

P1 是“coverage facts”。

现在已经有实体：

```TypeScript
coverageStatus:
  complete | partial | source_limited | unknown

coverageBasis:
  live_continuous
  backfill_reached_day_start
  terminal_eof_reached
  iteration_budget_exhausted
  cursor_saturated
  missed_live_window
  rate_limited
  observed_without_proof
  no_collection_evidence
```

[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/domain/entities/subreddit-collection-coverage.ts)

[subreddit-collection-coverage](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/domain/entities/subreddit-collection-coverage.ts)

也有 repository interface：

```TypeScript
upsertMany
replaceRange
listByTargetInRange
```

[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/domain/repositories/subreddit-collection-coverage-repository.ts)

[subreddit-collection-coverage-r…](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/domain/repositories/subreddit-collection-coverage-repository.ts)

数据库层也新增了 `subreddit_collection_coverage` 表，主键是 `(target_id, day)`，字段包括 `coverage_status`、`coverage_basis`、`observed_post_count`、`total_eligible_post_count`、`oldest_new_listing_seen_at`、`missed_live_window_count`、`backfill_stop_reason`、`source_limited` 等。[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/storage/schema/023_subreddit_collection_coverage.sql)

[023_subreddit_collection_covera…](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/storage/schema/023_subreddit_collection_coverage.sql)

Postgres repository 也已经支持 replace range 和按 target/day range 查询。[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/storage/repositories/postgres/postgres-subreddit-collection-coverage.repository.ts)

[postgres-subreddit-collection-c…](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/storage/repositories/postgres/postgres-subreddit-collection-coverage.repository.ts)

所以 P1.1、P1.2 可以算完成：

```
P1.1 coverage fact storage/read path：完成
P1.2 live/backfill cursor evidence 接入 coverage facts：完成
```

但 P1.3 是 Partial。原因是 coverage job 现在还是基础版。

`buildSubredditCollectionCoverageJob()` 当前逻辑是：

```
读取 daily facts
读取 totalEligibleOnly content
读取 live cursor
读取 backfill cursor
按 day 生成 coverage row
```

判断 complete 的主要条件是：

```
backfillCoverageStatus = covered
且 oldestObservedAt <= dayStart
=> complete / backfill_reached_day_start

terminal_eof 且 oldestObservedAt <= dayStart
=> complete / terminal_eof_reached
```

否则：

```
source_limited / saturated / live source_limited
=> partial 或 source_limited

有 observed posts 但无 proof
=> partial / observed_without_proof

无证据
=> unknown / no_collection_evidence
```

[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/jobs/build-subreddit-collection-coverage.job.ts)

[build-subreddit-collection-cove…](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/jobs/build-subreddit-collection-coverage.job.ts)

这个已经能支撑“complete vs observed”的主路径，但还没把 `missed_live_window`、`rate_limited`、真正的 `live_continuous` 细节做扎实。`project.md` 也明确说下一步是补 missed live windows、source-limited continuation 的 operational fixtures。[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

[project](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

### P2.1：已完成

P2.1 是“API/read-model/UI total-vs-observed 语义”。

现在 contract 已拆出：

```
observed_new_posts
observed_qualified_posts
total_new_posts
qualified_post_count
```

并且每个 series point 增加：

```
coverageStatus
coverageBasis
valueSemantics: complete_total | observed_total | missing
```

[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/packages/contracts/src/http.ts)

[http](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/packages/contracts/src/http.ts)

read model 里也已经做了关键 gate：

```TypeScript
if ((id === "total_new_posts" || id === "qualified_post_count")
  && coverage?.coverageStatus !== "complete") {
  return null;
}
```

也就是说：**coverage 不 complete 时，total series 直接返回 null，不再假装 total。** 同时 observed series 永远返回 observed count。[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/application/services/target-workbench-read-model.service.ts)

[target-workbench-read-model.ser…](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/application/services/target-workbench-read-model.service.ts)

UI 也改了：如果最新 day 的 `total_new_posts.coverageStatus !== complete`，KPI 用 `observed_new_posts / observed_qualified_posts`，label 也切到 Observed；只有 complete 才显示 Total。这个在提交 diff 里有明确改动。[](https://github.com/Euroish/reddit-monitoring-mvp/commit/6e6eafaf245e50e1f2bde05856f7d8a7c40f7c5d)

[Add coverage facts for observed…](https://github.com/Euroish/reddit-monitoring-mvp/commit/6e6eafaf245e50e1f2bde05856f7d8a7c40f7c5d)

所以 P2.1 已经完成。

### P2.2：部分完成

`project.md` 标记：

```
P2.2 Partial:
Comparison read-model semantics are aligned;
legacy export/report surfaces still need a focused pass.
```

[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

[project](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

也就是说 comparison 已经跟进，但旧 daily trend、export、report 这些“对外输出面”还没有完全扫完。这里是后续风险点：只要还有接口或导出报告继续叫 `total`，就可能重新污染产品语义。

## 当前总体进度判断

现在项目已经从：

```
修采集污染 / 修 content 语义
```

推进到：

```
coverage proof + read-model/UI 语义落地
```

更具体：

```
P0: Done
P1.1: Done
P1.2: Done
P1.3: Partial
P2.1: Done
P2.2: Partial
P3: 未真正开始，下一步进入 operational hardening
```

## 当前还没彻底解决的点

第一，coverage resolver 还偏粗。`SubredditCollectionCoverageBasis` 已经定义了 `live_continuous`、`missed_live_window`、`rate_limited`，但当前 `resolveCoverageStatus()` 主要靠 backfill cursor 和 observed count 推断，missed windows 还没有真实累计，`liveWindowCount` 也只是很粗地根据 cursor 是否存在给 1。[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/jobs/build-subreddit-collection-coverage.job.ts)

[build-subreddit-collection-cove…](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/src/jobs/build-subreddit-collection-coverage.job.ts)

第二，`iteration_budget_exhausted` 的产品语义还要小心。`project.md` 已经写明它不是最终 source limitation，只表示本轮预算用完、后续应继续。[](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

[project](https://github.com/Euroish/reddit-monitoring-mvp/blob/main/obsidian-reddit%E4%B8%93%E7%94%A8/Projects/project.md)

现在 coverage fact 里有这个 basis，但还需要 source-limited continuation fixtures 来防止未来把它误当“抓完了”。

第三，旧出口还没全扫。P2.2 还剩 export/report 以及 legacy daily trend 类接口，需要确保它们也遵守：

```
complete => Total
partial/source_limited/unknown => Observed
missing => null
```

## 下一步应该做什么

优先级应该是：

```
1. 补 P1.3 operational fixtures
   - missed live window
   - source_limited continuation
   - high-volume activation-only total
   - small subreddit backfill complete
   - medium subreddit iteration_budget_exhausted remains partial/progressing

2. 收紧 coverage resolver
   - 真正生成 live_continuous
   - 真正累计 missedLiveWindowCount
   - 区分 terminal_eof_reached complete vs terminal_eof_before_target source_limited
   - rate_limited / failed windows 降级 coverage

3. 完成 P2.2
   - legacy daily trend
   - comparison 已基本对齐后再复查
   - export/report 不允许 partial 数据叫 Total

4. 再进入 P3
   - observability
   - fixtures 扩展
   - DTO/provider 分支清理
```

一句话结论：**这次提交已经把核心修复推进过 P0 和 P1 主体，并落到 P2.1 的 API/UI 语义层；现在不是继续设计 total/observed 模型，而是进入“验证真实覆盖场景 + 清理遗留输出面”的阶段。**