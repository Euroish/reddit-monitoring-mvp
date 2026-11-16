# `twitterapi_io` 全量清理下线、低价 X 双源替换与 Apify 低价 Reddit 规格书

> **文档定位**：本规格书记录 `2026-11-16` 最终拍板的来源选型对比、供应商 OpenAPI HTTP 字段映射与 `twitterapi_io` / `arctic_shift` 在线源码清理定位。产品需求、复杂度约束、通用任务与重放语义、安全退役操作步骤、当前实码证据分别以[产品与架构](../README.md)、[数据与 API 契约](../contracts.md)、[开发与交付](../development.md)与[当前实现状态](../status.md)为唯一规范；本专项不另立产品预算线或同步等待规则。

---

## 1. 最终选型定案与商业证伪（Finalized Stack vs. Rejected Providers）

### 1.1 为什么彻底删除 `twitterapi_io` 现有代码
核对官网实时计费配置 `https://twitterapi.io/pricing.json`（`version: 2026-10-12`）：
- **按量单价为本次候选参考线的 3 倍**：`$1 = 100,000 credits`，所有推文读取接口（`/twitter/tweet/advanced_search`、`/twitter/user/last_tweets`、`/twitter/tweets`、`/twitter/tweet/replies/v2`、`/twitter/tweet/thread_context`、`/twitter/tweet/quotes`）统一定价 **`15 credits / 条`（`$0.15 / 1,000 条`）**，且无论是否命中结果，每次成功请求保底扣 **`15 credits`（`$0.00015`）**；
- **订阅最低地板价仍高于参考线**：只有购买 **`$1,499 / 月` Business 订阅**并把 31 天过期的当月加赠（`+50%`）及次月返还（`+40%`，停订即停返）全部消耗完（理论 `1.90x`），地板价才降至 **`$0.0789 / 1,000 条`**（Starter `$29/月` 等效仍约 `$0.133 / 1k`），高于本次采购比较使用的 `< $0.05 / 1k` 参考线（仅作候选筛选参考，不构成全产品硬预算约束）；
- **同源冗余假象**：`twitterapi.io` 首页公开将 Apify 上的 `kaitoeasyapi` 列为自家演员（运营实体同属 Prism Digital, LLC），保留它或挂接 `kaitoeasyapi` 均无法构成真实独立备源；
- **执行决定**：不保留空壳开关，**彻底从主线代码、运行时注册、环境模板、CI 脚本与测试中实删所有 `twitterapi_io` 资产**，同时平滑保全历史 PostgreSQL 观测记录。

### 1.2 最终锁定双平台采集架构

| 平台 | 主/备角色 | 选定数据源 | 公开报价与关键限制（`2026-11-16` 核验，非本仓实测账单） | 工程定位与职责分工 |
| :--- | :--- | :--- | :--- | :--- |
| **X (Twitter)** | **主力低价源** | **`TwitterAPIs`**<br>(`https://api.twitterapis.com`) | 标准读 **`$0.0008 / call`**（满 20 条/页 $\approx$ **`$0.04 / 1k`**）；新号赠 `$0.50`，`$10+` 充值**永不过期** | 承接日常高频检索（`/tweet/advanced_search`）、账号时间线（`/user/tweets`）、回复/引用分页（`/tweet/replies`、`/tweet/quotes`）。**无批量 ID 端点**（`refreshByIds: false`）；严禁自动调 `$0.004/call` 的单向 `/tweet/thread`。 |
| **X (Twitter)** | **独立供应商备源** | **`ScrapeBadger`**<br>(`https://scrapebadger.com/v1/twitter`，含可选 Apify 兜底说明) | **`1 base + 1 credit / item`**（20 条页 = 21 credits）；注册赠 `1,000 credits`；PAYG 从 `$10`/`$20` 起且永不过期；**`4xx/5xx` 失败扣 `0` credits**；响应头带 `X-Credits-Used` | 按 [SRC-03](../contracts.md#1-领域模型与内容身份) 单跳切备接管 X 搜索与时间线；**原生支持 `GET /v1/twitter/tweets/` 批量 ID 查推文**（`refreshByIds: true`），补齐 `TwitterAPIs` 无法低成本批量水合的短板。 |
| **Reddit** | **主力源** | **`kaix/reddit-scraper`**<br>(Apify build `0.2.25`，仓库已有基础连接器) | **`$0.02 / 1k` 结果**（post/comment/subreddit 同价）+ `$0.00005/GB` 启动 + 用户自付 Apify Compute/可选代理 | 共用现有 `APIFY_API_TOKEN`；开发期事件帽/内存/时长硬覆盖已移除，待完成混合批写入、异步 run 恢复与 4 项解封后，负责搜帖连带层序评论与批量 `postUrls` 补全。 |
| **Reddit** | **免费作者费备源** | **`red_crawler/reddit-search-v2` + `red_crawler/reddit-scrape-v2`** | **2026-10-29 起作者费 `FREE`**，仅消耗 Apify Compute（Apify Free 号含 `$5/月` 额度）；商店宣称 30 天成功率 `99.4% / 99.8%`，本仓未验 | 共用同一 `APIFY_API_TOKEN`；补齐 **`search_type="comments"` 全站评论关键词搜索**与逗号分隔多社区并行搜索（`reddit-search-v2`），及 `post_comments mode="all"` 完整评论树（`reddit-scrape-v2`）。按需可辅以 `kaix/reddit-comments-scraper`（`$0.02/1k + Compute`）。 |

### 1.3 已淘汰 / 落选候选记录（不再投入研发资源）

| 候选渠道 | 核验结果与淘汰原因 |
| :--- | :--- |
| **`TwitterAPI.io`** | `$0.15/1k`（最高订阅地板 `$0.0789/1k`）高于候选参考线，且与 `kaitoeasyapi` 同源，全量实删。 |
| **`TwexAPI`** (`twexapi.io`) | OpenAPI 核验：无任何按推文 ID 查询接口；`TweetModel` 缺少顶层 string `conversation_id`；`$10` Mini 包仅 7 天有效期且 `1 QPS`，仅 `$20+/月` 订阅才到 `$0.04/1k`，不列入当前清单。 |
| **`Xquik`** (`xquik.com`) | 单价 `$0.119–$0.15/1k` 高于候选参考线；仅记录“0 结果搜索 0 扣费”特性作未来极稀疏关键词可选参照，不接入主线。 |
| **`Desearch.ai`** | 早期审查曾列作可选备源线索；经 OpenAPI 与真实能力核验后，由原生支持 `GET /v1/twitter/tweets/` 批量 ID 查推文且支持 `X-Credits-Used` 响应头对账的 **`ScrapeBadger`** 正式替代。 |
| **`Arctic Shift`** 在线 API | `2026-11-16` 实测大/中版块关键词检索 `422 Timeout` 或 `10s+` 超时、`comment tree` 即刻触发 `x-ratelimit-reset`，Reddit 官网匿名访问返回 `403`；在线连接器列为实删，仅离线 `.zst` 保留在 R4 `plugins/zst-archive/`。 |
| **`PullPush.io`** | 官网 Cloudflare 拦截，`api.pullpush.io` 首次单请求即返回 `"does not provide free scraping resources for agents"` 拒答，不能作为自动化来源。 |

---

## 2. X 新双源连接器 OpenAPI 字段映射

### 2.1 `TwitterAPIs`（`provider: "twitterapis"`，主源）
- **认证与配置**：环境变量 `TWITTERAPIS_API_KEY`（请求头 `Authorization: Bearer <KEY>`）、`TWITTERAPIS_TIMEOUT_MS`（默认 `20000`，边界 `100..120000`）。
- **核心能力边界**：
  - `platform: "x"`, `provider: "twitterapis"`, `contentKinds: ["post"]`, `targetTypes: ["account", "search"]`, `keywordSearch: "global"`, `observationModel: "snapshot"`;
  - **`refreshByIds: false`**（OpenAPI 仅提供单条 `GET /tweet/detail?id=...`，无批量 ID 端点；禁止注册为自动批量刷新器或拆成 N 次收费请求）；
  - **`automaticRequestReplay: false`**（每请求固定 `$0.0008`，禁止在超时或 HTTP GET 结果未知时重放）；
  - **`requestResourceUpperBound: 20`**（初始预留上限，对应公开约 20 条/页；接入验收时须以真实样本证明适用上界，严禁丢弃超额结果伪造合规）。
- **端点与 OpenAPI 字段映射**：
  - 搜索：`GET https://api.twitterapis.com/twitter/tweet/advanced_search`，参数 `query`（编译 `(${raw}) since_time:${fromSec} until_time:${toSec}`）、`product=Latest`、`cursor`；
  - 账号时间线：`GET https://api.twitterapis.com/twitter/user/tweets`，参数 `username`、`cursor`；
  - 讨论/引用（精查按需）：`GET /twitter/tweet/replies`（`id`, `cursor`, `sort=latest|relevance|likes`）与 `GET /twitter/tweet/quotes`（`id`, `cursor`），均按 `$0.0008/call` 计费；**禁止接入 `$0.004/call` 且仅顺向读取同作者的 `/twitter/tweet/thread`**；
  - `Tweet` 字段映射：`id` → `externalId`（字符串）、`text`、`created_at`、`lang`、`url`、`author.{id, username, name, url}`、`conversation_id` → `thread_root` / `platformDetails.conversationId`、`in_reply_to_status_id` → `reply_to`、`quoted_status_id` / `quoted_tweet.id` → `quote`、`retweeted_tweet.id` → `repost`；指标映射 `favorite_count` → `x.likes`、`retweet_count` → `x.reposts`、`reply_count` → `x.replies`、`quote_count` → `x.quotes`、`view_count` → `x.views`、`bookmark_count` → `x.bookmarks`。
- **分页与协议错误校验**：
  - 读取 `body.tweets` 与 `next_cursor` 及显式结束标记；末页 `next_cursor` 可能非空，必须结合有效空页或重复 `cursor` 终止。
  - **缺失或非数组 `tweets` 属于协议错误**（不可 `?? []` 当作空页），遵守 [COL-05 / COL-07](../contracts.md#2-在线采集radar--hydrate主备能力与标准推流ingest) 不推进水位；每页独立计费，禁止因为是 HTTP GET 而自动重放。

### 2.2 `ScrapeBadger`（`provider: "scrapebadger"`，独立异构备源与批量补全）
- **认证与配置**：环境变量 `SCRAPEBADGER_API_KEY`（请求头 `x-api-key: <KEY>`）、`SCRAPEBADGER_TIMEOUT_MS`（默认 `20000`，边界 `100..120000`）；可选同品牌 Apify 路径 `scrape.badger/twitter-tweets-scraper` 作为说明记录，主适配器直连原生 REST `https://scrapebadger.com/v1/twitter`。
- **核心能力边界**：
  - `platform: "x"`, `provider: "scrapebadger"`, `contentKinds: ["post"]`, `targetTypes: ["account", "search"]`, `keywordSearch: "global"`, `observationModel: "snapshot"`;
  - **`refreshByIds: true`**（原生支持 `GET /v1/twitter/tweets/?tweets=id1,id2,...` 批量查推文，补齐 `TwitterAPIs` 的批量水合缺口，每批建议上限 `20–50` 个已授权 ID）；
  - **`automaticRequestReplay: false`**，`requestResourceUpperBound: 100`（搜索参数 `count` 支持 `1..100`；默认可配 `20–50` 对齐预算）。
- **OpenAPI 真实参数与响应结构（严格防猜错）**：
  - 搜索：`GET /v1/twitter/tweets/advanced_search`，查询参数**仅有** `query`（必填）、`query_type`（`Top | Latest | Media`，采集用 `Latest`）、`count`（`1..100`）、`cursor`——**没有 `start_time`/`end_time` 独立 HTTP 参数**，时间窗必须编入 `query`（`since_time:` / `until_time:`）；
  - 时间线：`GET /v1/twitter/users/{username}/latest_tweets`（`cursor`）；
  - 回复/引用：`GET /v1/twitter/tweets/tweet/{tweet_id}/replies` 与 `/quotes`（`cursor`）；
  - **响应体容错**：OpenAPI Schema 声明返回 `{ data: TweetData[] | null, next_cursor: string | null }`（顶层无 `meta` 对象，部分 SDK 示例写作 `tweets`）。适配器优先识别 Schema 声明的 `data` 数组或显式 `null`（允许显式 `null` 作为空页），仅在 `data` 键完全缺省时兼容读取 `tweets`；**二者均缺失或类型非法时必须抛出协议错误**，严禁用 `?? []` 静默掩盖错误。
  - **`TweetData` 字段映射**：`id`, `full_text ?? text`, `created_at`, `lang`, 扁平作者字段 **`user_id` / `username` / `user_name`**（非嵌套 `author` 对象）, `conversation_id`, `in_reply_to_status_id`, `favorite_count`, `retweet_count`, `reply_count`, `quote_count`, `view_count`, `bookmark_count`, `possibly_sensitive`, `is_quote_status`, `is_retweet`；响应头 **`X-Credits-Used`** 记入现有 `job`/用量的请求级诊断（`scrapebadger.credits_used`），缺头记 `unknown`，不作为内容指标或逐条均摊。
- **账户档位限流**：未首充账户限制 `5 req/min`（`12s/次` 极易撞本地 `20s` 超时），确认首充 PAYG 后提升至 `60 req/min`（`minimumIntervalMs >= 1000`）。未知档位按前者调度，间隔在请求发起前于连接外等待并严格遵守 `Retry-After` / 重置响应头；已知失败不扣费的公开声明不构成网络超时/状态未知时自动重放的授权。

---

## 3. `twitterapi_io` 与 `arctic_shift` 在线源码实删定位矩阵

### 3.1 代码、配置、CI 与测试点阵（经逐文件扫描核实，基线 `9760006`）

| 类别 | 目标路径 | 实施动作与防断裂门禁 |
| :--- | :--- | :--- |
| **直接删除文件** | `src/connectors/x/twitterapi-io-content.connector.ts`<br>`src/connectors/x/twitterapi-io.config.ts`<br>`tests/unit/twitterapi-io-content.connector.test.ts`<br>`src/connectors/reddit/arctic-shift-content.connector.ts`<br>`tests/unit/arctic-shift-content.connector.test.ts` | 整文件实删。**前置解耦门禁**：删除 `arctic-shift-content.connector.ts` 前必须先完成下表对 `kaix-content.connector.ts` 与 `tests/helpers/` 夹具的解耦重构，防止全仓编译瘫痪。 |
| **解除 `kaix` 对 `ArcticShift` 的代码耦合** | `src/connectors/reddit/kaix-content.connector.ts` (L4, L26) | 当前 `kaix` 直接导入 `ARCTIC_SHIFT_CAPABILITY.metrics`；实删前必须先把 Reddit 三项指标（`reddit.score`、`reddit.num_comments`、`reddit.upvote_ratio`）内联或抽入 Reddit 共享常量，否则 `kaix` 无法通过 `tsc`。 |
| **预算回退安全闸门** | `src/storage/source-lifecycle.ts` (L4 `defaultProviderBudget`) | 将免费列表从 `["arctic_shift", "demo_reddit", "demo_x"]` 收敛为 `["demo_reddit", "demo_x"]`。否则当空库或 `source_provider_budget` 中未配置 `arctic_shift` 行时，系统会回弹返回 `enabled: true, dailyRequests: 1000`。 |
| **运行时装配与新模块迁移** | `src/runtime/source-content-runtime.ts` (L2, L7-8, L22, L25) | 移除旧 `ArcticShiftContentConnector`、`TwitterApiIoContentConnector` 与 `resolveTwitterApiIoConfig` 导入和实例化；新连接器（`TwitterApis` / `ScrapeBadger` / `RedCrawler`）直接装配进目标 `collection` 模块，旧 `runtime` 按 R3 实删。 |
| **环境变量校验** | `src/runtime/environment-config.ts` (L58) | 删除 `TWITTERAPI_IO_TIMEOUT_MS`，替换为 `TWITTERAPIS_TIMEOUT_MS` 与 `SCRAPEBADGER_TIMEOUT_MS`（`100..120000`）。 |
| **部署环境模板与提示文案** | `deploy/env/sources.env.example` (L9)<br>`deploy/env/api.env.example` (L1)<br>`deploy/env/scheduler.env.example` (L1)<br>`src/connectors/demo/demo-content.connector.ts` (L15) | 删除 `TWITTERAPI_IO_API_KEY=` 并补充 `TWITTERAPIS_API_KEY=` 与 `SCRAPEBADGER_API_KEY=`；清理旧 `Arctic Shift` 注释与示例文案。 |
| **CI 与冒烟脚本** | `.github/workflows/verify.yml` (L19, L61)<br>`scripts/ci-demo.mjs` (L30)<br>`scripts/run-ci-tests.ts` (L31)<br>`scripts/smoke-compiled-build.ts` (L67) | 删除传递的 `TWITTERAPI_IO_API_KEY: ""`；显式置空新环境变量以隔离测试（`TWITTERAPIS_API_KEY: ""`、`SCRAPEBADGER_API_KEY: ""`）。 |
| **单元测试调整** | `tests/unit/source-content-runtime.test.ts` (L7, L13, L16-17, L22-23)<br>`tests/unit/environment-config.test.ts` (L27)<br>`tests/unit/create-reddit-connector.test.ts` (L20) | 移除 `TWITTERAPI_IO_*`、`REDDIT_LIVE_PROVIDER: "arctic_shift"` 与旧能力断言，改为校验 `twitterapis` / `scrapebadger` / `red_crawler` 默认关闭与开启边界；新增 `twitterapis-content.connector.test.ts` 与 `scrapebadger-x-content.connector.test.ts`。 |
| **测试公共夹具与生命周期用例解耦（防 ~29 处引用连锁报错）** | `tests/helpers/source-content-fixtures.ts` (L3, L12, L21)<br>`tests/helpers/source-scheduler-reliability-cases.ts` (L7, L64)<br>`tests/helpers/source-failure-policy-cases.ts` (L55-73, L111)<br>`tests/unit/source-content.service.test.ts` (L6, L8)<br>`tests/unit/source-request-timing.test.ts` (L7, L17-18)<br>`tests/unit/source-lifecycle.service.test.ts` (L10, L58)<br>`tests/integration/source-content-postgres.test.ts`<br>`tests/integration/source-scheduler-reliability-postgres.test.ts`<br>`tests/integration/legacy-source-content-guard-postgres.test.ts`<br>`tests/integration/api-server-source-content.test.ts` | 上述夹具与集成/单测目前直接导入 `ArcticShiftContentConnector` 或将 `"arctic_shift"` 用作合成 `provider`。**禁止整块删用例丢断言**：将 `fixtureConnector` 与 `syntheticSource` 重构为测试专用合成 `StubContentConnector`（不依赖任何真实线上 connector 类）。 |
| **集成测试防退化迁移** | `tests/integration/twitterapi-io-content-pipeline.test.ts` | **严禁直接删除！** 重命名并迁移为 `tests/integration/x-content-pipeline.test.ts`：完整保留 X 来源创建、零预算默认阻断、开启预算后执行、account+search 同推文身份去重、64 位雪花 ID 字符串精度、固定资源上限预留、额度耗尽阻断及 `401` 鉴权验证。 |
| **历史导出与旧分析提示过渡** | `src/application/services/research-export.service.ts` (L12, L20)<br>`apps/web/src/features/content/LegacyAnalysisNotice.tsx` (L8-9)<br>`scripts/smoke-workbench-functional.ts` (L191) | 1. 在 R3 整体退役 `ResearchExportService` 前，`extensionKeys` **保留 `"twitterapi_io.*"` 只读白名单条目**并追加 `"twitterapis.*"` / `"scrapebadger.*"`，避免库内历史观测丢失诊断键；<br>2. 旧分析页面下线前，先将 `LegacyAnalysisNotice.tsx` 文案改为“尚未纳入新来源采集的观测”并同步更新 `smoke-workbench-functional.ts` L191 断言（随 R3 整体删除）。 |

### 3.2 数据库历史数据保全规则（零外键破坏）
核查 `029_source_content_collection.sql`、`030_source_lifecycle.sql`、`031_x_platform.sql`、`035_source_configuration_revisions.sql` 与 `postgres-source-content.repository.ts`：
1. `031_x_platform.sql` 只注册 `source(code='x', name='X')`，与具体 `provider` 解耦，保持原样；
2. **禁止物理 `DELETE` 历史来源、预算或观测行**：`content_discovery` / `content_observation` 外键指向 `collection_source(id)`，`source_provider_usage(provider)` 外键指向 `source_provider_budget(provider)`；
3. 唯一安全退役与在途运行盘点步骤见[开发与交付：来源退役顺序](../development.md#来源退役顺序)。不得编写跳过云端运行核查而强行批量 `cancelled` 未知付费任务的脚本。

---

## 4. Reddit Apify 低价双源组合与评论树整合要点

以 `src/connectors/reddit/kaix-content.connector.ts` 为重构起点，共用 `APIFY_API_TOKEN`；混合写入、异步 Actor 状态恢复与评论预算遵从[契约 §2](../contracts.md#2-在线采集radar--hydrate主备能力与标准推流ingest)：
- **`kaix/reddit-scraper`（build `0.2.25`）**：开发期事件帽（`$0.01`）、45s 超时、512MiB 内存与禁代理硬覆盖已移除；仍需在 R1 解除 4 项功能限制——(1) 移除对 `ArcticShift` 的指标常量导入，(2) 放开 `includeComments` / `maxCommentsPerPost` / `commentSort` / `time` / `sort` 参数，(3) 支持 `mode="post"` 批量 `postUrls` 并**取消丢弃主帖**，(4) 删除误杀布尔查询的客户端 `literal().includes()` 过滤，同时将异步 run 创建与 `runId`/`datasetId` 持久化、保留 `depth`/`isSubmitter`/`collapsed` 一并落地；
- **`red_crawler/reddit-search-v2`**：支持 `search_type="posts"`（单 sort 约 500 帖）与 `"comments"`（单 sort 约 250 评论）及逗号分隔多社区并发检索，接入前需按有界扇出合并预留预算；
- **`red_crawler/reddit-scrape-v2`**：`endpoint="post_comments"` 提供 `all` / `deep` 选项与标准 `id`, `post_id`, `parent_id`, `depth`（顶层 `0`），对接 `reply_to` / `thread_root` 映射；`all` 不代表允许无限整树抓取；
- **同域提醒**：`kaix` 与 `red_crawler` 同属 Apify 基础设施，提供的是 **Actor 级冗余**而非跨平台故障冗余；两者的免费/低作者费均不含 Apify Compute 与可选代理开销。

---

## 5. 验证出口

- **文档阶段**：`npm run docs:check`（`scripts/check-docs.ts`）、`npm run lint`、`npm run typecheck`、`npx tsx --test tests/unit/release-package.test.ts tests/unit/repository-policy.test.ts` 与 `git diff --check` 全部通过；
- **代码实删阶段**：在 `src/`、`apps/`、`scripts/`、`tests/`、`deploy/`、`.github/` 范围内检索旧标记，仅允许保留在既有迁移 `001..040`、退役迁移及（R3 退役前）只读导出白名单中；`npm run test:offline`、`npm run test:postgres` 与 `x-content-pipeline.test.ts` 全量零跳过通过；
- **新源真实样本验收**：对 `TwitterAPIs`、`ScrapeBadger`、`kaix`（解封后）与 `red_crawler` 分别留存一次有界真实请求样本、耗时、实际账单/积分头（如 `X-Credits-Used`）、空结果边界及 PostgreSQL/HTTP/流式导出闭环报告至 `output/`（不提交 Git）。
