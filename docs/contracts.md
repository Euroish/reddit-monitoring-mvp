# 主线数据与 API 契约

本文件定义系统领域边界、状态机、混合批写入、查询与安全契约。结构体与校验的唯一代码真源是 `packages/contracts/` 的 TypeBox Schema（由 `@fastify/type-provider-typebox` 编译派生 OpenAPI），所有扩展 Schema 必须经统一 `strictMerge` 显式保留 `additionalProperties: false`（禁止使用会剥离严格校验的裸 `Type.Composite` 默认合并）。

## 1. 领域模型与身份划分

| 领域概念 | 唯一语义（严禁混用） |
| :--- | :--- |
| **`Platform`** | 原内容平台（`reddit`、`x`、`bluesky`、`web`）；对应 `source` 表，`content.source_id` 指向它。 |
| **`Provider`** | 执行采集或推流的渠道实现（`kaix`、`red_crawler`、`twitterapis`、`scrapebadger`、`newsnow`、`feed`、`bluesky_appview`、`external_ingest`）。 |
| **`CollectionSource`** | 逻辑监测目标（`collection_source`）；所有 HTTP 路由中的 `:id` / `sourceId` **始终指逻辑来源 `collection_source.id`**。 |
| **`Project`** | 研究工作空间（`monitor_project`）；绑定逻辑来源集合、本地三段词过滤与按需水合选项，不复制正文文本。 |
| **`Content`** | 规范内容节点，全局业务身份 `(platform, kind, externalId)`；`externalId` 始终为字符串；物理主键值 `id` 在写入内核确定性派生。 |
| **`Discovery`** | 某内容被哪条逻辑来源发现的关联（`content_discovery`），非独立正文。 |
| **`Observation`** | 某逻辑来源经特定 `Provider` 采回的不可变快照指标（`content_observation`）。 |

### SRC-01–03：逻辑来源分离与失效策略

| ID | 等级 | 逻辑来源与备源约束 | 验收出口 |
| --- | --- | --- | --- |
| SRC-01 | MUST | 逻辑来源身份由 `(platform, seedKind, canonicalTarget)`（`push` 另加客户端 namespace）唯一确定，创建后 `deliveryMode`（`pull` / `push`）不可变；同一来源允许绑定主备渠道，授权与项目绑定针对逻辑 `sourceId` 进行，而任务与观测准确记录实际执行 `provider`。 | PG 约束与主备权属测试 |
| SRC-02 | MUST | 基线 R2 中，主备切换与备源 `ScrapeBadger` 批量 ID 刷新优先支持明确人工操作、任务重试与显式备用策略；严禁对正常空结果、`partial` 覆盖或结果 `unknown` 的付费调用自动切备或级联回切。Stage 3 再视真实故障率评估受限单跳自动切备。 | 停发与显式切备测试 |
| SRC-03 | MUST | 按真实接口能力声明 `operations` 与 `refreshByIds`：禁止在缺少批量接口时暗中拆成 N 次收费请求，也禁止将批量 ID 刷新冒充完整讨论树。 | 能力边界单测 |

### DAT-01–04：内容身份、三元版本元组与三轴时间

| ID | 等级 | 内容规范化、版本比较与幂等规则 | 验收出口 |
| --- | --- | --- | --- |
| DAT-01 | MUST | `externalId` 统一字符串防精度丢失：Reddit ID 统一小写 2–32 位 ASCII base36（含 13+ 位 `t1_` 评论）；X 帖子与回复同属 `kind='post'`（用 `reply_to` 与 `thread_root` 建树）；`web` 按规范 `canonical publisher URL` 或 `feed namespace + GUID` 去重，`NewsNow` 以 `sha256(boardId + ':' + externalId + ':' + snapshotBucket)`（UTC 5 分钟桶）生成 `evidenceKey`。 | ID 与 URL 归一化单测 |
| DAT-02 | MUST | 正文版本严格按 **`(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")`** 决胜：同批先做单轮确定性归约且不丢较新 `fetchedAt`；胜出 `available` 省略或传入 `null` 字段时用 `COALESCE` 保留已知文本（显式 `""` 除外），`deleted`/`removed` 立即清空正文与搜索投影且禁止落后 `available` 记录复活正文。 | 逆序/平局/防复活 PG 测试 |
| DAT-03 | MUST | 三轴时间彻底分离：`publishedAt`（`content.created_at_source`）、`sourceObservedAt`、`fetchedAt`；缺失值一律存 `null`；所有互动指标显式绑定平台 `metricKey`、真实 `provider` 与 `timeBasis`（缺值维持 `null` 不补 `0`），所有正文携带明确 `textState`（`full` / `summary` / `missing` / `truncated`）。 | 时间与指标口径测试 |
| DAT-04 | MUST | 观测唯一键为 `(contentId, collectionSourceId, provider, evidenceKey)`，`evidenceKey` **严禁掺入读取时刻 `fetchedAt`**；同键同内容重放保持原行并返回 `updated = 0`，同键不同指标返回 `409` 或拒收；混合批内若检测到跨根矛盾或父链成环则整批拒绝，未入库父帖标 `contextMissing = true`。 | 观测幂等与 409 PG 测试 |

## 2. 在线采集（Radar / Hydrate）与外部推流（Ingest）

| ID | 等级 | 采集执行、幂等恢复与外部推流契约 | 验收出口 |
| --- | --- | --- | --- |
| COL-01 | MUST | 逻辑来源复用 `source_collection_job` 承载 `radar`（发现窗）、`hydrate`（指定根帖集合与每帖上限）与 `ingest`（推流回执）；`POST /v1/sources/:id/collect` 强制携带并校验 `Idempotency-Key`（同源同键同体至少 7 天复用同 `job`，同键异体返 `409`），支持 `GET /v1/source-jobs/:id` 及 `POST /v1/source-jobs/:id/{cancel,retry,continue}` 与 `POST /v1/sources/:id/unblock`。 | 幂等与任务操作 E2E |
| COL-02 | MUST | 无稳定上游游标来源（如 `kaix`、`NewsNow`）永远标 `coverage = 'partial'`；仅在当前窗正常取尽或安全游标提交成功时推进 `incrementalTo`（`kaix` 搜索触及 `maxItems` 截断禁止前推水位，失败不推进）；`feed` 遇 `304 Not Modified` 只更新 `lastCheckedAt` 不新增观测；禁止 `item.kind === source.contentKind` 硬锁与 `literal()` 误杀原生布尔式。 | 游标与截断 PG 测试 |
| COL-03 | MUST | 在线接受批上限设为 **`2,000 条 / 16 MiB`**（按最坏 `根帖 × (1 + 每帖评论)` 预留）；对 `kaix`、`red_crawler`、`TwitterAPIs`、`ScrapeBadger` 等声明 `automaticRequestReplay = false` 的来源落实 `starting -> running -> reading -> committed` 状态机；结果未明转 `unknown` 永远停发并需人工确认 `acknowledgePotentialCharge: true` 才可重建任务，停机 `SIGTERM` 仅放回租约不触发 `unknown` 或源封禁。 | 故障与重启恢复 E2E |
| COL-04 | MUST | 基线 R2 `hydrate` 由用户或合规调度显式勾选根帖集合触发（每批建议 <= 30 根、每帖 `<= 50` 评论，`commentSort="top"`），禁止 `maxItems = 0` 或 `maxCommentsPerPost = 0` 无限抓取；全自动后台衍生水合推迟至 Stage 3 经 14 天信号命中率校准后再决定开启。 | 水合边界测试 |
| ING-01 | MUST | `POST /v1/sources/:id/ingest` 仅接收规范化 `NormalizedContentItem[]`（剔除不可信客户端 `id` 由服务端生成确定 UUID），强验证 `ingest` scope、非空允许来源与 `Idempotency-Key`；单批限 **1–100 项、解码体 <= 1 MiB、标题 <= 4 KiB、正文 <= 64 KiB**；整批先验校验（错项 `400` 附下标、超限 `413`、暂停/归档/`pull` 源 `409`）；复用 `source_collection_job` 存回执（迁移显式放宽 `from_at`/`to_at`/`page_size`/`max_pages` `NOT NULL` 并排除出 `pull` 索引），首次写入返 `201`、同键同载重放返 `200`、异体返 `409`。 | 推流边界与 201/200/409 测试 |

### 供应商能力与边界摘要（OpenAPI 详细字段映射见[来源替换规格](research/source_replacement_and_twitterapi_io_removal_spec.md)）

| `provider` | 支持操作与能力 | `refreshByIds` | 关键限制 |
| :--- | :--- | :--- | :--- |
| **`kaix`** | Reddit 搜索、社区、账号与批量 `postUrls` 伴随评论 | `true`（按帖批补） | 异步 run + 轮询（等待兼容 `65s`），解除旧 `100` 条/事件帽限制，`automaticRequestReplay = false` |
| **`red_crawler`** | Reddit 多社区并发搜索（含 `comments`）与评论树 | 按操作声明 | 共用 `APIFY_API_TOKEN`；走真实异步 Run API 轮询（禁止调不存在的同步端点），限制扇出 |
| **`twitterapis`** | X 搜索、时间线、按需 `/replies` 与 `/quotes` | `false` | 约 20 条/页、`maxPages <= 5`；禁用高价 `/tweet/thread`；非数组 `tweets` 判协议错误禁 `?? []` |
| **`scrapebadger`** | X 搜索、时间线、回复/引用（`count 1..100`） | **`true`**（批量查推文） | 时间窗须入 `query`（`since_time:`/`until_time:`）；兼容 `data` 或 `null`；记 `X-Credits-Used` 诊断头 |
| **`newsnow` / `feed`** | 精选榜单 MIT getter；管理员白名单 RSS/Atom | `false` | `ETag`/`304` 条件请求；`rss-parser`/`fast-xml-parser` + HTML 消毒；`undici` IP 绑定防 DNS 重绑定 |

## 3. 统一过滤、信号、讨论树与对比

`ContentFilter` 白名单字段：`platforms`、`kinds`、`sourceIds`、`providers`、`deliveryModes`、`from` / `to`、`timeStatus`、`author`、`language`、`query`（`<= 200` 字符）、`searchMode`、`searchScope`、`anyTerms`（`<= 20`）、`allTerms`（`<= 20`）、`exclusions`（`<= 10`，单条 `<= 100`）、`threadAware`、`signal` 与同平台 `metricKey`/`min`/`max`；`limit` 默认 25 最大 100，非法额外字段一律 `400`。

| ID | 等级 | 过滤、信号与联动比较规则 | 验收出口 |
| --- | --- | --- | --- |
| QRY-01 | MUST | `compileContentFilter(scope, filter)` 为全系统唯一编译入口：有效范围 = `actor允许来源 ∩ 项目关联来源 ∩ 项目filter ∩ 请求filter`，并在单个 `EXISTS(content_discovery JOIN collection_source)` 内完成来源交集；项目与请求的三段词组间取 `AND`（禁止合并成单个平铺 `OR`），词项按 NFKC/Unicode 小写/转义 `LIKE` 求值，每项须含三个连续的 Unicode 字母或数字；时间窗为 UTC 半开区间 `[from, to)`，传 `timeStatus="unknown"` 同时带日期返 `422`。 | 过滤、权限隔离与词边界测试 |
| QRY-02 | MUST | Keyset 游标编入指纹与 `projectRevision`，失效返 `409 cursor_scope_changed`；分页执行非空与空时间双分支 seek。确定性 `signal` 在基线 R2 固定提供 **`discussion`**（Reddit `num_comments >= 10` / X `replies >= 5`）与 **`pain`**（痛点词命中或已知 `score` 下 `num_comments >= max(score, 1)`）；多快照 `growing` 推迟至具备同源时间轴基准的 Stage 3。 | 分页与信号判别测试 |
| QRY-03 | MUST | `threadAware = true` 下先匹配有效证据节点再映射至授权内可见 `anchor`（根帖不在授权范围内降级为节点自身并标 `contextMissing = true`）；只读树接口 `GET /v1/content/:id/thread?view=top|matches|op` 在基线 R2 采用单次有界查询（`LIMIT 200` 节点、32 跳环截断）在应用内存组装三视图；`POST /v1/project-comparisons` 保持统一口径并在跨平台互动比较时返回 `422`。 | 联动、三视图与 422 测试 |

## 4. 权限矩阵、Agent 接入与流式导出

| ID | 等级 | 访问控制、Agent 安全与导出格式契约 | 验收出口 |
| --- | --- | --- | --- |
| SEC-01 | MUST | 主体分三类：`owner`/`admin`（全共享与账户/运维权限，保留最后一位 `owner`）、`viewer`（只读共享 + 自己工作区）与 **`machine` API Key**（扩展 `app_session`、`client_kind='machine'`、SHA-256 `token_hash`、30–90 天过期、`allowed_source_ids` 贯穿全查询与单条详情防枚举 404/403）；统一权限作用域 enum 锁定为 `read` / `projects:write` / `sources:write` / `collect` / `ingest` / `export`（`ingest` Key 禁空来源清单；机器 Key 严禁访问个人研究/账户管理路由）。 | 角色与越权 E2E |
| OP-01 | MUST | 鉴权后访问 `GET /v1/capabilities` 与同源 TypeBox 派生的 `GET /v1/openapi.json`（完整 `operationId`）。**防提示词注入采用技术硬隔离**：向消费不可信抓取正文的外部 AI Agent 默认签发仅含 `read` + `export` 作用域的只读 Key，使其在权限层物理无法触发 `collect` 或修改来源。错误信封统一为 `{ error: { code, message, requestId, details?, retryable, nextAction? } }`。 | Capabilities 与隔离测试 |
| EXP-01 | MUST | `GET /v1/content/export?format=csv|json` 默认上限 `10,000`、硬上限 `50,000`，强制**全局与单用户并发 `1` 信号量**（冲突返 `429 + Retry-After`）；采用 `pg-query-stream` + Node `stream.pipeline` 在 `REPEATABLE READ READ ONLY` + `SET LOCAL idle_in_transaction_session_timeout = '35s'` 内写出并标记 `released=true`（禁止 `COMMIT` 后再执行 `ROLLBACK`）；设置 `X-Accel-Buffering: no`。JSON 在 `COMMIT` 后追加 `{result: {exportedCount, truncated, nextCursor, complete: true}}`；**CSV 严格遵守 RFC 4180，只输出正文数据行、文本化雪花/Reddit ID 与 OWASP 公式中和（严禁插入破坏通用 CSV 解析器的伪终结行），中途异常直接 `reply.raw.destroy()` 中断分块响应**。 | 并发导出、断流与 RFC 4180 测试 |

## 5. 标准化 HTTP 路由总览

| 资源域 | 标准化接口路径（不额外搭建第二套 Agent 接口） |
| :--- | :--- |
| **账户与发现** | `POST /v1/auth/login`、`GET /v1/auth/session`、`POST /v1/auth/logout`、`POST /v1/auth/register`、`GET /v1/capabilities`、`GET /v1/openapi.json`、`GET/POST /v1/access-tokens`、`DELETE /v1/access-tokens/:id` |
| **项目与对比** | `GET/POST /v1/projects`、`GET/PATCH/DELETE /v1/projects/:id`、`PUT /v1/projects/:id/sources`、`GET /v1/projects/:id/overview`、`GET /v1/projects/:id/content`、`POST /v1/project-comparisons` |
| **来源、任务与推流** | `GET/POST /v1/sources`、`GET/PATCH /v1/sources/:id`、`POST /v1/sources/:id/{pause,resume,archive,collect,ingest,unblock}`、`GET /v1/source-jobs`、`GET /v1/source-jobs/:id`、`POST /v1/source-jobs/:id/{cancel,retry,continue}` |
| **内容、讨论树与导出** | `GET /v1/content`、`GET /v1/content/:id`、`GET /v1/content/:id/thread`、`GET /v1/content/export` |
| **工作区与运维** | `/v1/content-saved-queries` 及单条操作、`/v1/content-annotations` 及单条操作、`GET /v1/source-ops`、`GET/PATCH /v1/source-provider-budgets/:provider` |
