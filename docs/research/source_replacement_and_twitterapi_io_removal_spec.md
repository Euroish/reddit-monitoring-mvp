# `twitterapi_io` 全量清理下线、低价 X 双源替换与 Apify 低价 Reddit 规格书

> **文档定位**：保留`2026-11-16`来源比较、供应商HTTP字段及`9760006`源码清理定位。产品/复杂度、任务语义、迁移步骤、实现证据分别以[产品与架构](../README.md)、[契约](../contracts.md)、[开发与交付](../development.md)、[实现状态](../status.md)为唯一规范；本专项不另设产品预算或同步等待规则。源码删除与新adapter仍待实施，公开报价/成功率不等于本仓验收。

---

## 1. 最终选型定案与商业证伪（Finalized Stack vs. Rejected Providers）

### 1.1 为什么彻底删除 `twitterapi_io` 现有代码
核对官网实时计费配置 `https://twitterapi.io/pricing.json`（`version: 2026-10-12`）：
- **按量单价为本次候选参考线的 3 倍**：`$1 = 100,000 credits`，所有推文读取接口（`/twitter/tweet/advanced_search`、`/twitter/user/last_tweets`、`/twitter/tweets`、`/twitter/tweet/replies/v2`、`/twitter/tweet/thread_context`、`/twitter/tweet/quotes`）统一定价 **`15 credits / 条`（`$0.15 / 1,000 条`）**，且无论是否命中结果，每次成功请求保底扣 **`15 credits`（`$0.00015`）**；
- **订阅理论最低价仍高于参考线**：只有购买 **`$1,499 / 月` Business 订阅**并把 31 天过期的当月加赠（`+50%`）及次月返还（`+40%`，停订即停返）全部消耗完（理论 `1.90x`），地板价才降至 **`$0.0789 / 1,000 条`**（Starter `$29/月` 等效仍约 `$0.133 / 1k`），高于本次采购比较使用的 `< $0.05 / 1k` 参考线（不作为全产品硬预算）；
- **同源冗余假象**：`twitterapi.io` 首页公开将 Apify 上的 `kaitoeasyapi` 列为自家演员（运营实体同属 Prism Digital, LLC），保留它或挂接 `kaitoeasyapi` 均无法构成真实独立备源；
- **执行决定**：不保留空壳开关，**彻底从主线代码、运行时注册、环境模板、CI 脚本与测试中实删所有 `twitterapi_io` 资产**，同时平滑保全历史 PostgreSQL 观测记录。

### 1.2 最终锁定双平台采集架构

| 平台 | 主/备角色 | 选定数据源 | 公开报价与能力（2026-11-16 资料核验，非账单/持续实测） | 工程定位与职责分工 |
| :--- | :--- | :--- | :--- | :--- |
| **X (Twitter)** | **主力低价源** | **`TwitterAPIs`**<br>(`https://api.twitterapis.com`) | 标准读 **`$0.0008 / call`**（满 20 条/页 $\approx$ **`$0.04 / 1k`**）；新号赠 `$0.50`，`$10+` 充值**永不过期** | 承接日常高频检索（`/tweet/advanced_search`）、账号时间线（`/user/tweets`）、回复/引用分页（`/tweet/replies`、`/tweet/quotes`）。**无批量 ID 端点**（`refreshByIds: false`）；严禁自动调 `$0.004/call` 的单向 `/tweet/thread`。 |
| **X (Twitter)** | **独立供应商备源** | **`ScrapeBadger`**<br>(`https://scrapebadger.com/v1/twitter`，含可选 Apify 兜底) | **`1 base + 1 credit / item`**（20 条页 = 21 credits）；注册赠 `1,000 credits`；PAYG 从 `$10`/`$20` 起且永不过期；**`4xx/5xx` 失败扣 `0` credits**；响应头带 `X-Credits-Used` | 按SRC-03单跳策略接管 X 搜索与时间线；**原生支持 `GET /v1/twitter/tweets/` 批量 ID 查推文**（`refreshByIds: true`），补齐 `TwitterAPIs` 无法低成本批量水合的短板。 |
| **Reddit** | **主力源** | **`kaix/reddit-scraper`**<br>(Apify build `0.2.25`，仓库已有基础实现) | **`$0.02 / 1k` 结果**（post/comment/subreddit 同价）+ `$0.00005/GB` 启动 + 用户自付 Apify Compute/可选代理 | 共用现有 `APIFY_API_TOKEN`；开发期费用/运行覆写已移除，待完成混合写入与恢复后，支持伴随有界评论及`postUrls`批量补全。 |
| **Reddit** | **免费作者费备源** | **`red_crawler/reddit-search-v2` + `red_crawler/reddit-scrape-v2`** | **2026-10-29 起作者费 `FREE`**，仅消耗 Apify Compute（Apify Free 号含 `$5/月` 额度）；商店宣称30天成功率 `99.4% / 99.8%`，本仓未验 | 共用同一 `APIFY_API_TOKEN`；补齐 **`search_type="comments"` 全站评论关键词搜索**与逗号分隔多社区并行搜索（`reddit-search-v2`），及 `post_comments mode="all"` 完整评论树（`reddit-scrape-v2`）。按需可辅以 `kaix/reddit-comments-scraper`（`$0.02/1k + Compute`）。 |

### 1.3 已淘汰 / 落选候选记录（不再投入研发资源）

| 候选渠道 | 核验结果与淘汰原因 |
| :--- | :--- |
| **`TwitterAPI.io`** | `$0.15/1k`（最高订阅地板 `$0.0789/1k`）高于候选参考线，按计划实删。 |
| **`TwexAPI`** (`twexapi.io`) | OpenAPI 核验：无任何按推文 ID 查询接口；`TweetModel` 缺少顶层 string `conversation_id`；`$10` Mini 包仅 7 天有效期且 `1 QPS`，仅 `$20+/月` 订阅才到 `$0.04/1k`，不列入当前采用清单。 |
| **`Xquik`** (`xquik.com`) | 单价 `$0.119–$0.15/1k` 高于本次候选比较参考线；仅记录“0 结果搜索 0 扣费”特性作未来极稀疏关键词可选扩展参照，不接入主线。 |
| **`Arctic Shift`** 在线 API | `2026-11-16` 实测大/中版块关键词检索 `422 Timeout` 或 `10s+` 超时、`comment tree` 即刻触发 `x-ratelimit-reset`，Reddit 官网匿名访问返回 `403`；在线连接器列为实删，仅离线 `.zst` 保留在 `R4` `plugins/zst-archive/`。 |
| **`PullPush.io`** | 官网 Cloudflare 拦截，`api.pullpush.io` 首次单请求即返回 `"does not provide free scraping resources for agents"` 拒答，不能作为自动化来源。 |

---

## 2. X 双源供应商HTTP字段（OpenAPI资料）

### 2.1 `TwitterAPIs`（`provider: "twitterapis"`，主源）
- **认证与配置**：环境变量 `TWITTERAPIS_API_KEY`（请求头 `Authorization: Bearer <KEY>`）、`TWITTERAPIS_TIMEOUT_MS`（默认 `20000`，边界 `100..120000`）。
- **`SourceCapability`**：
  - `platform: "x"`, `provider: "twitterapis"`, `contentKinds: ["post"]`, `targetTypes: ["account", "search"]`, `keywordSearch: "global"`, `observationModel: "snapshot"`;
  - **`refreshByIds: false`**（OpenAPI 仅提供单条 `GET /tweet/detail?id=...`，无批量 ID 端点；禁止注册为自动批量刷新器）；
  - **`automaticRequestReplay: false`**（每请求固定 `$0.0008`，禁止在超时/结果未知时重放）；
  - **`requestResourceUpperBound: 20`**为初始预留值；公开页量约20，接入验收须证明适用上界，不以丢弃超额记录证明合规。
- **端点与 OpenAPI 字段映射**：
  - 搜索：`GET https://api.twitterapis.com/twitter/tweet/advanced_search`，参数 `query`（编译 `(${raw}) since_time:${fromSec} until_time:${toSec}`）、`product=Latest`、`cursor`。
  - 账号时间线：`GET https://api.twitterapis.com/twitter/user/tweets`，参数 `username`（`cursor` 翻页）。
  - 讨论/引用（精查按需）：`GET /twitter/tweet/replies`（`id`, `cursor`, `sort=latest|relevance|likes`）与 `GET /twitter/tweet/quotes`（`id`, `cursor`），均按 `$0.0008/call` 计费；**禁止接入 `$0.004/call` 且只顺向读取同作者的 `/twitter/tweet/thread`**。
  - 返回 `Tweet` 映射：`id` $\to$ `externalId`（字符串）、`text`、`created_at`、`lang`、`url`、`author.{id, username, name, url}`、`conversation_id` $\to$ `thread_root` / `platformDetails.conversationId`、`in_reply_to_status_id` $\to$ `reply_to`、`quoted_status_id` / `quoted_tweet.id` $\to$ `quote`、`retweeted_tweet.id` $\to$ `repost`；指标映射 `favorite_count` $\to$ `x.likes`、`retweet_count` $\to$ `x.reposts`、`reply_count` $\to$ `x.replies`、`quote_count` $\to$ `x.quotes`、`view_count` $\to$ `x.views`、`bookmark_count` $\to$ `x.bookmarks`。
- **分页适配**：读取tweets/next_cursor与显式结束标记；末页cursor可能非空。缺失或非法tweets是协议错误，不能伪装空结果。停止、预算和调度预设仅按[契约 §2](../contracts.md#2-任务恢复与推流)的JOB-07/JOB-08执行；每页独立计费，不因HTTP GET自动重放。

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
  - **响应体容错**：OpenAPI Schema 声明返回 `{ data: TweetData[] | null, next_cursor: string | null }`（**顶层没有 `meta` 对象**，但部分 SDK 文档示例写作 `tweets`），优先识别声明的data数组或显式null，仅在data缺省时兼容tweets；两者缺失/非法报协议错误，不用`?? []`掩盖。结束条件遵从JOB-07；
  - **`TweetData` 字段映射**：`id`, `full_text ?? text`, `created_at`, `lang`, 扁平作者字段 **`user_id` / `username` / `user_name`**（非嵌套 `author` 对象）, `conversation_id`, `in_reply_to_status_id`, `favorite_count`, `retweet_count`, `reply_count`, `quote_count`, `view_count`, `bookmark_count`, `possibly_sensitive`, `is_quote_status`, `is_retweet`；响应头 **`X-Credits-Used`** 记入现有job/用量的请求级诊断（`scrapebadger.credits_used`），不作内容指标或逐条累加。
- **账户档位**：公开限制未首充`5 req/min`、首充PAYG后`60 req/min`。档位未知按前者调度，确认后才使用后者；间隔在请求前等待，不计入网络超时，具体spacing遵从契约。

---

## 3. `twitterapi_io`（与配套 `arctic_shift` 在线源）全量实删清单与零回归方案

### 3.1 代码、配置、CI 与测试点阵（经逐文件扫描核实）

| 类别 | 目标路径 | 实施动作与注意事项 |
| :--- | :--- | :--- |
| **直接删除文件** | [twitterapi-io-content.connector.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/connectors/x/twitterapi-io-content.connector.ts)<br>[twitterapi-io.config.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/connectors/x/twitterapi-io.config.ts)<br>[twitterapi-io-content.connector.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/unit/twitterapi-io-content.connector.test.ts)<br>[arctic-shift-content.connector.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/connectors/reddit/arctic-shift-content.connector.ts)<br>[arctic-shift-content.connector.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/unit/arctic-shift-content.connector.test.ts) | 整文件实删。**前置解耦门禁**：删除 `arctic-shift-content.connector.ts` 前必须先完成下表对 `kaix-content.connector.ts` 与 `tests/helpers/` 夹具的解耦重构，防止全仓编译瘫痪。 |
| **解除 `kaix` 对 `ArcticShift` 的代码耦合** | [kaix-content.connector.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/connectors/reddit/kaix-content.connector.ts) (L4, L26) | 当前 `kaix` 直接导入 `ARCTIC_SHIFT_CAPABILITY.metrics`；实删前必须先把 Reddit 三项指标（`reddit.score`、`reddit.num_comments`、`reddit.upvote_ratio`）内联至 `kaix` 或抽入 Reddit 共享常量，否则 `kaix` 无法通过 `tsc`。 |
| **预算回退安全闸门** | [source-lifecycle.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/storage/source-lifecycle.ts) (L4 `defaultProviderBudget`) | 将当前免费列表`["arctic_shift","demo_reddit","demo_x"]`收敛为`["demo_reddit","demo_x"]`。否则当 `source_provider_budget` 中尚未存在 `arctic_shift` 行时，系统会回弹返回 `enabled: true, dailyRequests: 1000`。 |
| **运行时装配** | [source-content-runtime.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/runtime/source-content-runtime.ts) (L2, L7-8, L22, L25) | 移除旧provider导入/实例化；新provider接入目标collection模块，不给旧runtime建立长期新装配。旧runtime按R3实删。 |
| **环境变量校验** | [environment-config.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/runtime/environment-config.ts) (L58) | 删除 `TWITTERAPI_IO_TIMEOUT_MS`，替换为 `TWITTERAPIS_TIMEOUT_MS` 与 `SCRAPEBADGER_TIMEOUT_MS`（`100..120000`）。 |
| **部署环境变量模板与提示文案** | [sources.env.example](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/deploy/env/sources.env.example) (L9)<br>[api.env.example](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/deploy/env/api.env.example) (L1)<br>[scheduler.env.example](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/deploy/env/scheduler.env.example) (L1)<br>[demo-content.connector.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/connectors/demo/demo-content.connector.ts) (L15) | 删除 `TWITTERAPI_IO_API_KEY=` 并补充 `TWITTERAPIS_API_KEY=` 与 `SCRAPEBADGER_API_KEY=`；清理 `api.env.example` / `scheduler.env.example` / `demo-content.connector.ts` 中的旧 `Arctic Shift` 注释与文案。 |
| **CI 与冒烟脚本** | `.github/workflows/verify.yml` (L19, L61)<br>[ci-demo.mjs](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/scripts/ci-demo.mjs) (L30)<br>[run-ci-tests.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/scripts/run-ci-tests.ts) (L31)<br>[smoke-compiled-build.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/scripts/smoke-compiled-build.ts) (L67) | 删除传递的 `TWITTERAPI_IO_API_KEY: ""`；按需显式置空新环境变量以隔离测试（`TWITTERAPIS_API_KEY: ""`、`SCRAPEBADGER_API_KEY: ""`）。 |
| **单元测试调整** | [source-content-runtime.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/unit/source-content-runtime.test.ts) (L7, L13, L16-17, L22-23)<br>[environment-config.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/unit/environment-config.test.ts) (L27)<br>[create-reddit-connector.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/unit/create-reddit-connector.test.ts) (L20) | 移除 `TWITTERAPI_IO_*`、`REDDIT_LIVE_PROVIDER: "arctic_shift"` 与旧能力断言，改为校验 `twitterapis` / `scrapebadger` / `red_crawler` 默认关闭与开启边界；新增 `twitterapis-content.connector.test.ts` 与 `scrapebadger-x-content.connector.test.ts`。 |
| **测试公共夹具与生命周期用例解耦（防 ~29 个测试套件集体报错）** | [source-content-fixtures.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/helpers/source-content-fixtures.ts) (L3, L12, L21)<br>[source-scheduler-reliability-cases.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/helpers/source-scheduler-reliability-cases.ts) (L7, L64)<br>[source-failure-policy-cases.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/helpers/source-failure-policy-cases.ts) (L55-73, L111)<br>[source-content.service.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/unit/source-content.service.test.ts) (L6, L8)<br>[source-request-timing.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/unit/source-request-timing.test.ts) (L7, L17-18)<br>[source-lifecycle.service.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/unit/source-lifecycle.service.test.ts) (L10, L58)<br>[source-content-postgres.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/integration/source-content-postgres.test.ts)<br>[source-scheduler-reliability-postgres.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/integration/source-scheduler-reliability-postgres.test.ts)<br>[legacy-source-content-guard-postgres.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/integration/legacy-source-content-guard-postgres.test.ts)<br>[api-server-source-content.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/integration/api-server-source-content.test.ts) | 上述公共夹具与集成/单测目前直接 `import ArcticShiftContentConnector` 或将 `"arctic_shift"` 作为合成 provider（`tests/` 内约 29 处间接/直接依赖）。**禁止直接删除用例**：将 `fixtureConnector` / `syntheticSource` 与辅助用例重构为测试专用合成 `StubContentConnector`（不依赖任何真实线上 connector 类）。 |
| **集成测试防退化迁移** | [twitterapi-io-content-pipeline.test.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/tests/integration/twitterapi-io-content-pipeline.test.ts) | **严禁直接删除丢断言！** 重命名并迁移为 `tests/integration/x-content-pipeline.test.ts`：完整保留 X 来源创建、零预算默认阻断、开启预算后执行、account+search 同推文身份去重、64 位雪花 ID 字符串精度、固定资源上限预留、额度耗尽阻断及 `401` 鉴权验证。 |
| **历史导出与旧分析提示过渡** | [research-export.service.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/application/services/research-export.service.ts) (L12, L20)<br>[LegacyAnalysisNotice.tsx](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/apps/web/src/features/content/LegacyAnalysisNotice.tsx) (L8-9)<br>[smoke-workbench-functional.ts](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/scripts/smoke-workbench-functional.ts) (L191) | 1. 在 R3 整体退役 `ResearchExportService` 前，`extensionKeys` **保留 `"twitterapi_io.*"` 只读白名单条目**并追加 `"twitterapis.*"` / `"scrapebadger.*"`，避免库内历史 `twitterapi_io` 观测丢失诊断键；<br>2. 旧分析页面未下线前，可在 R1 就地将 `LegacyAnalysisNotice.tsx` 文案改为“尚未纳入新来源采集的观测”并同步更新 `smoke-workbench-functional.ts` L191 断言（或在 R3 随旧分析页整体删除）。 |

### 3.2 数据库历史数据保全与迁移语义（无外键破坏）

源码依据：[029](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/storage/schema/029_source_content_collection.sql)的discovery/observation/job关联来源；[030](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/storage/schema/030_source_lifecycle.sql)的usage关联budget；[035](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/storage/schema/035_source_configuration_revisions.sql)增加revision。[031](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/storage/schema/031_x_platform.sql)只注册X平台，与provider无关；[仓储](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/storage/repositories/postgres/postgres-source-content.repository.ts#L202)仍会列出历史provider。

退役唯一执行顺序见[开发说明：来源退役顺序](../development.md#来源退役顺序)。不提供可跳过在途任务/云端费用核查的整段SQL，也不物理删除历史来源或预算行；未来迁移按该门禁编写和验证。

---

## 4. Reddit Apify 低价双源组合与评论树整合要点

以[当前kaix实现](https://github.com/Euroish/reddit-monitoring-mvp/blob/9760006/src/connectors/reddit/kaix-content.connector.ts)为重构起点，共用APIFY_API_TOKEN；混合写入、Actor恢复与评论预算只按[契约 §2](../contracts.md#2-任务恢复与推流)实施。

- **kaix build 0.2.25**：开发期事件帽/固定超时/内存/禁代理已移除；仍需解除Arctic Shift指标依赖、搜索禁评论、单页100、post丢根帖、布尔query误筛与同步等待。保留真实depth/isSubmitter/collapsed字段，不把开放表单当闭环完成。
- **red_crawler/reddit-search-v2**：原生search_type支持posts/comments，search_subreddit支持逗号分隔多社区；单sort约500帖/250评论只是召回边界，不是平台全量。使用明确上限，扇出资源合并预留。
- **red_crawler/reddit-scrape-v2**：post_comments提供all/deep选项与id/post_id/parent_id/depth（顶层0）。接入前核对引用映射与原生有界能力；all不等于可无限抓取或与kaix字段无差别直通。
- **按需补树**：只执行已授权hydrate策略；未知收费不重发，已知run续读，不强制同步waitForFinish=60。两家共享Apify故障域与Compute/代理开销，不将FREE作者费称为零成本。

---

## 5. 最小验证门禁与交接出口

文档门禁、离线/PG/构建命令仅维护在[开发说明 §3](../development.md#3-自动门禁)，实际结果在[状态](../status.md)。来源退役验收遵从开发说明，不删预算、身份精度、鉴权或幂等断言换通过。

四家来源分别有界验收：记录目标/窗口、耗时、独立内容、实际积分/账单与空结果行为，再验证PG→HTTP→导出；上游直连成功不等于adapter/产品闭环。原始报告留在output，不进Git。
