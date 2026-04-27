# Reddit Monitoring MVP：当前有效工程路线

> 目的：合并并清理 `obsidian-reddit专用/Projects/项目代码读取权限 (1).md` 与 `obsidian-reddit专用/Projects/回填逻辑问题分析.md` 中仍然有效的任务；剔除已经完成、互相冲突、或在 Reddit listing 1000 上限下不可成立的历史回填方案；形成当前最优执行文件。

---

## 0. 当前结论

当前项目不应继续以“过去 15 天历史回填完整覆盖”为主目标。

经过实测和代码复核，Reddit `/new` listing 对中大型 subreddit 存在约 1000 条可翻页上限。在没有 Pushshift、官方历史源、第三方历史 API 或自有长期采集数据之前，无法保证抓到 1000 listing 之外的历史 post。

因此产品数据语义必须改成：

```text
live-observed Reddit corpus
```

即：

```text
从现在开始稳定抓取关注 subreddit
→ 只把当前采集窗口内的新 post 计入趋势
→ 15 天后自然形成真实的 15 天观测趋势
→ 图表必须显示 observed / missing / source_limited，而不是伪造完整历史
```

---

## 1. 已完成或应剔除的旧任务

### 1.1 已剔除：旧 Apify after cursor 与 nextCursor 任务

旧文档中曾要求：

```text
Apify 使用 `after`
从最后一条 post 推导 `nextCursor`
```

当前已不再保留 Apify 作为主运行路径 provider，因此这条历史任务直接从当前执行面剔除，不再作为代码待办。

---

### 1.2 已完成：backfill 不再默认使用 rewindCursor 作为主推进 cursor

旧文档中指出：

```text
resolveBackfillCursor = cursor.rewindCursor ?? cursor.cursor
```

会导致反复回放同一窗口。

当前 main 的 `resolveBackfillCursor()` 已改为只返回 `cursor.cursor`，不再优先使用 `rewindCursor`。

处理：从 P0 blocker 中删除，但保留 regression test 要求。

---

### 1.3 已完成一部分：daily fact 不再为完全未观测 day 生成真实 0

当前 `buildSubredditDailyFactsJob()` 会先计算 `observedDays`，未观测日直接跳过，不再 materialize daily fact。

处理：删除“build daily fact 会把缺失日写成 0”的旧表述。

保留后续任务：确认所有 API/UI surface 都不把 missing day 渲染成 0。

---

### 1.4 剔除：继续做“完整 15 天历史 backfill”作为主产品路径

原因：

```text
Reddit listing 超过约 1000 后不可达。
中大型 subreddit 的 15 天帖子量可能远超 1000。
继续通过 /new 翻页、提高 limit、切 day/6h/1h window，仍无法访问 listing 之外的历史帖子。
```

处理：不再把“完整历史回填”作为主线功能。

保留为低优先级诊断/修复能力：

```text
manual backfill / onboarding repair / source_limited 诊断
```

---

### 1.5 剔除：把 Apify 作为主历史回填方案

Apify 当前即使有 cursor，也不等于拥有 Reddit listing 之外的历史源。Apify 可以作为 fallback 或实验 provider，但不能解决 1000 listing 之外的数据不可达问题。

处理：

```text
Apify = experimental fallback only
HTTP / OAuth Reddit = primary live provider
Scrapling = capability fallback / difficult-target fallback
```

---

## 2. 当前必须实现的核心产品语义

### 2.1 产品口径

所有页面和 API 必须明确：

```text
不是全 Reddit 全量数据
不是 subreddit 历史全量数据
而是 observed monitored corpus
```

关键词热度也是：

```text
observed corpus keyword trend
```

不能写成：

```text
entire Reddit full historical trend
```

---

### 2.2 采集口径

主采集方式：

```text
每 8 小时抓取 favorite subreddit 的 /new listing
每轮最多抓 1000
只接受 live window 内新产生的 post
旧 post 不进入 new post 趋势计算
```

建议窗口：

```text
REDDIT_LIVE_WINDOW_HOURS=8
REDDIT_LIVE_WINDOW_OVERLAP_MINUTES=30
```

逻辑：

```text
accepted_new_post =
  post.createdAtSource >= now - 8h - 30m
  AND externalId 不存在于 content
```

---

## 3. 当前仍需实现的功能 / 任务

## P0：数据真实性与 SQL 压力收束

### P0.1 Live window filter

文件：

```text
src/jobs/collect-subreddit-new-posts.job.ts
```

新增逻辑：

```text
live 模式只把 createdAtSource 落在当前采集窗口内的 post 作为 newAcceptedUpserts
```

建议：

```ts
const liveWindowFromIso = new Date(
  Date.parse(input.nowIso) -
    (liveWindowHours * 60 + liveWindowOverlapMinutes) * 60 * 1000,
).toISOString();
```

过滤规则：

```text
mode === live:
  keep if createdAtSource >= liveWindowFromIso

mode === backfill:
  保持旧行为，但仅用于 repair / diagnostic
```

验收：

```text
第一次启动不会把过去 listing 里的旧帖子全部算成当天新增。
8 小时周期内的重复 post 不重复计入 new_posts_15m / daily facts。
```

---

### P0.2 旧 post 不再写入趋势计算 snapshots

当前问题：

```text
filtered.metricPoints 会为本轮看到的所有 post 写 score / num_comments / upvote_ratio snapshots。
即使 post 已存在，也会继续膨胀 metrics_snapshot。
```

目标：

```text
默认只给 newAcceptedUpserts 写 content-level metrics。
```

可选增强：

```text
只追踪 createdAtSource >= now - 48h 的活跃 post，用于 driver post / growth。
```

建议变量：

```text
REDDIT_ACTIVE_POST_TRACKING_HOURS=48
```

验收：

```text
metrics_snapshot 增速与新 post 或 48h 活跃窗口绑定，不再随重复 listing 无限增长。
```

---

### P0.3 raw events 和 metrics prune 自动化

已有脚本：

```text
scripts/prune-raw-events.ts
scripts/prune-metrics-snapshots.ts
```

仍需实现：

```text
systemd timer / cron / deployment job
```

建议配置：

```env
RAW_EVENT_RETENTION_DAYS=2
RAW_EVENT_PRUNE_LOOP=true
RAW_EVENT_PRUNE_BATCH_SIZE=5000

METRICS_SNAPSHOT_RETENTION_DAYS=21
METRICS_SNAPSHOT_PRUNE_LOOP=true
METRICS_SNAPSHOT_PRUNE_BATCH_SIZE=10000
```

验收：

```text
raw_reddit_event 不再长期堆积。
metrics_snapshot 保留足够计算 recent trends，但不会无限增长。
daily facts / keyword facts / driver facts 长期保留。
```

---

### P0.4 统一 missing day 语义

当前 workbench series 已支持：

```text
value: number | null
quality: observed | observed_zero | missing
```

仍需检查并统一所有 API/UI：

```text
SubredditDailyTrendResponse
TargetWorkbenchResponse
comparison workbench
front-end charts
tooltip
legend
```

规则：

```text
missing = null / gap / gray area
observed_zero = 真实观测到 0
observed = 有观测数据
source_limited = 数据源不可达，不得画成真实 0
```

验收：

```text
未覆盖日不会显示成 0。
前端 tooltip 明确显示 Missing coverage, not zero posts。
```

---

## P1：8 小时 favorite subreddit 自动采集

### P1.1 当前可立即使用的 env 方案

配置：

```env
REDDIT_RUN_MODE=live
REDDIT_LIVE_PROVIDER=http
PHASE1_SCHEDULER_INTERVAL_MS=28800000
PHASE1_SCHEDULER_RUN_ON_START=true
REDDIT_POST_LIMIT=1000
REDDIT_POST_LIMIT_ADAPTIVE=false
REDDIT_RUN_SUBREDDITS=sub1,sub2,sub3,...,sub50
```

用途：

```text
先让 50 个关注 subreddit 稳定运行 15 天。
```

---

### P1.2 DB favorite policy

当前 env list 适合短期启动，但长期应落库。

建议使用 `monitor_target.config_json`：

```json
{
  "favorite": true,
  "crawlIntervalHours": 8,
  "desiredObservedDays": 15,
  "providerPolicy": "http_primary",
  "liveWindowHours": 8,
  "liveWindowOverlapMinutes": 30
}
```

新增或修改：

```text
target config parser
scheduler target selection
favorite-only live crawl
```

验收：

```text
favorite targets 每 8 小时自动采集。
非 favorite 不进入高频抓取。
backfill 不被每 8 小时重复触发。
```

---

### P1.3 超大 subreddit coverage 标记

规则：

```text
如果 8 小时内 /new 返回 1000 条仍然无法覆盖到 window start：
  标记 source_limited
  建议缩短该 subreddit crawlIntervalHours
```

需要新增指标：

```text
oldestPostInRun
newestPostInRun
requestedWindowFromIso
hitListingLimit
coverageStatus
```

验收：

```text
对超大 subreddit，系统不会伪装完整覆盖。
```

---

## P2：Subreddit trend workbench 产品闭环

目标功能：

```text
抓取 subreddit 形成趋势
```

当前基础：

```text
content
metrics_snapshot
subreddit_daily_fact
subreddit_trend_point
target workbench read model
```

仍需完成：

```text
1. live-observed coverage 状态进入 read model
2. 图表默认只展示可信 observed 数据
3. source_limited / partial 明确展示
4. total_new_posts 文案必须是 Observed New Posts
```

验收：

```text
GET /v1/targets/subreddit/:subreddit/workbench?range=30d

返回：
- heat_price
- ema_7
- ema_30
- activity_index
- total_new_posts
- point quality
- dataQuality.coverage
- notes
```

---

## P3：图表跳转到高热帖子

目标功能：

```text
在 subreddit 图表界面跳转到最近热度高的帖子
```

当前基础：

```text
post_growth_fact
driver post read model
TargetWorkbenchResponse.drivers
SubredditDriverPostsResponse
```

仍需完成：

```text
1. drivers API 支持 from/to/day 参数
2. drivers API 支持 keyword 参数
3. 前端图表点击某一天后过滤该日 driver posts
4. keyword overlay 下点击只显示匹配关键词的 driver posts
```

建议接口：

```http
GET /v1/targets/subreddit/:subreddit/drivers?from=...&to=...&keyword=...
```

验收：

```text
点击图表某一天 → 显示该日 driver posts → 点击 permalink 跳 Reddit 原帖。
```

---

## P4：关键词热度功能

### P4.1 全局关键词热度

目标功能：

```text
搜索某个关键词在 observed monitored corpus 最近的热度
```

当前基础：

```text
keyword_query_session
post_search_document
keyword_trend_daily
global keyword trend response
```

需要保留：

```text
POST /v1/keyword-queries
GET /v1/keyword-trends/global?query=...
```

必须修正文案：

```text
全局 = monitored observed corpus
不是整个 Reddit 全量
```

验收：

```text
返回 matchedPosts / qualifiedMatchedPosts / mentionRate / breakoutScore
coverage.scope = observed_corpus
```

---

### P4.2 特定 subreddit 关键词热度

目标功能：

```text
某关键词在特定 subreddit 里的热度
```

复用同一条 keyword pipeline。

接口：

```http
POST /v1/keyword-queries
{
  "query": "chatgpt",
  "subreddit": "worldnews",
  "limit": 50
}
```

workbench overlay：

```http
GET /v1/targets/subreddit/worldnews/workbench?keywords=chatgpt
```

仍需完成：

```text
1. overlay 与 driver posts 关联
2. matchedQueries 在 UI 展示
3. keyword scoped drivers 支持日期过滤
```

---

## P5：展示所有有记录 subreddit，而不是固定 8 个

目标功能：

```text
展示更多数据，展示有记录的 subreddit 数据
```

当前缺口：

```text
缺少 subreddit catalog summary/API。
```

新增 summary：

```text
subreddit_catalog_summary
```

字段建议：

```text
target_id
canonical_name
first_observed_at
last_observed_at
observed_day_count_30d
latest_heat_price
latest_post_count
latest_driver_count
data_quality_status
favorite
updated_at
```

新增 API：

```http
GET /v1/subreddits/catalog?status=observed&limit=100&sort=latest_heat
```

排序：

```text
latest_heat
recently_updated
observed_day_count
favorite_first
```

验收：

```text
首页/列表页展示所有有 content 或 daily_fact 的 subreddit。
不再固定只显示 8 个。
支持 favorite 筛选和排序。
```

---

## P6：Provider 与 backfill 策略降级

### P6.1 Provider 角色

```text
http/oauth = primary live provider
scrapling = fallback for blocked/difficult targets
apify = removed from current main runtime path
```

要求：

```text
Apify 不再作为当前主产品运行路径的一部分。
Apify 不用于承诺历史完整性。
不同 provider 的 cursor / health 必须隔离。
```

---

### P6.2 Backfill 只保留为 repair/diagnostic

保留：

```text
manual backfill
onboarding repair
source_limited diagnostic
```

删除主线目标：

```text
依靠 backfill 建立真实 15 天历史趋势
```

验收：

```text
scheduler live 周期不会触发 backfill。
backfill 结果在 dataQuality 中标明 source_limited / partial。
```

---

## 4. 推荐执行顺序

### Slice 1：Live 数据真实性修复

```text
P0.1 live window filter
P0.2 old post metrics 限制
P0.4 missing day 统一语义
相关测试
```

验收：

```text
第一次启动不会污染当天趋势。
重复抓取不会放大 new_posts。
missing 不再显示成 0。
```

---

### Slice 2：SQL 压力治理

```text
prune timers
retention env
storage observability
metrics_snapshot 增速验证
```

验收：

```text
raw_reddit_event 和 metrics_snapshot 可控增长。
```

---

### Slice 3：8 小时 favorite 自动采集

```text
env 方案先上线
DB favorite policy 后补
source_limited coverage 标记
```

验收：

```text
50 个关注 subreddit 连续运行。
15 天后形成真实 observed trend。
```

---

### Slice 4：Subreddit workbench 闭环

```text
coverage 展示
driver posts day click
keyword overlay click
```

验收：

```text
图表 → 某日 → 热帖 → Reddit permalink。
```

---

### Slice 5：Keyword 产品闭环

```text
global observed keyword trend
subreddit-scoped keyword trend
matched driver posts
```

验收：

```text
用户输入关键词后，可以看到 observed corpus 趋势和 subreddit 内趋势。
```

---

### Slice 6：Catalog + favorites

```text
subreddit_catalog_summary
catalog API
frontend list page
favorite management
```

验收：

```text
展示所有有记录 subreddit，不再只有固定 8 个。
```

---

## 5. 给 Codex 的精确执行指令

```text
Treat this as a precision stabilization and product-routing task.

Do not continue building a full historical 15-day backfill as the primary path. Reddit listing depth is source-limited around 1000 items for medium/large subreddits, so the product must use live-observed data going forward.

Current product target:
- collect favorite subreddits every 8 hours;
- count only posts created inside the live collection window;
- do not count old listing posts as new trend activity;
- prevent repeated listing hits from inflating metrics_snapshot;
- after 15 days, use the accumulated live-observed corpus as the reliable 15-day baseline.

Required changes:
1. In collect-subreddit-new-posts.job.ts, add a live-window filter:
   - default window = 8 hours + 30 minutes overlap;
   - only posts with createdAtSource >= windowStart can become newAcceptedUpserts in live mode.
2. Persist content-level metric snapshots only for:
   - newAcceptedUpserts; or
   - optionally active posts created within REDDIT_ACTIVE_POST_TRACKING_HOURS.
3. Keep raw_reddit_event and metrics_snapshot retention scripts, but wire them into deployment automation.
4. Ensure every API/UI surface treats missing coverage as null/missing/source_limited, never as real zero.
5. Configure scheduler for 8-hour favorite subreddit live collection:
   - PHASE1_SCHEDULER_INTERVAL_MS=28800000
   - REDDIT_RUN_MODE=live
   - REDDIT_POST_LIMIT=1000
   - REDDIT_POST_LIMIT_ADAPTIVE=false
6. Add DB-based favorite policy using monitor_target.config_json:
   - favorite
   - crawlIntervalHours
   - desiredObservedDays
   - providerPolicy
7. Add subreddit catalog summary and API so the frontend can list all observed subreddits instead of a fixed small set.
8. Keep Apify as fallback/experimental only. Do not use Apify to claim full historical coverage.
9. Keep backfill only for manual repair/diagnostic. It must never be scheduled as part of the 8-hour live cycle.

Remove from task list:
- Apify after cursor fix: already implemented.
- Apify nextCursor derivation: already implemented.
- rewindCursor permanent replay bug: current main no longer shows this as active.
- buildSubredditDailyFactsJob materializing completely missing days as zero: current main skips unobserved days.

Acceptance:
- First live run does not treat older listing posts as current new posts.
- Repeated 8-hour runs do not inflate new_posts or post-level metrics.
- Workbench charts show missing/source_limited as gaps or degraded states.
- 50 favorite subreddits can run for 15 days and produce a real observed trend.
- Keyword global/subreddit trends explicitly say observed corpus, not full Reddit.
- Catalog page can show all observed subreddits.
```

---

## 6. Final product wording

Use this wording in product/API/UI:

```text
Observed New Posts
Observed Monitored Corpus
Source-limited
Missing coverage, not zero posts
Live-observed 15-day trend
```

Avoid:

```text
Full Reddit
Full historical subreddit data
Complete 15-day backfill
Total subreddit volume
```
