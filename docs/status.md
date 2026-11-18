# 当前状态与下一阶段规划（唯一状态与规划真源）

> **核对日期**：`2026-11-18`（基于 `prod@8ebebfb` 全仓 54 个生产源码文件与 48 个 SQL 迁移逐行核验）。第 0 节记录当前重整分支的实码基线与 7 项待修硬缺陷台账，第 1–2 节保留旧 `main@dac7ab7` 与双分支审计留档，第 3 节定义对齐 `AIHOT` / `miniflux` / `newsnow` / `Vane` 后的 Phase 1–3 唯一交付路线。

---

## 产品转型方向与唯一实施路线（已清理首尾双路线漂移）

产品已从早期的“单一平台监测与重型研究项目工作台”转型为运行在 **4 GB 内存、60 GB 系统盘、\$0 新增基础设施预算** 单机上的**中英双语高价值信息流、事件聚簇、按题动态探索与个性化推荐平台（100% 确定性零内置 LLM 内核 + 开放式 API 扩展架构）**。

**本轮产品转型、信源范围与架构收敛定案**：
1. **聚焦三大高频支柱，暂缓重度金融接入**：
   - **支柱 1 · 关注的人与 AI 前沿开发（英文一手 `T1`/`T1_5` 占 85%+，中资只收官方一手）**：因为全球大模型、Coding Agent、开源仓库与架构论文 100% 首发于英文（OpenAI / Anthropic / DeepMind / Hugging Face 官方源、GitHub Releases、`r/LocalLLaMA`、Hacker News 及硅谷核心研究员 X/博客），中文仅收录 DeepSeek、千问 Qwen、月之暗面 Kimi、MiniMax 等官方一手发布，彻底剔除滞后失真的二手中文营销号；
   - **支柱 2 · 全球科技、独立开发与数码产品**：英文收 Hacker News、GitHub Trending、TechMeme、Product Hunt、The Verge、Ars Technica；中文收 V2EX、IT之家、少数派、酷安今日最热；
   - **支柱 3 · 大众生活、文化娱乐与全网热议**：中文通过 `newsnow` 零成本直取 B站全站热门视频与热搜、知乎热榜、微博实时热搜、虎扑步行街、机核、什么值得买；英文通过 Reddit 原生 `.rss` 雷达 + 按需 `kaix` 水合覆盖 `r/popular`、`r/gaming`、`r/movies`、`r/television`、`r/technology` 及 YouTube 顶流创作者原生 Atom 频道。
2. **吸收 [`KKKKhazix/AIHOT`](https://github.com/KKKKhazix/AIHOT) 产品精华，坚持“零内置大模型、不做强制翻译、开放式扩展设计”**：
   - 吸收其 **三级信源（`T1` 官方一手 / `T1_5` 认证主创 / `T2` 媒体社区）与代表报道选举**、**`web_list` 选择器抓无 RSS 页与“先预览前 20 条再保存”**、**`initialBackfillLimit: 8` 与 48h 旧文不刷屏**、**48h 独立来源事件热度（24h 半衰期 + 6h 飙升检测）**、**08:00 零模型成本规则日报** 与 **三维主题目录**；
   - 摒弃其“3 个独立 Node 容器 + 105 个碎迁移 + 每篇文章串行调用 6 次大模型才允许入库”的重型脆弱设计：本系统**入库、实体打标、64-bit SimHash 事件聚簇、48h/6h 热度、RRF 推荐、按题探索与 08:00 日报 100% 确定性零模型运行**；**不做强制机器翻译**（英文一手源与中文热榜均保持原语种原生直出），同时通过 `/v1/capabilities`、`/v1/openapi.json`、只读机器 API Key 与 `platform_details.extensions` 开放 JSONB 槽位，为未来外部 Agent 或自定义插件留出干净的开放式接入边界。

### Phase 1–3 分阶段交付序列（按可独立验收的纵向切片推进）

| 阶段 | 核心交付切片 | 涉及模块与文件 | 完成验收标志 |
| --- | --- | --- | --- |
| **Phase 1 · 存储止血、双字词 GIN 检索与全自动排期闭环** | 1. 消除 `044` + `content/sql.ts` 正文 3 倍冗余落盘，开启 PG16 `lz4` 压缩、连接池读写隔离与 Docker 日志/内存限制；<br>2. 基于 `pg_trgm` (`trgm_op.c:990,1058`) 空格边界机制修复 `search.ts:75`，支持中文双字词（如 `算力`、`开源`、`评测`、`游戏`）与短代号（`AI`、`o3`、`R1`）纯 GIN 索引秒查；<br>3. 在 `worker.ts` 落地 `scheduleDueSourcesOnce` 到期扫描、同域并发限流（`host_rank <= 1`）、自适应轮询间隔（$\text{clamp}([2\text{m}, 12\text{h}])$）与预算精确唤醒（根治 1 分钟死循环写库）；<br>4. 补齐 `Sources.tsx` 账号/社区/`web_list` 目标创建、试抓预览（前 20 条）、预算开关与任务恢复按钮，落实 48h 旧文不刷屏。 | • `047_storage_and_scheduler.sql`<br>• `src/modules/content/sql.ts`, `search.ts`<br>• `src/modules/collection/worker.ts`, `routes.ts`, `sql.ts`<br>• `apps/web/src/pages/Sources.tsx`, `Account.tsx`, `docker-compose.yml` | 1. `EXPLAIN` 证实 `LIKE '% 算力 %'` 与 `LIKE '% o3 %'` 走 `idx_content_search_trgm` Bitmap Index Scan；<br>2. 关闭所有浏览器跨 2 个调度周期自动入库，预算受阻时 0 空转写库；<br>3. 新导入 900 条历史源只取前 8 条且 >48h 旧文不刷屏今日流。 |
| **Phase 2 · 三大双语支柱、事件聚簇、48h 热度日报与首页信息流** | 1. 扩展 `sources.ts` 接入 13+ `NewsNow` 大众娱乐/科技榜单、HF Daily Papers、`web_list` 选择器与完整 IPv4/IPv6 + 3 跳 IP 绑定安全读取；<br>2. 支持 200 位 AI 学者/主创 X 批次搜索（`from:u1 OR from:u2 ...`，省 95% 成本）并提取推文图片/视频 `media` 与外链；<br>3. 落地规范实体链接 + 64-bit SimHash 事件聚簇（`storyKey`）、`T1 > T1_5 > T2` 英文一手代表选举（原语种直出不强制翻译）、48h/6h 热度趋势、08:00 规则日报与 RRF + 重力衰减个性化排序；<br>4. 将 `/` 切换为“为你 / 最新 / 08:00 日报 / 48h 热度”与三大频道首页，启用 `findActor` 60s LRU + `Singleflight` 15s SWR 缓存，修复 `Projects.tsx` 按日柱形图联动。 | • `src/connectors/web/sources.ts`<br>• `src/connectors/x/twitterapis.ts`<br>• `src/modules/content/batch.ts`, `routes.ts`, `thread.ts`<br>• `apps/web/src/App.tsx`, `pages/ContentLibrary.tsx`, `pages/Projects.tsx` | 1. 同一事件（英文官方一手 + 实测 + 社区讨论 + 10 家中文媒体转发）在首页折叠为 1 张事件聚簇卡，英文 `T1`/`T1_5` 原题稳居主标题；<br>2. 500 并发读者压测首页对应 PG 查询 $< 1\text{ QPS}$。 |
| **Phase 3 · 按题动态探索（20–30 站）与开放式 Agent 接入边界** | 1. 实现 4 正交槽确定性查询拆解（官方一手 / 独立评测 / 真实复现 / 失败反例）+ Tier-1 免费垂直 API 联邦（本地 PG + HN Algolia + GitHub Search + HF/arXiv + Reddit）+ Tier-2 可插拔搜索索引；<br>2. 引入 `linkedom` + `@mozilla/readability` 内存安全正文提取器（单页 `<15ms`、峰值 `<65MB`）与页面 RSS 自动嗅探；<br>3. 复用 `delivery_mode='push'` 的 `radar` 系统源实现三波渐进提交（1.5s / 3.5s / 12s），支持将发现的作者/RSS 一键转为长期 `pull` 监控源；<br>4. 完善开放式 `/v1/capabilities`、`/v1/openapi.json`、只读机器 Key（`read`/`export`）与付费操作浏览器人工确认门禁（主线零内置 LLM 依赖）。 | • `src/connectors/web/extractor.ts`, `search-router.ts`<br>• `src/modules/collection/routes.ts`<br>• `src/modules/workspace/routes.ts`<br>• `apps/web/src/pages/Workspace.tsx` | 1. 提问后 $<3.5\text{s}$ 渲染首批正文证据，$<12\text{s}$ 完成 24–30 站提取且 Node RSS 内存 $< 800\text{ MB}$；<br>2. 发现的新站点点击即可转为后台定时 `pull` 源。 |

---

## 0. 当前重整分支执行记录

`r1-content-batch` 通过 `11e7864` 引入 `main@dac7ab7`，形成可快进的 Fastify 重整版本，当前 `prod` 分支位于 `8ebebfb`。

唯一迁移链为原样保留的 `001..040`（含历史重复前缀的两个 018、两个 020）→ `041_content_batch.sql` → `042_monitor_projects.sql` → `043_kernel_cutover.sql` → `044_stage_one_safety.sql` → `045_web_sources.sql` → `046_hydration_queue.sql`，共 48 个 SQL 文件。新增存储压缩、索引与保留优化统一从 `047_*.sql` 起按前向迁移追加，严禁修改已应用的 `001..046` 文件。

### 0.1 `prod@8ebebfb` 全量源码审查确认的 7 项实存代码缺陷台账（Phase 1–2 必优先清零）

> 以下 7 项均为对 `src/` 与 `apps/web/` 逐行核实的确凿代码缺陷（完整推导见[深度审查与单机架构蓝图](research/deep-audit-and-architecture-blueprint-20261118.md)）：

| 编号 | 缺陷摘要 | 真实源码坐标 | 修复方案（已纳入 Phase 1–2） |
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
   - 应用 `047` 存储压缩与保留迁移，确认 `docker-compose.yml` 的内存限额（`1536m` / `1350m` / `128m`）、PG16 `lz4` 与 `json-file` 日志轮转生效；
   - 验证宿主机 `2 GiB /swapfile`、Cloudflare mTLS Origin Pulls 与 `DOCKER-USER` 防火墙规则；
   - 按原 owner 完成旧 `research_export` 历史导出交付对账后再在后续独立版本删除旧冻结表；
   - 保持单容器 `app` 运行，仅在混合负载实测证实事件循环延迟持续影响首页且缓存/连接池已调优后，才讨论用同一镜像分拆 API 与 Worker 角色。R4 `.zst` 离线归档始终保持仓外/独立 `plugins/zst-archive/` 外挂推流路径。
