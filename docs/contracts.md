# 主线数据与 API 契约（STD-100）

结构体与校验真源为 [source-content.ts](../packages/contracts/src/source-content.ts)、[content-stories.ts](../packages/contracts/src/content-stories.ts) 、[product-docs.ts](../packages/contracts/src/product-docs.ts) 与 [web-boards.ts](../packages/contracts/src/web-boards.ts)，运行时自动派生至 `GET /v1/openapi.json`。下文严格标记 `[LIVE]`（主干已实现，生产部署见[状态](status.md)）与 `[V2]`（规划契约）。

---

## 1. `[LIVE]` 领域模型与事件 API

| 领域概念 | 数据库映射与唯一契约语义 |
| :--- | :--- |
| **`Platform`** | 内容源大类（`reddit`、`x`、`bluesky`、`web`），对应 `source` 表。 |
| **`Provider`** | 采集渠道实现（`feed`、`newsnow`、`kaix`、`red_crawler`、`twitterapis`、`scrapebadger`、`bluesky_appview`、`external_ingest`）。 |
| **`CollectionSource`** | 逻辑监测源（`collection_source`）；`050` 已上线字段：`tier`（`T1`/`T1_5`/`T2`）、`ownerEntityId`、`sourceGroup`、`tags`（`<=20`）、`locale`、`fetchPolicy`（`maxItems 1..100`、`timeoutMs 3000..15000`、`stripTrackingParams`）、`http_etag`/`http_last_modified` 与诊断 `health`。 |
| **`Project`** | 研究专题（`monitor_project` + `monitor_project_source`）；绑定逻辑来源范围、本地三段词、`threadAware` 与 `includePushInTrends`，不复制正文。 |
| **`Content`** | 去重内容主表（`content`），业务身份由 `(source_id, kind, external_id)` 唯一确定；`content.language` 写时自动兜底识别，`platform_details`（`web`）含 `channel` 与 `textCompleteness`（`full` \| `summary` \| `title_only`）。 |
| **`Discovery` / `Observation`** | 多源发现关联（`content_discovery`）与按 `(content_id, collection_source_id, provider, evidence_key)` 隔离的时序指标快照（`content_observation`）；同 `payload_hash` 重放静默忽略防死元组。 |

### 已交付的事件 API

- **`[LIVE]` `GET /v1/content/stories?view=latest\|hot\|digest`**：复用 `read` 权限与 `allowedSourceIds` 隔离；支持 `sourceId`、`platform`、`sourceGroup`、`tier`、`language`、`date`（`YYYY-MM-DD`，仅 `digest`）与 `limit`（`1..100`，默认 `30`）、`offset`（`0..500`）。默认全范围在 `30s` 槽内共享聚合并在异常时驱逐坏槽；附带过滤或受限机器 Key 走独立查询。响应为已存样本，每种排序最多保留 600 个事件。聚合每进程最多 3 路，单窗超过 10,000 个可见来源关联返回 `503`，不会以截断后的候选排名冒充完整窗口。
- **`[LIVE]` 归组与热度算法**：基于规范 URL（arXiv、GitHub Release/Issue 等）+ 标题词项 + 数字版本分桶 + 64-bit SimHash（4×16-bit LSH）聚簇；代表选举按 **`T1 > T1_5 > T2` → 英文原题优先 → 有正文 → 发布/发现时间**；返回代表报道与最多 6 条 `related`。48h 热度按独立主体计最大衰减权重（`T1=3.0`/`T1_5=2.0`/`T2=1.0`，24h 半衰期）；仅两端存在可比源（非逾期停采且接入 `>=6h`）才输出 `trend: up\|down\|flat\|new`，否则返回 `trend: 'unknown'`。
- **`[LIVE]`**：事件响应的 `tierBreakdown` 按等级统计最近 48 小时簇内可见采集源 ID（各等级内去重）。`sparkline48h` 以响应 `to` 为终点，按从早到晚排列 8 个左闭右开的 6 小时桶。每桶按发布/发现时间归入截至 `to` 可见的证据，并用桶末时间计算衰减，每个独立主体取该桶最大权重。空桶为 0，表示已存样本无贡献。
- **`[LIVE]`**：`GET /v1/sources/budgets` 为管理员返回 UTC 日/月请求次数和预留记录数，供额度计量与告警使用。
- **`[LIVE]`**：专题概览新增 `dayPlatformFacets: [{ day, platform, count, matchedContentCount }]`，使用 UTC 日界线，与现有分面共享采集范围及讨论串去重口径。仅返回存在命中且日期已知的日与平台组合。

---

## 2. 核心规则契约（`SRC` · `DAT` · `COL` · `ING` · `QRY` · `SEC` · `EXP`）

### SRC-01–03：逻辑来源与渠道能力

| ID | 等级 | 逻辑来源、主备策略与能力声明 | 验收出口 |
| --- | --- | --- | --- |
| SRC-01 | MUST | 逻辑来源唯一索引为 `uq_collection_source_identity (platform_id, primary_provider, content_kind, target)`；创建后 `deliveryMode`（`pull`\|`push`）不可变；`Target` 支持 `search`、`community`、`account`、`post`、`feed`（RSS/Atom + `web_list` + `json_list`）。 | PG 唯一约束与 Schema 测试 |
| SRC-02 | MUST | 备源仅支持 `twitterapis -> scrapebadger` 与 `kaix -> red_crawler`（仅限定时任务首次请求明确失败/429 且无已计费 Run 时单跳切备）；正常空结果、`partial` 或状态 `unknown` 付费调用 `MUST NOT` 自动切备或重放。 | 失效策略与停发单测 |
| SRC-03 | MUST | 连接器显式声明 `operations` 与 `refreshByIds`；批量追踪 X 人物优先使用 `from:u1 OR from:u2` 批次搜索并按真实 `content_author` 归属，`MUST NOT` 暗中拆成 N 次付费调用。 | 能力边界与批次单测 |

### DAT-01–04：身份、版本元组、时间轴与指标

| ID | 等级 | 内容规范化、版本比较与快照口径 | 验收出口 |
| --- | --- | --- | --- |
| DAT-01 | MUST | `externalId` 统一字符串防精度丢失；X 主帖与回复同属 `kind='post'`；`web` 剥离 `utm_*`/`fbclid`/`gclid`/`spm`/`ref` 后规范化 URL；**`newsnow` 自 `8e436ac` 起仅在存在 `web.rank` 或其他 `metrics` 时采用 UTC 1 小时快照桶（`floor(fetchedAt / 3600000)`）生成 `evidenceKey`（无 `rank`/`metrics` 的榜单如 `google-trends-us` 与 `v2ex-share` 不纳入小时桶）**，内置 6 个 `webBoards` 见 `web-boards.ts`。 | URL 规范化与快照桶单测 |
| DAT-02 | MUST | 版本决胜三元组严格为 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")`；同键同版本冲突抛 `409`；`deleted`/`removed` 清空正文并禁止落后 `available` 复活。 | 乱序/平局/防复活 PG 测试 |
| DAT-03 | MUST | 三轴时间 `publishedAt`、`sourceObservedAt`、`fetchedAt` 彻底分离（未知存 `null`）；指标携带命名空间键名（`reddit.score`/`x.likes`/`web.rank`/`web.views`/`web.likes`）；**`contentFromRow` 仅由 `body_text` 与 `platform_details.textCompleteness === 'summary'` 派生对外 `textState`（`full`\|`summary`\|`missing`），库内不存在 `platform_details.textState`**。 | 时间轴、指标与 `textState` 单测 |
| DAT-04 | MUST | `content_observation` 唯一键 `(content_id, collection_source_id, provider, evidence_key)`：同键同 `payload_hash` 静默忽略并计 `updated=0`，同键异值返 `409`；回复缺父链时由 `thread.ts` 标 `contextMissing = true`。 | 观测幂等与 409 PG 测试 |

### COL-01–04 & ING-01：采集、预览、导入、水合与推流

| ID | 等级 | 采集、幂等、选择器配置与推流契约 | 验收出口 |
| --- | --- | --- | --- |
| COL-01 | MUST | `POST /v1/sources/:id/collect` 强制校验 `Idempotency-Key`（同源同键同体复用 `job`，同键异体返 `409`；普通任务清理保留幂等回执）；`POST /v1/sources/preview` 对启用中 `feed`/`newsnow` 真实试抓前 20 条并嗅探页面 RSS；`POST /v1/sources/import` 支持最多 200 条 JSON 或 `<=512 KiB` OPML 2.0 幂等批量导入；`web_list` 支持有限 CSS 选择器（标签/类/ID/后代/`>`），`json_list` 支持点路径映射（顶层数组 `items: "$"`），均自前 200 候选截取。 | 幂等、预览与导入 E2E |
| COL-02 | MUST | 无游标渠道永标 `coverage='partial'`；**`feed` 单次限 `100`（`fetchPolicy.maxItems`），首次未检查源仍限 8 条防刷屏；遇 `304 Not Modified` 保持 `last_success_at` 不变，更新 `last_checked_at`、`incremental_to`、退避 `next_due_at`/`schedule.intervalSeconds`、缓存头与 `health`**；**`Bluesky` 按上游游标翻页并仅本地按 `from` 过滤，不因越过时间窗提前停页**；`[V2]` 为超 48h 历史条目增加首页防刷屏门控。 | 304 退避与 Bluesky 翻页单测 |
| COL-03 | MUST | 在线批接收上限 `2,000 条 / 16 MiB`；付费源执行 `starting -> running -> reading -> committed` 状态机（`kaix` 支持异步轮询兼容 `65s`）；`twitterapis` 单页自动钳制 `<=20`；`scrapebadger` 兼容 `{ data \| null, next_cursor }` 并记 `X-Credits-Used`；结果 `unknown` 立刻自动阻断该源，须传 `acknowledgePotentialCharge: true` 人工解封；`SIGTERM` 只释放租约保留 `runId`。 | 断线恢复与付费阻断 E2E |
| COL-04 | MUST | `[LIVE]` `POST /v1/projects/:id/hydrate` 每次限 30 根帖 × 50 评论，**当前实现仅支持 `kaix`（`projects/routes.ts:34` 与 `hydrate.ts` 锁定，`red_crawler` 仅用于 `scheduled` 采集备源）**；`[V2 Phase D]` 按题动态探索 `POST /v1/discovery/query` 拆解 4 正交槽分波写入 `stream_class='adhoc'` 系统源，支持一键转 `pull`。 | 批量水合与探索测试 |
| ING-01 | MUST | `POST /v1/sources/:id/ingest` 为 L3 外部 Sidecar 与 R4 `plugins/zst-archive/` 的唯一推流入口；强校验 `ingest` scope、非空 `allowedSourceIds` 与 `Idempotency-Key`；输入 `ContentItem` 的 `id` 字段可选（服务端确定性生成）；单批限 `1..100` 项且解码体 `<=1 MiB`；首次返回 `201`、重放同载体 `200`、异体 `409`。 | 推流边界与 201/200/409 E2E |

- **`[LIVE]` 项目采集预检**由 `POST /v1/research/collection-plans/preview` 提供，返回目标匹配、阻断原因、首轮用量估算、可见存量、授权批次和有效字段权限。带 `projectId` 的预检和采集提交均要求有项目写权限的浏览器会话。Viewer 的可见存量按共享及本人批次统计，选择备用渠道须经有效套餐授权。预检期间的额度为查询时估算，提交时重验套餐与配额，执行时由 Worker 按既有预算与租约规则预留渠道资源。

### 安全加固候选分支的认证契约

`GET /v1/access/invites` 列出最多 50 条当前角色负责的邀请状态，响应不含邀请码和收件人邮箱。`DELETE /v1/access/invites/:id` 撤销同一权限范围内的邀请，已发邮件链接在完成注册时重新校验邀请状态。

启用邮件服务后，`POST /v1/auth/email/{register,reset}/{start,finish}` 受理注册和找回，`POST /v1/auth/email/verify/{start,finish}` 用于已有账号验证。开始请求绑定 Turnstile action 与站点域名，找回与注册返回统一受理响应。完成请求的 token 15 分钟内单次使用，注册时才接收新密码。`POST /v1/auth/password/change` 需 Viewer 会话和当前密码，密码修改与找回同时撤销该账户的浏览器会话和机器 Key。绑定邀请仅能由相同邮箱完成，并在建号事务中消费。管理员找回走离线运维恢复。

已登记 MFA 的用户登录返回 HTTP 202 与五分钟预认证挑战。必须经 `POST /v1/auth/mfa/complete` 校验 TOTP 或一次性恢复码才签发浏览器会话。`POST /v1/auth/mfa/step-up` 只接受 TOTP，成功后该浏览器五分钟内可执行管理员写操作。`POST /v1/auth/mfa/recovery-codes` 需要同一浏览器近期 TOTP 验证，一次显示 8 个新恢复码并使旧码失效。预认证挑战和恢复码都不能授予管理员写操作。

浏览器登录和注册使用同源 JSON，请求体上限 8 KiB，`/v1/auth/*` 拒绝 Bearer。退出始终清除浏览器 Cookie，过期会话也可退出。新会话默认最长 24 小时，Viewer 可通过可选布尔值 `remember` 启用最长 30 天的持久 Cookie。Viewer 默认空闲 2 小时，记住登录时空闲 7 天。Owner/Admin 空闲 30 分钟。活跃时间最多每 5 分钟更新一次。已有 7 天浏览器会话遵循原到期时间，机器 Key 沿用原始期限。候选分支新增 `GET /v1/auth/sessions`、`DELETE /v1/auth/sessions/:id` 和 `POST /v1/auth/logout-all`，仅操作当前用户的浏览器会话，列表最多 100 项并且只返回会话 ID、设备通用标签、时间和当前标记。撤销指定会话对他人的 ID 响应相同，退出全部浏览器保留机器 Key。

### QRY-01–03、SEC-01、OP-01、EXP-01：过滤、讨论树、权限与流式导出

| ID | 等级 | 查询、三视图、开放接口与导出规则 | 验收出口 |
| --- | --- | --- | --- |
| QRY-01 | MUST | `compileContentFilter` 编译权限交集、`sourceGroup`/`tier`/`language`/`hasMedia`、`from`/`to`（UTC 半开）、三段词与 `signal`（`discussion`\|`pain`）；`>=3` 连续字符走 `pg_trgm`，2 字中文/短代号走 `public_search_bigrams` GIN 后精确回表匹配；`[V2]` 引入 `stream_class` 前，默认流/趋势仅查 `pull`。 | 多维过滤与 GIN 命中 PG 测试 |
| QRY-02 | MUST | 列表采用 Keyset Seek 游标并在范围/项目 `revision` 变化时返 `409 cursor_scope_changed`；`GET /v1/content/facets` 强校验正区间 `<=90` 天，单 CTE 输出 `day`\|`6h`、`byPlatform` 与 `kinds`。 | 游标与分面 PG 测试 |
| QRY-03 | MUST | `threadAware=true` 归约至可见 `anchor`；`GET /v1/content/:id/thread?view=top\|matches\|op` 递归上限 32 跳、返回上限 200 节点；`[V2]` `POST /v1/project-comparisons` 仅基于 GIN 词项/项目对比内容量与事件热度，跨平台对比原分数返回 `422`。 | 嵌套闭包三视图 E2E |
| SEC-01 | MUST | 主体分 `owner`/`admin`、`viewer` 与 `machine` API Key；作用域枚举 `read`、`sources:write`、`projects:write`、`collect`、`ingest`、`export`；**`/v1/content/*` 仅 `GET/HEAD` 映射为 `read` scope**，`machine` Key 禁访 `/v1/access/*`、`/v1/workspace/*`、`/v1/sources/credentials*` 与 `/v1/quotas/*`；`viewer` 仅在 `plan_collection_policy` 显式授权与个人额度内可触发手动采集与本人任务控制。 | 角色越权与 Scope 边界 E2E |
| OP-01 | MUST | 鉴权提供 `/v1/capabilities` 与 `/v1/openapi.json`；任何 AI/Agent 均把抓取正文视作不可信数据，且 `[V2]` 产费操作（含 `/content/:id/enrich` 与 `/discovery/query`）只接受浏览器管理员或专用受限写授权，严禁向只读 `read` Key 暴露。 | Capabilities 与安全边界测试 |
| EXP-01 | MUST | `GET /v1/content/export?format=csv\|json` 默认 1 万、上限 5 万行，单进程单槽并发锁（冲突 `429 + Retry-After: 5`）、`30s` 超时、`REPEATABLE READ READ ONLY` + `pg-query-stream` 流式写出；JSON 尾块验真 `complete: true`，CSV 遵守 RFC 4180 并中和 `=+-@` 公式注入。 | 并发导出、断流与 CSV 注入测试 |

---

## 3. 全量 HTTP 路由注册清单（`[LIVE]` 随 `/v1/openapi.json` 导出）

| 资源域 | `[LIVE]` 已注册并随 `/v1/openapi.json` 导出 | `[V2]` 规划增补路由（Phase B–D，当前未注册） |
| :--- | :--- | :--- |
| **系统与元信息 (4)** | `GET /healthz`、`GET /readyz`、`GET /v1/openapi.json`、`GET /v1/capabilities` | — |
| **Access 鉴权 (11)** | `GET /v1/auth/session`、`POST /v1/auth/{login,register,logout}`、`GET/POST /v1/access/keys`、`DELETE /v1/access/keys/:id`、`POST /v1/access/invites`、`GET/PATCH /v1/access/users*`、`GET /v1/access/audit` | — |
| **Collection & Quotas (26)** | `GET /v1/public/sources`、`GET/POST /v1/sources`、`POST /v1/sources/{preview,import}`、`PATCH /v1/sources/:id`、`GET /v1/sources/budgets`、`PUT /v1/sources/budgets/:provider`、`GET /v1/sources/credentials`、`PUT/DELETE /v1/sources/credentials/:provider`、`POST /v1/sources/credentials/:provider/test`、`GET /v1/quotas/summary`、`PUT /v1/quotas/{plans/:tier,users/:id}`、`POST /v1/sources/:id/{collect,ingest,refresh,unblock}`、`GET /v1/sources/:id/jobs`、`GET /v1/source-jobs`、`GET /v1/source-jobs/recent`、`GET /v1/source-jobs/:id`、`POST /v1/source-jobs/:id/{cancel,retry,continue}` | `GET /v1/sources/budgets` 可选增配 `ai_enrich` 预算行 |
| **Content (8)** | `GET /v1/content`、`GET /v1/content/{feed,facets,stories,export}`、`GET /v1/projects/:id/content`、`GET /v1/content/:id`、`GET /v1/content/:id/thread` | Phase D：`POST /v1/content/:id/enrich`（禁只读 `read` Key） |
| **Projects (8)** | `GET/POST /v1/projects`、`GET/PATCH/DELETE /v1/projects/:id`、`GET /v1/projects/:id/overview`、`POST /v1/projects/:id/hydrate` | Phase B：`POST /v1/project-comparisons`；Phase D：`POST /v1/discovery/query` & `GET /v1/discovery/jobs/:id` |
| **Docs 文档中心 (6)** | `GET /v1/docs`、`GET /v1/docs/:slug`、`GET /v1/docs/:slug/file`、`POST /v1/docs`、`PATCH /v1/docs/:id`、`DELETE /v1/docs/:id`（已发布文档可用浏览器会话、带 `read` 的机器 Key 访问，开启公开读后也可匿名访问；草稿与写操作限 `owner`/`admin` 浏览器会话） | — |
| **Workspace (7)** | `GET/POST /v1/workspace/queries`、`DELETE /v1/workspace/queries/:id`、`GET /v1/workspace/annotations`、`GET/PUT /v1/workspace/annotations/:id` | Phase B：水位线与解耦 `readAt`/`muted`/`tags` 扩展、评论节点级独立批注 |
| **AI Catalog Public (8)** | `GET /v1/ai/vendors`、`GET /v1/ai/models`、`GET /v1/ai/models/:id`、`GET /v1/ai/events`、`GET /v1/ai/events/:id`、`GET /v1/ai/updates`、`GET /v1/ai/rankings`、`GET /v1/ai/rankings/:id`（均受 `PUBLIC_READ_ENABLED` 白名单显式控制，无通配放行） | 第三方授权榜单待配置 `ARTIFICIAL_ANALYSIS_API_KEY`；可选 LLM 辅助抽取默认关闭且受 `AiLlmExtractionSchema` 严格校验 |
| **AI Review Admin (23)** | `GET /v1/admin/ai/queue`、`PATCH /v1/admin/ai/candidates/:id`（`expectedRevision` 409 乐观锁）、`POST /v1/admin/ai/candidates/:id/{publish,reject}`、`POST /v1/admin/ai/candidates/bulk-dismiss`、`POST /v1/admin/ai/events/:id/unpublish`、`PATCH /v1/admin/ai/events/:id`、`POST /v1/admin/ai/{models,aliases}`、`GET /v1/admin/ai/{sources,sync-runs,history/status}`、`POST /v1/admin/ai/sources/:code/sync`、`GET/PUT /v1/admin/ai/vendor-sources`、`DELETE /v1/admin/ai/vendor-sources/:sourceId/:vendorId`、`POST /v1/admin/ai/discovery/run`、`GET /v1/admin/ai/ops/{summary,audit}`、`POST /v1/admin/ai/events/:id/rollback`、`GET /v1/admin/ai/rankings`、`PATCH /v1/admin/ai/vendors/:id/autopublish`、`POST /v1/admin/ai/alerts/:id/resolve`（仅限 `owner` 或 `admin` 浏览器会话。厂商绑定管理适用于 Web 文章 Pull 来源，发现继续核验官方域名） | 历史冷启动 CLI（`ai:history:validate\|plan\|apply\|backfill`）离线导入 `data/ai/history/v1/`；`AI_SYNC_ENABLED=true` 时按源到期调度（`official_discovery` 30min + 注册表源 2h/24h，默认关闭） |
