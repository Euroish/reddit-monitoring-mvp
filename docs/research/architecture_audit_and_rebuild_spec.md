> [!NOTE]
> **历史基线档案提示（`2026-11-16` / `main@7045185`）**：本文件完整保留 R1–R3 重建前的代码尸检与 SQL 推导母本；生产环境已于 `2026-11-19` 完成 `050` 27 表清理与引擎修复，当前在线事实与 V2 演进规划请以[当前状态](../status.md)、[主线架构规范](../architecture.md)与[数据与 API 契约](../contracts.md)为准。

# `reddit-monitoring-mvp` 深度审查、单机架构与外挂解耦母本（Master Spec）

> **文档定位**：本文件保留基于 `main@7045185`（576 文件 / 74,468 LOC）的代码尸检、核心决策推导、`GAP-01..06` SQL 蓝图与外挂 `.zst`/Parquet 技术依据，与[主线架构规范](../architecture.md)、[数据与 API 契约](../contracts.md)、[产品交互规范](../design.md)保持一致。当前代码进度、双分支对照与下一阶段收敛序列请直接查阅[当前状态与下一阶段](../status.md)。

---

## 0. 五项顶层架构决策（溯源共识）

1. **主线与离线归档物理隔离**：主线只运行 `Fastify 5 + TypeBox + PostgreSQL 16 + 在线 Connectors + React`，零 Python / DuckDB / `.zst` 依赖，永不恢复 7 张归档表。未来 `plugins/zst-archive/` 作为 R4 独立外挂，只通过鉴权 `POST /v1/sources/:id/ingest` 推流少量筛选条目。
2. **退役高成本与脆弱旧源，升级双平台渠道**：依据 2026-11-16 公开核验与连通实测，彻底清理 `Arctic Shift`（高超时 `422` 与限流）和 `TwitterAPI.io`（`$0.15/1k` 超参考线且与 `kaitoeasyapi` 同源）。Reddit 采用 `kaix`（解封后主力，`$0.02/1k`）+ `red_crawler`（FREE 作者费，Actor 级备源）；X 采用 `TwitterAPIs`（`$0.0008/call` $\approx \$0.04/1\text{k}$ 主力）+ `ScrapeBadger`（原生批量 ID 补全、失败零扣费备源）；资讯补充精选 `NewsNow` MIT getter 与白名单 `feed`。
3. **逻辑来源分离与三阶漏斗**：区分 `Platform`、`Provider` 与逻辑 `CollectionSource`；解禁 `commitContentBatch` “单任务单一 `kind`”限制，支持同事务混合写入主帖、评论与父链；核心流收拢为“增量发现（Radar）-> 确定性门控（Signal Gate）-> 显式批量水合（Hydrate）-> 联动证据与三视图评论树”。
4. **撤销双轨模拟与冻结表（方案 B）**：只保留外部 `ContentProvider` 接口，内部五模块直写接收 `Pool | PoolClient` 的命名 SQL 函数，废除 27 个单实现 `Repository` 与 14 个 `InMemory*`（106 KB 纯冗余）。退役 `research_export` 冻结表与服务，全系统只建 `monitor_project` 与 `monitor_project_source` 两张新表。
5. **同契约开放 API 与反 AI 过度设计**：Web 端与外部 AI Agent 共享 TypeBox契约、权限与 `compileContentFilter`，不设第二套后台；只读 Agent 强制绑定无写/无触发采集权限的只读机器 Key 隔离提示词注入风险。拒绝压行面条代码与机械白名单，用格式化前校验、可读行宽/文件行数上限与 AST 守住简洁内核。

---

## 1. 现状实码量化尸检（`main@7045185` 基线）

| 分类 | 文件数 | 行数 (LOC) | 字节数 | 问题诊断与减法去向 |
| :--- | ---: | ---: | ---: | :--- |
| **旧产品链生产代码** | 91 | 21,335 | 767 KB | `create-api-server.ts` (3,606 LOC)、`collect-subreddit-new-posts.job.ts` (1,996 LOC)、`reddit-phase1.worker.ts` (1,587 LOC)、`readyz-observability.ts` (793 LOC)、`opossum`、`rate-limiter-flexible`、Scrapling 桥、27 个单实现接口。**随重整实删**。 |
| **旧链路与冗余测试** | 36 | 15,001 | 511 KB | `api-server-trends.test.ts` (2,124 LOC)、`api-server-readyz.test.ts` (2,081 LOC) 等随旧链路清除。 |
| **旧维护/实验脚本** | 18 | 4,628 | 169 KB | `*phase1*`、`shadow-compare` 等含 `25` 处循环 `await` 脚本清除。 |
| **前端废弃页面** | 11 | 2,819 | 121 KB | `MarketBoard`、`TargetDetail` (800 LOC)、`Compare`、`Queries` 与冻结视图清除。 |
| **公共核心双轨与压行** | 139 | 14,060 | 652 KB | 14 个 `InMemory*Repository` (2,185 LOC / 106 KB) + 压行 `postgres-source-content.repository.ts` (305 行塞 50,868 字节，单行 > 600 字符)。**重写为清晰功能模块与直白 SQL**。 |
| **公共双跑测试** | 116 | 9,045 | 594 KB | 删除 InMemory 与 PG 双跑重复测试，收敛为纯函数单测 + 唯一真实 PG16 E2E。 |

---

## 2. 既有代码（`029`–`040`）8 类根因缺陷与 `GAP-01..06`

1. **`[AUD-01]` InMemory 模拟冗余**：`src/storage/repositories/in-memory/`（106 KB）无法测出行锁死锁、MVCC 触发器与 `pg_trgm` 边界，反而迫使每次字段演进双端改写。
2. **`[AUD-02]` 压行代码陷阱与反教训**：旧代码出现 22 行 6 KB、305 行 50 KB 的超长单行压行；早期治理一度在 `check-docs.ts` 套用“两文件硬白名单 + 300 字符注释拦截”作为矫枉手段，结果反过来诱导在有限文件内堆出千行 `sql.ts` 上帝文件。现已更正为：放开模块内合理拆文件，同时用非模板代码单行 <= 220 字符与单文件 <= 450 行守住真实可读性。
3. **`[AUD-03]` 列表热路径 `coverage COUNT(*)` 与 `038` 失效触发器**：每次分页全表扫 `LEFT JOIN public_content_search_document` 并先 `DELETE` 投影，在 100 万行规模下会把 `< 5ms` 翻页拖垮至 `> 500ms`。改为写入事务原子同步投影 + 单列回填后撤除 `038` 触发器，分页只做 `limit + 1` Seek。
4. **`[AUD-04]` `contentWorkbench` 10+ 次循环全扫与 `listAnnotations` `1+N`**：分别替换为单条 CTE `GROUPING SETS`（含 `providers` 独立去重聚合）与单条 `JOIN content`。
5. **`[AUD-05]` `ResearchExport` 冻结模型**：三重全扫与 32 MiB 内存拷贝替换为 `REPEATABLE READ` + `pg-query-stream` 流式下载（方案 B）。
6. **`[AUD-06]` `commitPage` 逐条 404 次往返与时钟混淆**：改为 4 组 `UNNEST` 集合写、独立 `content_version_fetched_at` 与 `C` collation `content_evidence_key`（严禁混入 `fetchedAt`），以及 `ON CONFLICT DO UPDATE` 加 `IS DISTINCT FROM` 防伪更新计数。
7. **`[AUD-07]` 假时间排序与 12 位 ID 截断**：统一基于 `created_at_source DESC NULLS LAST, id DESC` 双分支 Seek，Reddit base36 扩至 2–32 位并下线 `Arctic Shift`。
8. **`[AUD-08]` `kaix` 四项限制与 60s 阻塞丢 Run**：解除旧参数锁死，实行 `starting -> running -> reading -> committed` 异步持久化；优雅退场 `SIGTERM` 释放租约保 `runId` 而不拉黑来源。

---

## 3. 核心零漂移 SQL 架构参考模板

### 3.1 `commitContentBatch` 四组集合 `UNNEST` 与版本决胜

```sql
-- 事务外先完成同批单轮版本归约，observations 按确定键排序防并发死锁；
-- 服务端统一派生 content.id（忽略 /ingest 外部传入 id）；短事务按 source -> job -> identity 加锁：
WITH input_rows AS (
  SELECT *
  FROM unnest(
    $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[],
    $7::text[], $8::timestamptz[], $9::timestamptz[], $10::jsonb[], $11::jsonb[],
    $12::jsonb[], $13::jsonb[], $14::text[], $15::text[], $16::timestamptz[],
    $17::text[]
  ) AS t(
    id, source_id, kind, external_id, title, body_text, url,
    created_at_source, fetched_at, content_author, content_media,
    content_references, platform_details, language, availability,
    content_observed_at, content_evidence_key
  )
)
INSERT INTO content (
  id, source_id, kind, external_id, title, body_text, url, permalink,
  created_at_source, first_seen_at, last_seen_at,
  content_author, content_media, content_references, platform_details,
  language, availability, content_observed_at, content_version_fetched_at, content_evidence_key
)
SELECT
  id, source_id, kind, external_id,
  CASE WHEN availability IN ('deleted', 'removed') THEN NULL ELSE title END,
  CASE WHEN availability IN ('deleted', 'removed') THEN NULL ELSE body_text END,
  url, url, created_at_source, fetched_at, fetched_at,
  content_author, content_media, content_references, platform_details,
  language, availability, content_observed_at, fetched_at, content_evidence_key
FROM input_rows
ON CONFLICT (source_id, kind, external_id) DO UPDATE SET
  title = CASE
    WHEN (EXCLUDED.content_observed_at IS NOT NULL, COALESCE(EXCLUDED.content_observed_at, EXCLUDED.content_version_fetched_at), EXCLUDED.content_evidence_key COLLATE "C")
       > (content.content_observed_at IS NOT NULL, COALESCE(content.content_observed_at, content.content_version_fetched_at), content.content_evidence_key COLLATE "C")
    THEN CASE WHEN EXCLUDED.availability IN ('deleted', 'removed') THEN NULL ELSE COALESCE(EXCLUDED.title, content.title) END
    ELSE content.title
  END,
  body_text = CASE
    WHEN (EXCLUDED.content_observed_at IS NOT NULL, COALESCE(EXCLUDED.content_observed_at, EXCLUDED.content_version_fetched_at), EXCLUDED.content_evidence_key COLLATE "C")
       > (content.content_observed_at IS NOT NULL, COALESCE(content.content_observed_at, content.content_version_fetched_at), content.content_evidence_key COLLATE "C")
    THEN CASE WHEN EXCLUDED.availability IN ('deleted', 'removed') THEN NULL ELSE COALESCE(EXCLUDED.body_text, content.body_text) END
    ELSE content.body_text
  END,
  availability = CASE
    WHEN (EXCLUDED.content_observed_at IS NOT NULL, COALESCE(EXCLUDED.content_observed_at, EXCLUDED.content_version_fetched_at), EXCLUDED.content_evidence_key COLLATE "C")
       > (content.content_observed_at IS NOT NULL, COALESCE(content.content_observed_at, content.content_version_fetched_at), content.content_evidence_key COLLATE "C")
    THEN EXCLUDED.availability ELSE content.availability
  END,
  content_observed_at = CASE
    WHEN (EXCLUDED.content_observed_at IS NOT NULL, COALESCE(EXCLUDED.content_observed_at, EXCLUDED.content_version_fetched_at), EXCLUDED.content_evidence_key COLLATE "C")
       > (content.content_observed_at IS NOT NULL, COALESCE(content.content_observed_at, content.content_version_fetched_at), content.content_evidence_key COLLATE "C")
    THEN EXCLUDED.content_observed_at ELSE content.content_observed_at
  END,
  content_version_fetched_at = CASE
    WHEN (EXCLUDED.content_observed_at IS NOT NULL, COALESCE(EXCLUDED.content_observed_at, EXCLUDED.content_version_fetched_at), EXCLUDED.content_evidence_key COLLATE "C")
       > (content.content_observed_at IS NOT NULL, COALESCE(content.content_observed_at, content.content_version_fetched_at), content.content_evidence_key COLLATE "C")
    THEN EXCLUDED.content_version_fetched_at ELSE content.content_version_fetched_at
  END,
  content_evidence_key = CASE
    WHEN (EXCLUDED.content_observed_at IS NOT NULL, COALESCE(EXCLUDED.content_observed_at, EXCLUDED.content_version_fetched_at), EXCLUDED.content_evidence_key COLLATE "C")
       > (content.content_observed_at IS NOT NULL, COALESCE(content.content_observed_at, content.content_version_fetched_at), content.content_evidence_key COLLATE "C")
    THEN EXCLUDED.content_evidence_key ELSE content.content_evidence_key
  END,
  created_at_source = COALESCE(content.created_at_source, EXCLUDED.created_at_source),
  first_seen_at = LEAST(content.first_seen_at, EXCLUDED.first_seen_at),
  last_seen_at = GREATEST(content.last_seen_at, EXCLUDED.last_seen_at)
-- 实现时附带 IS DISTINCT FROM 仅对正文/版本真变更行执行搜索投影重写与计入 updated
RETURNING id, kind, external_id, title, body_text, availability, (xmax = 0) AS inserted;
-- 第 2–4 组 SQL：依据实际变更 RETURNING 同步 public_content_search_document、UNNEST content_discovery、sorted UNNEST content_observation
```

### 3.2 `projects` 单 SQL 锚点 `GROUPING SETS` 概览

```sql
WITH matched_nodes AS (
  SELECT c.id AS evidence_id, c.source_id, c.kind AS evidence_kind,
         COALESCE(root_c.id, c.id) AS anchor_id,
         to_char(c.created_at_source AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS pub_day
  FROM content c
  LEFT JOIN LATERAL (
    SELECT r.id FROM content r
    WHERE /* threadAware=true 时查找同一授权范围内的可见根帖 */
    LIMIT 1
  ) root_c ON TRUE
  WHERE /* compileContentFilter(actorAndProjectScope, filter) */
),
facets AS (
  SELECT GROUPING(pub_day) AS grp_day, GROUPING(source_id) AS grp_platform,
         GROUPING(evidence_kind) AS grp_kind, pub_day, source_id, evidence_kind,
         COUNT(DISTINCT anchor_id)::bigint AS cnt
  FROM matched_nodes
  GROUP BY GROUPING SETS ((), (pub_day), (source_id), (evidence_kind))
),
providers AS (
  SELECT o.provider, COUNT(DISTINCT m.anchor_id)::bigint AS cnt
  FROM matched_nodes m
  JOIN content_observation o ON o.content_id = m.evidence_id
  JOIN collection_source cs ON cs.id = o.collection_source_id
  WHERE /* 同一 actor ∩ project 来源范围 */
  GROUP BY o.provider
)
SELECT (SELECT jsonb_agg(facets) FROM facets) AS facets,
       (SELECT jsonb_agg(providers) FROM providers) AS providers;
```

---

## 4. R4 外挂格式论证与 DuckDB 转 Parquet 参考（不入主线代码树）

- **为什么不能直接随机 Seek `.zst`**：依据 `ArthurHeitmann/arctic_shift` 格式变化，2024-04 起仅提供连续 UTF-8 JSON `.zst` 流（`windowLogMax = 31`），任意字节偏移跳读缺乏帧可靠性；且 `retrieved_on` 与 `_meta.retrieved_2nd_on` 可能分属不同抓取时点。
- **12 列排序自索引 Parquet 方向**：在独立 R4 `plugins/zst-archive/` 环境通过 DuckDB `COPY (SELECT ... ORDER BY subreddit_lower, created_utc) TO ... (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)` 构建本地列存，检索命中少量条目后再按 `ING-01` 规范推入主线。实际体积与查询延迟以 R4 启用后实测为准。
