# 主线架构规范

本文定义系统的架构边界、运行不变量与单机交付蓝图。已落地能力、旧版本对照与后续工作见[当前状态](status.md)，接口及交互细节见[数据与 API 契约](contracts.md)和[产品交互规范](design.md)。

## 产品全景与能力依赖（目标设计）

系统服务两种阅读时刻：平时打开就有新内容，提出具体问题时能向外寻找证据。后台排期独立于登录、浏览器、页面刷新和模型服务。读者关注的人、社区、发布渠道与站点榜单是长期采集目标；一次提问产生短期探索任务。用户显式关注某个可持续获取的来源后，它才进入长期排期。

| 入口 | 数据如何流动 | 谁决定范围与成本 |
| --- | --- | --- |
| 后台自动采集 | 到期来源 → 有界任务 → 网络读取 → 标准化、统一入库 → 授权信息流 | 管理员启用来源与预算，同一目标共享抓取。任务记录显示最近成功时间、滞后及覆盖缺口 |
| 首页与频道 | 库内内容及来源关系 → 按时间、关注或热点筛选 → 事件、原帖、评测和讨论 | 读者选择频道或人物。推荐只在可见内容内排序，保留原文与出处 |
| 按题探索 | 私有问题 → 库内检索与外部索引 → 分批取证 → 带出处的结果 | 外部索引决定可发现范围，抓取许可决定可读范围。交互任务额度与后台更新额度分开 |
| 后续 LLM 工作环境 | 从 capabilities 与 OpenAPI 选择工具 → 在当前用户范围检索、比较、引用 → 返回结构化结果与来源 | 默认只读。需要发起探索或订阅时，经应用验证的窄操作沿用调用者权限、任务预算与幂等键。模型输入输出不授予网络、SQL 或凭证权限 |

采用同一信息身份与可追溯引用贯穿四个入口。私有问题、阅读偏好与模型会话属于个人空间，不能随公共内容复用而跨用户传播。LLM 接入时提供任务状态、取消、超时和按次用量；模型不可用时后台采集、阅读与原始证据仍可工作。具体模型、托管方式及编排框架留到该阶段按可用额度选择。

## 1. 架构鸟瞰与刻意不做列表（Bird's Eye & Deliberate Absences）

```text
Web 浏览器 / 外部 AI Agent / 未来 R4 外挂 (plugins/zst-archive/)
                       │  HTTPS :443
         Caddy (Compose 服务 proxy，对外映射 HTTPS，托管静态 Web，/api/* 去前缀反代，导出关闭缓冲)
                       │  Compose 内部网络
        Fastify 5 单体应用 + 进程内任务消费者 (concurrency=2)
                       │  单一 pg.Pool (max=10)
          PostgreSQL 16 (仅内部网络，禁止宿主机端口映射)
```

借鉴成熟开源工程实践的架构取舍：**刻意不引入** ORM（Prisma/Drizzle）、通用 DI 容器、微服务拆分、Redis/BullMQ、Elasticsearch/ClickHouse、在线 Python/DuckDB 运行时，也不维护第二套 `systemd` 生产发布流或通用规则引擎。

| ID | 等级 | 运行时与结构基线 | 验收出口 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 后端锁定 Node 24+、TypeScript、Fastify 5、`@sinclair/typebox`（`TypeBoxValidatorCompiler` + `registerAjvFormats` 保持 `removeAdditional: false`）、`pg`、`pg-query-stream`、PostgreSQL 16；前端使用 React / Vite / Router / TanStack Query；单容器 `app` 整合 API、调度器与静态产物，构建阶段必须复制 `src/storage/schema/*.sql` 至 `dist/` 且迁移脚本在发现 0 个 SQL 或错误前缀时立即报错。 | 构建与编译态启动验收 |
| ARC-02 | MUST | 单机 Compose（`proxy` / `app` / `db`）为唯一生产交付拓扑；应用监听 `SIGTERM` / `SIGINT`（如 `closeWithGrace` `15_000ms`，严格大于 SQL `10_000ms` 超时），构建与日常 CI 严禁打入 Python / DuckDB / `plugins/`。 | Compose 启动与退出测试 |
| ARC-03 | MUST | 仅外部多实现采集契约保留 `ContentProvider` 接口；业务模块内部直接调用接收 `Pool | PoolClient` 的命名 SQL 函数（写事务强制 `PoolClient`），彻底清除单实现 `*Repository` 与 `InMemory*` 模拟；`src/modules/` 内按职责自然拆分文件，由 `scripts/check-docs.ts` 守住 5 模块顶层结构、禁类/旧层 AST、<= 450 行/文件与 <= 220 字符非字符串代码行上限。 | `docs:check` 与 AST lint |

## 2. 入口地图与五模块所有权（Code Map）

目标代码组织维持清晰的单向依赖（`apps/api/src/` -> `src/modules/*` -> `src/storage/db` & `packages/contracts`；`src/connectors/*` 零数据库依赖）：

- **`apps/api/src/app.ts` & `server.ts`**：Fastify 5 实例、Default-Deny Auth Hook、`@fastify/rate-limit`（`HOST=0.0.0.0`、受控 `trustProxy: 1` behind Caddy，禁止全局 `true` 或反代后 `false`）、连接与头超时（`connectionTimeout`/`headersTimeout`/`keepAliveTimeout`/`requestTimeout` 且不误杀有界流式导出）、Swagger/Capabilities 与 `15s` 优雅停机。
- **`src/modules/access/`**：独家管理 `app_user`、`app_user_password`、`app_invite`、`app_audit_log` 与扩展后的 `app_session`（`client_kind`、`label`、`scopes`、`allowed_source_ids`）；不新建通用 Token 表。
- **`src/modules/collection/`**：独家管理 `source`、`collection_source`、`source_collection_job`（含 `operation`、`provider_state` 及 `purpose='ingest'` 幂等回执，沿用 `030` 已有的 `parent_job_id` 不重造列）、`source_provider_budget`、`source_provider_usage`、`source_worker_heartbeat` 与进程内 `worker.ts`。
- **`src/modules/content/`**：独家管理 `content`、`content_discovery`、`content_observation`、`public_content_search_document`（收敛为单列 `search_text` + `title_length`），暴露唯一混合入库写函数 `commitContentBatch`、唯一纯过滤函数 `compileContentFilter` 与有界流式导出。
- **`src/modules/projects/`**：独家管理全系统**仅有的两张新表** `monitor_project`（`owner_user_id`、`filter`、`hydration`、`thread_aware`、`include_push_in_trends`、`revision`）与 `monitor_project_source`（外键 `ON DELETE CASCADE`）。
- **`src/modules/workspace/`**：独家管理 `content_saved_query` 与 `content_annotation`（与旧冻结表 `research_export` 解耦并在 R3 清理后删表）。

| ID | 等级 | 模块所有权与数据安全约束 | 验收出口 |
| --- | --- | --- | --- |
| MOD-01 | MUST | 模块间禁止越权写他方独占表；`src/connectors/` 仅作协议适配（可含流式 HTTP 大小/SSRF 保护与 XML 消毒）且绝不访问 PG。迁移严格遵循 Expand-Migrate-Contract：`001..040` 不可修改，新结构经 `041+` 前向迁移落地，且不在首次切换同事务立即 `DROP` 上一版仍读写的旧列。 | 模块边界 AST 与 PG 迁移检验 |

### 新需求落在哪里

| 变化 | 最小改动面 | 复用的稳定边界 |
| --- | --- | --- |
| 新增一个 RSS 站点 | 兼容现有协议时加入允许的目标并配置逻辑来源 | 现有 Feed 解析、任务和入库 |
| 新增一类供应商协议 | 在 connectors 映射分页、身份、时间与能力，在启动入口注册并同步来源契约 | collection 管任务预算与续跑，content 管去重，页面按能力显示操作 |
| 新增趋势视图 | content 提供按已有可见范围聚合的 SQL，React 同步图的选区和列表条件；项目维度沿用 projects | 同一过滤编译器、同一内容身份 |
| 新增一种个人排序 | workspace 解析当前用户选择，content 对已授权候选排序；先写一个具名函数 | 返回内容 ID 与理由，详情复用原有查询 |

首版为请求时读取 PostgreSQL。排序结果只引用正文，不保存每个人的一份内容副本。关注条件沿用保存查询，首轮由用户在页面选择；跨设备默认偏好有实际需求时再设计其持久化。只有相同读查询确实拖慢交互且索引与执行计划已核查，才引入预计算；只有任务需要独立的故障恢复或资源预算，才讨论拆进程。

Bluesky 的 Feed Generator 返回有序帖子引用，由读取方补全展示内容；这里借用引用与展示分工，在现有进程内实现。Miniflux 将过滤条件分为全局与单源两级；这里借用范围可见的交互，把个人兴趣放在读取侧，让其他用户仍能看到完整的采集样本。[Bluesky Feed Generator](https://github.com/bluesky-social/feed-generator) · [Miniflux 过滤规则](https://miniflux.app/docs/rules.html)

## 3. 唯一入库与查询检索不变量

所有在线采集与外部推流统一在事务外完成 TypeBox 校验与按 `(kind, externalId)` 的单轮确定性版本归约后，按 **`source -> job -> content identity 升序`** 获取行锁并进入 `commitContentBatch` 短事务：

1. **四组 `UNNEST` 集合写**：依次提交 `content` upsert、`public_content_search_document` upsert、`content_discovery` upsert 与按确定顺序预排序的 `content_observation` insert，消除页内逐条 SQL 往返与并发死锁风险。
2. **三元版本元组与零无效更新**：服务端统一派生确定性 UUID 作为 `content.id`（拒绝外部 `/ingest` 指定任意 `id` 引发 `23505` 碰撞）；正文比较严格使用 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")`；`ON CONFLICT DO UPDATE` 附带 `IS DISTINCT FROM` 判断确保重复入库返回 `updated = 0` 且不重写搜索表；`deleted`/`removed` 清理正文后绝不允许落后 `available` 借 `COALESCE` 复活。
3. **统一过滤与无 `COUNT(*)` 翻页**：唯一纯函数 `compileContentFilter(scope, filter)` 在同一个 `EXISTS(content_discovery JOIN collection_source)` 内完成操作者、项目、来源与交付模式交集；列表分页统一按 `created_at_source DESC NULLS LAST, id DESC`（联动模式按 `matchedAt DESC NULLS LAST, anchorId DESC`）做双分支 `limit + 1` Seek，彻底删除翻页全表 `coverage COUNT(*)`。
4. **单列三段词检索与防扫表守卫**：`public_content_search_document` 用 `U+001F` 拼接标题与正文并由 PG `char_length` 记 `title_length`，字面转义 `%`、`_`、`\` 后生成参数化 `LIKE` 激活 `gin_trgm_ops` 索引（禁热路径 `strpos()`），并用 `substring` 守住 `title`/`text` 跨界短语；**即使在 `projectSourceIds` 范围内，也不允许豁免最小词长限制而放行多个 1–2 字符无索引扫描**。
5. **项目统计与评论树有界策略**：`projects` 概览经单 CTE + `GROUPING SETS ((), (pub_day), (source_id), (evidence_kind))` 与独立去重 `providers` 聚合消除 `contentStats` 循环全扫；基线 R2 评论树依托 `reply_to` / `thread_root` 索引做单次有界查询（`LIMIT 200`、32 跳环检测与缺根标 `contextMissing`），不预建重型游标分页树引擎。

| ID | 等级 | 存储、检索与迁移执行规则 | 验收出口 |
| --- | --- | --- | --- |
| SQL-01 | MUST | 批量写入固定 4 组 `UNNEST`，禁止循环内逐条 SQL；版本元组使用独立 `content_version_fetched_at` 与 `C` 序 `content_evidence_key`，零变化重放不得刷新搜索表或虚增 `updated` 计数。 | 逆序/平局/幂等 PG 测试 |
| SQL-02 | MUST | 在线查询禁止全表 `coverage COUNT(*)` 与 `strpos()` 热扫，统一用 `::bigint` 计数；大索引建表与 SQL 迁移必须使用独立长超时连接（绕开业务池 `10_000ms` 语句熔断）。 | EXPLAIN 与迁移实测 |

## 4. 进程内调度与单机安全基线

| ID | 等级 | 调度、收费保护与边缘安全约束 | 验收出口 |
| --- | --- | --- | --- |
| RUN-01 | MUST | `app` 内置轮询调度器上限并发 `2`、同逻辑来源互斥，采用 `FOR UPDATE SKIP LOCKED` 与租约字段领单；无任务按 `clamp(nextDue - now, 500ms, 5000ms)` 休眠。对 `automaticRequestReplay = false` 的来源实行 `starting -> running -> reading -> committed` 状态机，创建 Run 前先落库 `starting`，拿到 `runId`/`datasetId` 立即持久化；**收到 `SIGTERM` 优雅退场中断时仅释放租约退回 `queued` 并保留 `runId`，绝不可误标 `failed` 或置位 `automatic_collection_blocked=TRUE`**，仅未拿回执前异常失联才转入 `unknown` 待人工确认恢复。 | 停机恢复与故障注入 E2E |
| SAFE-01 | MUST | 全局 `/v1/*` 执行 Default-Deny（仅精确放行 `/healthz`、`POST /v1/auth/login`、`GET /v1/auth/session`、`POST /v1/auth/register`，以及内网健康检查路径 `/readyz`）；浏览器 Cookie 写操作校验同源 `Origin`；`@fastify/rate-limit` 登录 `5 次/分/IP`、API `120 次/分/IP`，Caddy 覆写 `X-Forwarded-For` 且 `app` 配置精确反代 hop（`trustProxy: 1`），`db` 服务严禁暴露宿主机 `ports`。 | 权限、CSRF 与反代限流测试 |
| SAFE-02 | MUST | 业务池锁定 `max: 10`、`statement_timeout: 10000ms`、`lock_timeout: 3000ms`、`idle_in_transaction_session_timeout: 10000ms`；流式导出使用全局+单用户 `concurrency=1` 信号量、事务内 `SET LOCAL idle_in_transaction_session_timeout = '35s'`、`X-Accel-Buffering: no`（Caddy `flush_interval -1`），客户断连立即中止游标并回滚。 | 并发导出与断连清理实测 |
| SAFE-03 | MUST | 首次冷启动仅强制核心应用配置（`DATABASE_URL`、`SESSION_SECRET`、`ADMIN_BOOTSTRAP_PASSWORD` 引导首号后清除），来源凭证按需配置；对 `feed` 外部 URL 必须使用固定解析 IP（如 `undici` 自定义 `lookup` + `redirect: 'error'` + 全量 IPv4/IPv6 保留段检查）阻断 DNS 重绑定 SSRF，HTML 与 XML 分别经专业库清洗并禁外部实体。 | 冷启动与 SSRF 安全单测 |

## 5. CI/CD 与可观测基线

借鉴 `actualbudget/actual`、`umami`、`fastify/demo` 与 `DIYgod/RSSHub` 工程实践，收敛为低开销的双阶段验证 + 发布纪律：

1. **Fast Gate（所有改动快速执行）**：所有 Action 锁定 40 位 Commit SHA 并全量启用 `npm ci --ignore-scripts`；依次运行 `docs:check`（含 `041+` 迁移号不可重复与 `001..040` 不可变检查）、`lint` / formatter、全局 `typecheck`、构建检查（校验 `dist/src/storage/schema/*.sql` 存在）与离线纯函数单测；并辅以 `gitleaks` 防密钥提交。
2. **Compiled + PG16 E2E Gate（代码改动必过）**：拉起固定 `postgres:16-alpine` 容器，直接用编译产物 `dist/` 运行 `npm run db:migrate:compiled` 与核心 PG16/HTTP 契约测试（不再双跑 `InMemory`）+ 1 条主流程 Playwright 浏览器冒烟。
3. **单一单机运营约束**：生产只输出高信号结构化字段（`requestId`、慢 SQL、队列深度、真实来源延迟/错误、计费头 `X-Credits-Used` 与当前迁移版本）；保留已演练的 `pg_dump`/`pg_restore` 离机备份；14–30 天运行期内若 10 万行级导出导致 `pg.Pool` 排队 `P95 > 500ms` 再拆只读导出池或独立 Worker，无实测瓶颈前不提前拆分。

## 6. 4 GB 内存、60 GB 系统盘的演进设计

产品允许少量用户开放阅读，新增成本预算为零。主机容量是操作系统、镜像、数据库、WAL、日志和备份临时文件共享的总量。日采一万条只作为容量计算情景。来源数量、轮询次数、独立正文数和观察数分别计量，同一篇新闻出现在十个 Feed 中，来源覆盖有价值，重复正文只需存一次。现有 Web 内容按规范化后的 HTTPS 链接识别，跟踪参数和转载链接仍可能形成不同身份。展示端可折叠疑似重复，保留每条发现关系供下钻。

### 从刷新单个来源走到持续更新

1. 复用迁移 030 的 `collection_source.schedule`、`next_due_at` 和到期索引。在 collection 消费者旁加一个低频、有界的到期扫描。每轮按到期时间领取少量已启用的活动 pull 源，锁源后复核暂停、预算阻塞和在途任务。生成任务与推进到期时间共用一个短事务。幂等键包含来源和原定时间槽。重启后将错过的多个槽合并为一次有上限的追赶窗口，保留可见缺口。网络请求在事务外执行。
2. 同域错峰，依据来源更新间隔和连续无变化次数调整频率。截断的 Feed 提高检查频率或标记覆盖不足；反复读同一首屏无法补齐已经滑出的条目。对 429 在供应商允许重试时按 Retry-After 安排下一次；预算关闭、当日耗尽、间隔不足要分别等到配置变化、额度重置、间隔到点。当前 worker 对这三种情况统一延后一分钟，扩大来源前应消除无效唤醒。
3. 继续沿用成功任务的 Feed checkpoint。只有请求窗口被已处理范围覆盖时才带验证器，304 更新检查时间，截断保留 partial。按源启用的网页正文提取应有独立预算和失败结果，Feed 摘要仍可发布。Miniflux 的逐源处理入口把正文抓取与条目处理区分开，适合作为今后确有正文缺口时的参考。[HTTP 条件请求](https://www.rfc-editor.org/rfc/rfc9110.html#section-13) · [Miniflux 条目处理源码](https://github.com/miniflux/v2/blob/main/internal/reader/processor/processor.go)
4. 发布初期继续单应用镜像和现有 PostgreSQL 队列。先让后台并发可降到一，同时记录最老到期任务的等待时间。若采集解析期间首页持续变慢，关联事件循环延迟、连接等待与内存峰值，确认应用内竞争后再用同一镜像分 API 和 worker 两个入口。扫描跟随 worker，只在一个角色启动。现有池上限为 10，拆分时按两个角色分配这份连接预算，并预留数据库管理连接。拆进程只能隔离事件循环和重启，磁盘和数据库仍共享。

### 阅读成本与开放边界

首页只读取已入库内容。沿用 scope、时间和 id 游标；优化候选查询时先在授权范围内完成筛选、排序和限量，再为当页 id 取展示用观察。若用户按指标过滤或排序，决定入选的指标必须在分页前求出。用同一数据快照的执行计划比较扫描行数、缓冲块和排序落盘，再决定索引。公共静态资源可共享缓存；含来源权限、收藏、批注的响应保持用户隔离。开放阅读沿用 read 权限，采集、付费评论水合和推流保持单独授权。移动浏览器复用同一读路径。

优先用已有 RSS 扩展独立发布者和主题，再用已有榜单发现漏掉的站点。每批记录新增独立条目、重复发现、从发布到可读的延迟及请求量。无发布时间的条目单列。若某类内容只有网页，先评估一个获准站点的定向适配；图片与视频保存来源引用。新增付费 API、媒体镜像或独立搜索服务均需要重新评估零增支约束。

### 多源抓取、推荐与开放流量的具体编排（规划）

**抓取。** 每个站点先选能交付目标信息的最小入口：官方 Feed、公开结构化 API、最后才是经核准的列表页。对列表页，每次任务只翻管理员配置的页数，限定域、路径、字节和时间；提取标题、原文链接、发布时间、可展示摘要。先评估条款、robots 和署名要求，公开可访问与允许再分发分别核实。页面变版导致零匹配时保留既有数据并报告结构变化。详情抓取单独计入预算。借鉴 Scrapy 按下载槽控制速率的做法，同一域共享在途额度；调度端从不同到期域轮流选源，按响应延迟拉长间隔，失败不能促使提速。DNS 查询也要纳入整次请求超时，现有 Feed 的计时器在 resolve4 结束后才启动。保留已校验地址绑定和禁止自动跳转。[Robots 协议](https://www.rfc-editor.org/rfc/rfc9309) · [Scrapy AutoThrottle](https://docs.scrapy.org/en/latest/topics/autothrottle.html)

**排序。** 首版保留严格时间流作对照。“为你”先按授权范围取三个有上限的候选序列：兴趣查询命中、最近更新、近期较少出现的来源。按内容 id 合并，用各序列的名次贡献求和（每路权重除以常数加名次），无需把论文发布时间、新闻榜位和社交点赞换算成一个分数。排序后限制同一发布者连续出现，记录命中的兴趣或补充来源作为展示理由。无兴趣时回到时间流。首轮只生成一屏；若要连续翻页，再固定候选窗口、排序版本和授权范围，每次读取重新校验权限。试用按相同阅读机会比较收藏、主动隐藏及独立发布者覆盖率，已有收藏可用，曝光和隐藏的分母仍需产品定义。按协议核实时间字段，无发布时间保留空值。采用算法本身即可在有界数组上计算。[Reciprocal Rank Fusion](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)

**并发。** 估算源站读请求率用活跃读者数乘每次翻页的 API 请求数再除以翻页间隔。100 人每 10 秒各取一页、每页一个请求约为 10 RPS，尚未计搜索、详情和登录。采集端单独估算：240 个源每小时一次为 4 次/分钟，平均占槽 5 秒时约占 0.33 个并发槽；若持续占用 30 秒则需要 2 个槽，已用满现有两个循环，超时重试还会增加负载。这说明域名错峰只能消除尖峰，长期积压需要调低频率。以有代表性的库和真实页大小做一次阶梯回放：已有活跃负载、预计开放峰值、短时两倍峰值，叠加一轮采集。记录成功读请求 p95、拒绝率、池等待和积压年龄；达到资源拐点便停。以仍满足交互目标且积压可回落的最后一档设开放额度。昂贵导出单独限制在途数，过载先推迟采集和导出，再对超额读取快速返回 429，避免等待中的请求耗尽内存。

**公网与费用。** 当前 Compose 默认回环绑定，Caddy 直接反代，Fastify 配置一跳信任与进程内限流。对外试用先核实已有服务商包含的上游流量清洗和计费上限。若已有可用的代理防护，则仅允许该代理的官方地址段进入源站公网服务端口；同时验证 IPv4/IPv6、证书续期及管理通道。Caddy 仅信任这些代理并重建传给应用的客户端地址，检查直连和用户自带转发头都无法改变限额身份。仅对带内容指纹的公开静态资源做长缓存。线路被打满时本机无法恢复可用性，上游能力未经验证时只做受邀开放。[代理地址与源站限制](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/) · [Caddy 可信代理](https://caddyserver.com/docs/caddyfile/options#trusted-proxies)

域名接管、DNS 查询账单和供应商调用盗刷各有不同控制点。域名侧启用注册商锁和 MFA，签名区与父区 DS 核对后验证 DNSSEC；应用容器无需 DNS 管理令牌。权威 DNS 使用现有套餐，核实查询计费、告警及可配置硬额度，关闭闲置记录和开放递归。阅读账号只访问库内内容；管理员按来源设置请求预算，并在供应商侧设置已有套餐硬限额或关闭自动充值。应用内预算不能覆盖凭证泄漏后的外部调用。按读者或机器 Key 限制昂贵操作，保留现有付费状态未知时的停止机制。[DNSSEC](https://developers.cloudflare.com/dns/dnssec/)

### 问题驱动的网站发现

用户提问走异步探索，首页和关注列表直接读库。以“最近一周 coding agent 在大型仓库里有哪些实测改进”为例，同时检索产品发布、独立评测、开发者复现与失败案例。优先查已有内容，再用可用的外部搜索索引发现此前没有配置过的域名；允许按主题、时间与语言改写查询。一次可选择 20–30 个相关站点为探索上限，按相关性、原始发布者、时间和观点差异分批取证，达到证据要求即可提前结束。区分已发现 URL、成功读取的页面及支持结论的独立来源，搜索摘要单列。来源不足或结论冲突时保留缺口。

外部搜索索引与答案模型分别核实访问权、机器使用条款和预算。无外部搜索额度时仍可查库内与已批准的站点，并在界面显示实际范围；无模型时返回按问题分组的证据卡。通用搜索的抓取隔离于现有管理员 Feed 白名单：经发现的网页只允许受限 HTTPS 读取，每个连接绑定已核验的公网地址，跳转逐跳核验，限制域并发、总字节、总时间和单用户在途任务。用户可取消，等待和失败的站点不能阻塞已到达的结果。正文只作引用材料。短期证据带来源 URL、取回时间和引文；检索历史与私有问题按用户隔离，公开页面按规范 URL 与新鲜度复用。一次搜索不自动订阅一个站点。[外部搜索索引示例与端点用途](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)

20–30 个站点只增加一次任务的总工作量。试用时给交互探索单独在途上限，并为长期关注留出执行机会。例如平均每站 2 秒、2 个并发槽，24 个站点理想耗时已约 24 秒，尚未包含搜索、排队和摘要；因此先给读者可打开的结果，再增补证据。监测每问独立证据数、首次有用结果延迟、请求成本与对定时采集的影响后才提高额度。
