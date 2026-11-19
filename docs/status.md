# 当前状态与下一阶段规划（唯一状态与规划真源）

> **核对日期** `2026-11-19` · **生产基准提交** `prod@8e436ac` · **运行镜像** `monitoring-unified:20261119-v2`。
> 本文件记录在线生产基线实码、跨分支客观审计、已修复故障台账与 V2 下一阶段纵深交付计划（Phase A–D）。任何规划项均明确标注为 **V2 规划**，绝不冒充已上线功能。

---

## 0. 当前生产基线与实测资产清单（`prod@8e436ac`）

2026-11-19 已在生产单机完成 `050_legacy_cleanup_and_schema_upgrade.sql` 大清理与引擎止血升级，当前在线系统健康运行于 `monitoring-unified` Compose 栈（`monitoring-unified-app-1` + `monitoring-unified-db-1`，`postgres:16-alpine`，4 vCPU / 3.8 GiB RAM / 58 GiB disk，空闲内存合计 `< 200 MiB`，库总占用 `40 MB`）：

| 资产维度 | 实测基线数据 (`prod@8e436ac`) |
| :--- | :--- |
| **源码规模** | 核心生产 `~6,900` LOC / 41 TS 文件（`apps/api` 2F/320L · `src/modules` 24F/3,627L · `src/connectors` 9F/2,162L · `packages/contracts` 3F/634L · `src/shared` 2F/50L · `src/storage` 2F/107L）；前端 `apps/web/src` 12 文件 / `3,038` L / `104 KB` |
| **PostgreSQL 16 核心表** | **20 张公网表**（`050` 安全实删 27 张零业务历史表，47 → 20）、`52` 条已应用迁移（`001..050`，含历史重复编号 `018`/`020`）；`content` ~2,005 行、`content_observation` ~5,957 行、`source_collection_job` ~1,926 行 |
| **活跃来源分布** | **100 个活跃并启用排期的来源**（`97` 个 `feed` + `3` 个 `newsnow`，另有 2 个归档来源），覆盖 **8 个 `source_group`**：`ai-firsthand` (16)、`dev-infra` (16)、`lifestyle` (15)、`public-affairs` (13)、`tech-media` (12)、`science` (11)、`design-visual` (9)、`social-trends` (8)；`missing_group=0`、`missing_locale=0` |
| **预算与调度通道** | 已开启 `feed`（20,000 req/日、0ms 间隔）、`newsnow`（320 req/日、1000ms 间隔）与 `kaix`；已内置未启用：`twitterapis`、`scrapebadger`、`red_crawler`、`bluesky_appview`；Worker 默认 `6` 协程并发 + `1500ms` 同域冷却 + 每小时作业滚动清理 |
| **安全与接口面** | 43 条 HTTP 路由（`/v1/openapi.json` 自动派生）；`@fastify/rate-limit` 在 `onRequest` 执行，鉴权在 `preParsing`（429 零 DB 查询）；`POST /v1/sources/import` 已上线；全套单测 20/20 + 隔离 PG16 集成测试 24/24 通过 |

---

## 1. 跨分支客观审计与融合结论

| 分支 / 引用 | 状态与代码体量 | 审计结论与处置策略 |
| :--- | :--- | :--- |
| **`prod` (`8e436ac`)** | 主线运行分支，干净、零循环依赖、已完成 `050` 清理与引擎修复 | **唯一生产与演进主干**：作为所有 V2 重构与前沿演进的基准分支。 |
| **`origin/main` (`c75506b`)** | 上次将 `prod@7ff733c` 合并入 `main`，尚未包含 `8e436ac` | **仅作参考上游**：`prod` 验证完毕后由管理员决定何时反向合入 `main`。 |
| **`origin/feat/semrush-frontend-rebuild` (`dbf8713`)** | 分叉自落后基线 `dd2feb2`，包含 `40fb284`（R4 `plugins/zst-archive/` 验证存档）+ `dbf8713`（前端 36 文件 / `637.8 KB` + 全量 `echarts@6.1.0`） | **严禁整支合并！** 见[前端融合审计矩阵](design.md#2-featsemrush-frontend-rebuild-分支审计与融合矩阵)：采纳其矿石配色、`api/hooks` 模式、`WorkbenchShell` 快捷键骨架、`ThreadTreeView`、`ObservationChart` 单源/null-gap 逻辑与斜线无采纹理，重写直连 `/v1/content/facets` 与 `/overview`，丢弃 B2B 营销页与假分数仪表盘；`plugins/zst-archive/` 继续隔离于主线之外。 |
| **`origin/r1-content-batch` & `feat/r1-core-and-r2-wip`** | R1–R3 重整期历史双支（`65c1e76` / `3e77a3e`） | **已完成历史使命**：洁净五模块内核已彻底取代旧双轨运行时。 |

---

## 2. 已修复故障台账与当前核心缺口

### 2.1 已修复项（`8ebebfb` → `8e436ac`）

- **`BUG-01..03`（磁盘膨胀与 Worker 死循环）**：`047` + `050` 物理删除 `normalized_title`/`normalized_text` 冗余双列并将 `search_text` 正文截断至 1,500 字；`048` + `worker.ts` 消除预算等待 1 分钟空转写盘；`050` 解除 `FEED_ALLOWED_URLS` 硬锁、修复截断后 304 失效与 `request_duration_ms` 空白，并将 `newsnow` 快照粒度扩为 1 小时。
- **`BUG-04..06`（连接器、双字词 GIN 与限流路径）**：实现 `public_search_bigrams` 中文双字词与 `o3`/`R1` 索引检索；修复多层评论闭包（32 跳上限）；全量 DNS IP 公网校验与 3 跳绑定落地 `src/connectors/web/http.ts`；限流前移至 `preParsing` 之前实现 429 零查库。

### 2.2 当前线上仍存在的 V2 核心缺口（待下一阶段迭代）

1. **前端与可视化脱节**：当前 `apps/web/src` 仍为 104 KB 极简运维界面，`Stories` 卡片尚无内嵌微图（来源等级分布与热度火花），`ContentLibrary`/`Projects` 尚未渲染后端已提供的 `GROUPING SETS` 时间脉冲与观测走势图，也缺少键盘速读与命令面板。
2. **阅读流与内容资产复利尚未贯通**：`content_annotation` 仅有 `favorite`/`note`，缺少 `read_at`/`archived_at`/`muted` 阅读状态，无法形成 RSS 速读与 `为你` RRF 个性化信号；`readStoryWindow` 每次滑窗现算（1w 条压测 1.0–1.5s），尚无持久化 `story_cluster` 与 `entity_catalog` 实体图谱。
3. **内置高流量源与正文深提取尚待激活**：代码中已内置但尚未正式启用更多 `newsnow` 大众榜单（IT之家/少数派/微博有效通道/酷安/虎扑）、`bluesky_appview`、`twitterapis` VIP 批次与 `kaix` 高热帖水合；无头/轻量级 `linkedom + @mozilla/readability` 仅在规划中。
4. **按题动态探索与按簇 AI 综述尚未实现**：`/v1/discovery/query` 与 `/v1/content/:id/enrich` 为 V2 Phase D 规划端点。

---

## 3. V2 四阶段纵深交付路线（Phase A – D）

| 阶段与目标 | 核心交付切片 | 涉及表与关键文件 | 可验证完成门禁 |
| :--- | :--- | :--- | :--- |
| **Phase A · 前端融合与双层诚实可视化**<br>（信息流优先 · 不改后端表结构） | 1. 落地 Editorial Mineral 视觉系统、`packages/contracts` 直连 `api/client + hooks`、精简 `WorkbenchShell`（`[` 折叠、`Cmd+K`、`j/k/o/s`）；<br>2. `/` Stories 卡片内嵌 **Tier 1 零依赖 SVG 微图**（`T1/T1_5/T2` 组成条 + 48h 热度火花线）；<br>3. `/content` 与 `/projects` 通过 **Tier 2 `React.lazy` 分包**（`uPlot` 或树摇 `echarts/core`）渲染后端 `GROUPING SETS` 脉冲柱图（含斜线未知区）、48h×6h 象限图、单源 `ObservationChart` 与 `ThreadTreeView`。 | `apps/web/src/*`（零增量表，总包可控） | `/` 首屏 JS 不含全量图表重包；三视图/导出/筛选联动 E2E 通过；`1440`/`768`/`390` 无横向溢出且 `dom_critic >= 88`。 |
| **Phase B · 阅读状态与内容价值复利内核**<br>（`20 → 24` 张核心表） | 1. `051` 扩充 `content_annotation` 增加 `read_at`/`archived_at`/`muted`/`tags` 并实现 `为你` 可解释 RRF 排序与 `reason` 徽章；<br>2. `052` 新增 `story_cluster` + `story_cluster_member` 增量归簇写入，稳定历史事件主键并把热点读延迟压至 `< 10ms`；<br>3. `053` 新增 `entity_catalog` + `content_entity` 确定性词典打标，扩展 `facets` 与 `POST /v1/project-comparisons`（跨实体/专题对比，遇跨平台原分数比较返 `422`）。 | `051..053`、`src/modules/{content,projects,workspace}/*` | PG16 `EXPLAIN` 热点读 `< 10ms`；跨日事件主键不漂移；RRF 多样性折损与 422 对比口径 E2E 全通。 |
| **Phase C · L1–L3 扩源矩阵与正文深提取**<br>（`100 → 500+` 异构源） | 1. 扩展 `newsnow`（少数派/36氪/IT之家/酷安/虎扑等）与 `bluesky_appview`，导入 200+ 精选 RSS 与原语种核心创作者；<br>2. 引入 `linkedom` + `@mozilla/readability` 为仅含摘要的 RSS 原文按需补全纯净正文；<br>3. 启用 `twitterapis` 200 位 VIP 批次追踪与 `kaix` 高热贴评论水合；<br>4. 建立 L3 外部隔离 Collector Sidecar（RSSHub / 强反爬生活站）经限定 `ingest` Machine Key 向 `POST /v1/sources/:id/ingest` 推流规范。 | `src/connectors/web/*`、外部 `sidecar/`、`POST /v1/sources/:id/ingest` | Node RSS `< 800 MB`；Readability 单页 `< 15ms`；主线零 Python/Chromium 依赖；Sidecar 仅持单源 `ingest` Key 验真 `201/200/409`。 |
| **Phase D · 按题探索与可插拔 AI 综述**<br>（`<= 26` 张表封顶） | 1. 实现 `POST /v1/discovery/query`（4 正交槽 + 免费垂直 API 联邦 + 三波入库 `radar` 源 + 一键转 `pull`）与 `054` 可选 `source_candidate` 外链发现表；<br>2. 实现零 SDK `src/modules/content/ai.ts` + `POST /v1/content/:id/enrich`（按簇指纹缓存双语标题与三点综述于 `platform_details.extensions.ai`，受 `ai_enrich` 预算与 `tools: []` 沙箱约束，未配置零报错降级）；<br>3. 可选 08:00 晨报/飙升 Webhook 投递（`alert_rule`）。 | `054+`、`src/modules/content/ai.ts`、`src/modules/collection/discovery.ts` | `< 3.5s` 返回首批探索证据；同内容指纹 AI 调用幂等命中 0 重复扣费；全库表数 `<= 26` 且闲时内存稳态保持 `< 1.2 GiB`。 |

---

## 4. 生产变更与回退门禁清单

1. **上线前置门禁**：任何对 `prod` 的后端/数据库变更必须先在独立 `postgres:16-alpine` 容器跑完 `docs:check`、`lint`、`typecheck`、`build`（验证 `dist/src/storage/schema/*.sql` SHA-256）、`test:unit`、`test:postgres` 与 `smoke:compiled`；禁止未测直接重建生产容器。
2. **数据安全前置**：执行 `051+` 前向迁移前，必须运行 `pg_dump` 并将可验证归档存至 `/opt/reddit-monitoring-backups/<tag>/` 并抽检 `pg_restore --list`。
3. **镜像构建提醒**：构建服务端镜像固定使用 `docker build --target runtime`，禁止漏掉 `--target runtime` 误用末段 `proxy` 阶段镜像。
