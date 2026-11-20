# 当前状态与下一阶段规划（STD-100 唯一真源）

> **核对基准**：`prod@8e436ac` + 文档与边界加固（见[开发台账](development.md#5-全阶段交付与演进台账)） · **运行镜像**：`monitoring-unified:20261119-v2`。
> 严格分离 **`[LIVE]` 实码真源** 与 **`[V2]` 演进计划**；文中实库行数为生产运行采样快照，持续采集会自然增长。

---

## 0. 当前生产基线与实测资产清单（`[LIVE]`）

| 维度 | 实测基线数据（`2026-11-19` 采样） |
| :--- | :--- |
| **源码规模** | 后端核心 `42` 个 TS 文件（`~6,900` LOC：`apps/api` 2 + `src/modules` 24 + `src/connectors` 9 + `packages/contracts` 3 + `src/shared` 2 + `src/storage` 2）；前端 `apps/web/src` `12` 文件 / `3,038` 行 / `104 KB` |
| **PG16 数据库** | **20 张公网表**（`050` 实删 27 张历史表）、`52` 条已应用迁移（`001..050`，含历史重复编号 `018`/`020`）；采样规模：`content` ~2,005、`content_observation` ~5,957、`source_collection_job` ~1,926、总库 ~40 MB |
| **活跃来源分布** | **100 个活跃排期源**（`97` `feed` + `3` `newsnow`，另有 2 个归档来源），覆盖 **8 个 `source_group`**：`ai-firsthand` (16)、`dev-infra` (16)、`lifestyle` (15)、`public-affairs` (13)、`tech-media` (12)、`science` (11)、`design-visual` (9)、`social-trends` (8)，`missing_group=0`、`missing_locale=0` |
| **接口与安全** | **`43` URL 路径 / `50` 条 HTTP 操作**（与 `/v1/openapi.json` 一致）；`onRequest` 限流早于 `preParsing` 鉴权（`429` 零查库）；`/v1/content/*` 仅 `GET/HEAD` 允许 `read` Key；`scripts/check-docs.ts` 守卫 `001..050` 迁移不可变；`search.ts` 使用 `LEFT JOIN public_content_search_document` |

---

## 1. 跨分支客观审计与融合立场

| 分支 / 引用 | 状态与特征 | 审计结论与执行动作 |
| :--- | :--- | :--- |
| **`prod`** | 当前唯一主干与部署源 | 所有后端加固、文档同步与 V2 演进都在此分支推进。 |
| **`origin/main` (`c75506b`)** | 停留在 `7ff733c` 合并快照（落后 `050` 升级） | 保持只读上游角色，由管理员按发布节奏反向合并。 |
| **`origin/feat/semrush-frontend-rebuild` (`dbf8713`)** | 位于 GitHub 远端（本地/服务端拉取需 `git fetch origin feat/semrush-frontend-rebuild`），分叉自旧 `dd2feb2`，含 `40fb284`（R4 `.zst` 插件）+ `dbf8713`（36 文件 / `637.8 KB` + 全量 `echarts`） | **`MUST NOT` 整支合并**：严格按[融合矩阵](design.md#2-featsemrush-frontend-rebuild-分支审计与融合矩阵)抽取样式令牌、`api/hooks`、快捷键壳、`ThreadTreeView`、`ObservationChart`、`vite.config`/`i18n` 与设置/导出逻辑，丢弃营销页、`AuthModal`、`ThemeStudio`、`SignalScoreGauge` 与 `R4ArchivePanel`。 |
| **`r1-content-batch` & `feat/r1-core-and-r2-wip`** | R1–R3 历史参考分支 | 历史任务已完结。 |

---

## 2. 已修复项与当前 V2 开放缺口

- **已修复项**：`BUG-01..06`（`047..050` + `8e436ac`）及后续代码/文档漂移加固（`check-docs <= 50` 守卫、`app.ts` `/v1/content/*` 方法门控、`search.ts` `LEFT JOIN` 防冷删隐身、`docker-compose.yml` 透传 `WORKER_CONCURRENCY`）。
- **当前 `[V2]` 开放缺口**：
  1. 当前生产镜像仍使用上一版工作台；Phase A 的待发布实现见下文；
  2. `content_annotation` 无阅读水位线，`readStoryWindow` 尚未沉淀跨周事件成员归属，尚无 `stream_class` 使 L3 推流融入首页；
  3. 仅开通 3/7 个内置 `newsnow` 榜与 0 个 `bluesky` 源，尚未引入 `linkedom`/`Readability` 提取 RSS 原文与外链；
  4. `/v1/discovery/query` 与 `/v1/content/:id/enrich` 均未实现。

---

## 3. `[V2]` 四阶段纵深路线（Phase A – D，总表数严格 `20 → <= 24`）

Phase A 待上线版本已实现故事卡微图与键盘速读、侧栏折叠与命令面板、采集告警与额度计量、内容库与专题的日 × 平台下钻、热度四象限、观测折线及评论三视图。无命中分面仅凭已存样本无法确认采集覆盖，显示斜线；0 仅用于服务端明确返回的零值。生产镜像状态仍以本页基线为准。

| 阶段 | 核心交付切片 | 表数量与关键文件 | 完成验收门禁 |
| :--- | :--- | :--- | :--- |
| **Phase A · 前端融合与双层可视化** | 1. 在 `readStoryWindow` 附带 `tierBreakdown` + `sparkline48h`（8×6h 桶），在 `projects/sql.ts` 补齐 `(day, platform)` 分面；<br>2. 落地矿石编辑风、精简 `WorkbenchShell`、`packages/contracts` 驱动 `api/hooks`、`ThreadTreeView` 与 `ObservationChart`；<br>3. `/` 渲染 Tier-1 零依赖 SVG 微图，`/content` 与 `/projects` 通过 `React.lazy` 模块化 `echarts/core` 渲染带斜线未知区的脉冲图与四象限。 | `+0` 表（保持 `20`）<br>`src/modules/{content/stories,projects/sql}.ts`、`apps/web/src/*` | `/` 首屏 JS 零 ECharts 依赖；`1440`/`768`/`390` 无横向溢出且 `dom_critic >= 88`；三视图与分面联动 E2E 通过。 |
| **Phase B · 阅读水位线与持久化事件归属** | 1. `051`：扩展 `content_annotation` 增配 `read_at`/`muted`/`tags` 并独立其修改与笔记 `revision` 锁，增加按频道/全局 `read_before_at` 水位线（已读锚定 `storyKey`）；实现 `为你` 可解释 RRF 与超 48h 旧文防刷屏门控；<br>2. `052`：新增 **`story_cluster` + `story_cluster_member`** **仅存成员归属与指纹**（代表选举与 `heat48h(now)` 在读路径按可见范围动态计算，禁存全局指标）；<br>3. 上线复用 GIN 索引的 `POST /v1/project-comparisons`（不建 `entity_catalog` 关联表）。 | `+2` 表（总计 `22`）<br>`051`、`052`、`src/modules/{content,projects,workspace}/*` | 一键已读写操作 `O(1)` 不膨胀，并发改笔记零 `409`；受限 API Key 不越权泄露他源代表；跨日热点查询 `< 10ms`。 |
| **Phase C · `stream_class` 与 L1–L3 扩源** | 1. 升级 `collection_source` 区分 **`stream_class` (`live \| archive \| adhoc`)**，使 L3 实时 Sidecar 推流进入默认 `/` 与分面趋势，R4 `.zst` 保持 `archive` 隔离；<br>2. 启用其余内置 `newsnow` 榜、`bluesky_appview`、`twitterapis` VIP 批次与可选 `linkedom` + `@mozilla/readability` 正文/外链提取。 | `+0` 表（保持 `22`）<br>`053`（扩列）、`src/connectors/web/*` | `Readability` 单页 `< 15ms`、Node RSS `< 800 MB`；L3 `ingest` 源可在首页与趋势按规则正常呈现。 |
| **Phase D · 按题探索与可插拔 AI 综述** | 1. 上线 `POST /v1/discovery/query`（4 正交槽 + 垂直公开 API + 三波写入 `adhoc` 源 + 一键转 `pull`）及基于 Readability 外链的未订阅高频域名查询；<br>2. 上线零 SDK `POST /v1/content/:id/enrich`（按簇指纹缓存双语/三点综述于 `platform_details.extensions.ai`，严格限制浏览器管理员或非 `read` 写授权）；<br>3. 可选增加 `alert_rule` / `alert_delivery`。 | 可选 `+0..2` 表（封顶 `<= 24`）<br>`src/modules/content/ai.ts`、`collection/discovery.ts` | `< 3.5s` 出首批证据；`read` API Key 调 `/enrich` 恒返 `403`；同指纹 AI 零重复调用；总表 `<= 24`。 |

---

## 4. 发布、部署与数据变更红线

1. 任何代码改动须经隔离 `postgres:16-alpine` 跑通 `docs:check`、`lint`、`typecheck`、`build`、`test:unit`、`test:postgres` 与 `smoke:compiled`；
2. 结构迁移前必须执行 `pg_dump -Fc` 并验证 `pg_restore --list`；
3. 重建服务端容器镜像必须传入 **`--target runtime`**（`Dockerfile` 默认末段为 `proxy`）；注意本轮 `app.ts`/`search.ts`/`workspace/sql.ts`/`docker-compose.yml` 加固改动待下次构建重启容器后于线上生效。
