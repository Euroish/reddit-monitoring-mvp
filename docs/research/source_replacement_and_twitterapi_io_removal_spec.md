# `twitterapi_io` 全量清理下线、低价 X 双源替换与 Apify 低价 Reddit 规格书

> **文档定位**：本规格书记录 `2026-11-16` 最终拍板的来源采购与代码实删方案，作为[产品与架构](../README.md)、[契约](../contracts.md)、[开发与交付](../development.md)及[实现状态](../status.md)在 X / Reddit 采购替换与清理边界上的专项补充规格。**当前阶段只完成方案定稿、审查与文档对齐；源码删除与新连接器编码按第 3–4 节清单分阶段执行。**

---

## 1. 最终选型定案与商业证伪（Finalized Stack vs. Rejected Providers）

### 1.1 为什么彻底删除 `twitterapi_io` 现有代码
核对官网实时计费配置 `https://twitterapi.io/pricing.json`（`version: 2026-10-12`）：
- **按量单价超预算 3 倍**：`$1 = 100,000 credits`，所有推文读取接口（`/twitter/tweet/advanced_search`、`/twitter/user/last_tweets`、`/twitter/tweets`、`/twitter/tweet/replies/v2`、`/twitter/tweet/thread_context`、`/twitter/tweet/quotes`）统一定价 **`15 credits / 条`（`$0.15 / 1,000 条`）**，且无论是否命中结果，每次成功请求保底扣 **`15 credits`（`$0.00015`）**；
- **订阅最低地板价仍超预算**：只有购买 **`$1,499 / 月` Business 订阅**并把 31 天过期的当月加赠（`+50%`）及次月返还（`+40%`，停订即停返）全部消耗完（理论 `1.90x`），地板价才降至 **`$0.0789 / 1,000 条`**（Starter `$29/月` 等效仍约 `$0.133 / 1k`），无法满足 `< $0.05 / 1k` 的成本约束；
- **同源冗余假象**：`twitterapi.io` 首页公开将 Apify 上的 `kaitoeasyapi` 列为自家演员（运营实体同属 Prism Digital, LLC），保留它或挂接 `kaitoeasyapi` 均无法构成真实独立备源；
- **执行决定**：不保留空壳开关，**彻底从主线代码、运行时注册、环境模板、CI 脚本与测试中实删所有 `twitterapi_io` 资产**，同时平滑保全历史 PostgreSQL 观测记录。

### 1.2 最终锁定双平台采集架构

| 平台 | 主/备角色 | 选定数据源 | 实测定价与关键限制（2026-11-16 核验） | 工程定位与职责分工 |
| :--- | :--- | :--- | :--- | :--- |
| **X (Twitter)** | **主力低价源** | **`TwitterAPIs`**<br>(`https://api.twitterapis.com`) | 标准读 **`$0.0008 / call`**（满 20 条/页 $\approx$ **`$0.04 / 1k`**）；新号赠 `$0.50`，`$10+` 充值**永不过期** | 承接日常高频检索（`/tweet/advanced_search`）、账号时间线（`/user/tweets`）、回复/引用分页（`/tweet/replies`、`/tweet/quotes`）。**无批量 ID 端点**（`refreshByIds: false`）；严禁自动调 `$0.004/call` 的单向 `/tweet/thread`。 |
| **X (Twitter)** | **高稳异构备源** | **`ScrapeBadger`**<br>(`https://scrapebadger.com/v1/twitter`，含可选 Apify 兜底) | **`1 base + 1 credit / item`**（20 条页 = 21 credits）；注册赠 `1,000 credits`；PAYG 从 `$10`/`$20` 起且永不过期；**`4xx/5xx` 失败扣 `0` credits**；响应头带 `X-Credits-Used` | 主力熔断时接管 X 搜索与时间线；**原生支持 `GET /v1/twitter/tweets/` 批量 ID 查推文**（`refreshByIds: true`），补齐 `TwitterAPIs` 无法低成本批量水合的短板。 |
| **Reddit** | **主力源** | **`kaix/reddit-scraper`**<br>(Apify build `0.2.25`，仓库已有基础实现) | **`$0.02 / 1k` 结果**（post/comment/subreddit 同价）+ `$0.00005/GB` 启动 + 用户自付 Apify Compute/可选代理 | 共用现有 `APIFY_API_TOKEN`；解除现存 4 项封印后，负责单次搜索伴随 Top N 层序评论与 `postUrls` 批量帖子+评论水合。 |
| **Reddit** | **免费作者费备源** | **`red_crawler/reddit-search-v2` + `red_crawler/reddit-scrape-v2`** | **2026-10-29 起作者费 `FREE`**，仅消耗 Apify Compute（Apify Free 号含 `$5/月` 额度）；30 天成功率 `99.4% / 99.8%` | 共用同一 `APIFY_API_TOKEN`；补齐 **`type="comments"` 全站评论关键词搜索**与逗号分隔多社区并行搜索（`reddit-search-v2`），及 `post_comments mode="all"` 完整评论树（`reddit-scrape-v2`）。按需可辅以 `kaix/reddit-comments-scraper`（`$0.02/1k + Compute`）。 |

### 1.3 已淘汰 / 落选候选记录（不再投入研发资源）

| 候选渠道 | 核验结果与淘汰原因 |
| :--- | :--- |
| **`TwitterAPI.io`** | `$0.15/1k`（最高订阅地板 `$0.0789/1k`）超预算 3 倍，全量实删。 |
| **`TwexAPI`** (`twexapi.io`) | OpenAPI 核验：无任何按推文 ID 查询接口；`TweetModel` 缺少顶层 string `conversation_id`；`$10` Mini 包仅 7 天有效期且 `1 QPS`，仅 `$20+/月` 订阅才到 `$0.04/1k`，不列入当前采用清单。 |
| **`Xquik`** (`xquik.com`) | 单价 `$0.119–$0.15/1k` 超 `<$0.05/1k` 红线；仅记录“0 结果搜索 0 扣费”特性作未来极稀疏关键词可选扩展参照，不接入主线。 |
| **`Arctic Shift`** 在线 API | `2026-11-16` 实测大/中版块关键词检索 `422 Timeout` 或 `10s+` 超时、`comment tree` 即刻触发 `x-ratelimit-reset`，Reddit 官网匿名访问返回 `403`；在线连接器列为实删，仅离线 `.zst` 保留在 `R4` `plugins/zst-archive/`。 |
| **`PullPush.io`** | 官网 Cloudflare 拦截，`api.pullpush.io` 首次单请求即返回 `"does not provide free scraping resources for agents"` 拒答，不能作为自动化来源。 |

---

## 2. X 新双源连接器精确契约（核对自 OpenAPI 实测定义）

### 2.1 `TwitterAPIs`（`provider: "twitterapis"`，主源）
- **认证与配置**：环境变量 `TWITTERAPIS_API_KEY`（请求头 `Authorization: Bearer <KEY>`）、`TWITTERAPIS_TIMEOUT_MS`（默认 `20000`，边界 `100..120000`）。
- **`SourceCapability`**：
  - `platform: "x"`, `provider: "twitterapis"`, `contentKinds: ["post"]`, `targetTypes: ["account", "search"]`, `keywordSearch: "global"`, `observationModel: "snapshot"`;
  - **`refreshByIds: false`**（OpenAPI 仅提供单条 `GET /tweet/detail?id=...`，无批量 ID 端点；禁止注册为自动批量刷新器）；
  - **`automaticRequestReplay: false`**（每请求固定 `$0.0008`，禁止在超时/结果未知时重放）；
  - **`requestResourceUpperBound: 20`**。
- **端点与 OpenAPI 字段映射**：
  - 搜索：`GET https://api.twitterapis.com/twitter/tweet/advanced_search`，参数 `query`（编译 `(${raw}) since_time:${fromSec} until_time:${toSec}`）、`product=Latest`、`cursor`。
  - 账号时间线：`GET https://api.twitterapis.com/twitter/user/tweets`，参数 `username`（`cursor` 翻页）。
  - 讨论/引用（精查按需）：`GET /twitter/tweet/replies`（`id`, `cursor`, `sort=latest|relevance|likes`）与 `GET /twitter/tweet/quotes`（`id`, `cursor`），均按 `$0.0008/call` 计费；**禁止接入 `$0.004/call` 且只顺向读取同作者的 `/twitter/tweet/thread`**。
  - 返回 `Tweet` 映射：`id` $\to$ `externalId`（字符串）、`text`、`created_at`、`lang`、`url`、`author.{id, username, name, url}`、`conversation_id` $\to$ `thread_root` / `platformDetails.conversationId`、`in_reply_to_status_id` $\to$ `reply_to`、`quoted_status_id` / `quoted_tweet.id` $\to$ `quote`、`retweeted_tweet.id` $\to$ `repost`；指标映射 `favorite_count` $\to$ `x.likes`、`retweet_count` $\to$ `x.reposts`、`reply_count` $\to$ `x.replies`、`quote_count` $\to$ `x.quotes`、`view_count` $\to$ `x.views`、`bookmark_count` $\to$ `x.bookmarks`。
- **防失控与分页协议**：
  1. **严禁仅靠 `next_cursor === null` 判停**：官方文档明确说明部分分页末端仍可能携带非空 cursor，**必须将 `!Array.isArray(body.tweets) || body.tweets.length === 0 || cursor === saved?.cursor` 作为硬终止条件**；
  2. **空结果与稀疏词止损**：每次空查仍扣 `$0.0008`，**禁止对持续监测跑小时级无差别时间二分递归树**；采集默认 `maxPages <= 5`、`minimumIntervalMs >= 200`（官网限流对照表最高 `600 req/min` 且无平台配额硬挡板，必须依赖本地预算与间隔护栏）。

### 2.2 `ScrapeBadger`（`provider: "scrapebadger"`，异构备源）
- **认证与配置**：环境变量 `SCRAPEBADGER_API_KEY`（请求头 `x-api-key: <KEY>`）、`SCRAPEBADGER_TIMEOUT_MS`（默认 `20000`，边界 `100..120000`）；可选同品牌 Apify 路径 `scrape.badger/twitter-tweets-scraper` 作为应急备用说明，主适配器直接走原生 REST `https://scrapebadger.com/v1/twitter`。
- **`SourceCapability`**：
  - `platform: "x"`, `provider: "scrapebadger"`, `contentKinds: ["post"]`, `targetTypes: ["account", "search"]`, `keywordSearch: "global"`, `observationModel: "snapshot"`;
  - **`refreshByIds: true`**（原生支持 `GET /v1/twitter/tweets/?tweets=id1,id2,...` 批量查推文，弥补 `TwitterAPIs` 的批量水合缺口，每批建议上限 `20–50` 个 ID）；
  - **`automaticRequestReplay: false`**，`requestResourceUpperBound: 100`（搜索参数 `count` 支持 `1..100`；默认可配 `20–50` 对齐预算）。
- **OpenAPI 真实参数与响应结构（严格防猜错）**：
  - 搜索：`GET /v1/twitter/tweets/advanced_search`，查询参数**仅有** `query`（必填）、`query_type`（`Top | Latest | Media`，采集用 `Latest`）、`count`（`1..100`）、`cursor`——**没有 `start_time`/`end_time` 独立 HTTP 参数**，时间窗必须编入 `query`（`since_time:` / `until_time:`）；
  - 时间线：`GET /v1/twitter/users/{username}/latest_tweets`（`cursor`）；
  - 回复/引用：`GET /v1/twitter/tweets/tweet/{tweet_id}/replies` 与 `/quotes`（`cursor`）；
  - **响应体容错**：OpenAPI Schema 声明返回 `{ data: TweetData[] | null, next_cursor: string | null }`（**顶层没有 `meta` 对象**，但部分 SDK 文档示例写作 `tweets`），适配器应兼容读取 `body.data ?? body.tweets ?? []`，以 `next_cursor` 与空数组双判定结束；
  - **`TweetData` 字段映射**：`id`, `full_text ?? text`, `created_at`, `lang`, 扁平作者字段 **`user_id` / `username` / `user_name`**（非嵌套 `author` 对象）, `conversation_id`, `in_reply_to_status_id`, `favorite_count`, `retweet_count`, `reply_count`, `quote_count`, `view_count`, `bookmark_count`, `possibly_sensitive`, `is_quote_status`, `is_retweet`；并将响应头 **`X-Credits-Used`** 记入只读诊断扩展字段（`scrapebadger.credits_used`）。
- **速率护栏**：未首充账户限制 **`5 req/min`**（`12s/次` 极易撞本地 `20s` 超时），PAYG 账户首充后提升至 **`60 req/min`**，因此默认 `minimumIntervalMs >= 1000` 并解析 `429 Retry-After` / `X-RateLimit-Reset` 响应头。

---

## 3. `twitterapi_io`（与配套 `arctic_shift` 在线源）全量实删清单与零回归方案

### 3.1 代码、配置、CI 与测试点阵（经逐文件扫描核实）

| 类别 | 目标路径 | 实施动作与注意事项 |
| :--- | :--- | :--- |
| **直接删除文件** | [twitterapi-io-content.connector.ts](../../src/connectors/x/twitterapi-io-content.connector.ts)<br>[twitterapi-io.config.ts](../../src/connectors/x/twitterapi-io.config.ts)<br>[twitterapi-io-content.connector.test.ts](../../tests/unit/twitterapi-io-content.connector.test.ts)<br>[arctic-shift-content.connector.ts](../../src/connectors/reddit/arctic-shift-content.connector.ts)<br>[arctic-shift-content.connector.test.ts](../../tests/unit/arctic-shift-content.connector.test.ts) | 整文件实删。**前置解耦门禁**：删除 `arctic-shift-content.connector.ts` 前必须先完成下表对 `kaix-content.connector.ts` 与 `tests/helpers/` 夹具的解耦重构，防止全仓编译瘫痪。 |
| **解除 `kaix` 对 `ArcticShift` 的代码耦合** | [kaix-content.connector.ts](../../src/connectors/reddit/kaix-content.connector.ts) (L4, L26) | 当前 `kaix` 直接导入 `ARCTIC_SHIFT_CAPABILITY.metrics`；实删前必须先把 Reddit 三项指标（`reddit.score`、`reddit.num_comments`、`reddit.upvote_ratio`）内联至 `kaix` 或抽入 Reddit 共享常量，否则 `kaix` 无法通过 `tsc`。 |
| **预算回退安全闸门** | [source-lifecycle.ts](../../src/storage/source-lifecycle.ts) (L4 `defaultProviderBudget`) | 必须将 `"arctic_shift"` 移出 `const free = ["demo_reddit", "demo_x"].includes(provider)`！否则当 `source_provider_budget` 中尚未存在 `arctic_shift` 行时，系统会回弹返回 `enabled: true, dailyRequests: 1000`。 |
| **运行时装配** | [source-content-runtime.ts](../../src/runtime/source-content-runtime.ts) (L2, L7-8, L22, L25) | 移除 `ArcticShiftContentConnector`、`TwitterApiIoContentConnector` 与 `resolveTwitterApiIoConfig` 导入和实例化；接上 `TwitterApisContentConnector`、`ScrapeBadgerXContentConnector` 与 `RedCrawlerContentConnector`。 |
| **环境变量校验** | [environment-config.ts](../../src/runtime/environment-config.ts) (L58) | 删除 `TWITTERAPI_IO_TIMEOUT_MS`，替换为 `TWITTERAPIS_TIMEOUT_MS` 与 `SCRAPEBADGER_TIMEOUT_MS`（`100..120000`）。 |
| **部署环境变量模板与提示文案** | [sources.env.example](../../deploy/env/sources.env.example) (L9)<br>[api.env.example](../../deploy/env/api.env.example) (L1)<br>[scheduler.env.example](../../deploy/env/scheduler.env.example) (L1)<br>[demo-content.connector.ts](../../src/connectors/demo/demo-content.connector.ts) (L15) | 删除 `TWITTERAPI_IO_API_KEY=` 并补充 `TWITTERAPIS_API_KEY=` 与 `SCRAPEBADGER_API_KEY=`；清理 `api.env.example` / `scheduler.env.example` / `demo-content.connector.ts` 中的旧 `Arctic Shift` 注释与文案。 |
| **CI 与冒烟脚本** | `.github/workflows/verify.yml` (L19, L61)<br>[ci-demo.mjs](../../scripts/ci-demo.mjs) (L30)<br>[run-ci-tests.ts](../../scripts/run-ci-tests.ts) (L31)<br>[smoke-compiled-build.ts](../../scripts/smoke-compiled-build.ts) (L67) | 删除传递的 `TWITTERAPI_IO_API_KEY: ""`；按需显式置空新环境变量以隔离测试（`TWITTERAPIS_API_KEY: ""`、`SCRAPEBADGER_API_KEY: ""`）。 |
| **单元测试调整** | [source-content-runtime.test.ts](../../tests/unit/source-content-runtime.test.ts) (L7, L13, L16-17, L22-23)<br>[environment-config.test.ts](../../tests/unit/environment-config.test.ts) (L27)<br>[create-reddit-connector.test.ts](../../tests/unit/create-reddit-connector.test.ts) (L20) | 移除 `TWITTERAPI_IO_*`、`REDDIT_LIVE_PROVIDER: "arctic_shift"` 与旧能力断言，改为校验 `twitterapis` / `scrapebadger` / `red_crawler` 默认关闭与开启边界；新增 `twitterapis-content.connector.test.ts` 与 `scrapebadger-x-content.connector.test.ts`。 |
| **测试公共夹具与生命周期用例解耦（防 ~29 个测试套件集体报错）** | [source-content-fixtures.ts](../../tests/helpers/source-content-fixtures.ts) (L3, L12, L21)<br>[source-scheduler-reliability-cases.ts](../../tests/helpers/source-scheduler-reliability-cases.ts) (L7, L64)<br>[source-failure-policy-cases.ts](../../tests/helpers/source-failure-policy-cases.ts) (L55-73, L111)<br>[source-content.service.test.ts](../../tests/unit/source-content.service.test.ts) (L6, L8)<br>[source-request-timing.test.ts](../../tests/unit/source-request-timing.test.ts) (L7, L17-18)<br>[source-lifecycle.service.test.ts](../../tests/unit/source-lifecycle.service.test.ts) (L10, L58)<br>[source-content-postgres.test.ts](../../tests/integration/source-content-postgres.test.ts)<br>[source-scheduler-reliability-postgres.test.ts](../../tests/integration/source-scheduler-reliability-postgres.test.ts)<br>[legacy-source-content-guard-postgres.test.ts](../../tests/integration/legacy-source-content-guard-postgres.test.ts)<br>[api-server-source-content.test.ts](../../tests/integration/api-server-source-content.test.ts) | 上述公共夹具与集成/单测目前直接 `import ArcticShiftContentConnector` 或将 `"arctic_shift"` 作为合成 provider（`tests/` 内约 29 处间接/直接依赖）。**禁止直接删除用例**：将 `fixtureConnector` / `syntheticSource` 与辅助用例重构为测试专用合成 `StubContentConnector`（不依赖任何真实线上 connector 类）。 |
| **集成测试防退化迁移** | [twitterapi-io-content-pipeline.test.ts](../../tests/integration/twitterapi-io-content-pipeline.test.ts) | **严禁直接删除丢断言！** 重命名并迁移为 `tests/integration/x-content-pipeline.test.ts`：完整保留 X 来源创建、零预算默认阻断、开启预算后执行、account+search 同推文身份去重、64 位雪花 ID 字符串精度、固定资源上限预留、额度耗尽阻断及 `401` 鉴权验证。 |
| **历史导出与旧分析提示过渡** | [research-export.service.ts](../../src/application/services/research-export.service.ts) (L12, L20)<br>[LegacyAnalysisNotice.tsx](../../apps/web/src/features/content/LegacyAnalysisNotice.tsx) (L8-9)<br>[smoke-workbench-functional.ts](../../scripts/smoke-workbench-functional.ts) (L191) | 1. 在 R3 整体退役 `ResearchExportService` 前，`extensionKeys` **保留 `"twitterapi_io.*"` 只读白名单条目**并追加 `"twitterapis.*"` / `"scrapebadger.*"`，避免库内历史 `twitterapi_io` 观测丢失诊断键；<br>2. 旧分析页面未下线前，可在 R1 就地将 `LegacyAnalysisNotice.tsx` 文案改为“尚未纳入新来源采集的观测”并同步更新 `smoke-workbench-functional.ts` L191 断言（或在 R3 随旧分析页整体删除）。 |

### 3.2 数据库历史数据保全与迁移语义（无外键破坏）
核查 [029_source_content_collection.sql](../../src/storage/schema/029_source_content_collection.sql)、[030_source_lifecycle.sql](../../src/storage/schema/030_source_lifecycle.sql)、[031_x_platform.sql](../../src/storage/schema/031_x_platform.sql)、[035_source_configuration_revisions.sql](../../src/storage/schema/035_source_configuration_revisions.sql) 与 [postgres-source-content.repository.ts](../../src/storage/repositories/postgres/postgres-source-content.repository.ts)：
1. **`031_x_platform.sql` 保持原样**：它只插入 `source(code='x', name='X')`，与具体 provider 解耦。
2. **禁止物理 `DELETE`**：`content_discovery` 与 `content_observation` 外键指向 `collection_source(id)`，`source_provider_usage(provider)` 外键指向 `source_provider_budget(provider)`，且 [postgres-source-content.repository.ts](../../src/storage/repositories/postgres/postgres-source-content.repository.ts#L202) 通过 `UNION` 动态展示历史来源。物理删表行会破坏历史内容归属与外键约束。
3. **平滑迁移合同**（若在 R1 大重建前单独清理，独立占用 `041_retire_legacy_providers.sql` 并使 R1 顺延为 `042+`；若合并随 R1 执行，纳入同一 `041+` 事务迁移）：
   ```sql
   BEGIN;
   -- 1. 取消遗留待跑任务，释放活动任务唯一索引
   UPDATE source_collection_job j
   SET status = 'cancelled', finished_at = NOW(),
       error = 'Provider retired by architectural replacement',
       lease_token = NULL, lease_until = NULL
   FROM collection_source cs
   WHERE cs.id = j.collection_source_id
     AND cs.provider IN ('twitterapi_io', 'arctic_shift')
     AND j.status IN ('queued', 'running', 'retrying');

   -- 2. 将旧 provider 采集源软归档，同步递增乐观锁 revision（035 迁移约束）
   UPDATE collection_source
   SET state = 'archived', next_due_at = NULL, next_recheck_at = NULL,
       updated_at = NOW(), revision = revision + 1
   WHERE provider IN ('twitterapi_io', 'arctic_shift') AND state <> 'archived';

   -- 3. 强制 Upsert 并锁定关闭旧 provider 预算闸门（防止空库/未配置库匹配 0 行且同步递增 revision，严禁 DELETE）
   INSERT INTO source_provider_budget (
     provider, enabled, daily_requests, monthly_requests, daily_resources, monthly_resources, minimum_interval_ms
   ) VALUES
     ('twitterapi_io', FALSE, 0, 0, 0, 0, 0),
     ('arctic_shift', FALSE, 0, 0, 0, 0, 0)
   ON CONFLICT (provider) DO UPDATE SET
     enabled = FALSE,
     daily_requests = 0,
     monthly_requests = 0,
     daily_resources = 0,
     monthly_resources = 0,
     revision = source_provider_budget.revision + 1;

   -- 4. 预置新低成本提供商默认关闭预算行（需管理员显式开启，符合 COL-06）
   INSERT INTO source_provider_budget (
     provider, enabled, daily_requests, monthly_requests, daily_resources, monthly_resources, minimum_interval_ms
   ) VALUES
     ('twitterapis', FALSE, 0, 0, 0, 0, 200),
     ('scrapebadger', FALSE, 0, 0, 0, 0, 1000),
     ('kaix', FALSE, 0, 0, 0, 0, 0),
     ('red_crawler', FALSE, 0, 0, 0, 0, 0)
   ON CONFLICT (provider) DO NOTHING;
   COMMIT;
   ```
   *(注：配合 [source-lifecycle.ts](../../src/storage/source-lifecycle.ts#L4) 将 `"arctic_shift"` 从 `free` 移除后，无论历史库还是全新空库均维持“历史数据完整可读、旧源零放行、新付费源默认关闭”的强不变量。)*

---

## 4. Reddit Apify 低价双源组合与评论树整合要点

与本仓已有 [kaix-content.connector.ts](../../src/connectors/reddit/kaix-content.connector.ts)（共用 `APIFY_API_TOKEN`）保持一致：
1. **主力 `kaix/reddit-scraper`（build `0.2.25`，`$0.02/1k + Compute`）解封改造**：
   - 既已由主线先移除开发期`$0.01`事件帽、`45s`超时、`512MiB`内存与禁代理覆写；后续按[契约 §2](../contracts.md#2-任务恢复与推流)与[实现状态](../status.md)解除对 `ARCTIC_SHIFT_CAPABILITY.metrics` 的导入耦合，并解除 `includeComments: false`、`maxItems<=100`、`mode="post"` 丢弃主帖、客户端 `literal()` 误杀布尔表达式及异步 `runId`/`datasetId` 恢复限制，抽取 `depth`、`isSubmitter`、`collapsed` 白名单字段。
2. **备源 `red_crawler/reddit-search-v2` + `red_crawler/reddit-scrape-v2`（作者费 `FREE + Compute`）**：
   - 无需额外注册账号，直接使用同一 `APIFY_API_TOKEN`；
   - `reddit-search-v2`：`search_type` 同时支持 `posts`（单 sort ~500）与 `comments`（单 sort ~250）、`search_subreddit` 支持逗号分隔多社区并发扇出；
   - `reddit-scrape-v2`：`endpoint: "post_comments"`, `post_comments_mode: "all"`, `post_comments_deep` 输出标准 `id`, `post_id`, `parent_id`, `depth`（`0` 为顶层），与本仓 `ContentReference`（`reply_to` / `thread_root`）无缝对接。
   - **成本护栏**：两者均继承 Apify `automaticRequestReplay: false`、`waitForFinish=60`（兼容上限 `65s`，不套用普通 `15s` 重试规则）；且**只在筛选出高讨论度/信号根帖后**，按 `hydrate` 策略触发评论树水合。

---

## 5. 最小验证门禁与交接出口

执行每一步代码实删与连接器替换时，必须满足以下可复现检查：
1. **文档同步阶段（当前任务）**：`npm run docs:check`（校验 `DOCUMENTATION_FILES`、规则编号、本地路径/Markdown 锚点与模块边界）、`npx tsx --test tests/unit/repository-policy.test.ts tests/unit/release-package.test.ts tests/unit/kaix-content.connector.test.ts`、`npm run typecheck:core`（全仓含 `apps/web` 安装依赖后跑 `npm run typecheck`）、`git diff --check` 全部通过。
2. **`twitterapi_io` & `arctic_shift` 实删阶段**：在 `src/`、`apps/`、`scripts/`、`tests/`、`deploy/`、`.github/` 范围内执行 `rg -i "twitterapi_io|twitterapi-io|TWITTERAPI_IO|arctic_shift|arctic-shift"`，仅允许在 `src/storage/schema/*`、`src/application/services/research-export.service.ts` 只读历史导出白名单（R3 前）及 R1/R3 迁移过渡说明（如在 R1 已同步更新 `LegacyAnalysisNotice.tsx` 与 `smoke-workbench-functional.ts`，则零前端残留）中出现；`npm run verify:repo`、`npm run test:offline`、`npm run test:postgres`（含新增退役迁移、解耦后的公共测试夹具与 `x-content-pipeline.test.ts`）零跳过全部通过。
3. **新 X/Reddit 源验收阶段**：遵循[产品与架构 §2](../README.md#2-来源选择)与[开发与交付](../development.md)真实采样标准，分别对 `TwitterAPIs`、`ScrapeBadger`、`kaix`（解封后）与 `red_crawler` 记录一次有界真实请求目标、窗口、耗时、消耗积分/账单头（如 `X-Credits-Used`）、独立内容、空结果边界及 PostgreSQL/HTTP/导出闭环证据（报告留存 `output/`，不进 Git）。
