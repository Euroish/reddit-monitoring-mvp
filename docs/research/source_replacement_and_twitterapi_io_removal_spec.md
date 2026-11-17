# `twitterapi_io` 下线清理、低价 X 双源与 Apify Reddit 规格

> **文档定位**：本规格书维护 `2026-11-16` 核验后的 X/Reddit 供应商商业与 OpenAPI 字段映射定案，以及 `twitterapi_io` / `arctic_shift` 在旧 `0.9.1` 代码库中的逐文件实删坐标。产品约束与运行语义分别以[主线架构规范](../architecture.md)、[数据与 API 契约](../contracts.md)、[开发记录](../development.md)与[当前状态](../status.md)为准。

---

## 1. 商业定案与渠道职责分工

1. **淘汰 `twitterapi_io`（固定 `$0.15 / 1k`）**：官网 `pricing.json` 显示空请求保底扣 15 credits（`$0.00015`），`$1,499/月` Business 满返地板仍 `$0.0789/1k`，且与 `kaitoeasyapi` 同属 Prism Digital。主线代码、环境模板、CI 与测试中彻底清除，历史库内容与观测保留原 `provider` 软归档。
2. **X 主备选型**：
   - **`TwitterAPIs`（主力低价源）**：`https://api.twitterapis.com`，`$0.0008 / call`（满 20 条页 $\approx \$0.04/1\text{k}$），`$10+` 永不过期，无批量 ID 端点（`refreshByIds: false`）；禁用 `$0.004/call` `/tweet/thread`。
   - **`ScrapeBadger`（独立备源与批量补全）**：`https://scrapebadger.com/v1/twitter`，`1 base + 1 credit/item`，PAYG 永不过期，`4xx/5xx` 零扣费，支持原生批量 `GET /v1/twitter/tweets/`（`refreshByIds: true`）与 `X-Credits-Used` 对账头。
3. **Reddit 主备选型**：
   - **`kaix/reddit-scraper`（主力，Apify build `0.2.25`）**：`$0.02/1k + Compute`，解除 `ArcticShift` 指标耦合、`includeComments=false`、100 条、`mode="post"` 丢主帖与 `literal()` 误杀 4 项封印，改为异步 Run + `runId`/`datasetId` 恢复。
   - **`red_crawler/reddit-search-v2` & `reddit-scrape-v2`（Actor 级备源）**：作者费 FREE，仅耗 Apify Compute，补充 `search_type="comments"` 与多社区搜索；与 `kaix` 共用 `APIFY_API_TOKEN`（同故障域非跨云容灾）。

---

## 2. X 新双源 OpenAPI 精确映射（严格防猜错路径）

### 2.1 `TwitterAPIs`（`provider: "twitterapis"`）

- **配置与能力**：`TWITTERAPIS_API_KEY`（`Authorization: Bearer <KEY>`）、`TWITTERAPIS_TIMEOUT_MS`（默认 `20000`，区间 `100..120000`）；`contentKinds: ["post"]`、`targetTypes: ["account", "search"]`、`refreshByIds: false`、`automaticRequestReplay: false`、`requestResourceUpperBound: 20`。
- **真实端点与参数**：
  - 搜索：`GET /twitter/tweet/advanced_search`（参数 `query` 编译 `(${raw}) since_time:${fromSec} until_time:${toSec}`、`product=Latest`、`cursor`）；
  - 时间线：`GET /twitter/user/tweets`（参数 `username`、`cursor`）；
  - 讨论/引用：`GET /twitter/tweet/replies`（`id`, `cursor`, `sort`）与 `GET /twitter/tweet/quotes`（`id`, `cursor`）；禁用 `/twitter/tweet/thread`。
- **字段映射与停页**：`id` -> `externalId`（字符串）、`conversation_id` -> `thread_root`、`in_reply_to_status_id` -> `reply_to`、`quoted_status_id` / `quoted_tweet.id` -> `quote`、`retweeted_tweet.id` -> `repost`；指标映射到 `x.likes` / `x.reposts` / `x.replies` / `x.quotes` / `x.views` / `x.bookmarks`。末页 `next_cursor` 可能非空，须结合空数组或重复 `cursor` 停页；**缺失或非数组 `tweets` 直接判协议错误（禁止 `?? []` 伪装空页）**。

### 2.2 `ScrapeBadger`（`provider: "scrapebadger"`）

- **配置与能力**：`SCRAPEBADGER_API_KEY`（请求头 `x-api-key: <KEY>`）、`SCRAPEBADGER_TIMEOUT_MS`（`20000`，`100..120000`）；`refreshByIds: true`（`GET /v1/twitter/tweets/?tweets=id1,id2,...`，每批限 20–50 ID）、`automaticRequestReplay: false`、`requestResourceUpperBound: 100`。
- **真实端点与响应结构**：
  - 搜索：`GET /v1/twitter/tweets/advanced_search`（参数仅 `query`、`query_type=Top|Latest|Media`、`count 1..100`、`cursor`——**没有独立 `start_time`/`end_time` 查询参数，时间窗必须编入 `query`**）；
  - 时间线：`GET /v1/twitter/users/{username}/latest_tweets`；回复/引用：`GET /v1/twitter/tweets/tweet/{tweet_id}/replies` 与 `/quotes`。
  - **响应体容错**：优先识别 Schema 的 `{ data: TweetData[] | null, next_cursor }`（显式 `null` 视作空页），仅在 `data` 键完全缺省时兼容读取 `tweets`；两者皆缺即抛协议错误。
  - **`TweetData` 扁平作者字段**：`user_id` / `username` / `user_name`（非嵌套 `author`），正文取 `full_text ?? text`，响应头 `X-Credits-Used` 写入任务用量诊断。未首充账户按 `5 req/min`（`>= 12s/次`），确认 PAYG 按 `>= 1s/次`；“失败零扣费”不构成超时重放授权。

### 2.3 Apify `kaix` 与 `red_crawler` 异步调用要求

- 统一使用 Apify 异步 Runs API（创建 Run -> 写库 `runId`/`datasetId` -> 轮询直至完成或按退场信号放回租约 -> 拉取 Dataset Items），**禁止对 `red_crawler` 调用不存在的同步端点 `red_crawler~reddit`**。
- `kaix` 解除 4 项旧限制并允许搜索结果触发 `maxItems` 时不前推 `incremental_to`；`red_crawler` 严格约束多社区扇出与 `mode="all"` 总条数。

---

## 3. 旧 `0.9.1` 代码库内 `twitterapi_io` 与 `arctic_shift` 清理定位矩阵

供尚未删除旧连接器的主干分叉按点定位与核对（已删除分支仅作验收核查表）：

| 类别 | `main@0.9.1` 目标路径 | 实施动作与防断裂门禁 |
| :--- | :--- | :--- |
| **直接实删文件** | `src/connectors/x/twitterapi-io-content.connector.ts`、`twitterapi-io.config.ts`、`tests/unit/twitterapi-io-content.connector.test.ts`、`src/connectors/reddit/arctic-shift-content.connector.ts`、`tests/unit/arctic-shift-content.connector.test.ts` | 整文件删除前须先完成 `kaix` 常量与测试夹具解耦。 |
| **`kaix` 解耦** | `src/connectors/reddit/kaix-content.connector.ts` | 内联或独立抽离 Reddit 指标常量（`reddit.score` / `num_comments` / `upvote_ratio`），移除 `ARCTIC_SHIFT_CAPABILITY` 导入。 |
| **预算回退安全闸门** | `src/storage/source-lifecycle.ts` (`defaultProviderBudget`) | 免费默认回退从 `["arctic_shift", "demo_reddit", "demo_x"]` 改为 `["demo_reddit", "demo_x"]`，防止空表回弹放行已退役渠道。 |
| **装配与环境变量** | `src/runtime/source-content-runtime.ts`、`environment-config.ts`、`deploy/env/*.env.example` | 移除旧连接器实例化与 `TWITTERAPI_IO_*`，切换 `TWITTERAPIS_*` / `SCRAPEBADGER_*`（若已完成 R3 则直接收拢至 `collection` 模块与 Compose 环境模板）。 |
| **测试迁移与夹具解耦** | `tests/integration/twitterapi-io-content-pipeline.test.ts`、约 29 处引用 `ArcticShiftContentConnector` 的夹具 | 将 `twitterapi-io-content-pipeline.test.ts` **重命名迁移为 `x-content-pipeline.test.ts`** 完整保留 X 核心断言；旧夹具改用测试用 `StubContentConnector`。 |
| **数据库保全** | `029`–`035` 历史 SQL 与 `content_observation` | 禁止修改已应用迁移或物理删旧观测/预算/来源行；严格按[开发记录](../development.md)安全退役步骤软归档。 |
