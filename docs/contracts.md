# 主线数据与 API 契约

本文件定义目标行为与不可变规则；各结构字段与枚举的唯一代码真源在 `packages/contracts/` 的 TypeBox Schema（并直接派生 OpenAPI），Web 前端、外部 AI Agent 与 R4 独立外挂共享同一套契约。当前未实施部分以[实现状态](status.md)为准。

## 1. 领域模型与内容身份

| 名称 | 唯一语义边界（严禁在 SQL、API 与文案中混用） |
| --- | --- |
| **`Platform`** | 原内容平台（`reddit`、`x`、`bluesky`、`web`）；既有数据库 `source` 表是平台注册表，`content.source_id` 指向它。 |
| **`Provider`** | 实际执行采集或推流的渠道（`kaix`、`red_crawler`、`twitterapis`、`scrapebadger`、`newsnow`、`feed`、`bluesky_appview`、`external_ingest`）。 |
| **`CollectionSource`** | 逻辑监测目标（`collection_source` 表）；HTTP 接口中的 `:id` / `sourceId` **始终指 `collection_source.id`**，挂载主渠道与可选备源。 |
| **`Project`** | 研究监测空间（`monitor_project`）；绑定逻辑来源集合、本地三段词过滤与按需水合策略，不复制内容正文。 |
| **`Content`** | 平台内唯一规范内容节点，全局唯一键 `(platform, kind, externalId)`；`externalId` 始终为字符串。 |
| **`Discovery`** | 某条内容被哪个逻辑 `CollectionSource` 发现的关系记录（`content_discovery`），不是一份独立内容。 |
| **`Observation`** | 某逻辑 `CollectionSource` 经由某一真实 `Provider` 采回的一份不可变指标与证据快照（`content_observation`）。 |

### SRC-01–04：逻辑来源与主备渠道分离

| ID | 等级 | 契约规则 | 验收出口 |
| --- | --- | --- | --- |
| SRC-01 | MUST | 逻辑来源唯一身份为 `(platform, seedKind, canonicalTarget)`（`push` 另含稳定客户端 namespace），`provider` 不参与逻辑去重；`deliveryMode`（`pull` / `push`）创建后不可变，落库 `kind` 由每条记录真实类型决定。 | PG / HTTP 约束 |
| SRC-02 | MUST | `collection_source` 保存 `primaryProvider` 与可选 `fallbackProvider` / `fallback_source_id`；`project` 关联与机器 API Key 授权只针对逻辑 `sourceId` 授予一次，任务执行与观测记录真实承担采集的 `provider`（禁止借当前主渠道推断历史数据来源）。 | 主备权属闭环 |
| SRC-03 | MUST | 仅当备源目标可表达、`operation` 兼容且已获预算授权时，主源遭遇明确失败或限流可单跳切备一次并保留 `fallbackOfJobId`；**正常空结果、`partial` 覆盖与结果未知（`unknown`）收费调用严禁触发切备**；备源不独立定时轮询，也不级联回切。 | 备源夹具 E2E |
| SRC-04 | MUST | 严格依据真实能力声明 `refreshByIds` 与 `operations` 选择渠道（如用 `ScrapeBadger` 补全 `TwitterAPIs` 缺失的批量 ID 刷新）；禁止把批量 ID 补全冒充完整讨论树，也禁止在无批量端点时暗中拆成 N 次独立收费调用。 | 能力声明单测 |

### DAT-01–08：内容身份、确定性版本与观测幂等

| ID | 等级 | 内容身份与时间/幂等契约 | 验收出口 |
| --- | --- | --- | --- |
| DAT-01 | MUST | 平台 `externalId` 始终保持字符串（防 64 位整数精度丢失）。Reddit 本体统一小写并支持 **2–32 位 ASCII base36**（主帖带 `t3_`、评论带 `t1_`），`Arctic Shift` 在线代码按计划退役但全仓统一按此验证，确保 13 位及更长评论 ID 正常落库；X 帖子与回复同属 `post`（通过 `reply_to` 与 `thread_root` 建树，不伪造 `comment`）。 | ID 纯函数与长 ID PG 测试 |
| DAT-02 | MUST | 网页条目（`web`）优先使用规范化 `canonical publisher URL`（仅剥离已知跟踪参数，保留语义 query）；缺乏可靠 URL 时使用 `feed namespace + GUID`；严禁凭借标题相似强行合并不同文章。 | URL 归一化单测 |
| DAT-03 | MUST | `NewsNow` 条目以 `canonical URL` 作为 `web/article` 唯一身份，榜单名次 `web.rank` 不等于互动指标；观测证据键使用 `sha256(boardId + ':' + externalId + ':' + snapshotBucket)`（`snapshotBucket` 为任务启动时固定的 UTC 5 分钟桶，重试复用同一桶且同桶仅留首次快照）。 | `NewsNow` 快照重放测试 |
| DAT-04 | MUST | `content` 接受正文版本必须严格按下方确定性版本元组比较决胜（具体语义见小节详述），禁止使用 `last_seen_at` 作为版本比较时钟，禁止较新空缺字段擦除已知正文，也禁止落后 `available` 记录复活已 `deleted` / `removed` 正文。 | PG 逆序/平局/防复活测试 |
| DAT-05 | MUST | `publishedAt`（对应数据库物理列 **`content.created_at_source`**）、`sourceObservedAt`（上游观测时刻）与 `fetchedAt`（本系统取回/接收时刻）三轴分离；未知必须存 `null`，严禁拿缓存时间、RSS `lastBuildDate` 或系统接收时间冒充发布时间或上游观测时刻。 | 时间轴边界单测 |
| DAT-06 | MUST | 观测唯一身份键固定为 **`(contentId, collectionSourceId, provider, evidenceKey)`**（含真实 `provider` 防止主备同键冲突）；`evidenceKey` 由稳定请求/Run/操作身份与规范内容摘要计算，**严禁将当前读取时钟 `fetchedAt` 掺入 `evidenceKey`**；同键同内容重放不新增行且沿用已存 `fetchedAt`，同键但内容字段冲突返回 `409` 或拒收，绝不静默篡改历史指标。 | 重放与冲突 PG 测试 |
| DAT-07 | MUST | 所有互动指标必须显式绑定单平台 `metricKey`（如 `reddit.score`、`x.likes`）、真实 `provider` 与观测 `timeBasis`（`provider_snapshot` / `archive_initial` / `archive_refresh` / `unknown`），缺失值维持 `null` 禁止补 `0`；导入的历史合并对象如字段来源不同时间点须独立表达或标 `unknown`。 | 指标口径测试 |
| DAT-08 | MUST | 趋势与分析默认沿 `publishedAt` 统计（未知时间单列一桶）；榜单快照详情另标 `capturedAt` 不混入发布趋势；所有正文携带明确状态 `textState`（`full` / `summary` / `missing` / `truncated`），列表、详情与文件导出保持完全一致。 | 详情与导出核对 |

#### `DAT-04`：接受正文的确定性版本与混合批规则详述

为既定 `content` 表新增列 `content_evidence_key TEXT NOT NULL` 与 `content_version_fetched_at TIMESTAMPTZ NOT NULL`（保持既有 `content_observed_at`）：
1. **确定性胜出比较元组**（对 `content_evidence_key` 强制使用字节序 `C` collation）：
   ```text
   (sourceObservedAt IS NOT NULL,
    COALESCE(sourceObservedAt, versionFetchedAt),
    evidenceKey)
   ```
   - `content_version_fetched_at` **仅在新版本胜出并接受正文更新时才同步刷新**；`first_seen_at` / `last_seen_at` 独立记发现区间，永不介入正文版本竞争；同一 `sourceObservedAt` 仅由 `evidenceKey` 字典序决胜，保证重读同一快照结果绝对幂等。
2. **字段缺失与删除语义**：
   - 当竞争胜出版本 `availability = 'available'` 时，省略或传入 `null` 的 `title` / `text` 表示“本次未采到该字段”，SQL 使用 `COALESCE(EXCLUDED.*, content.*)` 保留已知标题/正文；若传入显式 `""` 空字符串则按确定空文本处理；
   - 当竞争胜出版本 `availability IN ('deleted', 'removed')` 时，必须同步清空 `content` 对应正文/标题字段及 `public_content_search_document` 搜索投影；若后续到达元组小于当前版本的落后 `available` 输入，**禁止以其补全已删除正文**。
3. **混合批与附属上下文（`COL-08` 协同）**：
   - 批内允许同时到达根帖、子评论与中间父链节点；批内先按上述元组选出每条唯一内容的正文胜者并完整保留全部独立 `observation`（若同批同一 `(kind, externalId)` 同版本已知字段自相冲突，整批拒绝）。
   - Reddit 节点保留 `reply_to`（直系父节点）、`thread_root`（所属根帖）以及 `platformDetails.extensions` 白名单字段：`depth`（整数层深）、`isSubmitter`、`collapsed`、`collapsedReasonCode`（未知均存 `null`，不把输入 `depth="detailed"` 当成输出层级）。
   - X 回复同为 `kind='post'`，依托 `conversation_id -> thread_root`、`in_reply_to_status_id -> reply_to` 及引用关系构树；批内如检测到跨根矛盾、非法 ID 前缀或环状父链则整批拒绝；若只是父帖/根帖暂未入库，则保留真实引用并标记 `contextMissing = true`，绝不伪造占位父正文。

## 2. 在线采集（Radar / Hydrate）、主备能力与标准推流（Ingest）

| ID | 等级 | 在线任务调度、恢复与批写入规则 | 验收出口 |
| --- | --- | --- | --- |
| COL-01 | MUST | 同一逻辑 `collection_source` 复用 `source_collection_job` 承载三类操作：`radar`（带目标与 `[from, to)` 发现窗）、`hydrate`（指定根帖集合与每帖评论上限，不套发现时间窗）、`ingest`（外部推流回执）。各连接器声明支持的 `operations`、`targetTypes`、`contentKinds`、`refreshByIds`、`automaticRequestReplay` 与参数上限；`push` 来源严禁入调度队列。 | Schema / 调度单测 |
| COL-02 | MUST | 单逻辑来源同一时间至多一个运行中任务；短事务严格遵守 `source → job → content identity 升序` 加锁；旧租约或已取消任务绝不提交结果或推进水位。 | 并发租约 PG 测试 |
| COL-03 | MUST | `nextCheckpoint` 仅持久化真实可用续页游标并严格绑定来源/时间窗/排序条件；触顶停止时保存可用游标供 `Continue`，严禁伪造最后一条内容发布时间为游标。 | 续页与冲突测试 |
| COL-04 | MUST | 无游标渠道（如 `kaix`、`NewsNow`）`exhausted = true` 时仍永远标记 `coverage = 'partial'`；`incrementalTo` 仅记录已执行窗口终点（允许合理重叠回看，触顶标 gap，失败不推进），绝不以成功完成冒充全量覆盖，也不跑递归时间二分全量扫描。 | 覆盖语义单测 |
| COL-05 | MUST | 对可安全重放的临时/限流错误做最多 `3` 次有界退避重试；对于声明 `automaticRequestReplay = false` 的付费来源，一旦外部请求进入未决状态必须立即中止自动重试与切备。 | 重试与停发 E2E |
| COL-06 | MUST | 新增加或替换的付费 `provider`（如 `kaix`、`red_crawler`、`twitterapis`、`scrapebadger`）在迁移中默认关闭、配额为 `0`（不覆盖已有授权且移除旧 `arctic_shift` 免费回退）。预算/间隔拒发不计已发请求；`requests`/`resources` 为保守预留，实扣积分按请求记录在 `job`/用量诊断字段，不作跨行简单相加也不冒充商业账单。 | 迁移与预算 PG 测试 |
| COL-07 | MUST | `feed` 等渠道按来源持久化 `ETag` 与 `Last-Modified` 并发送条件请求；上游返回 `304 Not Modified` 时只更新 `lastCheckedAt`，严禁写入新观测、修改内容或增加内容计数。 | `304` 集成测试 |
| COL-08 | MUST NOT | 在线采集或混合批写入执行 `item.kind === source.contentKind` 单类型锁死校验；单次 `radar`（含伴随评论）或 `hydrate` 允许同事务写入根帖与附属评论，仅校验每条内容属于该 `provider` 本操作合法的 `contentKinds` 与引用一致性。`radar` 目标过滤仅约束主目标节点，**禁止沿用客户端 `literal().includes()` 过滤误杀原生布尔查询，也禁止在 `hydrate` 阶段按发现词/旧时间删除主帖**。 | `kaix` 混合批 PG 测试 |
| COL-09 | MUST | 在线接受批初始上限设为 **`2,000 条 / 16 MiB`**（按最坏 `根帖数 × (1 + 每帖评论上限)` 预留，超限调用前返回 `422`；严禁沿用旧 `100 条` 与 `maxItems + 2` 截断）；付费执行落实 **`starting -> running -> reading -> committed`** 状态机，创建 Actor Run 前持久化 `starting`，拿到 `runId`/`datasetId` 立即写库并支持异步轮询续读（不再同步阻塞 60s 失败即丢）；结果未知置 `failed / permanent (unknown)` 并返回 `retryable: false, nextAction: "inspect_provider_console"`，非经人工查明并显式提交 `acknowledgePotentialCharge: true`（禁止任何 UI/Agent 自动代填）绝不重新 POST 收费调用。 | 收费故障注入 E2E |
| COL-10 | MUST | 监测项目自动水合策略（`hydration` JSON 配置）初始为 `enabled: false`（`samplePercent: 10, maxRoots: 30, maxCommentsPerPost: 50, commentSort: "top", cooldownSeconds: 21600`）；开启即视为持续授权。每次 `radar` 事务提交后至多派生一笔 `hydrate` 子任务（按过门控本平台讨论数降序、时间与 ID 决胜，跳过冷却期内根帖），选择快照与 `parentJobId` 落原 `job` 防重启重复或丢失；用户手动批量挑选根帖不受百分比限制，仍受单批上限与预算约束。 | 自动派生与冷却 PG 测试 |

#### 目标 HTTP 请求形态（`POST /v1/sources/:id/collect`，带 `Idempotency-Key`）

```text
radar:   { operation: "radar", from, to, maxItems, maxPages,
           includeComments, maxCommentsPerPost, commentSort, time, sort }
hydrate: { operation: "hydrate", rootExternalIds: string[], maxCommentsPerPost,
           commentSort, projectId?, expectedProjectRevision? }
```
- `radar` 精准词默认 `includeComments=true, maxCommentsPerPost=15, commentSort="top"`；宽泛词默认 `includeComments=false, maxItems=100..300`。`hydrate` 支持单批 `10–30` 根（亦可单根），每根默认 `50` 评论（映射到 `kaix` `mode="post"` / `postUrls[]`，强制保留主帖刷新指标）；严禁 `maxItems = 0` 或 `maxCommentsPerPost = 0` 无限抓取。同来源 + `Idempotency-Key` + 规范 payload 至少 7 天复用同 `job`，同键异体返回 `409`。

#### 已核验供应商能力与调用边界矩阵（OpenAPI 详细映射见[来源替换规格](research/source_replacement_and_twitterapi_io_removal_spec.md)）

| `provider` | 发现 / 精查能力 | `refreshByIds` 与补全 | 强制调用边界与协议护栏 |
| --- | --- | --- | --- |
| **`kaix`** | Reddit 搜索、社区、账号与批量 `postUrls`（伴随层序评论） | 支持声明的根帖 `postUrls` 批量水合 | 异步 run + 轮询（等待兼容 `65s`），解除旧 `100` 条/事件帽限制；始终 `coverage = "partial"`；`automaticRequestReplay = false`。 |
| **`red_crawler`** | Reddit 搜索（`reddit-search-v2` 支持 `posts` 与全站 `comments` 关键词及多社区并发）+ 评论树（`reddit-scrape-v2`） | 支持各自声明的帖子/评论树目标 | 与 `kaix` 共用 `APIFY_API_TOKEN`（Actor 级冗余非跨云隔离）；严格限制扇出与 `mode="all"` 总条数上限；`automaticRequestReplay = false`。 |
| **`twitterapis`** | X 高级搜索、账号时间线、按需回复 `/replies` 与引用 `/quotes` | `false`（单条 detail 不冒充批量） | 约 20 条/页、默认 `maxPages <= 5`、`spacing >= 200ms`；禁用高价单向 `/tweet/thread`；以空 `tweets` / 重复 `cursor` 停页，禁跑时间二分树；HTTP GET 仍 `automaticRequestReplay = false`。 |
| **`scrapebadger`** | X 高级搜索、账号时间线、回复/引用（支持 `count` `1..100`） | **`true`**（原生 `GET /v1/twitter/tweets/`，每批 20–50 ID） | 时间窗必须编入 `query`（`since_time:`/`until_time:`）；识别 Schema 声明 `data` 或显式 `null`，禁用 `?? []` 吞错；未首充 `>= 12s`、确认 PAYG `>= 1s`；头 `X-Credits-Used` 记入请求级诊断；失败零扣费不构成超时重放授权。 |
| **`newsnow` / `feed`** | 精选榜单 MIT getter；白名单 RSS/Atom 与受控 RSSHub | 无 | 管理员白名单防 SSRF，清理 HTML 禁 XML 外部实体；严格执行 `ETag`/`Last-Modified` `304`；普通读取允许最多 3 次退避重试（`15s` 超时）。 |

---

### ING-01–02：标准外部批量推流契约

| ID | 等级 | 外部推流（`POST /v1/sources/:id/ingest`）硬性契约 | 验收出口 |
| --- | --- | --- | --- |
| ING-01 | MUST | 仅接受应用层规范对象数组 `NormalizedContentItem[]`（严禁 ZIP、Parquet、服务器本地文件路径或离线包协议）。要求 `ingest` scope、来源范围校验与 `Idempotency-Key` 头；`push` 来源由管理员建源、`provider = "external_ingest"`、`target` 仅作客户端命名空间且不加入 pull 调度。服务端强绑定 `platform` / `provider` / `sourceId` / `fetchedAt` / 内部 UUID，客户端时间声明保持外部证据地位；单批默认 **1–100 项、解码体 ≤ 1 MiB、title ≤ 4 KiB UTF-8、text ≤ 64 KiB UTF-8**（超长正文由推流端显式截断并传 `textState='truncated'` 与 `originalTextBytes`）。 | 边界校验 400 / 413 测试 |
| ING-02 | MUST | 整批校验先行（任一项错误整批 `400` 附 `details` 下标与字段；超限 `413`）；暂停/归档/`pull` 来源一律 `409`。直接复用 `source_collection_job` 存幂等回执（新增 `purpose='ingest'`、`ingest_key`、`payload_hash`、`result_summary`，**迁移必须显式放宽 `from_at` / `to_at` / `page_size` / `max_pages` 的 `NOT NULL` 约束**并排除出 pull 领取索引）。同 `(sourceId, ingest_key)` 锁来源后检查：`payload_hash`（基于归一化后稳定字段，不含接收时间）相同则返回 `200` 原回执，不同返回 `409`，首次成功返回 `201` 与 `{data:{receiptId,received,inserted,updated,unchanged,observationsInserted,replayed},meta}`（按批内去重身份计数，不把 `last_seen_at` 刷新算正文更新）。回执保留至少 7 天。 | 推流幂等与 409/并发测试 |

```text
NormalizedContentItem = {
  externalId: string, kind: ContentKind,
  title?: string | null, text?: string | null, url?: string | null,
  publishedAt: UTC | null, availability: "available" | "deleted" | "removed" | "unknown",
  textState: "full" | "summary" | "missing" | "truncated", originalTextBytes?: integer,
  author?: object | null, language?: string | null,
  media?: bounded array, references?: bounded array,
  platformDetails?: bounded PlatformDetails, provenance?: bounded object,
  observation: {
    sourceObservedAt: UTC | null, evidenceKey: string,
    timeBasis: "archive_initial" | "archive_refresh" | "provider_snapshot" | "unknown",
    maturity: "initial" | "refreshed" | "unknown",
    metrics: Record<namespacedMetric, finite number | null>
  }
}
```

## 3. 过滤、三段词信号、讨论树与项目比较

`ContentFilter` 白名单字段：`platforms`、`kinds`、`sourceIds`、`providers`、`deliveryModes`、`from` / `to`、`timeStatus`、`author`、`language`、`query`、`searchMode`、`searchScope`、`anyTerms`、`allTerms`、`exclusions`、`threadAware`、`signal`，以及同平台 `metricKey` / `min` / `max`。限制：`query <= 200` 字符、`anyTerms` / `allTerms` 各最多 20 项、`exclusions` 最多 10 项（每词 `<= 100` 字符）、`limit` 默认 25 最大 100；未知参数一律 `400`，不接受任意 SQL 或 DSL。

| ID | 等级 | 过滤、分页、信号与联动查询规则 | 验收出口 |
| --- | --- | --- | --- |
| QRY-01 | MUST | `compileContentFilter(scope, filter)` 为唯一纯过滤编译函数：候选有效范围 = `actor允许来源 ∩ 项目关联来源 ∩ 项目filter ∩ 页面filter`，其中权限/项目/来源/provider/交付模式必须在**同一个 `EXISTS(content_discovery JOIN collection_source)` 内完成交集**（严禁靠多个独立 `EXISTS` 拆开匹配绕过隔离）；全局内容库无项目约束但受 `actor` 限制，页面参数永不可放宽项目或 `actor` 范围。 | 跨来源/越权隔离 PG |
| QRY-02 | MUST | 三段词组在同一证据节点上求值：`query规则 AND (anyTerms任一，空组为true) AND allTerms全部 AND NOT exclusions任一`；项目条件组与页面临时条件组之间再取 **`AND`**（**严禁将项目 `anyTerms` 与页面 `anyTerms` 扁平混合成一个 `OR`**）。所有词项视作规范化（NFKC、Unicode 小写、空白归一）连续字面短语并转义 LIKE 通配符；`searchScope` 支持 `title` / `text` / `title_text` 且短语不跨 `U+001F` 边界。 | 过滤单测与字符边界测试 |
| QRY-03 | MUST | 上游 `target` 与搜索词决定远程召回；本地三段词组与项目 filter 只重查已存数据，修改项目词组**绝不静默改写共享来源 `target` 或触发历史补抓**。 | 项目修改 HTTP 测试 |
| QRY-04 | MUST | 时间窗采用严格 UTC 半开区间 `[from, to)`；携带日期区间时未知发布时间不匹配；传 `timeStatus = "unknown"` 时要求无 `from`/`to`（否则 `422`，前端切换“时间未知”须主动清除日期）。`unknownTimeCount` 基于同一有效范围，日期过滤排除未知时间时在 `meta.unknownTimeExcluded` 明确告知。 | 时间窗与 422 单测 |
| QRY-05 | MUST | 标准逐内容模式按 **`publishedAt DESC NULLS LAST, id DESC`** 排序（对应物理 SQL 列 `c.created_at_source DESC NULLS LAST, c.id DESC`）：非空 `cursor` 续取 `(c.created_at_source < $t OR (c.created_at_source = $t AND c.id < $id) OR c.created_at_source IS NULL)`；空时间 `cursor` 仅续取 `(c.created_at_source IS NULL AND c.id < $id)`，严禁 `COALESCE(created_at_source, first_seen_at)`。联动模式按 `matchedAt DESC NULLS LAST, anchorId DESC` 执行同等双分支 seek。 | 跨 null 游标边界 PG 测试 |
| QRY-06 | MUST | `cursor` 编入版本、规范 `filter`/`scope` 指纹、排序键、`projectRevision` 与锚点游标；范围或 `projectRevision` 变动返回 `409 cursor_scope_changed`，前端重置回第一页重新拉取。 | 409 游标冲突测试 |
| QRY-07 | MUST | 项目对比请求 `POST /v1/project-comparisons` 在相同已存模型、相同日期窗与统一 `threadAware` 口径（默认 `true`，禁把讨论数与逐内容数相减）下计算并列差值与增长率（前期为 `0` 增长率为 `null`）；涉及 `engagement` 对比必须保证两侧有效范围收窄到**同一个平台**且 `metricKey`/`provider`/`timeBasis` 兼容，否则 `422`；不承诺两项目合并汇总去重并集。 | 对比 422 与统计测试 |
| QRY-08 | MUST | 确定性信号筛选 `signal` 仅允许三个固定结构分支（不建通用规则引擎）：`discussion`（Reddit `num_comments >= 10` / X `replies >= 5`，可自定义 `minReplies`）；`pain`（命中痛点词表如 `alternative/switched/broken/坑`，或 Reddit `num_comments >= max(score, 1)` 且达 `minReplies` 并在 **`score` 已知**前提下通过，X 不可借用 Reddit 字段）；`growing`（同来源/渠道/`metricKey`/`timeBasis` 两次独立观测且时间差 `>= minIntervalSeconds` 与增量 `>= minDelta`，缺失为 `unknown` 不通过，禁跨主备渠道混比或按未证明上游时点伪造增速；若仅比较采集间隔需明确 `comparisonTimeBasis = "fetched_at"`）。 | 信号判别单测与 PG 测试 |
| QRY-09 | MUST | 联动检索与计数（项目默认 `threadAware = true`，全局内容库默认 `false`，并在 `resolvedFilter` 与 `meta` 回显）：**先在授权且命中过滤条件的证据节点上匹配，再映射至唯一可见讨论锚点（`anchor`）**——若根帖可见且授权范围内则为根帖 `id`，否则降级以命中节点自身为 `anchor` 并标 `contextMissing = true`（严禁借父链越过项目或 `allowedSourceIds` 授权）。列表每项返回 `{content, thread: {rootId, contextMissing, matchedAt, matchedEvidence}}`（只带少量命中摘录）；`contentCount` 计数去重 `anchor`，`matchedContentCount` 计数实际命中节点，`byKind` 按命中证据类型各自去重 `anchor`；`daily` 日桶按每个命中节点实际 UTC 日历归属各自去重 `anchor`（同一讨论跨天多评论命中时多日各自计入，不把日桶加总当作期间总数，且缩窄到该日钻取时 ID 集必须与日桶完全一致）。 | 联动钻取 ID 集核对 |
| TREE-01 | MUST | 只读评论树接口 `GET /v1/content/:id/thread?view=top|matches|op` 携带同一 `projectId` 与 `filter` 校验且只读已存内容，永不触发收费网络补全：`top` 按平台内 `score`/`likes` 排序，`matches` 返回命中节点及至根父链，`op` 返回 `isSubmitter = true`（或已确证稳定作者 ID）节点及必要父链（缺作者标记不冒充非楼主）。响应 `{nodes, nextCursor, meta: {treePartial, contextMissing, ...}}` 默认每页最多 **50 个选中节点**、含父链总预算 **200 节点**、父链遍历上限 **32 跳**并检测环，超预算时减少本页选中数量并提供 `nextCursor` 续页。 | 评论树三视图与环检测 PG |

**统一列表、概览与项目最小结构**：
- 列表返回 `{ items, nextCursor, meta }`（不强求 `COUNT`）；分析返回 `{ data, meta }`；公共 `meta` 包括 `requestId`, `queryFingerprint`, `resolvedFilter: { project, request, options }`, `projectRevision?`, `timeAxis`（联动为 `matched_published_at` / 否则 `published_at`）, `asOf`, `coverage: { status, limitations }`, `unknownTimeExcluded`。
- 概览 `data`：`contentCount, matchedContentCount, unknownTimeCount, daily[{date, count}], byPlatform, byKind, byDiscoveryProvider, sources`。
- 项目契约：`Project = {id, name, description, filter, hydration, sourceIds, revision, createdAt, updatedAt}`；`CreateProject = {name, description?, filter?, hydration?, sourceIds?, sources?, expectedRevision: 0}`（支持单事务内规范化复用已有同身份来源或创建禁用自动调度的新来源，绝不静默改写既有来源或触发外网）；`PatchProject = {name?, description?, filter?, hydration?, expectedRevision}`；`SetProjectSources = {sourceIds, expectedRevision}`（整集合替换且受来源可见性保护）；删除项目只清理项目与关联，绝不删公共内容与共享来源。

## 4. 权限、安全边界与 Agent 操作契约

| ID | 等级 | RBAC 矩阵、安全边界与 Agent 发现协议 | 验收出口 |
| --- | --- | --- | --- |
| SEC-01 | MUST | 严格执行三类访问主体权限：1) **`owner` / `admin` session**：可读写全部共享项目、内容、来源/任务与个人资产及授权管理（保留最后一位 `owner` 保护）；2) **`viewer` session**：只读共享项目/内容与来源状态，仅可读写自己的保存查询、批注与导出；3) **`machine` API Key**：基于既有 `app_session` 扩展 `client_kind` / `label` / `scopes` / `allowed_source_ids`，数据库仅存 SHA-256 `token_hash`、绑定签发人角色与 30–90 天过期时间且停用/降权即时生效；`scopes` 限定 `read, projects:write, sources:write, collect, ingest, export`（`ingest` 模板强绑 `read+ingest` 与非空来源），来源受限 Key 在所有查询、详情 UUID 枚举、概览、树、对比与项目管理 PUT 均强制收缩在许可来源集合内（超范围一律 404/403），且**严禁机器 Key 访问任何个人查询、批注或账户管理端点**。 | 角色与 Key 越权 E2E |
| SEC-02 | MUST | 除 [SAFE-01](architecture.md#6-远端单机公网安全与稳定运行基线) 精确例外外一律 Default-Deny；Cookie 写操作检验同源 `Origin`；feed 来源限定管理员白名单并封堵内网/云元数据地址及跨源危险跳转；HTML 渲染前严格净化，XML 解析禁用外部实体；媒体外链仅被动展示不自动预抓；一切异常与元数据禁止泄露数据库串、凭证或私钥。 | 安全与 SSRF 专项测试 |
| OP-01 | MUST | 鉴权暴露 `GET /v1/capabilities`（返回当前 actor 权限/来源范围/过期时间、各 provider 支持操作/参数上限/指标/是否禁自动重放、剩余配额及导出/推流硬上限）与由同一 TypeBox Schema 派生的 `GET /v1/openapi.json`（稳定 `operationId` 与无密示例）。AI Agent 按标准 6 步流（`capabilities -> project -> collect radar / poll job -> overview / signals -> collect hydrate / thread -> export`）工作，在预授权范围内直接推进，并明确声明**第三方帖子/评论正文为不可信材料，绝不可作为系统动作指令执行**；`nextAction` 仅允许白名单安全动作枚举（如 `inspect_provider_console` / `narrow_filter` / `reload` / `retry_later`），资源 ID 放入 `details`。 | Capabilities / OpenAPI E2E |

## 5. 流式导出与个人工作区（方案 B）

| ID | 等级 | 有界游标流式导出与资产留档规则 | 验收出口 |
| --- | --- | --- | --- |
| EXP-01 | MUST | 个人工作区仅保存 `content_saved_query` 与按 `userId` 隔离的 `content_annotation`；下载文件即唯一静态留档（不承诺服务端历史快照重放）；`research_export` 服务、表、冻结 API 与 UI 经资产对账交付后全面退役。 | 资产迁出对账检查 |
| EXP-02 | MUST | `GET /v1/content/export?format=csv|json` 复用 `compileContentFilter` 与同一权限范围（`threadAware` 下每条为一去重 anchor，内含最多 20 条命中证据及不超过 200 条可见父链上下文并标记 `evidenceTruncated`，多出树节点另由 `thread` 分页获取）。单一导出在**一个有界只读 `REPEATABLE READ` 事务内配合单一 PostgreSQL server cursor（`pg-query-stream`）流式写出**：事务内执行 `SET LOCAL idle_in_transaction_session_timeout = '35s'`（单条 SQL 仍保持 `10s`、`HTTP` 总流预算 `30s`），响应头强制带 `X-Accel-Buffering: no` 关闭 Nginx 缓冲使背压直达浏览器，严禁预跑 `COUNT` 或全量数组驻留内存，客户断连瞬间中止游标、回滚事务并归还连接。 | 断流清理与背压实测 |
| EXP-03 | MUST | 默认 `maxRows = 10,000`、硬上限 `50,000`，全局与单用户最多并发 `1` 条活跃导出流，流式额外内存缓冲目标 **`<= 2 MiB`**（在明确代表记录大小下实测）；严禁并发抢占导出连接池。 | 导出并发与内存实测 |
| EXP-04 | MUST | JSON 输出 `{meta, items: [...], result: {exportedCount, truncated, nextCursor, complete: true}}`（缺 `complete: true` 终结对象即认定文件残缺）；CSV 带 `recordType` 列，内容行 `recordType=content`，末行 `recordType=end` 写齐结束计数/游标状态；全文本列严格引号转义与防公式注入，数值型雪花/Reddit ID 一律按文本输出。 | 文件完整性单测 |
| EXP-05 | MUST | 超出 `maxRows` 采用明确分页截断（`truncated = true` 并给出 `nextCursor`），前端仅提示“本段已导出 N 条，可继续下载下一段”，绝不伪称导出全量；续段开启新事务快照。 | 分段导出验证 |
| EXP-06 | MUST NOT | 导出流启动并写包头后遇到下游故障或断连时强改 HTTP 状态码或写入成功终结块/行数标记；连接必须明确异常断开且前端不得弹出完成提示。 | 中途报错断流测试 |

## 6. 目标 HTTP 表面与错误信封

| 资源域 | 最小标准化接口路径（逗号仅为文档简写，Schema 中每个方法/路径单独注册） |
| --- | --- |
| **账户与发现** | `POST /v1/auth/login`、`GET /v1/auth/session`、`POST /v1/auth/logout`、`POST /v1/auth/register`；`GET /v1/capabilities`；`GET /v1/openapi.json`；`GET/POST /v1/access-tokens`、`DELETE /v1/access-tokens/:id` |
| **监测项目与对比** | `GET/POST /v1/projects`；`GET/PATCH/DELETE /v1/projects/:id`；`PUT /v1/projects/:id/sources`；`GET /v1/projects/:id/overview`；`GET /v1/projects/:id/content`；`POST /v1/project-comparisons`（只读） |
| **逻辑来源、采集与推流** | `GET/POST /v1/sources`；`GET/PATCH /v1/sources/:id`；`POST /v1/sources/:id/pause`、`resume`、`archive`、`collect`、`ingest`；`GET /v1/source-jobs`、`GET /v1/source-jobs/:id`、`POST /v1/source-jobs/:id/cancel`、`retry`、`continue` |
| **内容、讨论树与导出** | `GET /v1/content`；`GET /v1/content/:id`；`GET /v1/content/:id/thread`；`GET /v1/content/export` |
| **个人工作区与运维** | `/v1/content-saved-queries` 及单条操作；`/v1/content-annotations` 及单条操作；`GET /v1/source-ops`、`GET/PATCH /v1/source-provider-budgets/:provider` 及现有账户/审计管理（管理员限权） |

- 统一错误信封：`{ error: { code, message, requestId, details?, retryable, nextAction? } }`。状态码语义：`400` 结构错、`401` 未认证、`403` 无权限、`404` 不可见或越权资源隔离、`409` revision/幂等/cursor 或 `unknown` 状态冲突、`413` 请求超限、`422` 过滤或跨平台对比不兼容、`429` 限流附 `Retry-After`、`503` 索引/数据库未就绪或查询熔断。不存在已废除的 `release_expired` 或隐藏归档模式。
- 现有 `/auth/*` 等遗留旧接口仅在切换窗口保留或同步迁移，R3 完成后不长期保留双套接口；未完成实施的能力不挂空路由冒充可用。
