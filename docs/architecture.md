# 主线架构规范

目标架构；尚未实施。产品边界与度量口径见[产品与架构](README.md#2-主线与外挂边界)，接口语义与状态机见[数据与 API 契约](contracts.md)，改造细节溯源见[Master Spec](research/architecture_audit_and_rebuild_spec.md)。

## 1. 技术栈与单机拓扑

```text
人类 Web / 外部 AI Agent / 未来独立外挂 (plugins/zst-archive/)
                       │  HTTPS :443
         Nginx / Caddy（唯一公网入口，托管静态 Web）
                       │  Compose 内部私有网络
        Fastify 5 单体应用 + 进程内有界调度器（max=2）
                       │  一个 pg.Pool（max=10）
          PostgreSQL 16（内部网络，无宿主机公网映射）
```

| ID | 等级 | 技术与部署架构约束 | 验收出口 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 主线运行时锁定 Node 24（LTS）、TypeScript、Fastify 5、`@sinclair/typebox`、`pg`、`pg-query-stream`、PostgreSQL 16 与 React/Vite + Router + TanStack Query；精确版本以实施锁文件为准，禁止 alpha/beta 依赖。 | 构建 / `typecheck` |
| ARC-02 | MUST | Docker Compose 三服务（`proxy` / `app` / `db`）为唯一目标默认部署；`app` 单进程同时承载 HTTP 服务与有界调度器并共用同一个 `pg.Pool`。现有 systemd 配置仅用于过渡搬迁，不维护第二套长期发布流程，也不承诺单机重启零停机。 | Compose 启动与关闭验证 |
| ARC-03 | MUST | TypeBox 是请求/响应与 OpenAPI 生成的唯一结构真源，I/O 边界只解析一次；不变量与领域过滤由数据库约束及纯规则函数守护，严禁建立重复 DTO 映射层或内部防御性校验壳。 | OpenAPI 与边界单测 |
| ARC-04 | MUST NOT | 引入 ORM（Prisma/Drizzle）、通用 DI 容器、Redis、BullMQ、Kafka、Elasticsearch、ClickHouse、在线 Python/DuckDB 或动态插件执行框架；任何新增依赖必须直接替代既有机制或解决已实测瓶颈。 | `package.json` 审查 |
| ARC-05 | MUST | 模块内部直接调用接收 `Pool | PoolClient` 的命名参数化 SQL 函数（事务写入函数显式要求 `PoolClient` 防止误用 `Pool` 再开事务）；删除全部单实现 `*Repository` 接口、14 个 `InMemory*` 模拟与空壳 `service`。仅外部多实现采集边界保留 `ContentProvider`。 | AST lint / 真实 PG |
| ARC-06 | MUST | 业务模块默认仅包含 `routes.ts + sql.ts`；具备明确独立职责时才在 `scripts/check-docs.ts` 允许清单登记并拆出 `worker.ts` 或 `search.ts`。`100–250` 行为代码审阅提示而非硬配额，禁止压行（Code Golfing）或机械切割文件，新内核单条注释不超过 300 字符。 | AST lint / Diff 审查 |

可选第三方服务说明：`RSSHub` 为外部受控 HTTP 订阅源，不构成核心三服务的强启动依赖；精选 `NewsNow` getter 仅移植纯 MIT 获取与映射代码（保留原版权及提交来源），不部署其前端、数据库与任务框架。`plugins/zst-archive/` 拥有独立依赖、环境与测试，严禁进入根 `tsconfig`、核心镜像、发布清单或日常 CI 必需路径；主线未启动 `R4` 前不预建插件空壳。

## 2. 五个纵向模块与表所有权

```text
apps/api/src/
  app.ts                # Fastify 5 实例、Default-Deny Auth Hook、RateLimit、Swagger/Capabilities、统一错误信封
  server.ts             # 进程入口与 15s 优雅退出
src/modules/
  access/               # routes.ts + sql.ts：账号、会话/机器 Key、邀请、审计
  collection/           # routes.ts + sql.ts + worker.ts：逻辑来源、主备调度、异步付费状态恢复、POST ingest
  content/              # routes.ts + sql.ts + search.ts：UNNEST 集合批写、统一过滤、详情/评论树、流式导出
  projects/             # routes.ts + sql.ts：监测项目 CRUD、GROUPING SETS 概览、同口径对比
  workspace/            # routes.ts + sql.ts：个人保存查询、收藏与批注 JOIN 查询
src/connectors/         # 唯一保留 ContentProvider 多实现接口
  reddit/               # kaix-content.connector.ts + red-crawler-content.connector.ts（无 Arctic Shift 在线代码）
  x/                    # twitterapis-content.connector.ts + scrapebadger-x-content.connector.ts（无 twitterapi_io）
  web/                  # newsnow.ts（精选 MIT getter）+ feed.ts（通用 RSS/Atom + 白名单防 SSRF + 304）
src/storage/
  db.ts                 # pg.Pool（max=10, statement_timeout=10s, lock_timeout=3s）与事务助手
  schema/               # 001..040 已应用迁移（不可改）+ 041+ 新增迁移
packages/contracts/     # TypeBox Schema 唯一真源与派生类型
```

| ID | 等级 | 模块 | 独占写入的状态与最小表扩展（全库仅新增 2 张新表） |
| --- | --- | --- | --- |
| MOD-01 | MUST | `access` | `app_user`、`app_user_password`、`app_invite`、`app_audit_log`、`app_session`（扩展 `client_kind`、`label`、`scopes`、`allowed_source_ids`，复用 SHA-256 `token_hash` 与过期撤销机制，不建新 token 表） |
| MOD-02 | MUST | `collection` | `source`（平台注册表）、`collection_source`（扩 `primary_provider`、`fallback_provider`/`fallback_source_id`、`delivery_mode`、`http_etag`、`http_last_modified`）、`source_collection_job`（扩 `operation`、`request_key`、`request_json`、`provider`、`provider_state`、`parent_job_id`、`fallback_of_job_id` 及推流扩展 `purpose='ingest'`、`ingest_key`、`payload_hash`、`result_summary`）、`source_provider_budget`、`source_provider_usage`、`source_worker_heartbeat`、`source_dispatch_state` |
| MOD-03 | MUST | `content` | `content`（扩 `content_evidence_key TEXT NOT NULL`、`content_version_fetched_at TIMESTAMPTZ NOT NULL`）、`content_discovery`、`content_observation`（唯一键纳入 `provider` 防主备碰撞）、`public_content_search_document`（收敛为单列 `search_text` + `title_length`） |
| MOD-04 | MUST | `projects` | **`monitor_project`**（`filter JSONB`、`hydration JSONB`、`revision`）与 **`monitor_project_source`**（`project_id`、`collection_source_id` 外键指向 `collection_source(id) ON DELETE CASCADE`）——全系统唯一新建的两张表 |
| MOD-05 | MUST | `workspace` | `content_saved_query`、`content_annotation`（彻底淘汰并删除 `research_export` / `research_export_member` 持久化冻结表与服务） |

模块间通过显式导出的纯函数或带参 SQL 函数协作；`projects` 与 `workspace` 可按需只读联表读取 `content` 与 `collection_source`，严禁跨模块写入他方独占表。`src/connectors/` 仅完成外部 HTTP/Actor 协议适配与归一化，严禁直接访问业务数据库。

## 3. 唯一写入路径：`commitContentBatch`

`collection` 模块拥有在线巡检、评论水合与外部推流的调度与数据库短事务边界；`content` 模块暴露唯一写入函数 `commitContentBatch(client, source, items)`，所有采集与 `POST /v1/sources/:id/ingest` 必须经由此路径落库，严禁为外挂或特定来源另造并行 writer：

1. **事务外归一化与预合并**：连接器解析或 HTTP 边界 TypeBox 校验均在开启 PG 事务前完成。允许单批同时包含主帖、附属评论与父链节点；逐条读取记录真实 `kind` 并校验其属于当前 `provider` 该 `operation` 支持的 `contentKinds` 与引用结构，**严禁校验 `item.kind === source.contentKind`**。批内按 `(kind, externalId)` 预合并重复项：按 [DAT-04](contracts.md#dat-04接受正文的确定性版本与混合批规则详述) 选出正文胜者，**完整保留所有不同 `evidenceKey` 的独立 `observation`**；若同身份同版本字段互相冲突则整批拒绝。
2. **固定加锁序开启短事务**：`collection` 在短事务内按 **`source → job → content identity 升序`** 领取行锁，防止并发 `UNNEST` 死锁；校验来源有效状态、`deliveryMode`、租约令牌或 `Idempotency-Key` 回执锁。网络请求与大文件 I/O 严禁落入事务内部。
3. **四组集合 SQL 原子落库**：调用 `commitContentBatch` 提交以下四条集合语句。
4. **同事务收尾**：由 `collection` 在同一事务推进 `checkpoint`/`incrementalTo` 或写入 `source_collection_job` 推流回执并释放状态，随后 `COMMIT`。

| ID | 等级 | 集合写入与投影不变量 | 验收出口 |
| --- | --- | --- | --- |
| SQL-01 | MUST | 批量内容落库固定收敛为 4 条集合 `UNNEST` 语句：正文 `content` upsert、搜索投影 `public_content_search_document` upsert、`content_discovery` upsert、`content_observation` insert；禁止在批内循环逐条 `await query`。事务控制、锁/任务状态更新另计，SQL 往返数与页条数解耦为 $O(1)$。 | SQL 计数断言 |
| SQL-02 | MUST | 正文版本比较采用完整三元元组 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key)`（`content_evidence_key` 使用确定性 `C` collation 字节序）；`last_seen_at` 仅记发现范围，严禁参与正文版本比较。 | PG 逆序与平局测试 |
| SQL-03 | MUST | 较新 `available` 版本省略或传入 `null` 标题/正文时使用 `COALESCE(EXCLUDED.*, content.*)` 保留已知字段（明确空字符串除外）；较新 `deleted`/`removed` 必须清除正文与搜索投影，且**严禁落后 `available` 版本复活已删除正文**。`RETURNING` 返回最终生效规范正文与状态，投影仅从真正接受的正文计算。 | PG 删后防复活测试 |
| SQL-04 | MUST | 必须新增向前迁移移除 `038_public_content_search_document.sql` 的失效 `DELETE` 触发器并完成单列投影回填与完整性验证后，才切换新检索路径；严禁修改已应用 `038` SQL 或跳过一致性核查。 | 迁移与完整性检查 |

## 4. 统一查询、检索与性能基准

| ID | 等级 | 查询、聚合与全文检索硬约束 | 验收出口 |
| --- | --- | --- | --- |
| SQL-05 | MUST | `compileContentFilter(scope, filter)` 是全系统唯一纯过滤编译函数；`scope` 显式收紧操作者允许来源集合（`actor.allowedSourceIds`）与项目关联来源集合，在单个 `EXISTS (content_discovery JOIN collection_source)` 内完成交集校验，严禁接用户 SQL 或在多个独立 `EXISTS` 中绕过来源授权。 | 越权测试 / 单测 |
| SQL-06 | MUST | 列表接口 `listContent` 采用双分支 Keyset 分页，每次只多取 `limit + 1` 行判断 `nextCursor`（`totalMatching` 默认 `null`），**彻底取消分页热路径上的全表 `coverage COUNT(*)`**；全文投影完整性验证仅在写入事务与离线维护命令中执行。 | SQL trace / EXPLAIN |
| SQL-07 | MUST | 项目概览使用一条 SQL 完成：经 `compileContentFilter` 生成唯一 `matched` 证据 $\to$ 可见 `anchor` 映射，按 `GROUPING SETS ((), (pub_day), (source_id), (kind))` 各自计算 `COUNT(DISTINCT anchor)::bigint`（用 `GROUPING(pub_day)` 位区分总计 `NULL` 与未知发布时间桶 `NULL`）；`byDiscoveryProvider` 按去重 `matched` 独立关联聚合，禁止直接关联 `facets` 导致计数笛卡尔膨胀；禁止按平台/渠道循环重扫 `contentStats`。 | 概览一致性与 ID 集核对 |
| SQL-08 | MUST | 个人批注列表采用单条 `JOIN content` 查询，关联观测采用有界子查询或批量读取；彻底消除 `for` 循环逐条 `getContent()` 与详情页 `N+1` 查询。 | SQL 计数断言 |
| SQL-09 | MUST | 全文检索采用单个规范化列 `public_content_search_document.search_text` 配合 `GIN (search_text gin_trgm_ops)` 索引；规范标题与正文以禁止用户输入的控制符 `U+001F` 拼接，并用 PG `char_length(normTitle)` 存储 `title_length`（禁止用 JS UTF-16 `.length`）。限定 `title` / `text` 搜索域时，先走 GIN 候选索引再用 `substring` 做字符边界精确校验，确保短语绝不跨越标题/正文分隔符。 | EXPLAIN / 跨界短语单测 |
| SQL-10 | MUST | 字面/短语/三段词项匹配必须将 `%`、`_`、`\` 转义为字面量后生成参数化 `LIKE` 谓词，使 PostgreSQL `pg_trgm` GIN 索引真正生效（**禁止在热路径使用无法走 GIN 的 `strpos()`**）。无可用 trigram 的过短词或纯符号检索必须配合时间窗或来源范围收窄；过宽返回 `422`，SQL 超时返回 `503`，绝不静默返回假 `0`。 | EXPLAIN 索引扫描确认 |

补充索引与计数规则：
- 列表非联动模式依据物理列 `content.created_at_source DESC NULLS LAST, content.id DESC` 排序与建 B-tree 复合索引；联动模式以 `matched` 锚点最新命中节点真实发布时间生成 `matchedAt DESC NULLS LAST, anchorId DESC`；
- 评论树与父链反查依托 `content_references` 与既有 `reply_to` / `thread_root` 关系建立可用 B-tree 索引（经 `EXPLAIN` 验证，不另建树表或图数据库），通过有界 `WITH RECURSIVE` 查祖先，缺根或断链明确返回 `contextMissing` 与 `partial`；
- SQL 计数统一 `::bigint`，API 序列化校验安全整数边界，严禁 `COUNT(*)::int` 溢出。

**代表性目标负载基准（非未测吞吐承诺）**：以单机 `4 vCPU / 8 GiB RAM / NVMe SSD`、测试库规模 `100 万 content / 300 万 observation / 20 collection_source / 5 并发读取` 为验收目标：列表与详情 `P95 <= 400ms`，90 天项目概览 `P95 <= 1s`，100 条/页纯落库吞吐初始门槛 `>= 200 条/秒`；基准报告必须实测并记录冷/暖缓存、SQL 次数、更新率、内存与 WAL 指标。

## 5. 调度、异步收费状态机与单跳备源

| ID | 等级 | 进程内调度与状态恢复约束 | 验收出口 |
| --- | --- | --- | --- |
| RUN-01 | MUST | 进程内有界调度器运行于 `app` 进程，固定最大工作并发 `2`、同逻辑来源互斥执行；沿用 PG `FOR UPDATE SKIP LOCKED` 与 `lease_token`/`lease_until` 领取任务以兼容重启切换时短暂双活；按到期 `next_due_at` 调度，不因轮询抖动重复入队。 | 并发租约 PG 测试 |
| RUN-02 | MUST | 续页 `next_run_at = now` 并由 `provider.minimum_interval_ms` 统一控频；存在可领任务立即消费，空队列采用 `clamp(nextDue - now, 500ms, 5000ms)` 休眠并可随时被退场信号打断；未来到期或预算耗尽来源不占并发槽也不空转轮询。 | 调度延迟单测 |
| RUN-03 | MUST | 普通外部 HTTP 读取默认超时 `15s`（X 渠道初始 `20s`，`100..120000ms` 可调），传递 `AbortSignal`；仅对明确声明安全可重放的限流/临时读错误做最多 `3` 次退避。`kaix`、`red_crawler`（Apify 显式等待上限 `65s`）与 `TwitterAPIs` / `ScrapeBadger` 等声明 `automaticRequestReplay = false` 的来源必须走 **`starting -> running -> reading -> committed`** 状态机：发创建请求前持久化 `starting`，拿到 `runId`/`datasetId` 立即写库并支持续读轮询（不得因同步 `waitForFinish=60` 仍 `RUNNING` 就抛错丢失 Run）；结果未明进入 `unknown` 永久阻断自动重试与切备，直到人工确认或明确授权重操作。 | 故障注入与中断恢复 E2E |
| RUN-04 | MUST | `pull` 续页与 `incrementalTo`/cursor 推进同事务原子提交；`push` 内容与回执同事务原子提交；已暂停或取消的旧租约严禁提交结果。无稳定游标数据源（如 `kaix`、`NewsNow`）永远标 `coverage = 'partial'`；HTTP `304 Not Modified` 只更新 `lastCheckedAt`，严禁写入虚假观测或计为内容更新。 | 租约撤销与 `304` 测试 |

**闭环联动细节**：
- 精准品牌词可在 `radar` 请求携带 Top 15 评论；宽泛行业词仅发现 100–300 根帖，经唯一 `compileContentFilter` 确定性门控筛选出高价值讨论后，在同一 `radar` 任务事务提交后于原 `job` 记录快照并至多派生一笔有界 `hydrate` 子任务（每批 10–30 根、每帖最多 50 评论，支持进程重启后从父 `job` 幂等补建）；
- 单个逻辑 `collection_source` 至多配置一个兼容备源（`fallback_provider` 或受限 `fallback_source_id`，不成链/环）；仅在主源明确不可用、失败或 429 且目标/操作兼容、预算授权到位时创建单跳备源子任务（写观测时准确记录真实执行的备源 `provider`，保留 `fallback_of_job_id`）；空结果、`partial` 与 `unknown` 付费状态严禁切备。

## 6. 远端单机公网安全与稳定运行基线

| ID | 等级 | 远端单服务器硬性安全稳定基线 | 验收出口 |
| --- | --- | --- | --- |
| SAFE-01 | MUST | 全局 `/v1/*` **Default-Deny Auth Hook**：仅精确放行 `GET /healthz`、登录 `POST /v1/auth/login`、本人探测 `GET /v1/auth/session` 与持有效邀请码注册 `POST /v1/auth/register`。浏览器使用 `HttpOnly; Secure; SameSite=Lax` Cookie 且全写操作强制校验同源 `Origin`；机器与外挂使用 `Authorization: Bearer <API_KEY>`。鉴权通过仍继续校验 RBAC、`scopes` 与 `allowedSourceIds`，所有日志与响应脱敏零密钥。 | 越权与 CSRF HTTP 测试 |
| SAFE-02 | MUST | `@fastify/rate-limit`：登录 `5 次/分钟/IP`、全 API `120 次/分钟/IP`、请求体 `413` 硬上限；仅信任明确反向代理 hop 并由 Nginx/Caddy 覆盖重写 `X-Forwarded-*` 客户端真实 IP，严禁轻信任意伪造头；机器 Key 同样纳入限流，内网健康检查免占用户配额。 | 限流 HTTP 测试 |
| SAFE-03 | MUST | 单应用共用 1 个 `pg.Pool`（`max: 10`，获取连接有界等待）：`statement_timeout: 10000ms`、`lock_timeout: 3000ms`、`idle_in_transaction_session_timeout: 10000ms`；流式导出按 [EXP-02](contracts.md#5-流式导出与个人工作区方案-b) 通过事务级 `SET LOCAL idle_in_transaction_session_timeout = '35s'` 覆盖长事务空闲上限（单条 SQL 仍保持 10s）。HTTP 断连立即中止查询、关闭游标并回滚。大索引创建与数据迁移走独立维护连接与显式预算。 | 断连清理与超时测试 |
| SAFE-04 | MUST | 仅反向代理暴露公网 `:443`（HTTPS 与域名配置为公网部署前置前提）；`app` 与 `db` 仅在 Docker Compose 内部私有网段互通，**`db` 容器严禁配置任何宿主机公网 `ports` 映射**。本地明文 HTTP 调试必须显式配置环境标志，生产环境启动强制拒绝不安全降级。 | `docker compose` 配置审查 |
| SAFE-05 | MUST | 监听 `SIGTERM` / `SIGINT` 执行有界优雅退出：立即停止领取新任务与接收新 HTTP 请求 $\to$ 中止在途外部 `fetch` 与导出流 $\to$ 等待活跃数据库事务提交或回滚后调用 `pool.end()`。应用退出总预算 **`15s`**（大于 `10s` SQL 超时以保正在提交事务），进程守护宽限 **`30s`**。 | 信号退出压测 |
| SAFE-06 | MUST | 首次部署全空库仅强制 **3 个应用必需密钥**：`DATABASE_URL`、`SESSION_SECRET`、`ADMIN_BOOTSTRAP_PASSWORD`（仅首次空库引导生效，绝不覆盖已有用户，首次登录改密后移除）；第三方来源凭证（`APIFY_API_TOKEN`、`TWITTERAPIS_API_KEY`、`SCRAPEBADGER_API_KEY`）按实际启用来源按需配置，机器 API Key 在产品“设置”页生成并可随时撤销。 | 全空库冷启动引导测试 |

## 7. 发布、维护与扩展边界

| ID | 等级 | 单机发布、维护与边界纪律 | 验收出口 |
| --- | --- | --- | --- |
| OPS-01 | MUST | 一个不可变 `app` 容器镜像同步包含编译后的 API、调度器与静态 Web 资源（入口 HTML `no-cache`，带哈希资产长期缓存并保留上一发布哈希）；构建与启动过程严禁在线执行 `npm install` 或打入 Python/DuckDB/`plugins/`。 | 镜像与发布包测试 |
| OPS-02 | MUST | 每次版本切换前以独立命令先执行数据库前向迁移；`GET /readyz` 确认库结构、投影就绪后再放行流量，并受保护/内网隔离；严禁在检索回填完成前宣称搜索就绪，避免健康检查失败重启循环清空队列租约。 | 迁移与 `readyz` 检验 |
| OPS-03 | MUST | 保留并实际演练 PostgreSQL `pg_dump` / `pg_restore` 恢复流程与至少一份离机备份副本；明确保留策略并确认个人资产与未决收费任务无冲突后再做有界清理，禁止跳过备份演练直接破坏性操作。 | 恢复演练报告 |
| OPS-04 | MUST | 核心可观测性只输出高信号结构化字段：`requestId`、慢 SQL、队列积压、各来源真实观测延迟/成功率、错误分类、`X-Credits-Used`/积分用量与构建迁移版本；用户仅见可恢复行动建议，明细日志归管理员，不引入 Prometheus/ELK 监控集群。 | 日志与 `/v1/source-ops` 检验 |

主线核心严禁读取外部插件的 manifest/release，也不提供 `.zst`/Parquet/任意本地路径上传；未来 `plugins/zst-archive/` 接入只需严格遵守 `POST /v1/sources/:id/ingest` 标准契约，绝不为了便利跳过鉴权、版本比较、幂等回执与批大小限制。
