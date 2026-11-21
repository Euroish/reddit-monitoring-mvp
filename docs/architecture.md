# 主线架构规范（STD-100）

本文定义系统运行拓扑、Post-050 `20 → <= 24` 表节制演进约束、L1–L3 扩源路线与单机安全基线。实码状态与 V2 排期见[当前状态与规划](status.md)，契约路由见[数据与 API 契约](contracts.md)，前端融合与可视化规范见[前端交互规范](design.md)。

---

## 0. 微内核总览与开源借鉴约束

在 **4 vCPU / 3.8 GiB RAM / 58 GiB 系统盘 / \$0 额外基础设施** 约束下，系统只吸收成熟开源生态的最小高收益机制：

| 参考来源 | 采纳机制 | 拒绝复杂度（适配单机 4 GB） |
| :--- | :--- | :--- |
| **`miniflux/v2`** | 持久自适应调度、同域冷却、真 `ETag`/`304` 与 URL 去追踪参数 | 独立 Go 守护进程（合入 Node Worker） |
| **`newsnext/newsnow`** | 零依赖纯函数热榜 getter（6 个已落地 `webBoards`） | 独立 `h3` 服务端与 SQLite 缓存 |
| **`KKKKhazix/AIHOT`** | `T1`/`T1_5`/`T2` 分级、`T1` 一手代表选举、48h/6h 热度与 08:00 日报 | 3 Node 容器、105 迁移与入库串行 6 次 LLM |
| **`Folo` / `Karakeep`** | 多模态冷静流、`[V2]` 阅读状态、`read`/`archived`/`muted` 与按需阅读器/摘要 | 常驻 Next.js SSR + Meilisearch + Puppeteer |
| **`Vane` / `Ground News`** | 卡片内 16px 来源权威分布微条、`[V2]` 正交按题探索与 `keepKPerHostname` | 外部向量库与无头浏览器集群 |

---

## 1. `[LIVE]` 运行时拓扑与刻意不做列表

```text
Web 浏览器 / 移动 Web / 外部 Agent / [V2] L3 外部 Sidecar / R4 plugins/zst-archive
                       │  HTTPS :443 (Cloudflare Edge + Authenticated Origin Pulls mTLS)
                 Caddy 2 (proxy, mem_limit=128m, deploy/Caddyfile)
                       │  Docker 内部网络（proxy 可选；宿主机仅绑 127.0.0.1 或零暴露端口）
        Fastify 5 单容器应用 (app, mem_limit=1536m, Dockerfile --target runtime)
        ├── HTTP 读平面：onRequest @fastify/rate-limit -> preParsing 鉴权 -> apiPool (max=8)
        └── 后台调度平面：5s 到期扫描 (LIMIT 32) + 6 协程并发 (hostCooldown=1500ms) + workerPool (max=4)
                       │
      PostgreSQL 16 (db, postgres:16-alpine, mem_limit=1350m, pg_trgm, LZ4 TOAST)
```

- **镜像构建陷阱**：[Dockerfile](../Dockerfile) 末段 stage 为 `AS proxy`（`caddy:2-alpine`），构建服务端必须显式传 **`--target runtime`**，构建静态反代传入 `--target proxy`。
- **刻意不做列表**：`MUST NOT` 引入 ORM、单实现 `*Repository`/`InMemory*`、Redis/BullMQ、Elasticsearch/ClickHouse、多 Node 容器拆分、容器内 Headless Chromium/Python，或首页同步加载重型全量图表包。

| ID | 等级 | 运行时与结构基线 | 验收出口 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 后端锁定 Node 24+、TypeScript、Fastify 5、`@sinclair/typebox`（`removeAdditional: false`）、`pg`、`pg-query-stream`、PostgreSQL 16；**`[LIVE]` 网页解析依赖 `rss-parser`、`cheerio`、`sanitize-html`（`linkedom` + `@mozilla/readability` 属 `[V2]` Phase C 按需引入）**；构建复制 `src/storage/schema/*.sql` 至 `dist/` 并校验 SHA-256。 | 构建与编译态启动验收 |
| ARC-02 | MUST | Compose 内存配额锁定 `db: 1350m`、`app: 1536m`、`proxy: 128m` 与 `json-file` 日志轮转（`max-size: 10m, max-file: 3`），透传 `WORKER_CONCURRENCY`（默认 6）；优雅停机 `SIGTERM`/`SIGINT` 限 `15_000ms`；主线镜像零 Python/DuckDB/Chromium。 | Compose 配置与停机测试 |
| ARC-03 | MUST | 仅多实现采集边界保留 `ContentProvider` 接口；业务模块内部直写接收 `Pool \| PoolClient` 的命名 SQL 函数（写事务用 `PoolClient`）；`scripts/check-docs.ts` 守卫禁旧层导入、禁类封装、`<= 450` 行/文件与 `<= 220` 字/非模板行。 | `docs:check` 与 AST lint |

---

## 2. `[LIVE]` 入口地图与五模块所有权（`43` 后端核心 TS 文件）

| 模块路径 | 文件数 / 体量 | 独家表所有权与核心职责 |
| :--- | :--- | :--- |
| **`apps/api/src/`** | 2F · 320L | `app.ts`（`requestTimeout: 30_000`、`connectionTimeout: 10_000`、`onRequest` 全局限流 120/min、`preParsing` Default-Deny 鉴权、Swagger `/v1/openapi.json`、`/v1/capabilities`）、`server.ts`（`apiPool: 8` + `workerPool: 4` + 7 Providers）。 |
| **`src/modules/access/`** | 2F (`routes`, `sql`) | `app_user`、`app_user_password`、`app_invite`、`app_audit_log`、`app_session`（浏览器 Cookie + 43 字符一次性 SHA-256 `machine` API Key）。 |
| **`src/modules/collection/`** | 9F (`config`, `hydrate`, `import`, `jobs`, `refresh`, `routes`, `schedule`, `sql`, `worker`) | `source`、`collection_source`、`source_collection_job`、`source_provider_budget`、`source_provider_usage`、`source_worker_heartbeat`；含预览、OPML/JSON 导入、到期扫描与 6 协程 Worker。 |
| **`src/modules/content/`** | 21F (`batch`, `docs`, `export`, `facets`, `routes`, `search`, `sql`, `stories`, `story-groups`, `thread`, `ai-registry`, `ai-sync`, `ai-sql`, `ai-admin-sql`, `ai-routes`, `ai-discovery`, `ai-event-identity`, `ai-history-schema`, `ai-history-import`, `ai-history-backfill`, `ai-history-cli`) | `content`、`content_discovery`、`content_observation`、`public_content_search_document`、`doc_page` 以及 `054..056` 新增的 19 张 `ai_*` 表（全库共 `43` 张表）；唯一内容写函数 `commitContentBatch`、唯一过滤 `compileContentFilter`、48h 事件聚簇、分面、闭包树、流式导出、文档中心、AI 发布日历与离线历史 Seed 导入/分页 Backfill。 |
| **`src/modules/projects/`** | 2F (`routes`, `sql`) | `monitor_project`、`monitor_project_source`；项目三段词 `GROUPING SETS` 概览与显式 `kaix` 水合。 |
| **`src/modules/workspace/`** | 2F (`routes`, `sql`) | `content_saved_query`、`content_annotation`（仅限浏览器会话隔离读写）。 |
| **`src/connectors/`** | 9F · 2,162L | `web/{http,sources}`、`reddit/{kaix,red-crawler,kaix.config}`、`x/{twitterapis,scrapebadger}`、`bluesky/bluesky-appview-content.connector`、`shared/content-provider.interface`（**零 `pg` 依赖**）。 |
| **`packages/contracts/src/` & `src/shared/` & `src/storage/`** | 3F + 2F + 2F | TypeBox 契约真源、`stable-id` / `language` 语言与通道识别、`db` 池/事务与 SQL 迁移运行器（合计后端核心 `43` 文件 · `~7,300` LOC）。 |

| ID | 等级 | 模块边界与不可变迁移规则 | 验收出口 |
| --- | --- | --- | --- |
| MOD-01 | MUST | 模块间 `MUST NOT` 越权写他方独占表；`src/connectors/`、`src/shared/` `MUST NOT` 导入 `pg` 连接；`001..050` 已应用 SQL `MUST NOT` 修改（由 `scripts/check-docs.ts` 强制拦截），结构变更 `MUST` 通过 `051+` 前向迁移推进。 | `docs:check` 与 PG 迁移验证 |

---

## 3. 存储、检索引擎与 `[V2]` 内容价值复利（`20 → <= 24` 表上限）

### 3.1 `[LIVE]` `commitContentBatch` 与双字词 GIN 检索

- **4×`UNNEST` 短事务**：`content` 以 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")` 决胜并自动识别 `language`；`public_content_search_document` 仅在 `changed=true` 时更新且正文截断于 **`MAX_INDEXED_BODY_CHARS = 1500`**（`050` 已物理移除 `normalized_title`/`normalized_text`）；`content_discovery` 维护发现关系；`content_observation` 仅在 `payload_hash` 异同时入库（零重写死元组）。
- **无痛冷裁剪兼容**：`contentTables`、`matchingNodes`（`src/modules/content/search.ts`）使用 **`LEFT JOIN public_content_search_document`**，`listAnnotations`（`src/modules/workspace/sql.ts`）不连搜索表。关键词检索时自然走 GIN 匹配，非关键词读取或 90 天冷删搜索投影行时仍保证 `content`、评论树、收藏与导出完整可读。

| ID | 等级 | 存储、索引与检索执行规则 | 验收出口 |
| --- | --- | --- | --- |
| SQL-01 | MUST | 批量入库固定 4 组 `UNNEST`；零变更重放 `MUST NOT` 重写 `public_content_search_document`、插入同哈希 `content_observation` 或虚增 `updated` 计数；90 天冷裁剪若移除搜索投影行，仅允许依赖 `LEFT JOIN` 与清文本语义，禁止造成内容静默不可读。 | 版本幂等与冷删可读性 PG 测试 |
| SQL-02 | MUST | 列表与分面 `MUST NOT` 全表 `COUNT(*)`；`>=3` 连续字母数字走 `gin_trgm_ops`，2 字中文/短代号（`算力`/`o3`）走 `public_search_bigrams(search_text)` GIN 索引并回表精确匹配原文；结构迁移与大索引使用独立长超时连接。 | `EXPLAIN` 索引计划验证 |

### 3.2 `[V2]` 高收益低复杂度内容演进路径（`20 → <= 24` 表上限）

经写入放大与权限压测，放弃高维护 `entity_catalog` 关联表与无输入源 `source_candidate` 表，全库演进精确收敛为以下高收益设计：

| 阶段与表 delta | 设计要点（防写放大 · 防越权 · 零冻结） |
| :--- | :--- |
| **Phase A · 卡片微图与平台分组分面**<br>（`+0` 表 → 保持 `20`） | 复用现有 `readStoryWindow` 计算并附加 `tierBreakdown`（全簇各等级去重源数）与 `sparkline48h`（8×6h 桶）；`projectOverview` `GROUPING SETS` 补齐 `(day, platform)`，零建表支撑 `/` 内嵌微图与联动日柱图。 |
| **Phase B · `051` 水位线阅读态**<br>（`+0` 表 · 扩 1 表 → 保持 `20`） | 在 `content_annotation` 增配 `read_at`/`muted`/`tags` 且**将阅读状态更新与笔记 `revision` 锁隔离**；叠加按频道/全局的 **`read_before_at` 水位线**（存入 `app_user` 轻量偏好 JSONB 或专用稀疏状态，避免“一键已读”触发万行写入风暴），事件流已读键锚定稳定 `storyKey`。 |
| **Phase B · `052` 仅存事件成员归属**<br>（`+2` 表 → `22`） | 新增 `story_cluster` + `story_cluster_member` **仅持久化 `(cluster_id, content_id)` 归属关系与规范链接/SimHash 指纹**；`representative` 选举、关联计数与指数半衰期 `heat48h(now)` **MUST 在读路径按当前 `actor.allowedSourceIds` 与过滤范围实时归约**（杜绝全局字段导致的 `SEC-01` 越权泄露、指数衰减冻结及高并发写冲突）。 |
| **Phase B · 跨专题/实体声量对比**<br>（`+0` 表 → `22`） | `POST /v1/project-comparisons` 直接复用 `monitor_project` + 既有双字词/trigram GIN 查询并排比较多个三段词主题，无需 `content_entity` 百万行关联表或中文误命中折腾。 |
| **Phase D · 外链雷达与主动推送**<br>（可选 `+1..2` 表 → `<= 24`） | 仅在 Phase C 落地 `Readability` 保留原文 `<a>` 外链后，直接对库内提取链接做高频未订阅域名查询；仅在确有通知需求时新增轻量 `alert_rule`/`alert_delivery`。 |

> **`ParadeDB (pg_search)` 与 `pgvector` 准入门槛**：当前 `pg_trgm` + `public_search_bigrams` 足以覆盖当前量级；**仅当有效去重正文突破 `200,000+` 篇且明确调配或扩容内存**后，方经隔离基准引入 `pgvector`（`halfvec` HNSW，仅嵌入 `title + 300 字`）或 ParadeDB BM25，未达阈值前禁止引入。

---

## 4. `[V2]` L1–L3 扩源、自适应调度与单机安全基线

- **L1（主线零费直采）**：`feed`（动态放行公网 HTTPS，支持 OPML 批量导入与 `web_list`/`json_list`）+ `newsnow`（6 个内置 `webBoards` 可扩充 IT之家/少数派等 MIT getter，UTC 1h 桶）+ `bluesky_appview`；`[V2]` Phase C 按需补 `linkedom` + `@mozilla/readability` 提取摘要类 RSS 全文与出站链接。
- **L2（预算门控付费 API）**：`twitterapis` 批次 `from:u1 OR from:u2`（较单号省 ~95% 调用）+ `scrapebadger` 备源/批量刷新；Reddit 日常走 `.rss` 雷达，高热帖由用户按需触发 `POST /v1/projects/:id/hydrate`（`kaix`）。
- **L3（外部隔离 Sidecar · `stream_class` 架构修补）**：`[LIVE]` 默认流与趋势 `pullOnly = true` 会屏蔽 `delivery_mode='push'`；因此在 `[V2]` Phase C 接入外部 Sidecar（小红书、豆瓣、Telegram、Instagram 等强反爬源）前，`MUST` 为 `collection_source` 区分 **`stream_class` (`live \| archive \| adhoc`)**：L3 实时采集器推流源标为 **`live`**（进入默认首页流与趋势，解决推送隐形悖论），R4 `.zst` 标 **`archive`**、按题探索 `radar` 源标 **`adhoc`**；显式传 `deliveryMode` 时覆盖默认过滤。

| ID | 等级 | 调度、抗滥用与 SSRF 安全规则 | 验收出口 |
| --- | --- | --- | --- |
| RUN-01 | MUST | 进程内 Worker 运行 `WORKER_CONCURRENCY`（`[1, 12]`，默认 `6`）、5s 到期扫描（`LIMIT 32`）与同域 `1500ms` 冷却；Feed 遇 `304` 或无新增按 `1.5x` 指数退避（上限 12h），截断保持配置周期不空转；每小时清理保留各源最新 5 条以外且超 14 天的终结 `source_collection_job`；付费 `unknown` 永不重放。 | 并发冷却、清理与停发 E2E |
| SAFE-01 | MUST | `/v1/*` Default-Deny；`@fastify/rate-limit` 置于 `onRequest`（先于 `preParsing` `findActor` 保证 429 零查库）；`/v1/content/*` 仅 `GET/HEAD` 允许 `machine` `read` scope（任何写/AI 端点需管理员浏览器会话或独立作用域）；浏览器写操作校验同源 `Origin`；公网须配 Cloudflare mTLS + `DOCKER-USER` 防墙，禁暴露 `db` 端口。 | `429` 零查库与 `POST /v1/content/*` 403 测试 |
| SAFE-02 | MUST | 连接池预算总计 `12`（`apiPool: 8` + `workerPool: 4`）；流式导出全局单槽、`REPEATABLE READ READ ONLY`、`35s` 空闲超时与 `X-Accel-Buffering: no`，断流即销毁 `QueryStream` 释放连接。 | 并发导出与断流测试 |
| SAFE-03 | MUST | 全部 Web 请求经 `src/connectors/web/http.ts`：拒绝非 HTTPS、带凭证/端口/裸 IP URL；DNS `resolve4`/`resolve6` 纳入 `[3000, 15000]ms` 总超时并要求 **`addresses.every(isPublicIp)`**；手动跟跳最多 3 跳且逐跳重验 DNS 与 Socket `lookup` 绑定；传输与解压上限 `2 MiB`。 | SSRF 与重定向单测 |

---

## 5. 单机容量与 CI 门禁基线

- **Compose 实配**（`docker-compose.yml`）：`db: 1350m`、`app: 1536m`、`proxy: 128m`，容器日志 `json-file (10m×3)`；`prod@8e436ac` 实测闲时 RAM `< 200 MiB`（`app ~104 MiB`、`db ~91 MiB`）、全库 `40 MB`。
- **CI 门禁**：`npm run docs:check` → `npm run lint` → `npm run typecheck` → `npm run build` → `npm run test:unit` → 隔离 PG16 `test:postgres` + `smoke:compiled`。
