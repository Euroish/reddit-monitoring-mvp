# 当前状态与下一阶段规划（唯一状态与规划真源）

> **核对日期**：`2026-11-18`（基于 `prod@8ebebfb` 全仓 54 个生产源码文件与 48 个 SQL 迁移逐行核验）。第 0 节保留审查基线，第 0.3 节记录本轮代码及尚待实测的项目，第 1–2 节保留旧 `main@dac7ab7` 与双分支审计留档，第 3 节定义对齐 `AIHOT` / `miniflux` / `newsnow` / `Vane` 后的 Phase 1–3 唯一交付路线。

---

## 产品转型方向与唯一实施路线（已清理首尾双路线漂移）

产品已从早期的“单一平台监测与重型研究项目工作台”转型为运行在 **4 GB 内存、60 GB 系统盘、\$0 新增基础设施预算** 单机上的**中英双语高价值信息流、事件聚簇、按题动态探索、全景数据可视化与个性化推荐平台（极简高性能五模块确定性微内核 + 四大零改表扩展缝隙 + 可插拔 AI 翻译与事件摘要）**。

**本轮产品转型、信源范围与极简架构定案**：
1. **聚焦三大高频支柱，暂缓重度金融接入**：
   - **支柱 1 · 关注的人与 AI 前沿开发（英文一手 `T1`/`T1_5` 占 85%+，中资只收官方一手）**：因为全球大模型、Coding Agent、开源仓库与架构论文 100% 首发于英文（OpenAI / Anthropic / DeepMind / Hugging Face 官方源、GitHub Releases、`r/LocalLLaMA`、Hacker News 及硅谷核心研究员 X/博客），中文仅收录 DeepSeek、千问 Qwen、月之暗面 Kimi、MiniMax 等官方一手发布，彻底剔除滞后失真的二手中文营销号；
   - **支柱 2 · 全球科技、独立开发与数码产品**：英文收 Hacker News、GitHub Trending、TechMeme、Product Hunt、The Verge、Ars Technica；中文收 V2EX、IT之家、少数派、酷安今日最热；
   - **支柱 3 · 大众生活、文化娱乐与全网热议**：中文通过 `newsnow` 零成本直取 B站全站热门视频与热搜、知乎热榜、微博实时热搜、虎扑步行街、机核、什么值得买；英文通过 Reddit 原生 `.rss` 雷达 + 按需 `kaix` 水合覆盖 `r/popular`、`r/gaming`、`r/movies`、`r/television`、`r/technology` 及 YouTube 顶流创作者原生 Atom 频道。
2. **吸收 [`KKKKhazix/AIHOT`](https://github.com/KKKKhazix/AIHOT) 产品精华，打造“极简确定性微内核 + 可插拔 AI 翻译/摘要 + 全景数据可视化”**：
   - 吸收其 **三级信源（`T1` 官方一手 / `T1_5` 认证主创 / `T2` 媒体社区）与代表报道选举**、**`web_list` 选择器抓无 RSS 页与“先预览前 20 条再保存”**、**`initialBackfillLimit: 8` 与 48h 旧文不刷屏**、**48h 独立来源事件热度（24h 半衰期 + 6h 飙升检测）**、**08:00 规则日报** 与 **三维主题目录**；
   - 摒弃其“3 个独立 Node 容器 + 105 个碎迁移 + 每篇文章入库前串行调用 6 次大模型”的重型脆弱设计：本系统将全仓后端收敛在 **`~6,000 LOC` 的 `Fastify 5 + TypeBox + pg + PG16` 五模块微内核**，**入库、实体打标、64-bit SimHash 事件聚簇、48h/6h 热度、RRF 推荐、按题探索与 08:00 日报 100% 确定性零模型运行**（默认原语种原生直出不强制翻译）；
   - **可插拔 AI 翻译与事件摘要缝隙（较逐篇调用省 90% Token）**：后续接入 AI 时无需安装重型 SDK、无需改表，直接通过 ~45 行 Node 原生 `fetch` 对接任意 OpenAI 兼容 `/v1/chat/completions` 接口（或由外部 Agent 调 `POST /v1/content/:id/enrich` 写回），并复用 `source_provider_budget`（`provider='ai_enrich'`）统一管控日/月额度与熔断；**仅对 `storyKey` 事件簇代表（`T1`/`T1_5`）或用户点击项**按需生成中英双语对照标题（`titleZh`）与三点事件综述（`summaryPoints`），按内容 SHA-256 指纹幂等缓存在 `platform_details.extensions.ai`；
   - **原有数据可视化与图表体系全面适配升级**：基于 `compileContentFilter` + 单条 PostgreSQL `GROUPING SETS` 查询（`< 8ms`）与前端零依赖原生响应式 `<svg>` 图表组件（`apps/web/src/charts.tsx`），在探索页、热度榜与专题工作台统一提供**按日/6h 跨平台与权威级叠柱脉冲图**、**48h 事件热度 × 6h 升温增速矩阵**、**`T1/T1_5/T2` 信源传播结构条**与**多专题/多实体并排声量对比图（`POST /v1/project-comparisons`）**。

### Phase 1–3 分阶段交付序列（按可独立验收的纵向切片推进）

| 阶段 | 核心交付切片 | 涉及模块与文件 | 完成验收标志 |
| --- | --- | --- | --- |
| **Phase 1 · 存储、双字词检索与自动排期闭环** | 复用现有来源、预算、任务与内容表。补齐新写入的压缩与短词索引，开启有界自动采集、任务恢复和「最新」入口。存量投影清理走独立维护窗口。 | `047..048`、`content` 和 `collection` 模块、来源页、首页、Compose | 双字词命中与索引计划，后台定时入库及重启恢复，预算禁用和耗尽无空转写库。 |
| **Phase 2 · 三大双语支柱、事件聚簇、48h 热度日报与全景可视化图表** | 1. 扩展 `sources.ts` 接入 13+ `NewsNow` 大众娱乐/科技榜单、HF Daily Papers、`web_list` 选择器与完整 IPv4/IPv6 + 3 跳 IP 绑定安全读取；<br>2. 支持 200 位 AI 学者/主创 X 批次搜索（`from:u1 OR from:u2 ...`，省 95% 成本）并提取推文图片/视频 `media` 与外链；<br>3. 落地规范实体链接 + 64-bit SimHash 事件聚簇（`storyKey`）、`T1 > T1_5 > T2` 英文一手代表选举、48h/6h 热度趋势、08:00 规则日报与 RRF + 重力衰减个性化排序；<br>4. 将 `/` 切换为“为你 / 最新 / 08:00 日报 / 48h 热度”与三大频道首页，按混合负载实测决定是否增加读取缓存；新增 `GET /v1/content/facets`、`POST /v1/project-comparisons` 与零依赖原生 `<svg>` 图表组件 `apps/web/src/charts.tsx`（按日/6h 叠柱图、48h 热度 × 6h 增速矩阵、权威级分布条、多专题对比图）。 | • `src/connectors/web/sources.ts`<br>• `src/connectors/x/twitterapis.ts`<br>• `src/modules/content/batch.ts`, `routes.ts`, `thread.ts`<br>• `src/modules/projects/routes.ts`, `sql.ts`<br>• `apps/web/src/App.tsx`, `charts.tsx`, `pages/ContentLibrary.tsx`, `pages/Projects.tsx` | 1. 同一事件（英文官方一手 + 实测 + 社区讨论 + 10 家中文媒体转发）在首页折叠为 1 张事件聚簇卡，英文 `T1`/`T1_5` 原题稳居主标题；<br>2. 四类 SVG 图表点击柱体/节点即可联动过滤下方列表；<br>3. 500 并发读者压测首页对应 PG 查询 $< 1\text{ QPS}$。 |
| **Phase 3 · 按题动态探索（20–30 站）与可插拔 AI 翻译/事件摘要** | 1. 实现 4 正交槽确定性查询拆解（官方一手 / 独立评测 / 真实复现 / 失败反例）+ Tier-1 免费垂直 API 联邦（本地 PG + HN Algolia + GitHub Search + HF/arXiv + Reddit）+ Tier-2 可插拔搜索索引；<br>2. 引入 `linkedom` + `@mozilla/readability` 内存安全正文提取器（单页 `<15ms`、峰值 `<65MB`）与页面 RSS 自动嗅探；<br>3. 复用 `delivery_mode='push'` 的 `radar` 系统源实现三波渐进提交（1.5s / 3.5s / 12s），支持将发现的作者/RSS 一键转为长期 `pull` 监控源；<br>4. 落地零 SDK 可插拔 AI 翻译与事件簇三点摘要模块（`src/modules/content/ai.ts` + `POST /v1/content/:id/enrich`，按内容 SHA-256 指纹幂等写入 `platform_details.extensions.ai`，支持卡片 `原文 \| 双语对照 \| AI 综述` 切换，未配 AI 时 100% 确定性无损运行）。 | • `src/connectors/web/extractor.ts`, `search-router.ts`<br>• `src/modules/content/ai.ts`<br>• `src/modules/collection/routes.ts`<br>• `src/modules/workspace/routes.ts`<br>• `apps/web/src/pages/Workspace.tsx` | 1. 提问后 $<3.5\text{s}$ 渲染首批正文证据，$<12\text{s}$ 完成 24–30 站提取且 Node RSS 内存 $< 800\text{ MB}$；<br>2. 开启 `ai_enrich` 时按簇生成双语标题与三点摘要且同指纹零重复调用，关闭时零报错原生直出。 |

---

## 0. 当前重整分支执行记录

`r1-content-batch` 通过 `11e7864` 引入 `main@dac7ab7`，形成可快进的 Fastify 重整版本，审查时的 `prod` 基线为 `8ebebfb`。

唯一迁移链为原样保留的 `001..040`（含历史重复前缀的两个 018、两个 020）→ `041_content_batch.sql` → `042_monitor_projects.sql` → `043_kernel_cutover.sql` → `044_stage_one_safety.sql` → `045_web_sources.sql` → `046_hydration_queue.sql`，共 48 个基线 SQL 文件。本轮新增 `047_short_search_and_storage.sql` 和 `048_provider_budget_window.sql`，已应用迁移保持原校验和。

### 0.1 `prod@8ebebfb` 审查台账（历史基线）

> 以下 7 项均为对 `src/` 与 `apps/web/` 逐行核实的确凿代码缺陷（完整推导见[深度审查与单机架构蓝图](research/deep-audit-and-architecture-blueprint-20261118.md)）：

| 编号 | 缺陷摘要 | 真实源码坐标 | 审查时提出的方案 |
| :--- | :--- | :--- | :--- |
| **BUG-01** | **正文 3 倍冗余落盘（60 GB 磁盘寿命折损过半）** | `044_stage_one_safety.sql:3-7` 加回 `normalized_title`/`normalized_text` 后，[src/modules/content/sql.ts]( ../src/modules/content/sql.ts#L177-L181 ) 在每次写入时把完整正文同时存入 `content.body_text`、`search_text` 与 `normalized_text` 三处，而查询侧只读 `search_text`。 | `content/sql.ts:178` 对 `normalized_title`/`normalized_text` 写空串 `''`；追加 `047` 迁移清空历史冗余列并对 `body_text`、`platform_details`、`search_text` 启用 PG16 `COMPRESSION lz4`（日增量立降 52.5%）。 |
| **BUG-02** | **中文双字词与短代号被 `422` 封杀及 `pg_trgm` 脱索引** | [src/modules/content/search.ts]( ../src/modules/content/search.ts#L75-L78 ) 硬拦截 `<3` 连续字符，导致 `算力`、`开源`、`评测`、`游戏`、`AI`、`o3`、`R1` 全部报 `HTTP 422`；且直接 `LIKE '%词%'` 在 `trgm_op.c:1005,1067` 下产生 0 个 trigram。 | `publicSearchDocument` 追加空格分隔的 CJK 2 字 Bigram 与短代号；`compileContentFilter` 对 2 字符词编译为 `LIKE '% 词 %'`，触发 `trgm_op.c:990,1058` 补齐 `LPADDING=2, RPADDING=1`，走 3 键纯 GIN 索引扫描。 |
| **BUG-03** | **自动排期环缺失 + 预算受阻 1 分钟死循环写库风暴** | [src/modules/collection/worker.ts]( ../src/modules/collection/worker.ts#L285-L311 ) 无 `next_due_at` 扫描器；且 [worker.ts:136]( ../src/modules/collection/worker.ts#L136 ) 在预算未开启、耗尽或间隔不足时先 `attempts+1` 再硬编码 `next_run_at=NOW()+interval '1 minute'`，每天产生上万次无效写盘。 | 新增 `scheduleDueSourcesOnce`（领源前先校验预算与同域并发）；预算/间隔受阻时回退 `attempts` 并将 `next_run_at` 设为精确的 `provider_ready_at`。 |
| **BUG-04** | **X 单号轮询无时间窗、丢弃媒体且与默认 `pageSize=25` 冲突崩溃** | [src/connectors/x/twitterapis.ts]( ../src/connectors/x/twitterapis.ts#L109-L120 ) 对 `limit > 20` 直接抛异常（与 `030` 默认 `pageSize=25` 冲突），`account` 模式不传时间窗，且 [twitterapis.ts:65]( ../src/connectors/x/twitterapis.ts#L65 ) 硬编码 `media: []`。 | 自动钳制 `Math.min(pageSize, 20)`；支持 15–20 人 `from:u1 OR from:u2` 批次 `advanced_search`（带 `since_time`/`until_time`，省 95% 成本）；完整提取图片/视频 `media`、外链与引用推文。 |
| **BUG-05** | **Web 连接器仅支持 HN、丢弃作者且存在 IPv6/重定向与 DNS 超时缺口** | [src/connectors/web/sources.ts]( ../src/connectors/web/sources.ts#L13-L105 ) 的 `resolve4` 在超时计时器外执行，缺 IPv6/`::ffff:0:0/96`/`64:ff9b::/96` 拦截，拒绝一切 `301/302` 重定向，丢弃 `<author>`，且 `newsnow` 除 `"hackernews"` 外全报 `422`。 | 升级为完整 IPv4+IPv6 `BlockList` + 含 DNS 的总超时 + 最多 3 跳逐跳 DNS 重验与 IP 绑定 + `linkedom`/`Readability` 提取；扩充 13+ `NewsNow` 榜单、`web_list` 与 `json_list`。 |
| **BUG-06** | **每请求直查 PG `findActor`、单连接池争用与多层回复漏查** | [apps/api/src/app.ts]( ../apps/api/src/app.ts#L143 ) 每请求查库鉴权；[search.ts:155]( ../src/modules/content/search.ts#L155-L158 ) 主查询逐行跑观测子查询；[thread.ts:37]( ../src/modules/content/thread.ts#L37-L40 ) 漏掉仅带 `reply_to` 中间评论的多层回复；`Bluesky`（[bluesky-appview-content.connector.ts:276]( ../src/connectors/bluesky/bluesky-appview-content.connector.ts#L276-L291 )）早于 `from` 时不停页。 | 加入 `findActor` 60s LRU + `Singleflight` 15s SWR 缓存；拆分为两阶段批量取观测与读写双连接池；`thread.ts` 补齐父链闭包；`Bluesky` 越过 `from` 立即停页。 |
| **BUG-07** | **前端 UI 锁死 `search` 目标、隐藏作者/指标/按日分面且缺预算与任务按钮** | [App.tsx]( ../apps/web/src/App.tsx#L101 ) `/` 仍为项目页；[Sources.tsx]( ../apps/web/src/pages/Sources.tsx#L53-L59 ) 锁死 `target.type="search"`（无法建账号/社区源）且无预算面板和任务恢复按钮；[ContentLibrary.tsx]( ../apps/web/src/pages/ContentLibrary.tsx#L265 ) 不显示作者与指标；[Projects.tsx]( ../apps/web/src/pages/Projects.tsx#L169 ) 过滤丢弃了 SQL 已算好的 `day_group` 按日趋势数据。 | `/` 切换为信息流与事件聚簇卡（展示作者、分级、指标、理由）；`Sources.tsx` 开放全目标类型、试抓预览、排期、预算与任务恢复按钮；`Projects.tsx` 渲染按日柱形图联动。 |

### 0.2 既有后端采集与隔离库真实验收基线

2026-11-18 在仅绑定回环地址的全新 PG16 库应用 48 个迁移，通过编译态 API 提交真实任务并与 PostgreSQL 对账：共成功 12 项，处理 365 条记录，去重后入库 **358 条**（其中 7 条为跨来源重复发现，1 条已存主帖因评论补采更新）：

| 渠道 | 实际入库与核验结果 | 启动次数与预算资源 |
| --- | --- | --- |
| **Kaix (Reddit)** | 111 条主帖、85 条评论（首帖 50 条、次帖 35 条，SQL 与评论树核实 10 条嵌套回复指向同根帖库内父评论）；`SIGTERM` 重启后复用同一 `runId` 零重复扣费 | 4 次，预留 214 条；Apify Run 合计 `$0.001786`、`0.002733 CU` |
| **TwitterAPIs (X)** | 搜索与 NASA 时间线共返回 60 条，去重入库 54 条；两次时间线在触发限流停机时保持未决付费状态，重启后严守规则未自动重放 | 5 次入账，预留 100 条 |
| **RSS / NewsNow** | Hacker News RSS、BBC Tech、The Verge、Ars Technica 共 78 条；NewsNow Hacker News 榜 30 条 | RSS 4 次（预留 124 条）；NewsNow 1 次（预留 31 条） |

17 项单测、17 项隔离 PG16/HTTP 集成测试与 1 条编译态 Chromium 主流程通过；PG16 隔离库备份包含 `pg_trgm` 扩展，恢复后 47 张表行数与迁移校验和一致。

### 0.3 当前实现与未验证项

| 审查项 | 本轮实码 |
| --- | --- |
| BUG-01、02 · 存储和检索 | `047` 增加双字 GIN 表达式索引和 LZ4 列压缩。新写入省去第三份正文，保留既有列供兼容。存量重复列按[有界维护步骤](development.md#搜索投影存量维护)清理。 |
| BUG-03 · 自动排期 | `048` 增加预算到期计算。来源可经 API 开启排期，后台使用有界 SQL 批次入队，预算等待按间隔或 UTC 日/月边界恢复，禁用或单次超上限等配置变化再唤醒。Feed 同域领取互斥，初次最多 8 条。X/Bluesky 支持有上限的游标推进。已知付费 Run 保留回执，未知启动停发。 |
| BUG-04、05 · 连接器 | X 账号通过带窗口的 `from:` 搜索，限制为 20 条每页并保留媒体及外链。Feed 保留 RSS/Atom 作者，HTTPS 读取共享 DNS/响应总时限，逐跳验证并绑定公网 IP。固定热榜支持 HN、B 站热门视频和 V2EX 分享。 |
| BUG-06、07 · 读取与交互 | 列表只为已分页的行批量读观测，API/采集各用有限连接池，评论树支持仅持有 `reply_to` 的多层节点。首页转到「最新」，项目移到 `/projects`。来源页支持目标类型、自动排期、预算和任务恢复。项目按日分面可进入同日内容。 |

隔离 PG16 已核对后台自动采集、重启沿用 Feed 验证器、双字词范围、嵌套回复和 1,000 条长正文批量写入；15,002 行合成数据上，`算力` 与 `o3` 均使用双字 GIN Bitmap Index Scan。鉴权继续查库，吊销与过期立即生效。Bluesky 的公开接口未承诺按发布时间单调排序，采用有界游标，不根据单条发布时间截断。生产负载、索引构建空间和付费渠道实账仍需实测。事件聚簇、推荐、按题探索、通用网页选择器及 AI 扩展仍在后续阶段。

---

## 1. 重整前 `main` 实码与验证证据（历史对照留档）

| 领域范围 | `main@0.9.1` 历史代码现状 | 重整分支已完成的清理与重构 |
| :--- | :--- | :--- |
| **API / Web 框架** | 手写 `node:http`（`create-api-server.ts` 3,606 LOC + `readyz-observability.ts` 793 LOC）；React 含旧 Phase1/Markets 等 21 页 | 已收敛为 Fastify 5 + TypeBox 五模块、`/v1/capabilities` + `/v1/openapi.json`、机器 API Key、`monitor_project*` 两新表与五导航工作台 |
| **存储与仓储层** | PG 迁移止于 `040`、30 个 PG 仓储、27 个单实现接口、14 个 `InMemory*`（106 KB）；`commitPage` 逐条 SQL | 已实删全部单实现 `*Repository` 与 `InMemory*`；落地 4x `UNNEST` `commitContentBatch`、`content_evidence_key COLLATE "C"` 与 Keyset 分页 |
| **渠道替换** | 依赖 `Arctic Shift`（高超时 `422`）与 `TwitterAPI.io`（`$0.15/1k`） | 已物理实删 `Arctic Shift` 与 `TwitterAPI.io` 在线代码，切换至 `kaix` + `red_crawler`、`TwitterAPIs` + `ScrapeBadger`、`newsnow` 与 `feed` |

---

## 2. 双开发分支客观实测对照（重整前审计留档）

重整前远端曾并存 `origin/r1-content-batch@353fd9b`（Branch A，128 文件 / 5,469 生产 LOC，0 循环依赖）与 `origin/feat/r1-core-and-r2-wip@3e77a3e`（Branch B，610 文件 / 55,180 生产 LOC，保留旧 `create-api-server.ts` 与 `InMemory*`）。主线以 Branch A 洁净五模块骨架为基底，吸收了 Branch B 中有价值的 UI/流式限读/异步 Run 思路，并修复了编译态迁移 SQL 复制、`SIGTERM` 租约回退、`trustProxy: 1`、同版本归约与流式导出 `complete: true` 尾块。

---

## 3. 生产发布门禁与阈值驱动演进

1. **Fast Gate & Compiled PG16 E2E Gate**：所有 GitHub Actions 锁定 40 位 Commit SHA 与 `npm ci --ignore-scripts`；依次通过 `docs:check`、`lint`、`typecheck`、`build`（校验 `dist/src/storage/schema/*.sql` SHA-256 一致）、离线单测、编译态 `db:migrate:compiled` + PG16/HTTP 集成测试 + Playwright 浏览器冒烟，以及 `gitleaks` 和 `npm audit`。
2. **单机生产上线前核对清单**：
   - 应用 `047..048` 存储、检索与预算迁移，确认 `docker-compose.yml` 的内存限额（`1536m` / `1350m` / `128m`）、PG16 `lz4` 与 `json-file` 日志轮转生效；
   - 验证宿主机 `2 GiB /swapfile`、Cloudflare mTLS Origin Pulls 与 `DOCKER-USER` 防火墙规则；
   - 按原 owner 完成旧 `research_export` 历史导出交付对账后再在后续独立版本删除旧冻结表；
   - 保持单容器 `app` 运行，仅在混合负载实测证实事件循环延迟持续影响首页且缓存/连接池已调优后，才讨论用同一镜像分拆 API 与 Worker 角色。R4 `.zst` 离线归档始终保持仓外/独立 `plugins/zst-archive/` 外挂推流路径。
