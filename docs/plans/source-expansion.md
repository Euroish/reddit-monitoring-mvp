# 主线演进边界、已完结 R1–R3 归档与外部外挂隔离规范

本文界定 R1–R3 主线重构的已交付结果、Post-050 数据库建表纪律，以及重型历史归档插件 `plugins/zst-archive/` 和 L3 高反爬外部采集器与主线内核的物理隔离规范。实码现状与 V2 Phase A–D 计划见[当前状态与规划](../status.md)。

---

## 1. 切换原则与 Post-050 建表纪律（`docs:check` 受控规则）

| ID | 等级 | 重建边界、迁移保护与外挂隔离准则 | 验收出口 |
| --- | --- | --- | --- |
| PLAN-01 | MUST | 结构演进或资产清理严禁破坏既有用户凭据、已验证内容观测证据或个人工作区数据；已删除的 27 张历史旧表与旧 `research_export*` 冻结表永不在新迁移中恢复。 | 备份校验与回归测试 |
| PLAN-02 | MUST | 主线运行时始终保持单一轻量化 `Fastify 5 + TypeBox + PG16 + React` 内核，零运行时依赖 Python、DuckDB、`.zst` 解压器或常驻无头浏览器；所有 R4 离线归档与 L3 高反爬采集器必须作为独立外部进程，仅经 `POST /v1/sources/:id/ingest` 推流通信。 | 依赖树与发布包清单检查 |
| PLAN-03 | MUST | 数据库在 Post-050 **20 张干净核心表**基线上遵循**节制演化纪律**：`001..050` 为已应用不可变历史迁移，禁止更改其校验和；结构演进严格按 Expand-Migrate-Contract 追加 **`051+` 前向迁移**，优先利用现有 JSONB 扩展缝隙，仅当需要稳定主键、高基数外键关联或高频聚合索引时方允许新增归一化核心表，**全库核心表上限严格控制在 `<= 26` 张**，且永不引入 7 张旧归档设想表。 | 迁移前缀守卫与 PG16 验证 |

---

## 2. R1–R3 主线重建与 `050` 物理清理完结总账

原计划清单中的旧运行时清理任务已于 **`041`–`050`** 全部落地并上线验证：
1. **旧代码清理完成**：`create-api-server.ts`、27 个单实现 `Repository`、14 个 `InMemory*` 模拟、`arctic-shift`、`twitterapi-io` 与旧 Phase1 运行时目录已物理删除（`scripts/check-docs.ts` 持续拦截其回潮）。
2. **数据库清理完成（`050`）**：校验全部 26/27 张遗留表零行无误后执行 `CASCADE` 清理，生产公网表由 **47 张精简至 20 张**（`content`、`content_discovery`、`content_observation`、`public_content_search_document`、`collection_source`、`source`、`source_collection_job`、`source_provider_budget`、`source_provider_usage`、`source_worker_heartbeat`、`monitor_project`、`monitor_project_source`、`content_annotation`、`content_saved_query`、`app_user`、`app_user_password`、`app_session`、`app_invite`、`app_audit_log`、`schema_migration`）。
3. **冗余投影清零**：彻底删除 `public_content_search_document.{normalized_title, normalized_text}` 及 `content`/`collection_source` 历史废弃列，将正文检索上限锁定至 `1,500` 字。

---

## 3. R4 历史归档外挂规范：`plugins/zst-archive/`（物理隔离演进）

- **现状锚点**：`origin/feat/semrush-frontend-rebuild` 分支中的历史提交 `40fb284` 留有一份面向 `.zst`/Parquet 开放语料批量推流的 `plugins/zst-archive/` 验证实现，**本仓库 `prod` 主干刻意不合入该目录**，保持与线上运行容器、根 `tsconfig.json`、`Dockerfile` 和 `scripts/package-release.mjs` 的零耦合边界。
- **独立运行约束**：未来如启用离线 `.zst` 归档回放，继续仅在仓外或独立插件工作区运行 Python + DuckDB 顺序流式转 12 列排序 Parquet，筛选高价值条目后严格按 `ING-01`（带 `timeBasis = 'archive_initial'` 与 `Idempotency-Key`）经只读限定来源的 `ingest` Machine Key 推送到 `POST /v1/sources/:id/ingest`（默认不计入首页 `pull` 趋势）。

---

## 4. L3 外部异构采集器（Collector Sidecar）推流边界（V2 Phase C）

针对小红书、豆瓣、Telegram 频道、Instagram/TikTok 创作者等需强反爬代理、Cookie 会话或浏览器渲染的高价值生活与社交信源：
1. **独立容器 / 外部 Worker 部署**：严禁把 RSSHub（AGPL）、Playwright、Python curl-cffi 或住宅代理逻辑放入主线 Fastify 应用；
2. **最小授权凭证**：在 `/settings` 为外部收集器签发只含 **`ingest`** scope 且 **`allowedSourceIds` 严格锁定对应逻辑源 UUID**（`deliveryMode='push'`、`primaryProvider='external_ingest'`）的 1–90 天 Machine Key；
3. **幂等标准负载**：每次推送 `1–100` 条符合 `ContentItem` TypeBox Schema 的规范对象（附带完整 `publishedAt`、去追踪参数后的 `url`、`textCompleteness` 与唯一 `evidenceKey`），共享主线 `commitContentBatch` 事件聚簇、语言识别与搜索索引全部能力。
