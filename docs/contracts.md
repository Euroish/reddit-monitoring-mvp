# 数据模型、接口规则与路由契约

数据结构体与 Schema 的唯一编程真源位于 [packages/contracts/src/](../packages/contracts/src/)（按域拆分为 `common`、`access`、`content`、`collection`、`feed`、`intelligence`、`projects`、`content-stories`、`product-docs`、`ai-catalog`、`web-boards` 及兼容导出 `source-content`），运行时自动编译至 **`GET /v1/openapi.json`**，并由 `npm run check:openapi` 强制校验。

---

## 1. 核心领域契约语义

| 领域概念 | 核心标识与不可变约束 |
| :--- | :--- |
| **`Platform` / `Provider`** | 平台 `reddit` \| `x` \| `bluesky` \| `web`；渠道 `feed` \| `newsnow` \| `kaix` \| `red_crawler` \| `twitterapis` \| `scrapebadger` \| `bluesky_appview` \| `external_ingest`。 |
| **`CollectionSource`** | 唯一键 `(platform_id, primary_provider, content_kind, target)`；创建后 `deliveryMode`（`pull` \| `push`）不可变；V2 新增 `feed_lane`（`discussion` \| `release` \| `monitor_only` \| `news`）与 `quality_grade`。`usageDomain`（`research` / `feed`）区分采集管理工作区，`feedLane` 控制推荐分发，两者独立，旧客户端省略 V2 字段的 PATCH 保留原值。 |
| **`Content`** | 业务身份 `(source_id, kind, external_id)`（外部 ID 统一字符串，X 主帖与回复同属 `post`）。版本决胜三元组 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")`；同键同版本内容冲突抛 `409`；`deleted`/`removed` 清空正文且禁止落后版本复活。对外 `textState`（`full` \| `summary` \| `missing`）由正文与 `platform_details.textCompleteness` 派生。 |
| **`Observation`** | 时序快照按 `(content_id, collection_source_id, provider, evidence_key)` 唯一存储；同 `payload_hash` 重放静默忽略（`updated=0`），同键异值返 `409`；`newsnow` 仅在携带 `web.rank` 或其他指标时使用 UTC 1 小时快照桶生成 `evidenceKey`。 |
| **批次与项目** | `collection_batch` / `collection_batch_item` 属于采集域，`monitor_project_batch` 属于项目域。批次型项目只读启用且授权的批次，Viewer 仅可见共享或本人批次，内容查询在同一 discovery 上求批次来源与来源过滤的交集。 |
| **三轴时间** | `publishedAt`、`sourceObservedAt`、`fetchedAt` 彻底分离，未知原始时间保持 `null`。 |

---

## 2. 认证、会话、MFA 与 Scope 权限边界

| 维度 | 契约规则 |
| :--- | :--- |
| **主体层级** | `owner` / `admin` 浏览器管理员、`viewer` 浏览器受限用户、`machine` API Key（支持绑定非空或受限 `allowedSourceIds`）。 |
| **Machine Key Scopes** | `read`、`sources:write`、`projects:write`、`collect`、`ingest`、`export`。**`/v1/content/*` 仅 `GET/HEAD` 允许映射 `read` scope**；Machine Key 永不可调用 `/v1/auth/*`、`/v1/access/*`、`/v1/admin/*`、`/v1/workspace/*`、`/v1/quotas*`、`/v1/sources/credentials*`、`/v1/feed/events` 与 `/v1/feed/preferences*`。 |
| **浏览器会话与安全** | 登录/注册限同源 JSON（`<= 8 KiB`）且 `/v1/auth/*` 拒绝 Bearer；标准会话 24h（`remember=true` 时 Viewer 最长 30 天），空闲超时 Admin 30 分钟 / Viewer 2 小时（记住登录 7 天）；支持列出会话（最多 100 条）、吊销单个会话及退出全部浏览器（保留 Machine Key）。 |
| **邮件挑战与管理员 MFA** | 邮件注册/重置/验证 Token 15 分钟单次有效且绑定 Turnstile；启用 MFA 的账户登录返回 `202` 预认证挑战，需经 `POST /v1/auth/mfa/complete`（TOTP 或 8 组一次性恢复码之一）才签发会话；管理员写敏感配置需 5 分钟内 TOTP `step-up`。 |

---

## 3. 采集幂等、检索游标与流式导出

1. **采集与付费熔断**：`POST /v1/sources/:id/collect` 强校验 `Idempotency-Key`（同源同键同体复用 `job`，异体返 `409`）；`POST /v1/sources/:id/ingest` 接收 `1..100` 条且解压体 `<= 1 MiB`（首次 `201`、重放同载体 `200`、异体 `409`）。仅当首次付费请求明确失败/429 且无已计费 Run 时允许单跳切备（`twitterapis -> scrapebadger`、`kaix -> red_crawler`）；`unknown` 状态立即阻断来源，须显式 `acknowledgePotentialCharge: true` 解封。
2. **检索、分面与讨论树**：`compileContentFilter` 统一在权限交集内编译三段词、双字词 GIN、`sourceGroup`/`tier`/`language`/`hasMedia`/`signal` 与 `[from, to)`；列表使用 Keyset 游标（范围或项目 `revision` 变化返 `409 cursor_scope_changed`）；`/v1/content/facets` 强校验正区间 `<= 90` 天；`/v1/content/:id/thread?view=top|matches|op` 递归上限 32 跳、返回上限 200 节点，断链标 `contextMissing = true`。
3. **研究采集预检**：`POST /v1/research/collection-plans/preview` 返回 `restrictions`、字段权限、可见存量与预算估算。提交与执行分别重验项目权限、套餐、配额及供应商预算。`GET /v1/batches?forProjectId=` 仅返回有项目写权限、授权、非空且尚未关联的研究批次。
4. **流式导出**：`GET /v1/content/export?format=csv|json` 默认 1 万、上限 5 万行，`REPEATABLE READ READ ONLY` + 全局单槽锁（冲突 `429 + Retry-After: 5`）；JSON 结尾输出 `{ complete: true }`，CSV 中和 `=+-@` 公式注入。

---

## 4. V2 产品 BFF 接口契约（已注册 OpenAPI · 详见 [蓝图](plans/backend-v2-blueprint.md)）

### 4.1 信息流与热榜（`/v1/feed/*` · 5 路径 / 6 操作）

- **`GET /v1/feed/stream`（`public_read` + `read`）**：Query 支持 `mode=foryou|hot|following|explore`、`topic`、`platform`、`language`、`includeNews`、`limit`（`1..40`）、`excludeIds`、`seed`。直出标准化 `FeedCard`（含 `cardLayout`、`headline`、`clean_excerpt`/`tldr`、`media`、`discussion`、`author`、`source`、`topCommentsPreview`、`intentTag`、`reason`、`viewerState`），匿名用户自动切入非个性化高价值混排。
- **`GET /v1/feed/hot`（`public_read` + `read`）**：跨平台 `unifiedHeat`（0..100 百分位归一化）排行榜，支持 `window=6h|24h|48h|7d`、`platform`、`topic`、`limit`（`1..60`）、`offset`。`sparkline` 取过去 48 小时每 6 小时段内最新的真实互动快照，以时间升序返回互动分，允许空数组或单点。`corroborationCount` 为当前候选集内同一故事聚簇的独立信源数。
- **`POST /v1/feed/events`（`authenticated` 浏览器）**：批量上报最多 50 条曝光与行为事件（`impression|dwell|open|bookmark|useful|dismiss|mute_*`），事务更新已读防重与 14 天半衰期兴趣权重（`[-2.0, +2.0]` 钳位）。同一用户对同一内容的 `bookmark` 和 `useful` 各生效一次，`accepted` 返回实际新入库的事件数。
- **`GET` / `PATCH /v1/feed/preferences` & `POST /v1/feed/preferences/reset`（`authenticated` 浏览器）**：管理破茧探索滑块（`exploreRatio: 0..0.5`）、关注主题与屏蔽列表及一键重置。

### 4.2 Semrush 级社媒与 GEO 智能监测（`/v1/intelligence/*` · 10 路径 / 13 操作）

- **监测生命周期**：`GET/POST /v1/intelligence/monitors`、`GET/PATCH/DELETE /v1/intelligence/monitors/:id`（`revision` 乐观锁），统一支撑 `keyword`、`author_list`（15–20 个 X 账号自动拼批）与 `community_bundle`，单日单项上限 `20,000`。
- **监测器归属**：普通浏览器账号只可访问本人监测器。管理员和所有者的浏览器会话可跨账号管理。Machine Key 仅可访问所属账号的监测器，关联来源必须全部在 Key 范围内，并继续受相应接口的 scope 约束。监测器明细、写入和按监测器统计统一执行相同的访问规则。
- **托管建源准入**：监测器新建、目标与周期配置、重新启用当前仅开放给管理员浏览器会话。普通用户可停用、删除和手动采集本人已有监测器，手动采集沿用套餐准入。监测器不得重新激活已停用来源。
- **托管调度生命周期**：监测器新建来源时记录托管归属。多个已启用监测器共用一个托管来源时采用最短周期，沿用来源调度的 12 小时周期上限。没有启用引用时，停止定时并取消尚未发起渠道请求的排队任务，保留来源和历史数据。既有或管理员自建来源的调度保持独立。升级已经应用 `063` 的环境时，运维须核对历史监测来源及无人引用的启用调度。
- **预算门控采集**：`POST /v1/intelligence/monitors/:id/estimate`（Pre-flight 预估请求数与条目预算）与 `POST /v1/intelligence/monitors/:id/collect`（强制 `Idempotency-Key`）。已启用的 `community_bundle` 在社区拉取成功后，以近 7 日已观测主帖评论量计算 P80。每次最多入队一条超过阈值的主帖，补采最多 15 条 Top 评论，受监测器 UTC 日预算、账户配额、系统日上限与供应商预算约束。
- **单请求仪表盘与下钻**：`GET /v1/intelligence/monitors/:id/overview`（`days <= 90`、`bucket=6h|1d` 返回趋势、SoV、意图占比、GEO 高频外链域名榜（含获正向评分的评论，每个域名在同一条评论中计一次）、高频词与诚实样本覆盖声明）、`.../posts`（多维排序下钻）、`GET /v1/intelligence/authors` / `.../authors/:platform/:handle`（KOL 聚合与单人画像，个人互动率基于可见历史样本，计入点赞或分数、评论、转发、收藏）、`GET /v1/intelligence/communities` / `.../communities/:subreddit`（多板块象限对比与单板块 7×24 热力图/Flair/精华流）。

---

## 5. 已注册全量 HTTP 路由清册（`check:openapi` 实测：`122` 路径 / `140` 操作）

| 资源域（路径 / 操作） | 已注册路由端点 |
| :--- | :--- |
| **System (4 / 4)** | `GET /healthz`、`GET /readyz`、`GET /v1/capabilities`、`GET /v1/openapi.json` |
| **Access (24 / 26)** | `GET /v1/auth/session`、`POST /v1/auth/{login,register,logout,logout-all}`、`GET /v1/auth/sessions`、`DELETE /v1/auth/sessions/:id`、`POST /v1/auth/password/change`、`POST /v1/auth/email/{register,reset,verify}/{start,finish}`、`POST /v1/auth/mfa/{complete,recovery-codes,step-up}`、`GET/POST /v1/access/keys`、`DELETE /v1/access/keys/:id`、`GET/POST /v1/access/invites`、`DELETE /v1/access/invites/:id`、`GET /v1/access/users`、`PATCH /v1/access/users/:id`、`GET /v1/access/audit` |
| **Collection & Quotas (27 / 30)** | `GET /v1/public/sources`、`GET/POST /v1/sources`、`PATCH/DELETE /v1/sources/:id`、`POST /v1/sources/{preview,import}`、`POST /v1/sources/:id/{collect,ingest,refresh,unblock}`、`GET /v1/sources/:id/jobs`、`GET /v1/sources/budgets`、`PUT /v1/sources/budgets/:provider`、`GET /v1/sources/credentials`、`PUT/DELETE /v1/sources/credentials/:provider`、`POST /v1/sources/credentials/:provider/test`、`GET /v1/source-jobs`、`GET /v1/source-jobs/recent`、`GET /v1/source-jobs/:id`、`POST /v1/source-jobs/:id/{cancel,retry,continue}`、`GET /v1/quotas/summary`、`PUT /v1/quotas/plans/:tier`、`PUT /v1/quotas/users/:id`、`GET /v1/batches`、`PATCH /v1/batches/:id/visibility`、`POST /v1/research/collection-plans/preview` |
| **Content (8 / 8)** | `GET /v1/content`、`GET /v1/content/{feed,facets,stories,export}`、`GET /v1/projects/:id/content`、`GET /v1/content/:id`、`GET /v1/content/:id/thread` |
| **Feed [V2] (5 / 6)** | `GET /v1/feed/{stream,hot}`、`POST /v1/feed/events`、`GET/PATCH /v1/feed/preferences`、`POST /v1/feed/preferences/reset` |
| **Intelligence [V2] (10 / 13)** | `GET/POST /v1/intelligence/monitors`、`GET/PATCH/DELETE /v1/intelligence/monitors/:id`、`POST /v1/intelligence/monitors/:id/{estimate,collect}`、`GET /v1/intelligence/monitors/:id/{overview,posts}`、`GET /v1/intelligence/authors`、`GET /v1/intelligence/authors/:platform/:handle`、`GET /v1/intelligence/communities`、`GET /v1/intelligence/communities/:subreddit` |
| **Projects (6 / 10)** | `GET/POST /v1/projects`、`GET/PATCH/DELETE /v1/projects/:id`、`GET /v1/projects/:id/overview`、`POST /v1/projects/:id/hydrate`、`GET/POST /v1/projects/:id/batches`、`PATCH /v1/projects/:id/batches/:batchId` |
| **Docs (4 / 6)** | `GET/POST /v1/docs`、`GET /v1/docs/:slug`、`GET /v1/docs/:slug/file`、`PATCH/DELETE /v1/docs/:id` |
| **Workspace (4 / 6)** | `GET/POST /v1/workspace/queries`、`DELETE /v1/workspace/queries/:id`、`GET /v1/workspace/annotations`、`GET/PUT /v1/workspace/annotations/:id` |
| **AI Catalog Public (8 / 8)** | `GET /v1/ai/{vendors,models,events,updates,rankings}`、`GET /v1/ai/{models,events,rankings}/:id` |
| **AI Admin (22 / 23)** | `GET /v1/admin/ai/{queue,sources,sync-runs,history/status,rankings}`、`GET /v1/admin/ai/ops/{summary,audit}`、`PATCH /v1/admin/ai/candidates/:id`、`POST /v1/admin/ai/candidates/bulk-dismiss`、`POST /v1/admin/ai/candidates/:id/{publish,reject}`、`PATCH /v1/admin/ai/events/:id`、`POST /v1/admin/ai/events/:id/{unpublish,rollback}`、`POST /v1/admin/ai/{models,aliases,discovery/run}`、`POST /v1/admin/ai/sources/:code/sync`、`PATCH /v1/admin/ai/vendors/:id/autopublish`、`POST /v1/admin/ai/alerts/:id/resolve`、`GET/PUT /v1/admin/ai/vendor-sources`、`DELETE /v1/admin/ai/vendor-sources/:sourceId/:vendorId` |
