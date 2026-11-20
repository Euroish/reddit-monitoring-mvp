# 主线演进边界、已完结 R1–R3 归档与外挂隔离规范（STD-100）

本文界定 R1–R3/`050` 清理结果、Post-050 建表纪律以及 R4 `plugins/zst-archive/` 和 L3 外部采集器的物理隔离边界。现状与 V2 规划见[当前状态](../status.md)。

---

## 1. 演进原则与外挂隔离规则（`docs:check` 受控 ID）

| ID | 等级 | 重建边界、迁移保护与外挂隔离准则 | 验收出口 |
| --- | --- | --- | --- |
| PLAN-01 | MUST | 结构演进或清理 `MUST NOT` 破坏已有账户凭据、已入库观测或个人资产；已删 27 张历史表与旧 `research_export*` 冻结表永不恢复。 | 备份验证与回归测试 |
| PLAN-02 | MUST | 主线运行时锁定单一轻量化 `Fastify 5 + TypeBox + PG16 + React` 内核，严禁引入 Python、DuckDB、`.zst` 解压器或常驻无头浏览器；所有 R4 归档与 L3 高反爬采集器 `MUST` 外置运行且仅通过鉴权 `POST /v1/sources/:id/ingest` 推流。 | 依赖树与发布包测试 |
| PLAN-03 | MUST | `001..050` 为不可变已应用迁移（`scripts/check-docs.ts` 拦截修改）；结构变更按 Expand-Migrate-Contract 追加 **`051+` 前向迁移**，优先利用既有字段与 JSONB，**全库核心表总上限严格锁定 `<= 24` 张**（基线 `20`），永不恢复 7 张旧归档设想表。 | `docs:check` 与 PG 迁移校验 |

---

## 2. 已完结项：R1–R3 重建与 `050` 物理清理

1. **旧运行时已清零**：`create-api-server.ts`、27 个单实现 `Repository`、14 个 `InMemory*`、`arctic-shift`、`twitterapi-io` 与旧 Phase1/Workers 目录均已实删（由 `scripts/check-docs.ts` 拦截回潮）。
2. **`050` 27 表清理已上线**：对 `retired TEXT[]` 中 26 张旧表执行零行校验后删除共 27 张废弃表（连同 `source_dispatch_state`），生产表收敛至 `20` 张；同时删除 `public_content_search_document.{normalized_title, normalized_text}` 及 `content`/`collection_source` 废列。

---

## 3. R4 离线归档外挂：`plugins/zst-archive/`（物理隔离）

- **现状**：`origin/feat/semrush-frontend-rebuild@40fb284` 存有一份面向开放语料推送的 `plugins/zst-archive/` Python/DuckDB 实现；`prod` 主线刻意保持不包含该目录。
- **契约约束**：未来如独立启用 R4，仍须在仓外或隔离环境中单遍流式转 12 列排序 Parquet，仅筛选高相关条目按 `ING-01`（`ContentItem` 中 `id` 可选，带 `timeBasis = 'archive_initial'` 与 `Idempotency-Key`）推入 `POST /v1/sources/:id/ingest`，并在数据源标记 `stream_class = 'archive'` 确保不混入默认首页流与趋势。

---

## 4. `[V2 Phase C]` L3 外部异构采集器 Sidecar 隔离边界

针对小红书、豆瓣、Telegram、Instagram/TikTok 等强反爬或动态渲染源：
1. **外置部署**：在主线容器外运行独立收集器（或受控自建 RSSHub / 托管 Actor）；
2. **最小授权**：签发只含 `ingest` scope 且 `allowedSourceIds` 锁死目标源 UUID 的 1–90 天 Machine Key，调用 `POST /v1/sources/:id/ingest`（每批 1–100 项、`<=1 MiB`、`Idempotency-Key` 幂等）；
3. **首页可见性前置依赖**：`[V2]` Phase C 接入前须按[主线架构](../architecture.md#4-v2-l1l3-扩源自适应调度与单机安全基线)为 `collection_source` 增加 **`stream_class` (`live` \| `archive` \| `adhoc`)**，将 L3 实时推送源标记为 `live` 方可进入默认首页 `/` 与趋势统计。
