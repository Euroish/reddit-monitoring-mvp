# R1–R4 主线重建与物理实删计划

本文规定重构迁移边界、既有表资产处置、物理实删清单与 R4 离线归档外挂接口。实际代码现状、双分支实测差异与下一阶段分期推进表统一维护于唯一状态真源[当前状态与下一阶段](../status.md)；具体 SQL 写入、安全与 HTTP 语义以[主线架构规范](../architecture.md)及[数据与 API 契约](../contracts.md)为准。

## 1. 切换原则与安全迁移约束

| ID | 等级 | 重建切换与迁移保护约束 | 验收出口 |
| --- | --- | --- | --- |
| PLAN-01 | MUST | 物理删除旧运行时、仓储与页面时，严禁连带破坏账户、来源观测证据与个人研究资产；历史 `research_export` 资产必须按原 owner 导出可读档案并完成对账交付后才删表。 | 资产对账报告 |
| PLAN-02 | MUST | 新 Fastify 5 内核必须零依赖旧 `Phase1` 运行时独立冷启动，禁止新旧两套写入器或调度器并写同一生产库，R3 物理删净旧链而不维护永久兼容双轨。 | 冷启动与依赖检查 |
| PLAN-03 | MUST | 全系统数据库仅允许新增 `monitor_project` 与 `monitor_project_source` 两张新表（`collection_source_id REFERENCES collection_source(id) ON DELETE CASCADE`）；`001..040` SQL 严禁修改，结构演化严格按 Expand-Migrate-Contract 推进 `041+` 前向迁移（先扩兼容列并在独立后续版本再删废弃列；本分支已校验的 041–043 保持 checksum，由 044 同事务恢复兼容投影列）；禁止对 `source_collection_job` 重复添加已由 `030_source_lifecycle.sql` 创建的 `parent_job_id`。 | 迁移静态与 PG16 验证 |

## 2. 既有数据库资产盘点与最小迁移矩阵

| 既有对象 | `041+` 迁移处置与约束条件 |
| :--- | :--- |
| `app_user` / `password` / `app_session` / `invite` / `audit` | 原样保留账户与历史口令；只扩展 `app_session`（`client_kind`、`label`、`scopes`、`allowed_source_ids`），复用现有 `token_hash` 与注销/过期索引，不建新 Token 表。 |
| `source` / `collection_source` / `source_collection_job` | 扩展 `collection_source`（`delivery_mode`、`primary_provider`、`fallback_provider`/`fallback_source_id`、`http_etag`、`http_last_modified`、`automatic_collection_blocked`）与 `source_collection_job`（`operation`、`request_key`、`request_json`、`provider`、`provider_state`、`fallback_of_job_id`，沿用 `030` 既有的 `parent_job_id`；为 `purpose='ingest'` 新增 `ingest_key`、`payload_hash`、`result_summary` 时，**必须显式对 `from_at`、`to_at`、`page_size`、`max_pages` 执行 `DROP NOT NULL`** 并将条件约束收窄至 `purpose='collect'`）；旧 `arctic_shift`/`twitterapi_io` 来源软归档并停发新任务。 |
| `content` / `content_discovery` / `content_observation` | 新增 `content.content_evidence_key TEXT NOT NULL`（强制 `COLLATE "C"`）、`content.content_version_fetched_at TIMESTAMPTZ NOT NULL` 及 `(created_at_source DESC NULLS LAST, id DESC)` / `reply_to` / `thread_root` 索引；`content_observation` 唯一键纳入 `provider`；回填历史行时不伪造 `content_observed_at`。 |
| `public_content_search_document` | 迁移阶段以独立长超时连接新增并回填单列 `search_text` + `title_length` + `GIN gin_trgm_ops`，卸载 `038` 失效 `DELETE` 触发器；旧 `normalized_title`/`normalized_text` 列延后至切流稳定后的后续 `043+` 迁移删除，保证回退安全。 |
| `monitor_project` / `monitor_project_source` | R2 唯一新建两张表：承载 `owner_user_id`、`filter JSONB`、`hydration JSONB`、`thread_aware`、`include_push_in_trends`、`revision` 与外键级联关联，不复制正文文本。 |
| `content_saved_query` / `content_annotation` | 保留 `user_id` 隔离与 `revision` 乐观锁，迁移旧可转换查询，明确输出无法等价转换项报告至 `output/`。 |
| `research_export` / `member` 与 7 张旧归档设想表 | R3 按原 owner 交付历史导出文件后实删 `research_export*`；7 张归档表（`dataset*`、`import_batch`、`archive_activity_day`）不进入主线库与迁移。 |

## 3. 重整前的遗留资产与处置矩阵

基于 `main@7045185` 全仓基线（457 源码文件 / ~73,534 LOC -> 实际重整目标参照 Branch A 已收敛结构 ~5,469 生产 LOC），当时列出的清理对象及前置条件；当前余项见[状态记录](../status.md)：

| 待清理遗留目录 / 文件组 | 删除前必须满足的保护门禁 |
| :--- | :--- |
| `src/connectors/x/twitterapi-io*`、`arctic-shift-content.connector.ts` 与旧 `ENV` 键 | 完成 `kaix` 与测试夹具对 `ArcticShift` 常量的解耦，X 集成用例已完整迁为 `x-content-pipeline.test.ts`；DB 已软归档旧源与停零预算。 |
| `src/domain/repositories/*`（保留 `ContentProvider`）与 14 个 `src/storage/repositories/in-memory/*` | 5 模块命名 SQL 与 PG16 + HTTP E2E 完全接管核心行为，停止新建任何 `InMemory*` 模拟。 |
| `apps/api/src/create-api-server.ts`（3,606 LOC）、`readyz-observability.ts` 及空壳 `service` / `runtime-factory` | Fastify 5 `app.ts` + `server.ts` 完整运行，`apps/api/src/create-api-server.ts` 移除后 `scripts/check-docs.ts` 自动扩大检查范围至 `apps/api/src/`。 |
| 旧 Phase1 scheduler/job/worker、`scrapling` 桥接、`opossum` 与 `rate-limiter-flexible` | 单进程有界轮询与 `@fastify/rate-limit` 验证通过，冷启动与依赖树零旧运行时残余。 |
| 旧 Phase1 / Markets / Target / Heat 前端页（16+ 页面）及旧冻结导出界面 | 五导航工作台及 `research_export` 历史资产按原 owner 交付核验完成。 |
| `deploy/*.service` 旧 systemd 启动链（过渡对照留档） | Docker Compose（Caddy + App + PG16）启动、编译迁移与 15s 优雅退出验证通过。 |

## 4. 切流部署窗口操作要点（单机 VPS）

1. **隔离副本预演**：在独立 PG16 库用编译后产物运行 `npm run build && npm run db:migrate:compiled`、`public_content_search_document` 回填对账、`pg_dump`/`pg_restore` 恢复演练，并在容器验证 `/readyz` 与流式导出。
2. **停写与末次快照**：暂停旧调度器、确认库内无 `unknown` 悬决付费任务，做末次全库物理备份；执行 `041+` 前向迁移与个人研究资产核对（本阶段保留旧列兼容回退余地）。
3. **带边界开放**：仅开放 Caddy `:443` 公网，内部 `db` 严禁宿主机端口映射；跑通登录、来源/推流、项目检索与下载后再解除维护锁。

## 5. R4 历史归档外挂规划：`plugins/zst-archive/`（独立演进）

在线主线稳定后，按需单独授权启动 `plugins/zst-archive/`（独立 Python / DuckDB 环境、依赖与测试，不入根 `tsconfig`、主线镜像、发布包与日常 CI）：

- 原始 `.zst` 归档（依据 `ArthurHeitmann/arctic_shift` 格式特性，单遍顺序流式解压，未核对总行数、拒绝行统计与备份完整性前严禁删除原始 `.zst`）在离线管线预先整理为标准化的归档包（当前实施直连已准备好的 `open-corpus-v1` Parquet + FTS5 包；外挂自身不再重复兼容未处理的 `.zst` 原始流）；
- 经离线 FTS5 + DuckDB 筛选后的高相关样本严格按 `ING-01` 构造成 `NormalizedContentItem[]`（保留真实 `timeBasis = 'archive_initial'` 与确定性 `Idempotency-Key`），通过鉴权 `POST /v1/sources/:id/ingest` 推流至在线主线（不混入默认 `pull` 趋势）。
