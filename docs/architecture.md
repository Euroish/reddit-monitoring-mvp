# 主线架构规范

本文定义系统后端架构边界、Post-050 数据库节制演进机制、内容复利管道、多级扩源路由与单机安全基线。实码盘点与 V2 分阶段计划见[当前状态与规划](status.md)，Schema 与 HTTP 接口细节见[数据与 API 契约](contracts.md)，前端双层可视化与 `semrush` 分支融合规范见[前端与可视化交互规范](design.md)。

---

## 0. 核心架构范式：五模块微内核 + 内容价值复利 + 物理隔离扩源

在 **4 vCPU / 3.8 GiB RAM / 58 GiB 系统盘 / \$0 额外基础设施成本** 约束下，系统吸收多家成熟开源项目的设计精华并剔除其资源与运维负担：

| 参考来源 | 吸收的核心工程/产品机制 | 刻意剔除的冗余复杂度（适应 4 GB 单机） |
| :--- | :--- | :--- |
| **`miniflux/v2`** | 持久化调度器、自适应退避、同域名并发隔离（`hostCooldown`）与 HTTP `ETag`/`304` | Go 独立二进制外部同步守护进程（合入单 Node 进程） |
| **`newsnext/newsnow`** | 零依赖纯函数榜单 getter（7 大内置 `webBoards` JSON/HTML 提取） | 独立 `h3` 服务端与 SQLite 缓存层 |
| **`KKKKhazix/AIHOT`** | `T1`/`T1_5`/`T2` 信源分层、一手代表选举、48h 半衰期与 6h 飙升、08:00 日报、`web_list` 预览 | 3 个 Node 容器（耗 >1 GB RAM）、105 碎迁移、入库串行 6 次大模型调用 |
| **`Folo` / `Karakeep`** | 多模态统一流、`read`/`saved`/`muted` 阅读归档流转、可插拔按需 AI 翻译与全文阅读器 | Next.js SSR + Meilisearch + Puppeteer 常驻重进程 |
| **`Vane` / `DeepResearch`** | 正交证据槽拆解、`keepKPerHostname` 占槽、多波渐进流式提交（V2 按题探索） | 外部向量服务与重型 Chromium 无头集群 |

全仓后端生产代码实测仅 **`~6,900` 行 TypeScript**（`apps/api` + `src/` + `packages/contracts` 共 41 个 TS 文件），以 **`Fastify 5 + TypeBox + pg + PostgreSQL 16`** 为单一确定性微内核运行，支持四项零侵入扩展能力：
1. **零重启扩展信源**：`FEED_ALLOWED_URLS` 留空时动态放行全部 DNS 解析均为公网 IP 的 HTTPS 订阅与 `web_list`/`json_list`，配合 `POST /v1/sources/import` 批量导入；
2. **异步非阻塞采集池**：默认 `WORKER_CONCURRENCY=6`（上限 12）+ 同域 `1500ms` 冷却，`workerPool max=4` 与 `apiPool max=8` 读写连接隔离；
3. **统一过滤编译与单 CTE 可视化分面**：`compileContentFilter(scope, filter)` 同时服务首页流、双字词全文检索、分面脉冲图与流式导出；
4. **节制建表 + 外部推流隔离**：主线严守零 Python/Chromium 运行时；重型反爬采集器与 R4 `.zst` 离线包统一下沉为外部 Sidecar，仅通过受限 `ingest` Machine Key 向 `POST /v1/sources/:id/ingest` 推流。

---

## 1. 运行时拓扑与刻意不做列表

```text
Web 浏览器 / 移动端 Web / 外部只读 Agent / L3 外部 Sidecar / R4 插件 (plugins/zst-archive/)
                       │  HTTPS :443 (Cloudflare Edge + Authenticated Origin Pulls mTLS)
                 Caddy 2 (proxy, mem_limit=128m, deploy/Caddyfile)
                       │  Docker 内部网络（可选启用 proxy；宿主机仅绑 127.0.0.1 或不暴露端口）
        Fastify 5 单容器应用 (app, mem_limit=1536m, Dockerfile --target runtime)
        ├── HTTP 读平面：onRequest @fastify/rate-limit -> preParsing 鉴权 -> apiPool (max=8)
        └── 后台调度平面：5s 到期扫描 + 6 协程消费者 + 1h 任务清理 + workerPool (max=4)
                       │
      PostgreSQL 16 (db, postgres:16-alpine, mem_limit=1350m, pg_trgm, LZ4 TOAST)
```

> **构建陷阱提示**：[Dockerfile](../Dockerfile) 的末段舞台是 `AS proxy`（`caddy:2-alpine`），不是 Node 运行时；手动构建 API 容器镜像时必须显式传入 **`--target runtime`**，构建前端静态代理镜像传入 `--target proxy`。

**刻意不引入**：ORM（Prisma/Drizzle）、单实现 `*Repository` 与 `InMemory*` 模拟层、通用 DI 容器、多 Node 微服务拆分、Redis/BullMQ、Elasticsearch/ClickHouse、容器内 Headless Chromium/Playwright，以及未按需隔离的大体积前端图表全量包。

| ID | 等级 | 运行时与结构基线 | 验收出口 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 后端锁定 Node 24+、TypeScript、Fastify 5、`@sinclair/typebox`（`removeAdditional: false`）、`pg`、`pg-query-stream`、PostgreSQL 16；**当前线上网页解析依赖 `rss-parser`、`cheerio` 与 `sanitize-html`（轻量 `linkedom` + `@mozilla/readability` 列入 V2 Phase C 按需补充，未上线前不得宣称内置）**；构建阶段复制 `src/storage/schema/*.sql` 至 `dist/` 并在启动校验 SHA-256。 | 构建与编译态启动验收 |
| ARC-02 | MUST | 单机 Compose（`db` `1350m`、`app` `1536m`、`proxy` `128m`）与 `json-file` 日志轮转（`max-size: 10m, max-file: 3`）为标准交付拓扑；应用监听 `SIGTERM`/`SIGINT`（`15_000ms` 优雅停机）；主线镜像与日常 CI 严禁包含 Python、DuckDB 或 Chromium。 | Compose 限制与停机测试 |
| ARC-03 | MUST | 仅外部采集协议边界保留 `ContentProvider` 接口；内部五模块平铺编写接收 `Pool | PoolClient` 的命名 SQL 函数（写事务强制 `PoolClient`）；`scripts/check-docs.ts` 静态守卫禁旧层导入、禁类封装、`<= 450` 行/文件与 `<= 220` 字/非模板行。 | `docs:check` 与 AST lint |

---

## 2. 入口地图与五模块所有权（Live Code Map）

```text
apps/api/src/{app,server}.ts ──▶ src/modules/{access,collection,content,projects,workspace}/*
                                        │                            ▲
                                        ▼                            │ (唯一入库/契约边界，connectors 零 PG 依赖)
                         src/storage/db.ts & packages/contracts/src/* ◀── src/shared/text/language.ts
```

- **`apps/api/src/`**（2 文件 · 320 行）：`app.ts` 配置连接/请求超时（`requestTimeout: 30_000`、`connectionTimeout: 10_000`、`keepAliveTimeout: 5000`）、`onRequest` 全局限流（`max: 120/min`）与 `preParsing` Default-Deny 鉴权（使 `429` 请求**零 DB 查库**）、Swagger `/v1/openapi.json` 及 `/v1/capabilities`；`server.ts` 装配 `apiPool (8)` + `workerPool (4)` 与 7 个在线 Provider。
- **`src/modules/access/`**（`routes.ts`, `sql.ts`）：管理 `app_user`、`app_user_password`、`app_invite`、`app_audit_log` 与扩展后的 `app_session`（浏览器会话 + `machine` API Key）。
- **`src/modules/collection/`**（`config.ts`, `hydrate.ts`, `import.ts`, `jobs.ts`, `refresh.ts`, `routes.ts`, `schedule.ts`, `sql.ts`, `worker.ts`）：独家管理 `source`、`collection_source`、`source_collection_job`、`source_provider_budget`、`source_provider_usage`、`source_worker_heartbeat`；承载 OPML/JSON 批量导入、试抓预览、调度扫描（单批 `LIMIT 32`）与 `6` 协程自适应 Worker。
- **`src/modules/content/`**（`batch.ts`, `export.ts`, `facets.ts`, `routes.ts`, `search.ts`, `sql.ts`, `stories.ts`, `story-groups.ts`, `thread.ts`）：独家管理 `content`、`content_discovery`、`content_observation`、`public_content_search_document`；提供 `commitContentBatch` 唯一批写、`compileContentFilter` 统一过滤、`readStoryWindow` 48h 事件聚簇/日报、单 CTE `GROUPING SETS` 分面与有界流式导出。
- **`src/modules/projects/`**（`routes.ts`, `sql.ts`）：独家管理 `monitor_project`、`monitor_project_source`、项目三段词概览与跨评论树按需水合触发。
- **`src/modules/workspace/`**（`routes.ts`, `sql.ts`）：独家管理个人 `content_saved_query` 与 `content_annotation`（仅限浏览器会话读写）。
- **`src/connectors/`**（9 文件 · 2,162 行，零 DB 依赖）：`web/http.ts`（统一 SSRF 公网校验器、URL 去追踪参数规范化）、`web/sources.ts`（`feed` / `newsnow`）、`reddit/{kaix,red-crawler}`、`x/{twitterapis,scrapebadger}`、`bluesky/bluesky-appview-content.connector.ts`。

| ID | 等级 | 模块所有权与向后迁移约束 | 验收出口 |
| --- | --- | --- | --- |
| MOD-01 | MUST | 模块间禁止越权写他方独占表；`src/connectors/` 与 `src/shared/` 严禁导入 `pg` 池；`001..050` 已应用 SQL 严禁修改校验和，所有结构升级严格遵循 Expand-Migrate-Contract 通过 `051+` 前向迁移推进。 | AST 边界与迁移校验 |

---

## 3. 内容价值复利与 PostgreSQL 20→<=26 表节制演进设计

### 3.1 Post-050 唯一写入路径与去冗余存储基线（20 张实时表）

`050_legacy_cleanup_and_schema_upgrade.sql` 已安全删除 27 张零业务历史遗留表（47 → 20 张），移除 `content` 8 个废列与 `public_content_search_document` 的 `normalized_title` / `normalized_text` 冗余双列，并将 `search_text` 正文索引上限收敛至 **`MAX_INDEXED_BODY_CHARS = 1500`**（线上 `search_text` 最大长度由 `28,137` 降至 `1,649`，均长由 `796` 降至 `405`）。

所有采集与 `/ingest` 推流继续严格走 **`commitContentBatch`** 4 组 `UNNEST` 短事务：
1. `content` upsert：以 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")` 决胜，未变更版本零重写；`language` 缺省时自动经 `src/shared/text/language.ts` 补充识别；
2. `public_content_search_document` upsert：仅对 `changed=true` 行写入截断后的 `search_text` 与 `public_search_bigrams` 双字候选，保留 `pg_trgm`（>=3 连续字母数字）与双字词（`算力`/`o3`）纯 GIN 扫描；
3. `content_discovery` upsert：维护多源共现与首次/最近发现时间；
4. `content_observation` insert：仅当 `payload_hash` 真正变化时插入新快照，消除同值重刷产生的死元组写放大（409 同键冲突校验保持有效）。

| ID | 等级 | 存储、索引与迁移执行规则 | 验收出口 |
| --- | --- | --- | --- |
| SQL-01 | MUST | 批量写入固定 4 组 `UNNEST`；仅正文或版本真变更时更新 `public_content_search_document`；同一 `(content_id, collection_source_id, provider, evidence_key)` 仅当 `payload_hash` 异同时报错或追加，零变更重放严禁虚增死元组与 `updated` 计数。 | 版本决胜与零重写 PG 测试 |
| SQL-02 | MUST | 禁止分页查询执行全表 `COUNT(*)` 或无索引 `strpos()`；>=3 字符词走 `gin_trgm_ops`，2 字中文/短代号走 `public_search_bigrams` GIN 表达式索引并回表精确匹配原文；大表索引与结构迁移使用独立长超时连接。 | `EXPLAIN` 索引计划验证 |

### 3.2 四层“爬取内容价值复利”演化蓝图（20 → <=26 表上限）

仅有原始文章列表会导致内容随时间贬值；我们不建重型数仓或微服务，而是通过 **`051`–`054+` 最多 4–6 张高回报核心表** 将采集内容复利为结构化资产：

| 演进层级与目标迁移 | 核心数据结构变化（表量变化） | 解决的核心产品与性能问题 |
| :--- | :--- | :--- |
| **Layer 1 · 写入期轻提取**<br>（`050` 已上线，+0 表） | `content.language`、`platform_details.{channel, textCompleteness}`、`collection_source.{source_group, tags, locale, fetch_policy, health}` | 无需模型即可按 8 频道、4 语种、原文完整度交叉过滤，源健康与截断率可观测 |
| **Layer 2 · 阅读态与隐式反馈回路**<br>（V2 `051`，**+0 表 · 扩展 1 表**） | 扩充 `content_annotation` 增加 `read_at`, `archived_at`, `muted`, `tags TEXT[]` | 补齐 Readwise/Miniflux 式 `未读 / 已读 / 稍后 / 静音` 三键流；同时直接为首页 **“为你” RRF 个性化排序** 提供正负反馈信号，省去千万级曝光流水大表 |
| **Layer 3 · 持久化事件聚簇与实体图谱**<br>（V2 `052`–`053`，**+4 表 → 24 表**） | • `052`: `story_cluster` + `story_cluster_member`（按 `published_at` 与 SimHash/规范链增量归簇、锁定稳定 `storyKey` 与 `heat48h`）<br>• `053`: `entity_catalog` + `content_entity`（基于精选确定性词典提取公司/模型/人物/主题标签，外链共现计数） | 1. 解决当前 `readStoryWindow` 每次滑窗现算耗 `1.0–1.5s` 且 `storyKey` 随首成员滑出漂移的瓶颈，降至 `<10ms`；<br>2. 为可插拔 AI 摘要提供稳定缓存锚点；<br>3. 解锁 **实体声量对比图表**、人物/公司页与“同题横向穿刺” |
| **Layer 4 · 外链信源雷达与主动触达**<br>（按需 `054+`，**+1–3 表 → <=26 表**） | 可选 `source_candidate`（统计 `T1`/`T1_5` 正文外链引用却尚未订阅的高频域名/RSS）与可选 `alert_rule`/`alert_delivery`（晨报/飙升 Webhook） | 把“已抓回来的文章里的参考链接”自动转化成新信源发现雷达，形成内容 → 发现 → 扩源飞轮 |

> **关于 `ParadeDB (pg_search)` 与 `pgvector` 的阈值纪律（4 GB RAM 诚实边界）**：当前 PG16 容器上限 `1350 MiB`、`shared_buffers` 默认紧凑运行（实测全库仅 `40 MB`），现有 `pg_trgm` + `public_search_bigrams` + 确定性实体词典已覆盖 95% 检索需求，**不提前引入向量库或 Rust Tantivy 扩展**。仅当（a）库内有效去重正文突破 **`200,000+` 篇** 或显式需要跨语种语义召回，且（b）明确授权调配或扩容内存时，才在独立隔离基准测试后引入 `pgvector`（`halfvec` HNSW，仅嵌入 `title + 300字摘要`）或 ParadeDB BM25。

---

## 4. L1–L3 多源扩容分级、自适应调度与单机安全基线

想要从目前 100 个来源安全扩至 **500+ 异构源**（涵盖生活文化、大众热榜、专业评测与海外社交创作者）而不拖垮 4 vCPU / 4 GB VPS，必须按渠道性质实施三级隔离路由：

1. **L1 · 主线内置直采（零费 / 低 CPU，`feed` + `newsnow` + `bluesky_appview`）**：
   - `feed`（RSS/Atom + `web_list` + `json_list`）：带完整 `http_etag`/`http_last_modified` 真 304 跳过、gzip 流式 2 MiB 上限、单页上限 `100`（首采限制 `8` 防刷屏）与 `1500ms` 同域冷却。扩源首选 **OPML 批量导入** 优质公开源及无 Key 原生通道（GitHub `.atom`、YouTube 频道 Atom、arXiv、Reddit `.rss` 雷达）；
   - `newsnow`：内置纯函数 getter（已落地 7 个，可轻量新增 IT之家/微博热搜可用公开接口/36氪/少数派/酷安/虎扑 等 MIT 解析函数，使用 **UTC 1 小时快照桶** 防高频观测膨胀）。
2. **L2 · 预算门控付费与批处理 API（`twitterapis`/`scrapebadger` + `kaix`/`red_crawler`）**：
   - 仅追踪精选核心账号与高讨论贴按需水合；X 必须采用 **15–20 人 `from:u1 OR from:u2` 批次搜索**（较逐号省 ~95% 调用）；所有付费源强制走 `starting -> running -> reading -> committed` 防重放状态机。
3. **L3 · 外部隔离 Collector Sidecar（高反爬站点与重型采集，物理隔离于主线之外）**：
   - 面对强风控/JS 渲染站点（如小红书公开精选、豆瓣/什么值得买动态页、Telegram 频道或受限微博榜单）与自建 RSSHub / Apify 定时 Actor，**严禁将 Playwright/Python/RSSHub 塞入主线 `app` 容器**；统一在外置小容器/独立进程抓好结构化条目，持有**仅允许特定 `sourceId` 与 `ingest` scope 的 Machine API Key**，调用 `POST /v1/sources/:id/ingest` 落库。

| ID | 等级 | 自适应调度、抗滥用与 SSRF 安全规则 | 验收出口 |
| --- | --- | --- | --- |
| RUN-01 | MUST | 进程内 Worker 采用 `WORKER_CONCURRENCY`（默认 `6`、上限 `12`）、5s 有界到期扫描（`LIMIT 32`）与同域 `1500ms` 冷却；Feed 遇到 304/无新增按 `1.5x` 指数退避（上限 12h），截断保持配置周期而非死循环缩窗；每小时自动清理保留每个源最新 5 条以外且超过 14 天的终结 `source_collection_job`；付费请求 `unknown` 永远停发待人工确认。 | 并发冷却、清理与停发 E2E |
| SAFE-01 | MUST | 全局 `/v1/*` 实行 Default-Deny；`@fastify/rate-limit` 在 **`onRequest`** 钩子执行（早于 `preParsing` 鉴权查库 `findActor`，确保 `429` 零 DB 查询）；浏览器写操作校验同源 `Origin`；公网开放须前置 Cloudflare（开启 Authenticated Origin Pulls mTLS 与 `DOCKER-USER` 链封堵源站直连），`db` 禁宿主机端口映射。 | `429` 零查库与 CSRF/权限测试 |
| SAFE-02 | MUST | 单应用连接池总预算 `12`（`apiPool: 8` + `workerPool: 4`），流式导出全局单槽占位并在 `REPEATABLE READ READ ONLY`（`35s` 空闲超时、`X-Accel-Buffering: no`）中运行，客户端断连立即销毁 `QueryStream` 并释放连接。 | 断流与并发导出 429 测试 |
| SAFE-03 | MUST | 全部 `feed`/`web_list`/`newsnow` 请求经过 `src/connectors/web/http.ts`：拒绝非 HTTPS、带凭证/端口/裸 IP URL；DNS `resolve4` + `resolve6` 纳入总超时（`[3000, 15000]ms`），必须 **`addresses.every(isPublicIp)`**（屏蔽 IPv4 保留段与非全局 IPv6）方可发起连接；手动跟踪最多 3 跳且逐跳重验 DNS 与 Socket `lookup` 绑定，响应体与解压均限 **`2 MiB`**，仅提取纯文本（禁执行外链脚本）。 | SSRF、多 IP/IPv6 与跳转单测 |

---

## 5. 单机容量边界与 CI 门禁基线

- **Compose 实配内存配额**（[docker-compose.yml](../docker-compose.yml)）：`db: 1350m`、`app: 1536m`、`proxy: 128m`（容器日志统一 `10m × 3` 轮转，封顶 90 MB）。`prod@8e436ac` 实测空闲态内存合计不足 `200 MiB`（`app ~104 MiB`、`db ~91 MiB`），全库总占用 `40 MB`，距硬件红线拥有极大弹性余量，可平稳支撑每日 `10,000+` 条入库与 V2 增量演进。
- **分层生命周期管理**：永久保留 `content` 核心身份、引用与被收藏/批注/项目绑定的条目完整正文；`source_collection_job` 已由 Worker 自动按“保留最新 5 条 + 14 天滚动窗口”清理；观测快照（30d 折叠）与非收藏冷正文微缩（90d 截至 500 字并删检索投影）可通过定时运维任务执行，详见[开发与运维手册](development.md#3-备份恢复容量观测与日常运维)。
- **CI 门禁序列**：`npm run docs:check` → `npm run lint` → `npm run typecheck` → `npm run build`（同步 `dist/src/storage/schema/*.sql` 并核对 SHA-256）→ `npm run test:unit` → `postgres:16-alpine` 隔离库 `db:migrate:compiled` + `npm run test:postgres` + `npm run smoke:compiled`。
