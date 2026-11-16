# `reddit-monitoring-mvp` 终版架构审查、产品升级与开放 API 重建总规范（Master Spec）

> **文档状态与定位**：本文件是 `main` 分支的**完整架构审查溯源与重建总规范（Master Spec）**，在 `a078c9c` 基线代码尸检、2026-11-16 数据源实测及 `df8ab15` / `8ba0d65` / `90dbe9a` / `fefdb8c` / `93ca276` 多轮深化对齐基础上合并定案。后续业务编码严格落实到[产品与架构](../README.md)、[主线架构规范](../architecture.md)、[数据与 API 契约](../contracts.md)、[产品交互规范](../design.md)、[R1–R4 重建与实删计划](../plans/source-expansion.md)及[来源替换规格](./source_replacement_and_twitterapi_io_removal_spec.md)中，各规范编号唯一定义且由 `npm run lint` 静态校验，彻底消除文档冲突与漂移。

---

## 1. 五大锁定顶层决策（Finalized Product & Architecture Decisions）

1. **主线核心与离线归档外挂彻底物理隔离（Core vs. Plugin）**：
   - **远端单机在线主线（Mainline Core）**：聚焦于 7×24 安全稳定运行的在线多平台信息监测与讨论证据研究系统——**Fastify 5 + TypeBox + PostgreSQL 16 + 在线 Connectors + React 五页工作台**。主线容器镜像、迁移、备份、打包白名单（`scripts/release-package-lib.mjs`）与日常测试**零 Python / DuckDB / `.zst` 依赖**，彻底取消原规划的 7 张归档表（`dataset`、`import_batch`、`dataset_partition_revision`、`dataset_release`、`dataset_release_partition`、`dataset_content`、`archive_activity_day`）与顶层“数据集”页面。
   - **历史归档外挂（External Plugin `plugins/zst-archive/`）**：独立外挂客户端留待 R4 按需演进，主线只在 `collection` 暴露标准化鉴权推流口 `POST /v1/sources/:id/ingest`（复用 `commitContentBatch` 与 `source_collection_job` 幂等回执），不感知 `.zst`、Parquet、manifest 或全档汇总。
2. **彻底退役并实删 `Arctic Shift` 与 `TwitterAPI.io` 在线连接器，升级低价双源矩阵**：
   - **`Arctic Shift` 实测破产证据（2026-11-16）**：大中版块搜帖/搜评论即刻 **`422 Timeout`**（1.6s–10.2s），评论树端点即刻触发 `x-ratelimit-reset: 51` 强限流；Reddit 官网匿名端点实测均返回 **`HTTP 403`**。
   - **`TwitterAPI.io` 成本超限证伪（2026-11-16 核对 `/pricing.json`）**：按量 **`$0.15/1k`**（空请求保底扣 15 credits），`$1,499/月` Business 满吃返点理论地板仍达 **`$0.0789/1k`**，超出参考线且与 Apify `kaitoeasyapi` 同属一间公司。
   - **最终双平台选型定案**：Reddit 采用 **`kaix/reddit-scraper`（解封后主力）+ `red_crawler/reddit-search-v2` & `reddit-scrape-v2`（FREE 作者费备源与评论补全）**；X 采用 **`TwitterAPIs`（`$0.0008/call` 主力低价源）+ `ScrapeBadger`（`1 base + 1/item`、原生 `GET /v1/twitter/tweets/` 批量 ID 补全且失败零扣费的独立异构备源）**；资讯补充精选 `NewsNow` MIT getter 与受控 `feed`。`arctic_shift` 与 `twitterapi_io` 在线代码在 R1–R3 解耦实删，历史 DB 记录经软归档与零额度锁定完整保留。
3. **产品形态升级：逻辑来源分离 + 三阶信号漏斗 + 评论树深度利用**：
   - 将领域模型精准拆分为 **`Platform`**（`source` 表）、**`Provider`**（渠道）、**`CollectionSource`**（`collection_source` 逻辑监测目标，挂载 `primaryProvider` 与可选单跳 `fallbackProvider`），项目与机器 Key 只授权逻辑来源一次，观测唯一键纳入 `provider`（`(contentId, collectionSourceId, provider, evidenceKey)`）防止主备数据碰撞。
   - 确立**增量发现（Radar）$\to$ 确定性三段词与信号门控（Signal Gate）$\to$ 按需批量水合讨论树（Hydrate）$\to$ 联动锚点证据展示与三视图阅读**核心闭环；解除 `commitContentBatch` “单任务单一 `contentKind`”锁死，彻底释放 `kaix` 连带层序评论与 `postUrls` 批量水合能力。
4. **砍掉单实现 `*Repository` 接口、`InMemory*` 模拟与冻结快照表（方案 B）**：
   - 全仓仅保留外部多实现 `ContentProvider` 接口；5 个业务模块默认 `routes.ts + sql.ts`，直接调用接收 `Pool | PoolClient` 的命名参数化 SQL 函数，由 `scripts/check-docs.ts` 对 `src/modules/` 做 AST 强制门禁（禁止包装类、`*Repository`、引入旧 `runtime`/仓储层，单条注释 `<= 300` 字符）。
   - 退役 `ResearchExportService`、`research_export` / `research_export_member` 冻结表与界面；工作区保留 `content_saved_query` + `content_annotation` + 有界只读 `REPEATABLE READ` 游标流式 CSV/JSON 导出；**全系统仅新增 `monitor_project` 与 `monitor_project_source` 两张表**。
5. **Agent-First 开放 HTTP API + 远端单机安全与零漂移工程基线**：
   - 人类 Web 端与外部 AI Agent **100% 共用同一 TypeBox Schema、权限边界与 `compileContentFilter(scope, filter)`**（`GET /v1/capabilities` + `GET /v1/openapi.json` + 扩展 `app_session` 的细粒度机器 Key），零数据库旁路、零第二套后台。
   - 消除旧代码与早期草图全部规格漂移（见 §2.2），验证聚焦“纯函数单测 + 一套真实 PG 16 HTTP E2E + 关键端到端浏览器任务流”。

---

## 2. 实码尸检、规格纠偏与缺陷定位（Observed Baseline）

经对仓库全量源码与 `029`–`040` 公共内容演进代码逐行核查，当前 `0.9.1` 代码重构前存在以下精确可观测缺陷：

### 2.1 实码体量与关键缺陷定位（`AUD-01..08`）

- **`AUD-01`（双轨仓储冗余）**：`src/storage/repositories/in-memory/` 含 **14 个文件 / 2,185 行 / 106,212 字节**，用 `Map` 与 `structuredClone` 手工模拟 PG 事务、租约与 `REPEATABLE READ`；`src/domain/repositories/` 含 **27 个文件 / 655 行**，全部为一对一单实现抽象。除 `ContentProvider` 外全删。
- **`AUD-02`（压行伪装 Code Golfing）**：`postgres-source-content.repository.ts`（**305 行 / 50,868 字节**）、`content-personal.service.ts`（**22 行 / 6,129 字节**）、`Content.tsx`（**211 行 / 39,048 字节**）存在单行 600–890 字符的严重压行与多层三元嵌套，前端并堆砌内部术语说明框；`create-api-server.ts` 膨胀至 **3,606 行 / 131 KB**、`readyz-observability.ts` 达 **793 行**。R1–R3 彻底拆解重写为人类可读垂直代码。
- **`AUD-03`（分页热路径全库 `coverage` + `038` 失效触发器）**：`listContent()` 每次分页先对全量 `LEFT JOIN public_content_search_document` 跑 `COUNT(*)`；`038_public_content_search_document.sql` 触发器在内容更新时先 `DELETE` 投影造成死元组与缺索引窗口。须新迁移回填校验后移除 `038` 触发器，列表只取 `limit + 1`。
- **`AUD-04`（概览 10+ 次全扫与批注 `1+N`）**：`content-workbench.service.ts` 循环平台与渠道多次跑 `contentStats`；`content-personal.service.ts#L21` 在 `for` 循环中逐条 `getContent()`。改为单 SQL `GROUPING SETS` 与 `JOIN content`。
- **`AUD-05`（冻结三重全扫与 32 MiB 内存驻留）**：`research-export.service.ts` 拉 2 万行进入 `structuredClone` 再分批写回 `research_export_member`。按方案 B 迁出原资产后退役。
- **`AUD-06`（400+ 次页内往返、版本无稳态时钟与删后复活漏洞）**：`postgres-source-content.repository.ts#L102-L127` 页内循环每项发 4 条 SQL，缺乏 `content_evidence_key` 平局决胜，较新缺字段输入会用 `NULL` 擦除已知正文，且缺少独立 `content_version_fetched_at`。改为 4 组 `UNNEST` 集合写。
- **`AUD-07`（排序语义失真与长 ID 截断）**：`postgres-source-content.repository.ts#L250-L255` 使用 `COALESCE(created_at_source, first_seen_at)` 偷替未知发布时间；`arctic-shift-content.connector.ts` 限制 `2–12` 位 ID 破坏 13 位评论。
- **`AUD-08`（`kaix` 4 项人为封印与同步 Wait 丢 Run 风险）**：`kaix-content.connector.ts#L60-L87` 锁死 `includeComments=false`、100 条、`mode="post"` 丢主帖、`literal()` 误杀布尔式，且同步 `waitForFinish=60` 遇到 `RUNNING` 即直接抛错丢失云端正在计费的 `runId`/`datasetId`。

### 2.2 必须锁死的 9 项零漂移纠偏规则

为杜绝 R1–R4 返工，以下纠偏已全部写入正式契约与架构文档：
1. **禁用 `last_seen_at` 作版本比较时钟**：新增 `content_evidence_key TEXT NOT NULL`（`C` collation）与 `content_version_fetched_at TIMESTAMPTZ NOT NULL`，仅在接受胜出正文版本时更新；严禁落后 `available` 记录复活已 `deleted/removed` 正文。
2. **禁止在 `evidenceKey` 中掺入读取时刻 `fetchedAt`**：`evidenceKey` 必须由稳定 `operation` / `runId` / 快照桶与规范摘要计算；同一 Actor Dataset 重读维持同一 `evidenceKey` 与原 `fetchedAt`（观测唯一键为 `(contentId, collectionSourceId, provider, evidenceKey)`）。
3. **付费调用强制 `starting -> running -> reading -> committed` 异步恢复**：发外部收费创建前持久化 `starting`，拿到 `runId` / `datasetId` 立即写库支持轮询续读；超时或创建未明入 `unknown` 态，永久阻断自动重试与切备，仅人工作确认 `acknowledgePotentialCharge = true` 可发起新操作。
4. **物理列名显式对齐**：领域字段 `publishedAt` 在 PostgreSQL 对应物理列 **`content.created_at_source`**，`QRY-05` 双分支 seek SQL 与 B-tree 复合索引直接作用在 `c.created_at_source DESC NULLS LAST, c.id DESC`。
5. **解除 `item.kind === source.contentKind` 校验 + 明确外键约束**：`collection_source` 挂载 `primaryProvider`/`fallbackProvider`；`monitor_project_source` 外键明确指向 `collection_source(id) ON DELETE CASCADE`；`source_collection_job` 在 `purpose = 'ingest'` 时显式 `DROP NOT NULL` 于 `from_at` / `to_at` / `page_size` / `max_pages`。
6. **概览 `GROUPING SETS` 使用 `GROUPING(pub_day)` + `COUNT(DISTINCT anchor)`**：区分总计 `NULL` 与未知发布时间桶 `NULL`；`byDiscoveryProvider` 按去重 `matched` 锚点单独聚合，严禁 `JOIN facets` 放大。
7. **单列全文投影禁用 `strpos()`**：以 `U+001F` 拼接 `normTitle` 与 `normText`（用 PG `char_length` 存 `title_length`），所有检索先转义 `%`/`_`/`\` 后生成参数化 `LIKE` 命中 `pg_trgm` GIN，再用 `substring` 精确验证字段边界。
8. **流式导出独立空闲预算 + 代理禁缓冲**：导出连接使用事务局部 `SET LOCAL idle_in_transaction_session_timeout = '35s'`（单条 SQL 仍 `10s`，HTTP 流总限 `30s`），响应头固定输出 `X-Accel-Buffering: no`。
9. **容器私有网络与 15s 优雅退场**：Compose 内 `db` 不绑定 `ports:` 公网端口（`app` 通过服务名访问私网 PG）；应用退出总预算 **`15s`**（高于 10s SQL 熔断），守护进程宽限 `30s`，单机切换不虚构零停机。

---

## 3. 产品升级：低价双源矩阵、三阶信号漏斗与 `kaix` 解封

### 3.1 低价异构双源采集架构

| 平台 | 主/备角色 | 数据源 | 真实计费与稳定性边界 | 接入契约与防坑约束 |
| :--- | :--- | :--- | :--- | :--- |
| **Reddit** | **主力源** | **`kaix/reddit-scraper`** (build `0.2.25`) | `$0.02 / 1k` 结果 + Apify Compute | 解除 4 项封印；异步 `runId` 恢复；无游标恒标 `coverage = "partial"`；`automaticRequestReplay = false`。 |
| **Reddit** | **Actor 级备源** | **`red_crawler/reddit-search-v2` + `reddit-scrape-v2`** | 作者费 `FREE`，仅耗 Apify Compute | 共用 `APIFY_API_TOKEN`（与 `kaix` 同属 Apify 故障域）；补充 `search_type="comments"` 全站评论关键词搜索、多社区逗号并发搜索与评论树。 |
| **X** | **主力低价源** | **`TwitterAPIs`** (`api.twitterapis.com`) | `$0.0008 / call`（满页 20 条 $\approx \$0.04/1\text{k}$），`$10+` 永不过期 | `refreshByIds: false`（禁自动拆单条刷 ID）；以空 `tweets` / 重复 `cursor` 停页；禁接 `$0.004/call` 且仅顺向的 `/tweet/thread`；禁跑稀疏词时间二分树。 |
| **X** | **异构独立备源** | **`ScrapeBadger`** (`scrapebadger.com/v1/twitter`) | `1 base + 1 credit/item`，PAYG 永不过期，**`4xx/5xx` 零扣费** | **`refreshByIds: true`**（原生 `GET /v1/twitter/tweets/` 批量补全）；时间窗编入 `query`（`since_time:`/`until_time:`）；按账户档位限制间隔（`>= 12s` / PAYG `>= 1s`）；头 `X-Credits-Used` 记入请求级诊断。 |
| **资讯/订阅** | **补充源** | **`NewsNow` 精选 getter + 通用 `feed` (受控 RSSHub)** | `$0`（MIT 裁剪函数 + 白名单 HTTP RSS/Atom） | `canonical URL` 去重、`web.rank` 只作名次、`ETag`/`304` 只刷 `lastCheckedAt`；管理员白名单防 SSRF。 |
| **归档外挂** | **未来扩展 (`R4`)** | **`plugins/zst-archive/`** | 离线独立运行 | 仅按需挑选少量样本通过 `POST /v1/sources/:id/ingest` 推入主线。 |

### 3.2 解除 `kaix-content.connector.ts` 的 4 项人为封印
1. 移除对 `ARCTIC_SHIFT_CAPABILITY.metrics` 的导入依赖（内联或抽入 Reddit 共享常量）；
2. 开放 `includeComments`、`maxCommentsPerPost`（`15~50`）、`commentSort`（`top | confidence | new`）、`time` 与 `sort`，利用其层序抓取必保留父节点特性一次采回主帖+Top 评论；
3. 支持 `mode = "post"` 传入 `10~30` 个批量 `postUrls[]`，并**删除第 79 行丢弃根帖逻辑**，使水合同时刷新根帖指标并入库完整回复树；
4. 删除第 85 行误杀原生布尔查询的客户端 `literal().includes()` 过滤，同时白名单保留 `depth`、`isSubmitter`、`collapsed`、`collapsedReasonCode` 树元数据。

### 3.3 三阶信号漏斗（Radar $\to$ Signal Gate $\to$ Hydrate）

```text
【第 1 阶：低成本增量发现（Radar）】
  ├─ 精准品牌/竞品词：kaix (includeComments=true, maxCommentsPerPost=15, commentSort="top")
  ├─ 宽泛行业大词（控费降噪）：先仅发现根帖 (includeComments=false, maxItems=100~300)
  └─ X 水位线巡检 / NewsNow 榜单 / RSS feed
        │
        ▼ 唯一 commitContentBatch() 落库（同事务写入主帖+评论+父链，2,000条/16MiB 上限）
【第 2 阶：确定性噪声门控（Signal Gate — 零 LLM 烧钱，纯 SQL 规则）】
  ├─ 三段式词组：anyTerms (OR) + allTerms (AND) + exclusions (NOT)
  └─ 可解释信号：discussion (Reddit>=10 / X>=5)、pain (痛点词或评论>=分数且score已知)、growing (同渠道同口径二次增量)
        │
        ▼ 筛选高价值根帖（手选无比例限制，自动策略默认关闭且每 radar 至多派生 1 笔 hydrate）
【第 3 阶：按需批量水合与评论树证据利用（Hydrate & Three Views）】
  ├─ 批量补全：攒批调 kaix postUrls[] (每根 50 评论) 或 X /replies + ScrapeBadger 批量 ID
  ├─ 联动检索（threadAware=true）：评论命中即把【根帖 + 命中评论摘录】映射到 anchor 呈现
  └─ 详情侧栏三视图（基于 reply_to + depth + isSubmitter）：
        [Top 高赞共识] │ [命中词完整父链上下文] │ [楼主 OP 互动]
```

---

## 4. 开放 HTTP API 与 Agent-First 架构（Human & Machine Parity）

Web 前端与外部 AI Agent **共用唯一 TypeBox HTTP API 表面、RBAC/来源边界与 `compileContentFilter`**：
- **自发现与唯一 Schema**：鉴权访问 `GET /v1/capabilities`（actor 权限与允许来源、各 `provider` 能力/参数上限/`automaticRequestReplay`、剩余配额及限额）与基于相同 TypeBox 派生的 `GET /v1/openapi.json`（稳定 `operationId`）；
- **机器 API Key（复用 `app_session`）**：扩充 `client_kind`（`'browser' | 'machine'`）、`label`、`scopes`（`read`, `projects:write`, `sources:write`, `collect`, `ingest`, `export`）、`allowed_source_ids UUID[]`（`ingest` 模板强制绑定非空来源）；只存 SHA-256 `token_hash`，明文展示一次，30–90 天过期且撤销立即失效；**严禁机器 Key 访问个人保存查询、批注或账户管理路由**；
- **Agent 6 步工作流与 4 项防失控护栏**：
  1. `GET /v1/capabilities` $\to$ `POST /v1/projects` $\to$ `POST /v1/sources/:id/collect`（轮询 `/v1/source-jobs/:id`）$\to$ `GET /v1/projects/:id/overview` $\to$ `GET /v1/projects/:id/content` & `/v1/content/:id/thread` $\to$ `GET /v1/content/export`；
  2. 护栏：`GET` 零收费；`automaticRequestReplay = false` 下收费未知进入 `unknown` 返回 `retryable: false, nextAction: "inspect_provider_console"` 阻断循环重试；`allowed_source_ids` 贯穿详情/树/统计防 UUID 枚举（404/403 隔离）；显式声明第三方帖子/评论正文为不可信材料，严禁作为执行指令。

---

## 5. 主线极简架构与零漂移 SQL 蓝图（5 模块 × 5 导航 × 仅 2 新表）

### 5.1 核心数据库四组 `UNNEST` 与关键 SQL 契约

1. **`commitContentBatch(client, source, items)`（混合批唯一写入）**：
   - 应用层预去重后，短事务按 `source -> job -> content identity 升序` 加锁，随后仅执行 4 条集合 SQL：
     1) **正文 `UNNEST` Upsert**：比较 `(EXCLUDED.content_observed_at IS NOT NULL, COALESCE(EXCLUDED.content_observed_at, EXCLUDED.content_version_fetched_at), EXCLUDED.content_evidence_key)`（`C` collation）；胜出且为 `deleted/removed` 时清正文，为 `available` 时用 `COALESCE(EXCLUDED.*, content.*)` 保留已知字段，落后版本绝不复活已删除正文；`RETURNING id, title, body_text, availability`。
     2) **搜索投影 `UNNEST` Upsert**：仅基于 `RETURNING` 最终生效正文计算 `search_text = normTitle || U+001F || normText` 与 `title_length = char_length(normTitle)`。
     3) **`content_discovery` `UNNEST` Upsert**：维护 `first_fetched_at` / `last_fetched_at`。
     4) **`content_observation` `UNNEST` Insert**：冲突键 `(content_id, collection_source_id, provider, evidence_key)`，内容冲突返回 `409`，同键同内容幂等跳过。
2. **`QRY-05` 双分支 Keyset 分页（禁止 `first_seen_at` 补空）**：
   - 索引 `ON content (created_at_source DESC NULLS LAST, id DESC)`；`listContent` 只读 `limit + 1`。
   - 非空游标：`(c.created_at_source < $t OR (c.created_at_source = $t AND c.id < $id) OR c.created_at_source IS NULL)`；空游标：`(c.created_at_source IS NULL AND c.id < $id)`。联动模式按 `matchedAt DESC NULLS LAST, anchorId DESC` 执行。
3. **`projects` 单 SQL 锚点 `GROUPING SETS` 概览**：
   ```sql
   WITH matched AS (
     -- compileContentFilter(actorAndProjectScope, filter) 返回去重命中节点并映射至可见 anchor_id
     SELECT DISTINCT ON (evidence_id, anchor_id)
            anchor_id, source_id AS platform_id, evidence_kind, pub_day
     FROM matched_evidence_to_anchor
   ),
   facets AS (
     SELECT
       GROUPING(pub_day) AS grp_day,
       GROUPING(platform_id) AS grp_platform,
       GROUPING(evidence_kind) AS grp_kind,
       pub_day, platform_id, evidence_kind,
       COUNT(DISTINCT anchor_id)::bigint AS cnt
     FROM matched
     GROUP BY GROUPING SETS ((), (pub_day), (platform_id), (evidence_kind))
   ),
   providers AS (
     SELECT o.provider, COUNT(DISTINCT m.anchor_id)::bigint AS cnt
     FROM matched m
     JOIN content_observation o ON o.content_id = m.anchor_id
     JOIN collection_source cs ON cs.id = o.collection_source_id
     WHERE /* 同一 actor ∩ project ∩ 过滤来源范围 */
     GROUP BY o.provider
   )
   SELECT
     (SELECT jsonb_agg(facets) FROM facets) AS facets,
     (SELECT jsonb_agg(providers) FROM providers) AS providers;
   ```
   *(注：真实 SQL 实现须严格绑定实际字段与同源范围，仅 `grp_day = 0 AND pub_day IS NULL` 记为 `unknownTimeCount`，各日桶 `COUNT(DISTINCT anchor_id)` 绝不直接加和。)*
4. **单索引字符边界检索（`SQL-09` / `SQL-10`）**：
   - `GIN (search_text gin_trgm_ops)` + `title_length`（`U+001F` 分隔）；对 `%`/`_`/`\` 做字面转义后使用参数化 `LIKE` 命中 GIN，再用 `substring` 精确复核 `title`/`text` 边界。

### 5.2 代码结构与 AST 静态护栏
- 模块布局与所有者严格按 `docs/architecture.md` 第 2 节锁定：`access`、`collection`、`content`、`projects`、`workspace`（对应 `MOD-01..05`）。
- 现已由 `scripts/check-docs.ts` 对 `src/modules/` 执行 TypeScript AST 门禁：强制文件白名单（仅允许 `routes.ts`/`sql.ts` 及显式登记的 `worker.ts`/`search.ts`）、严禁 `class` 与 `*Repository` 接口、严禁引入 `application/services|domain/repositories|storage/repositories|runtime`、单条注释 `<= 300` 字符、以及仓库 `.env` / 私钥防泄漏与规则编号唯一性校验。

---

## 6. 远端单机安全、调度、流式导出与运维基线

- **安全基线（`SAFE-01..06`）**：`/v1/*` 默认拒绝仅精确例外 `healthz` / 登录 / 本人 `session` / 持邀请注册；Cookie `HttpOnly+Secure+SameSite=Lax` + 同源 `Origin` 校验；`@fastify/rate-limit`（登录 5/min/IP、API 120/min/IP、仅信明确代理 hop）；共享 `pg.Pool`（`max=10`、`statement_timeout=10s`、`lock_timeout=3s`、`idle_in_transaction_session_timeout=10s`，断连立刻 cancel/rollback）；Compose 仅 `:443` 对外暴露、`db` 零公网映射；`SIGTERM` `15s` 有界退出；首次空库仅必需 `DATABASE_URL`、`SESSION_SECRET`、`ADMIN_BOOTSTRAP_PASSWORD`。
- **调度与导出（`RUN-01..04` / `EXP-01..06`）**：进程内调度最大并发 2 + PG `SKIP LOCKED` 租约；导出运行在 `REPEATABLE READ` + server cursor + **`SET LOCAL idle_in_transaction_session_timeout = '35s'`** + HTTP `30s` + **`X-Accel-Buffering: no`**，默认 `10,000` / 硬上限 `50,000` 行，流缓冲目标 `<= 2 MiB`，断流中止且不写 JSON `complete: true` 或 CSV `recordType=end`。

---

## 7. 独立外挂扩展备案：`plugins/zst-archive/`（R4 独立演进）

- 与主线唯一边界为鉴权推流 `POST /v1/sources/:id/ingest`（每批 `1–100` 条、`<= 1 MiB`）；绝对不进主线镜像、依赖、测试或发布清单；
- 依据 `arctic_shift@11bbf2e6` 格式，2024-04 起归档仅 `.zst` 顺序 UTF-8 JSON 流，不允许未经验证的随机字节偏移跳读；R4 阶段在独立环境将 `.zst` 顺序转为排序 ZSTD Parquet（建议聚簇键 `ORDER BY subreddit_lower, created_utc`、`ROW_GROUP_SIZE 100000`、`COMPRESSION ZSTD`、按需验证 Bloom Filter），保持真实 `timeBasis` 与 `sourceObservedAt`，未完成全量行列/拒绝率/备份核对前严禁删原 `.zst` 档案；
- 推流样本在列表标“导入样本”，按 `MET-03` 默认排除出在线趋势，除非用户显式纳入。

---

## 8. 与各正式文档映射及 `R1 -> R4` 执行路线

全部 14 份注册文档职责已收敛闭环，唯一实施顺序（**R1 薄内核 + `041` 核心与退役迁移 + 混合批 + `kaix` 解封 $\to$ R2 `042` 项目表 + 三阶漏斗 + 双源矩阵 + 5 页 UI $\to$ R3 资产迁出交付 + 仓储/冻结/旧码物理实删 + Compose 切换 $\to$ R4 独立外挂**）见[R1–R4 重建计划](../plans/source-expansion.md)。
