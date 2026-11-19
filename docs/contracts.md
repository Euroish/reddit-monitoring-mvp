# 主线数据与 API 契约

本文件定义系统领域对象、`050` 后数据库契约、混合批写入语义、检索/事件/分面规则与全量 HTTP API 表面。结构体与校验的唯一代码真源是 [source-content.ts](../packages/contracts/src/source-content.ts)、[content-stories.ts](../packages/contracts/src/content-stories.ts) 与 [web-boards.ts](../packages/contracts/src/web-boards.ts)，路由与 Schema 由 Fastify + TypeBox 自动派生至 `GET /v1/openapi.json`。

---

## 1. 领域模型与 Post-050 来源/内容扩展字段

| 领域概念 | 对应存储对象与唯一语义 |
| :--- | :--- |
| **`Platform`** | 内容源站大类（`reddit`、`x`、`bluesky`、`web`）；对应 `source` 表，`content.source_id` 指向它。 |
| **`Provider`** | 具体执行采集或推流的渠道（`feed`、`newsnow`、`kaix`、`red_crawler`、`twitterapis`、`scrapebadger`、`bluesky_appview`、`external_ingest`）。 |
| **`CollectionSource`** | 逻辑监测源（`collection_source`）。除调度 `schedule` 与主备渠道外，`050` 已正式上线 `tier`（`T1`/`T1_5`/`T2`）、`ownerEntityId`、`sourceGroup`（如 `ai-firsthand`、`dev-infra`、`tech-media`、`lifestyle`、`design-visual`、`science`、`public-affairs`、`social-trends`）、`tags`（最多 20 项）、`locale`（如 `en`/`zh`）、`fetchPolicy`（`maxItems 1..100`、`timeoutMs 3000..15000`、`stripTrackingParams`）、`http_etag`/`http_last_modified` 与运行态诊断 `health`（连续失败、上次耗时、是否截断、是否 304、累计运行统计）。 |
| **`Project`** | 研究专题（`monitor_project` + `monitor_project_source`）；绑定逻辑来源范围、本地三段词规则、`threadAware` 与 `includePushInTrends` 开关，不复制正文。 |
| **`Content`** | 去重内容主表（`content`），业务身份由 `(source_id, kind, external_id)` 唯一确定，`id` 在服务端确定性生成；`content.language` 写入时自动兜底识别，`platform_details`（`web`）补充 `channel` 与 `textCompleteness`（`full`/`summary`/`title_only`）。 |
| **`Discovery`** | 多源发现关联（`content_discovery`）：同一文章被 3 个不同订阅发现，只增 3 条发现记录，不产生重复正文。 |
| **`Observation`** | 按 `(content_id, collection_source_id, provider, evidence_key)` 隔离的时序指标快照（`content_observation`）；同 `payload_hash` 重放静默跳过避免死元组膨胀。 |

### 已交付的事件 API

> 本节描述当前 `prod@8e436ac` 已在生产环境真实上线并经 PG16 集成测试验收的契约能力。

- **`GET /v1/content/stories?view=latest|hot|digest`**：共用 `read` 权限与 `allowedSourceIds` 隔离，支持 `sourceId`、`platform`、`sourceGroup`、`tier`、`language`、`date`（仅 `digest` 视图，格式 `YYYY-MM-DD`）与 `limit`（`1..50`，默认 `20`）。默认全范围请求在 `30s` 滚动时间槽内共享一次窗口聚合并在异常时自动驱逐坏槽；附加过滤条件或机器 Key 受限来源时独立执行精确查询。
- **事件归组与代表选举**：`story-groups.ts` 基于去追踪参数的规范链接（支持 arXiv、GitHub Release/Issue 等）+ 规范化标题 + 数字版本隔离 + 64-bit SimHash（4×16-bit 分桶）聚合，代表选举严格遵循 **`T1 > T1_5 > T2` -> 同级英文原标题优先 -> 有正文优先 -> 时间先后**；同时返回最多 6 条 `related` 关联报道、`relatedCount`、`sourceCount`。
- **48h 热度、6h 趋势与 08:00 日报**：`stories.ts` 按独立参与主体（`ownerEntityId` > YouTube 频道 URL > 去 `www.` 的网站域名 > 社交作者 > `source:id`）计算最大衰减权重（`T1=3.0`、`T1_5=2.0`、`T2=1.0`，24h 指数半衰期）；仅在两端都存在可比来源（非停采 `behind` 且接入满 `>= 6h`）时计算 `trend: up|down|flat|new` 及徽章 `surge`/`rising`/`new`，否则诚实返回 `trend: 'unknown'`；`digest` 每日按切分点覆盖前 24 小时并保证同一事件单日去重。

### V2 演进读模型（明确标注为下一阶段规划，见 `docs/status.md`）

1. **阅读态与 `为你` RRF 排序**（V2 Phase B · `051`）：基于扩展后的 `content_annotation`（`read_at`/`archived_at`/`muted`/`tags`）及 `content_saved_query` 计算可解释 RRF 排序（保存查询命中 + 关注 VIP/一手源 + 多源印证 + 平台内对数互动 × 重力衰减 × 同发布者连续出现折损），卡片附带确定性 `reason` 徽章，支持 `read`/`unread`/`saved`/`muted` 滤镜。
2. **持久化事件簇与实体标签读模型**（V2 Phase B · `052–053`）：增量写入 `story_cluster`/`story_cluster_member` 与 `entity_catalog`/`content_entity`，为历史跨周热榜、实体声量趋势、跨专题/跨实体对比（`POST /v1/project-comparisons`）与卡片内嵌微图数据（`tierBreakdown`、`heatSparkline`）提供稳定毫秒级索引。
3. **可插拔按簇 AI 翻译/三点综述 & 按题动态探索**（V2 Phase D）：经 `POST /v1/content/:id/enrich` 触发零 SDK OpenAI 兼容端点或外部 Agent 写回 `platform_details.extensions.ai = { titleZh, leadZh, summaryPoints, model, fingerprint, enrichedAt }`，由 `source_provider_budget (provider='ai_enrich')` 统一管控配额；经 `POST /v1/discovery/query` 拆解 4 个正交证据槽并分波推送至 `delivery_mode='push'` 的 `radar` 系统源。

---

## 2. 来源、内容版本、采集与推流规范规则

### SRC-01–03：逻辑来源分离、目标形态与批量导入

| ID | 等级 | 逻辑来源与备源约束 | 验收出口 |
| --- | --- | --- | --- |
| SRC-01 | MUST | 逻辑来源由 `(platform_id, primary_provider, content_kind, target)` 唯一索引标识（`050` 已升级约束名 `uq_collection_source_identity`）；创建后 `deliveryMode`（`pull`/`push`）不可变；`Target` 支持 `search`、`community`、`account`、`post`、`feed`（支持 RSS/Atom 及零代码 `web_list` 选择器/`json_list` 点路径配置）；允许维护 `tier`、`ownerEntityId`、`sourceGroup`、`tags`、`locale`、`fetchPolicy` 与 `schedule`。 | PG 唯一约束与 Schema 测试 |
| SRC-02 | MUST | 备源仅支持 `twitterapis -> scrapebadger` 与 `kaix -> red_crawler` 配对，触发限于明确失败/429 且无已计费 Run 的场景；严禁对正常空结果、`partial` 覆盖或状态 `unknown` 的付费调用自动切备或重放。 | 失效政策与停发单测 |
| SRC-03 | MUST | 所有采集严格声明 `capability.operations` 与 `refreshByIds`；追踪批量人物优先使用 `from:u1 OR from:u2` 批次搜索，入库后依据每条记录真实 `content_author` 还原人物归属，禁止暗中把批请求拆成 N 次收费请求。 | 能力声明与批次归属单测 |

### DAT-01–04：内容身份、三元版本元组、三轴时间与快照口径

| ID | 等级 | 内容规范化、版本比较与幂等规则 | 验收出口 |
| --- | --- | --- | --- |
| DAT-01 | MUST | `externalId` 统一字符串；X 帖子与回复同归 `kind='post'`；`web` 默认以剥离 `utm_*`/`fbclid`/`gclid`/`spm`/`ref` 等跟踪参数后的规范 HTTPS URL 为身份；**`newsnow` 自 `8e436ac` 起采用 UTC 每小时快照桶（`floor(fetchedAt / 3600000)`）参与生成 `evidenceKey`**，7 大内置 `webBoards` 见 `packages/contracts/src/web-boards.ts`（`hackernews`、`bilibili-hot-video`、`zhihu-hot`、`google-trends-us`、`v2ex-share`、`github-trending`、`huggingface-papers`）。 | URL 规范化与快照桶单测 |
| DAT-02 | MUST | 正文版本比较严格采用三元组 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")`；同键同版本正文冲突抛 `409`；`deleted`/`removed` 状态清空标题/正文及检索文档且不可被更旧记录复活。 | 乱序/平局/防复活 PG 测试 |
| DAT-03 | MUST | 三轴时间彻底分离：`publishedAt`（原文发布时间）、`sourceObservedAt`（通道指标观测时间）、`fetchedAt`（系统采集时间）；未知时间存 `null`；平台指标显式携带命名空间前缀（如 `reddit.score`、`x.likes`、`web.rank`、`web.views`、`web.likes`）；正文完整度同时输出 `textState` 与 `platformDetails.textCompleteness`。 | 时间轴与指标口径测试 |
| DAT-04 | MUST | 观测表以 `(content_id, collection_source_id, provider, evidence_key)` 去重：同键同 `payload_hash` 静默忽略并保持 `updated=0`，同键异值拒绝覆写并报 `409`；回复树缺父链时由 `thread.ts` 标记 `contextMissing = true`。 | 观测幂等与 409 PG 测试 |

### COL-01–04 & ING-01：在线采集、批量导入、预览与外部推流

| ID | 等级 | 采集执行、预览导入、防刷屏与推流契约 | 验收出口 |
| --- | --- | --- | --- |
| COL-01 | MUST | 逻辑来源复用 `source_collection_job` 承载 `radar`、`hydrate`、`ingest`；`POST /v1/sources/:id/collect` 强校验 `Idempotency-Key`；`POST /v1/sources/preview` 对启用中的 `feed`/`newsnow` 真实试抓前 20 条并嗅探页面 RSS 链接（不写业务表）；`POST /v1/sources/import` 支持管理员提交最多 200 条 JSON 来源清单或 <=512 KiB OPML 2.0 文本，幂等跳过冲突并逐项返回校验错误。 | 幂等、预览与 OPML 导入 E2E |
| COL-02 | MUST | 无游标渠道永久标 `coverage='partial'`；`feed`（动态放行公网 HTTPS，除非 `FEED_ALLOWED_URLS` 非空启用白名单）单次抓取上限已提至 `100`（受 `fetchPolicy.maxItems` 约束），首次未知检查源仍限 `8` 条防刷屏，遇到 `304 Not Modified` 使用 `http_etag`/`http_last_modified` 且仅更新 `last_checked_at` 与 `health`；`Bluesky` 翻页越过时间窗 `from` 立即停页。 | 304 缓存、限流与防刷屏测试 |
| COL-03 | MUST | 在线批量接收上限 `2,000 条 / 16 MiB`；对 `automaticRequestReplay=false` 的付费渠道落库 `starting -> running -> reading -> committed` 状态机；`twitterapis` 单页上限钳制为 `<= 20`；结果进入 `unknown` 立刻自动阻断该源等待人工 `acknowledgePotentialCharge: true` 解封；`SIGTERM` 仅回收租约保留 `runId`。 | 断线恢复与付费阻断 E2E |
| COL-04 | MUST | `POST /v1/projects/:id/hydrate` 每次最多勾选 30 根帖、每帖最多 50 条评论（`kaix` 主源 / `red_crawler` 备源）进入水合任务；V2 按题动态探索 `POST /v1/discovery/query` 拆解 4 个正交检索槽并将精选结果推入 `delivery_mode='push'` 的系统 `radar` 源（支持一键转长期 `pull` 订阅）。 | 批量水合主备测试 |
| ING-01 | MUST | `POST /v1/sources/:id/ingest` 为外部 Collector Sidecar（L3 异构站点）与 R4 `plugins/zst-archive/` 的**唯一外部写入入口**，强校验 `ingest` scope、非空 `allowedSourceIds` 与 `Idempotency-Key`；单批限 `1..100` 条、解码体 `<= 1 MiB`；首次入库返回 `201`、同键同载体返回 `200`、同键异体返回 `409`。 | 推流边界与 201/200/409 E2E |

---

## 3. 检索过滤、三视图讨论树、权限与导出规则

| ID | 等级 | 过滤、双字词检索、讨论树与开放 API 安全规则 | 验收出口 |
| --- | --- | --- | --- |
| QRY-01 | MUST | `compileContentFilter(scope, filter)` 编译全权限交集与过滤条件：当前已支持 `sourceId`、`deliveryMode`、`platform`、`kind`、`from`/`to`（UTC 半开）、`query`、`searchScope`、`anyTerms`/`allTerms`/`exclusions`、`threadAware`、`signal`（`discussion`/`pain`），以及 `050` 新增的 **`sourceGroup`、`tier`、`language`、`hasMedia`**；>=3 连续字母数字走 `pg_trgm`，2 字中文/短代号（如 `算力`/`o3`）走 `public_search_bigrams` GIN 索引再精确回表复核。 | 多维过滤与 GIN 命中 PG 测试 |
| QRY-02 | MUST | 列表分页采用 Keyset Seek 游标（`created_at_source DESC NULLS LAST, id DESC`）编入过滤与项目 `revision` 指纹，范围变更返 `409 cursor_scope_changed`；`GET /v1/content/facets` 强制正区间 `<= 90` 天，单 CTE `GROUPING SETS` 输出 `day` / `6h`、`byPlatform` 与 `kinds` 分布。 | 游标一致性与分面 PG 测试 |
| QRY-03 | MUST | `threadAware=true` 先命中节点再归约至可见根帖；`GET /v1/content/:id/thread?view=top|matches|op` 闭包查询递归上限 32 跳、返回上限 200 节点，防止多层嵌套漏查；未来 `POST /v1/project-comparisons` 严格禁止跨平台直接加总点赞/分数（强制返回 `422` 并提示切换内容量/事件热度视角）。 | 嵌套闭包三视图 E2E |
| SEC-01 | MUST | 主体分 `owner`/`admin`、`viewer`（仅可读共享资产 + 个人 `/v1/workspace/*`）与 `machine` API Key（43 字符一次性 Bearer Token，SHA-256 存 `app_session`，1–90 天过期）；作用域固定为 `read`、`sources:write`、`projects:write`、`collect`、`ingest`、`export`，`machine` Key 禁访 `/v1/access/*`、`/v1/workspace/*` 与预算配置。 | 角色越权与 Scope 边界 E2E |
| OP-01 | MUST | 鉴权暴露 `GET /v1/capabilities` 与同源 `GET /v1/openapi.json`；任何 AI 摘要/Agent 均将第三方抓取正文按不可信数据处理（仅限只读或受控 `ai_enrich` 预算内写扩展字段，绝不将正文当作指令执行），产费操作只接受浏览器管理员确认。 | Capabilities 与隔离测试 |
| EXP-01 | MUST | `GET /v1/content/export?format=csv|json` 默认 1 万行、硬上限 5 万行，单进程单槽并发锁（冲突返 `429 + Retry-After: 5`），请求上限 `30s`，`REPEATABLE READ READ ONLY` + `pg-query-stream`（`batchSize: 100`）流式写出，JSON 尾块以 `{ result: { exportedCount, truncated, nextCursor, complete: true } }` 验真；CSV 遵守 RFC 4180 并中和 `=+-@` 公式注入。 | 并发导出、断流与 CSV 注入 E2E |

---

## 4. 全量 HTTP 路由注册清单（实码核对 vs V2 规划）

| 资源域 | 当前已注册路由（`prod@8e436ac` 实测 43 条路由，与 OpenAPI 一致） | V2 规划增补路由（Phase A–D） |
| :--- | :--- | :--- |
| **系统与元信息** | `GET /healthz`、`GET /readyz`、`GET /v1/openapi.json`、`GET /v1/capabilities` | — |
| **Access 鉴权与密钥** | `GET /v1/auth/session`、`POST /v1/auth/login`、`POST /v1/auth/register`、`POST /v1/auth/logout`、`GET/POST /v1/access/keys`、`DELETE /v1/access/keys/:id`、`POST /v1/access/invites` | — |
| **Collection 来源与调度** | `GET/POST /v1/sources`、`POST /v1/sources/preview`、`POST /v1/sources/import`、`PATCH /v1/sources/:id`、`GET /v1/sources/budgets`、`PUT /v1/sources/budgets/:provider`、`POST /v1/sources/:id/{collect,ingest,refresh,unblock}`、`GET /v1/sources/:id/jobs`、`GET /v1/source-jobs`、`GET /v1/source-jobs/:id`、`POST /v1/source-jobs/:id/{cancel,retry,continue}` | `GET /v1/sources/budgets` 增补可选 `ai_enrich` 预算控制；支持批量暂停/启用分组排期 |
| **Content 信息流、分面与导出** | `GET /v1/content`、`GET /v1/content/feed`、`GET /v1/content/facets`、`GET /v1/content/stories`、`GET /v1/projects/:id/content`、`GET /v1/content/:id`、`GET /v1/content/:id/thread`、`GET /v1/content/export` | `facets` 增补 `byTier` / `topEntities`；新增 `POST /v1/content/:id/enrich`、`GET /v1/entities`、`GET /v1/entities/:slug/overview` |
| **Projects & Discovery** | `GET/POST /v1/projects`、`GET/PATCH/DELETE /v1/projects/:id`、`GET /v1/projects/:id/overview`、`POST /v1/projects/:id/hydrate` | `POST /v1/project-comparisons`（多专题/实体对齐比较）；`POST /v1/discovery/query` & `GET /v1/discovery/jobs/:id` |
| **Workspace 个人空间** | `GET/POST /v1/workspace/queries`、`DELETE /v1/workspace/queries/:id`、`GET /v1/workspace/annotations`、`GET/PUT /v1/workspace/annotations/:id` | `PUT/PATCH /v1/workspace/annotations/:id` 扩展 `readAt`/`archivedAt`/`muted`/`tags`；新增评论节点级独立批注 |
