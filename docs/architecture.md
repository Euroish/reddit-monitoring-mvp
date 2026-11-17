# 主线架构规范

本文定义目标系统的架构边界、运行不变量与单机交付蓝图。真实代码当前停在 `0.9.1`，两分支进度与下一阶段实施节奏见[当前状态](status.md)，接口契约与交互细节分别见[数据与 API 契约](contracts.md)和[产品交互规范](design.md)。

## 1. 架构鸟瞰与刻意不做列表（Bird's Eye & Deliberate Absences）

```text
Web 浏览器 / 外部 AI Agent / 未来 R4 外挂 (plugins/zst-archive/)
                       │  HTTPS :443
         Caddy (:80/:443，托管静态 Web，/api/* 去前缀反代，导出关闭缓冲)
                       │  Compose 内部网络
        Fastify 5 单体应用 + 进程内有界调度器 (concurrency=2)
                       │  单一 pg.Pool (max=10)
          PostgreSQL 16 (仅内部网络，禁止宿主机端口映射)
```

借鉴成熟开源工程实践的架构取舍：**刻意不引入** ORM（Prisma/Drizzle）、通用 DI 容器、微服务拆分、Redis/BullMQ、Elasticsearch/ClickHouse、在线 Python/DuckDB 运行时，也不维护第二套 `systemd` 生产发布流或通用规则引擎。

| ID | 等级 | 运行时与结构基线 | 验收出口 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 后端锁定 Node 22/24 LTS、TypeScript、Fastify 5、`@sinclair/typebox`（`TypeBoxValidatorCompiler` + `registerAjvFormats` 保持 `removeAdditional: false`）、`pg`、`pg-query-stream`、PostgreSQL 16；前端使用 React / Vite / Router / TanStack Query；单容器 `app` 整合 API、调度器与静态产物，构建阶段必须复制 `src/storage/schema/*.sql` 至 `dist/` 且迁移脚本在发现 0 个 SQL 或错误前缀时立即报错。 | 构建与编译态启动验收 |
| ARC-02 | MUST | 单机 Compose（`caddy` / `app` / `db`）为唯一生产交付拓扑；应用监听 `SIGTERM` / `SIGINT`（如 `closeWithGrace` `15_000ms`，严格大于 SQL `10_000ms` 超时），构建与日常 CI 严禁打入 Python / DuckDB / `plugins/`。 | Compose 启动与退出测试 |
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
