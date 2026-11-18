# 主线架构规范

本文定义系统的架构边界、运行不变量与 4 GB 内存 / 60 GB 磁盘单机交付蓝图。已落地能力、7 项实码缺陷台账与分阶段路线见[当前状态](status.md)，接口细节见[数据与 API 契约](contracts.md)，交互细节见[产品交互规范](design.md)，开源源码考证与完整数学推导见[深度审查与单机架构蓝图](research/deep-audit-and-architecture-blueprint-20261118.md)。

## 0. 产品转型全景与“极简高性能确定性微内核 + 四大零改表扩展缝隙”原则

系统从早期单一平台监测全面转型为**中英双语高价值资讯流、事件聚簇、全景图表可视化与主动探索平台**。在架构上，我们对标 [`miniflux/v2`](https://github.com/miniflux/v2) 的极简持久调度、[`newsnext/newsnow`](https://github.com/newsnext/newsnow) 的零依赖榜单函数、[`ItzCrazyKns/Vane`](https://github.com/ItzCrazyKns/Vane) / [`jina-ai/node-DeepResearch`](https://github.com/jina-ai/node-DeepResearch) 的按题多槽取证，并吸收 [`KKKKhazix/AIHOT`](https://github.com/KKKKhazix/AIHOT) 的产品信息组织精华（三级信源 `T1`/`T1_5`/`T2`、英文一手优先代表选举、事件聚簇、48h/6h 热度升降、08:00 每日日报、先预览再创建、48h 旧文不刷屏），同时**彻底摒弃其高复杂度与入库强绑定大模型的缺陷**（拒绝拆分成 `api`/`worker`/`web` 三个 Node 容器耗尽 4 GB 内存，拒绝每篇文章入库前串行调用 5–6 次大模型或强制阻塞翻译）。

通过将全仓后端锁定在 **`~6,000 LOC` 的五模块扁平微内核（`Fastify 5 + TypeBox + pg + PostgreSQL 16`）** 并预留 **四大免改表扩展缝隙（Four Zero-Schema-Change Extension Seams）**，系统既能以极低心智负担与极致性能运行，又能让后续新增信源、接入 AI 翻译/摘要、扩展可视化图表或外部自动化在 `< 60` 行代码内零侵入落地：

| 核心平面 / 微内核扩展缝隙 | 100% 确定性高性能底座（默认零模型依赖） | 后续功能无缝扩展机制（可插拔 AI 翻译/摘要 · 图表 · 新信源） |
| --- | --- | --- |
| **缝隙 1 · 协议采集与自适应调度平面** (`ContentProvider` + `worker.ts`) | 到期扫描（`scheduleDueSourcesOnce`）→ 预算与同域并发门控（`host_rank <= 1`）→ 六类采集器（`feed` / `web_list` / `json_list` / `x` 批次 / `reddit` 三级 / `newsnow`）→ 48h 旧文防刷屏门控 → `commitContentBatch` 4x `UNNEST` 入库（200 条 `< 12ms`） | **零改表扩源**：新增热榜仅需在 `sources.ts` 添加 15 行纯函数 getter；无 RSS 官网直接在界面配置 `web_list` CSS 选择器或 `json_list` 字段路径试抓预览即用。X 采用 15–20 人 `from:u1 OR from:u2` 批次搜索省 95% 费用。 |
| **缝隙 2 · 确定性聚簇与可插拔 AI 翻译/摘要平面** (`batch.ts` + `platform_details.extensions`) | 规范化实体链接提取（GitHub/arXiv/原帖 ID/Canonical URL）+ 64-bit SimHash（$4\times 16$-bit 鸽巢 LSH 分桶复用 `idx_content_reference_nodes`）→ 自动归入 `storyKey` 并按 `T1 > T1_5 > T2` 选举英文一手代表报道 → 单 CTE 计算 48h 热度与 6h 升温比 → 08:00 规则汇编日报 | **入库零阻塞 + 按簇/按需 AI 翻译与摘要**：默认原语种原生直出；后续开启 AI 时无需引入重型 LLM SDK，直接用 ~45 行 Node 原生 `fetch` 调用任意 OpenAI 兼容 `/v1/chat/completions` 接口（或由外部 Agent 调 `POST /v1/content/:id/enrich` 写回），**仅对 `storyKey` 簇代表（`T1`/`T1_5`）或用户点击项**生成双语标题精译（`titleZh`）与三点事件综述（`summaryPoints`），按内容 SHA-256 指纹幂等缓存在 `platform_details.extensions.ai`，较逐篇调模型省 **90% Token**。 |
| **缝隙 3 · 统一过滤、RRF 推荐与全景可视化图表平面** (`compileContentFilter` + `GROUPING SETS`) | 按请求核验主体，先分页再批量读取可见观测 → `compileContentFilter` 统一编译权限、三段双字词 GIN 检索、频道、分级与事件簇 → 单次 `GROUPING SETS` 聚合同时输出多维图表分面与 RRF 个性化推荐流 | **一处扩展、全局生效**：在 `compileContentFilter` 增加任意过滤维度（如 `tier`、`storyKey`、`topicSlug`），首页信息流、按日/6h 跨平台叠柱趋势图、48h 热度 × 6h 增速矩阵、信源权威级分布图、多专题声量对比图（`POST /v1/project-comparisons`）与流式导出同步生效；前端采用零依赖原生响应式 `<svg>` 图表组件（`0 KB` 第三方图表包膨胀）。 |
| **缝隙 4 · 按题动态探索与统一预算/Agent 平面** (`source_provider_budget` + `/v1/openapi.json`) | 提问按确定性规则拆解 4 个正交证据槽 → Tier-1 免费垂直 API 联邦 + Tier-2 搜索 → 标题 3-gram 去重与 `keepKPerHostname(2)` → `linkedom` + `@mozilla/readability` 提取正文 → 复用 `delivery_mode='push'` 分三波（1.5s / 3.5s / 12s）入库并嗅探 RSS 一键转 `pull` | **统一预算门控与安全沙箱**：可选的 AI 翻译/摘要与采集渠道共用同一张 `source_provider_budget` 表（新增 `provider='ai_enrich'` 预算行，复用同一套日/月配额、间隔与 402/429 自动熔断机制，零新表！）；所有 AI 文本处理均在 `tools: []` 隔离读取态执行，彻底免疫第三方正文提示词注入。 |

## 1. 架构鸟瞰与刻意不做列表（Bird's Eye & Deliberate Absences）

```text
Web 浏览器 / 移动端 Web / 外部 AI Agent / R4 外挂 (plugins/zst-archive/)
                       │  HTTPS :443 (Cloudflare Edge WAF + Authenticated Origin Pulls mTLS)
         Caddy 2 (Compose 服务 proxy，mem_limit=128m，托管静态 Web，/api/* 反代，导出去缓冲)
                       │  Compose 内部网络（宿主机 DOCKER-USER 链仅放行 Cloudflare 或绑定 127.0.0.1）
        Fastify 5 单容器应用 (mem_limit=1536m)
        ├── HTTP 读平面：按请求核验会话 + API 连接池 (max=8)
        └── 后台任务平面：到期扫描 (5s) + 两个任务消费者 + 采集连接池 (max=2)
                       │
          PostgreSQL 16 (mem_limit=1350m, 指定列 LZ4 TOAST, 零宿主机端口映射)
```

**刻意不引入**：ORM（Prisma/Drizzle）、通用 DI 容器、拆多 Node 容器（`api`/`worker`/`web` SSR 分离会多耗 $>1\text{ GB}$ 内存）、Redis/BullMQ、Elasticsearch/ClickHouse、Headless Chromium 在线爬虫（Playwright 并发抓网页会直接触发 4GB 主机 OOM）、在线 Python/DuckDB 运行时，以及不落地的曝光/停留流水大表（`recommendation_event`）。

| ID | 等级 | 运行时与结构基线 | 验收出口 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 后端锁定 Node 24+、TypeScript、Fastify 5、`@sinclair/typebox`（`TypeBoxValidatorCompiler` + `registerAjvFormats` 保持 `removeAdditional: false`）、`pg`、`pg-query-stream`、PostgreSQL 16；网页正文提取使用轻量 `linkedom` + `@mozilla/readability` + `cheerio` + `sanitize-html`（单页解析 `<15ms`、峰值堆 `<65MB`）；单容器 `app` 整合 API、到期扫描与任务消费者，构建阶段复制 `src/storage/schema/*.sql` 至 `dist/`。 | 构建与编译态启动验收 |
| ARC-02 | MUST | 单机 Compose（`proxy` / `app` / `db`）为唯一生产交付拓扑；显式配置容器内存硬上限（`db: 1536m`、`app: 1350m`、`proxy: 128m`）与 `json-file` 日志轮转（`max-size: 10m, max-file: 3`）；应用监听 `SIGTERM` / `SIGINT`（`15_000ms` 优雅停机），构建与日常 CI 严禁打入 Python / DuckDB / `plugins/`。 | Compose 资源与退出测试 |
| ARC-03 | MUST | 仅外部多实现采集契约保留 `ContentProvider` 接口；业务模块内部直接调用接收 `Pool | PoolClient` 的命名 SQL 函数（写事务强制 `PoolClient`），彻底清除单实现 `*Repository` 与 `InMemory*` 模拟；由 `scripts/check-docs.ts` 守住 5 模块扁平结构、禁类/旧层 AST、`<= 450` 行/文件与 `<= 220` 字符非模板代码行上限。 | `docs:check` 与 AST lint |

## 2. 入口地图与五模块所有权（Code Map）

目标代码组织维持清晰的单向依赖（`apps/api/src/` -> `src/modules/*` -> `src/storage/db` & `packages/contracts`；`src/connectors/*` 零数据库依赖）：

- **`apps/api/src/app.ts` & `server.ts`**：Fastify 5 实例、Default-Deny Auth Hook（`findActor` 逐请求核验状态与凭据版本）、`@fastify/rate-limit`（`HOST=0.0.0.0`、`trustProxy: 1`）、连接与头超时、Swagger/Capabilities 与 `15s` 优雅停机。
- **`src/modules/access/`**：独家管理 `app_user`、`app_user_password`、`app_invite`、`app_audit_log` 与扩展后的 `app_session`（`client_kind`、`label`、`scopes`、`allowed_source_ids`）；不新建通用 Token 表。
- **`src/modules/collection/`**：独家管理 `source`、`collection_source`（完整暴露 `schedule`、`source_group`、`last_checked_at`、`last_success_at`、`incremental_to`、`http_etag`、`http_last_modified`、`automatic_collection_blocked`）、`source_collection_job`、`source_provider_budget`、`source_provider_usage`、`source_worker_heartbeat`，以及进程内 `worker.ts`（含 `scheduleDueSourcesOnce` 到期扫描、自适应轮询间隔、来源试抓预览与按题动态探索编排）。
- **`src/modules/content/`**：独家管理 `content`、`content_discovery`、`content_observation`、`public_content_search_document`，暴露唯一混合入库写函数 `commitContentBatch`、唯一纯过滤函数 `compileContentFilter`、两阶段观测补全与有界流式导出。实体链接、64-bit SimHash 事件聚簇、48h/6h 事件热度与 08:00 规则日报沿用后续阶段设计。
- **`src/modules/projects/`**：独家管理全系统**仅有的两张新表** `monitor_project` 与 `monitor_project_source`（外键 `ON DELETE CASCADE`），提供单 CTE `GROUPING SETS` 按日/平台/类型分面概览与项目对比。
- **`src/modules/workspace/`**：独家管理 `content_saved_query` 与 `content_annotation`，并在读取侧基于用户保存查询与最近收藏/批注实时计算 RRF 个性化推荐流（零行为日志表膨胀）。

| ID | 等级 | 模块所有权与数据安全约束 | 验收出口 |
| --- | --- | --- | --- |
| MOD-01 | MUST | 模块间禁止越权写他方独占表；`src/connectors/` 仅作协议适配与安全提取（含完整 IPv4/IPv6 SSRF `BlockList`、逐跳 IP 绑定重定向与 HTML/XML 消毒）且绝不访问 PG。迁移严格遵循 Expand-Migrate-Contract：`001..046` 已应用 SQL 不可修改，新优化通过 `047+` 前向迁移落地。 | 模块边界 AST 与 PG 迁移检验 |

## 3. 唯一入库、双字词 GIN 检索与事件聚簇不变量

所有在线采集、按题探索与外部推流统一在事务外完成 TypeBox 校验、单轮确定性版本归约、实体链接提取与 64-bit SimHash 指纹计算后，按 **`source -> job -> content identity 升序`** 获取行锁并进入 `commitContentBatch` 短事务：

1. **四组 `UNNEST` 集合写与消除 3 倍正文冗余**：依次提交 `content` upsert、`public_content_search_document` upsert、`content_discovery` upsert 与预排序的 `content_observation` insert。**在写 `public_content_search_document` 时，必须将兼容遗留列 `normalized_title` 与 `normalized_text` 置为空串 `''`，并对 `content.body_text`、`content.platform_details` 与 `search_text` 启用 PG16 `COMPRESSION lz4`**，彻底消除同一正文存 3 份的磁盘膨胀缺陷。
2. **三元版本元组与零无效更新**：服务端统一派生确定性 UUID 作为 `content.id`；正文比较严格使用 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")`；`ON CONFLICT DO UPDATE` 附带 `IS DISTINCT FROM` 判断确保零变更重放返回 `updated = 0` 且不重写搜索表。
3. **中文双字词与短代号的 GIN 检索**。`047` 为 `public_search_bigrams(search_text)` 建立 GIN 表达式索引。`compileContentFilter` 用双字候选筛选 `算力`、`o3` 等短词，再按标题、正文或全域执行转义后的字面匹配。含三个连续字母或数字的词项沿用 `gin_trgm_ops`。
4. **三级确定性事件聚簇（`storyKey`）与一手代表选举（零新增表）**：
   - **Stage 1（规范化实体与主链锚定）**：提取并归一化正文/外链中的 GitHub 仓库或 Release、arXiv ID、DOI、源推文 ID 或去追踪参数后的规范 URL（跨语言、跨平台直接归入同一 `storyKey`）；
   - **Stage 2（64-bit SimHash + $4\times 16$-bit 鸽巢 LSH 分桶）**：对标题（权重 3）+ 摘要前 400 字（权重 1）+ 数值/模型代号（权重 4）计算 64 位 SimHash，将 4 个 16-bit 分桶标签与 `storyKey` 写入 `content_references`（直接复用已有的 `idx_content_reference_nodes USING GIN (content_references jsonb_path_ops)` 索引），在 72 小时窗口内将汉明距离 $\le 3$ 或标题相似度 $\ge 0.55$ 的同源报道归入同一事件簇；
   - **Stage 3（三级权威度代表选举与角色标注）**：按信源分级 **`T1`（官方一手英文源）$>$ `T1_5`（认证核心学者/主创）$>$ `T2`（媒体与社区）** 选举簇内代表报道（Representative），并标注 `storyRole`（`primary_release` / `benchmark_eval` / `community_discussion` / `syndicated_repost`）。
5. **统一过滤、两阶段观测补全与无 `COUNT(*)` 翻页**：`compileContentFilter(scope, filter)` 在单个 `EXISTS(content_discovery JOIN collection_source)` 内完成权限与来源交集；列表分页先按 `created_at_source DESC NULLS LAST, id DESC` 取当页 `limit + 1` 条 `content.id`，再在同一 SQL 快照内连接当页记录并批量补全最新观测，消除主查询逐行关联子查询开销。

| ID | 等级 | 存储、检索与迁移执行规则 | 验收出口 |
| --- | --- | --- | --- |
| SQL-01 | MUST | 批量写入固定 4 组 `UNNEST`，禁止循环内逐条 SQL；`public_content_search_document` 的遗留 `normalized_title`/`normalized_text` 必须写空串 `''` 并开启 `lz4` 压缩，严禁三份正文落盘；零变化重放不得刷新搜索表或虚增 `updated` 计数。 | 逆序/平局/幂等与存储体积测试 |
| SQL-02 | MUST | 在线查询禁止全表 `coverage COUNT(*)` 与 `strpos()` 热扫；双字词走独立 GIN 表达式索引，并用原始字面条件复核标题或正文，长词沿用 `gin_trgm_ops`；大索引建表与 SQL 迁移必须使用独立长超时连接。 | EXPLAIN 索引命中与迁移实测 |

## 4. 自适应调度、动态探索与单机安全基线

| ID | 等级 | 调度、探索、收费保护与边缘安全约束 | 验收出口 |
| --- | --- | --- | --- |
| RUN-01 | MUST | 单 Worker 进程使用两个任务消费者与有界到期扫描。扫描仅为预算可用的来源入队，Feed 同域领取互斥，停机后合并至有上限的追赶窗口。预算按间隔及 UTC 日/月边界唤醒，关闭及单次超上限等配置变更。Feed 连续 304 或无新增退避，截断加密；热榜按配置周期采集。持久化付费回执只重读，结果未知的启动停发。 | 停机恢复、预算唤醒与采集 E2E |
| SAFE-01 | MUST | 全局 `/v1/*` 执行 Default-Deny（仅放行 `/healthz`、`/readyz`、`POST /v1/auth/login`、`GET /v1/auth/session`、`POST /v1/auth/register`）；`onRequest` 查询会话状态、权限与凭据版本；浏览器 Cookie 写操作强制校验同源 `Origin`；公网部署在 Cloudflare 后开启 Caddy Authenticated Origin Pulls（mTLS）与 `trusted_proxies`，宿主机通过 `DOCKER-USER` 防火墙链（或 `127.0.0.1` 隧道绑定）封堵绕过 CDN 的源站直连，`db` 严禁暴露宿主机端口。 | 权限、撤销、CSRF 与反代测试 |
| SAFE-02 | MUST | 单实例 API 与采集连接池总上限 10（API 8、采集 2），吊销和过期校验按请求查库。流式导出共享一个进程槽，使用 `REPEATABLE READ READ ONLY`、35 秒空闲事务时限、`X-Accel-Buffering: no`，客户端断连立即销毁游标并回滚。缓存和进一步池调优由混合负载实测决定。 | 隔离库断流实测与混合负载观测 |
| SAFE-03 | MUST | 所有外部网页/Feed/动态探索抓取必须通过统一安全读取器：（1）DNS 解析纳入整体 `AbortSignal.timeout(10000)` 期限；（2）校验全部返回的 A/AAAA 记录并拦截完整 IPv4 + IPv6 保留网段（含 `127.0.0.0/8`、`169.254.0.0/16`、`::1`、`fe80::/10`、`fc00::/7`、IPv4 映射地址 `::ffff:0:0/96` 与 NAT64 `64:ff9b::/96`）；（3）手动跟随最多 3 跳 HTTPS 重定向，**每一跳重新执行 DNS 解析、保留网段校验与 Socket `lookup` IP 绑定**以彻底阻断 DNS Rebinding TOCTOU；（4）单页流式读取硬上限 `2 MiB`，经 `linkedom` + `@mozilla/readability` + `sanitize-html` 提取纯文本，严禁执行任何外部 JS。 | SSRF、IPv6 映射与逐跳重定向单测 |

## 5. 4 GB 内存 / 60 GB 磁盘容量工程与分层保留策略

在 **4,096 MiB 物理内存 + 2 GiB Swap、60 GB 系统盘、\$0 新增成本** 约束下，单机资源按以下刚性配额运行：

1. **4 GB 内存刚性分配表**：
   - **Linux 内核与 OS 页缓存（`~1,100 MiB`）**：`journald` 限制 `100M`，开启 `2 GiB /swapfile`（`vm.swappiness=10`）吸收瞬时峰值；
   - **PostgreSQL 16 容器（当前上限 `1350m`，参数需在目标机实测）**：`shared_buffers=768MB`、`effective_cache_size=2GB`、`work_mem=8MB`、`maintenance_work_mem=128MB`、`wal_buffers=16MB`、`max_connections=25`、`max_wal_size=1GB`、`wal_compression=lz4`、`default_toast_compression=lz4`、`gin_pending_list_limit=4MB`；
   - **Fastify + Worker 容器（`mem_limit: 1350m`）**：`NODE_OPTIONS="--max-old-space-size=1024"`；
   - **Caddy 2 容器（`mem_limit: 128m`）**：`GOMEMLIMIT=100MiB`。
2. **60 GB 磁盘生命周期与日采 1 万条永不爆盘策略（可用 PG 数据预算 `36.8 GB`）**：
   - 消除 `normalized_title`/`normalized_text` 冗余双列并开启 `lz4` 后，日采 10,000 条的活跃日增量从 `156 MB/天` 降至 **`74 MB/天`（`2.22 GB/月`）**；
   - **每日后台分层裁剪任务（Tiered Retention，每批 `LIMIT 5000` 短事务）**：
     1. **永久保留（Forever）**：所有 `content` 行的**去重身份与引用骨架**（`id`、`source_id`、`kind`、`external_id`、`url`、`title`、`content_author`、`created_at_source`、`content_evidence_key`、`content_references`，仅 `~600 B/条`，1,000 万条仅占 `~6 GB`）+ **所有被用户收藏、写有批注或绑定在活跃研究项目下的完整正文与搜索索引**；
     2. **30 天快照折叠**：对入库超过 30 天的内容，每个 `(content_id, collection_source_id)` 仅保留最新 1 条 `content_observation` 指标快照，清理历史中间观测快照与已终结超过 30 天的 `source_collection_job` 日志；
     3. **90 天冷正文微缩**：对入库超过 90 天且**未被收藏/批注/项目引用**的普通资讯，删除其 `public_content_search_document` 索引行并将 `content.body_text` 微缩保留前 500 字摘要（`textState = 'truncated'`）。由此使全库在日采 1 万条下 **3 年稳态体积恒定收敛于 `~13.2 GB`**（不足 `36.8 GB` 数据预算的 36%）。

## 6. CI/CD 与可观测基线

1. **Fast Gate**：所有 GitHub Actions 锁定 40 位 Commit SHA 并启用 `npm ci --ignore-scripts`；运行 `docs:check`（含 `041+` 迁移号唯一与 `001..040` 不可变检查）、`lint`、全仓 `typecheck`、构建检查（校验 `dist/src/storage/schema/*.sql` 存在）与离线纯函数单测，并同步运行 `gitleaks` 与生产依赖 `npm audit`。
2. **Compiled + PG16 E2E Gate**：拉起 `postgres:16-alpine` 容器，用编译产物 `dist/` 运行 `npm run db:migrate:compiled` 与核心 PG16/HTTP 契约测试 + 编译态 Playwright 浏览器冒烟。
3. **高信号结构化观测**：生产日志仅输出 `requestId`、慢 SQL、队列积压年龄、来源抓取延迟/错误、计费头 `X-Credits-Used` 与迁移版本；维护已演练的 `pg_dump`/`pg_restore` 隔离库恢复流程。
