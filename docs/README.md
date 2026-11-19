# 产品规范、指标口径与文档总览

本文确立产品的核心定位、度量诚实性标准与工程边界。系统拓扑与存储演进见[主线架构规范](architecture.md)，数据对象与路由契约见[数据与 API 契约](contracts.md)，交互体验与 `semrush` 前端分支融合方案见[前端与可视化交互规范](design.md)，实码盘点与 V2 实施序列见[当前状态与规划](status.md)，单机运维见[开发与运维手册](development.md)。

规范等级 `MUST` / `MUST NOT` / `SHOULD` / `MAY` 由 `npm run docs:check` 执行静态校验，全仓规则 ID 全局唯一。

---

## 1. 产品定位演进：从“单一采集监控台”到“信息流优先 + 选择性可视化 + 内容资产复利”

产品最初是一个面向 Reddit 的重型关键字监控看板（包含 47 张历史中间统计表与多页图表仪表盘）；经过 R1–R3 内核重建与 `050` 结构大清理后，系统已经进化为运行在 **4 vCPU / 4 GB RAM / 60 GB 系统盘** 单机上的**多源双语信息流、事件聚簇、选择性数据可视化与个人/Agent 知识工作台**。

这次转型的核心判断只有三句：
1. **信息流解决“每天 3 分钟读什么”**：首页（`/`）打开即读库内已聚合的事件卡与 08:00 日报，同源转发自动按 `T1 > T1_5 > T2` 折叠选举一手代表报道；
2. **选择性可视化解决“热点从哪来、信源靠不靠谱、讨论怎么演进”**：摒弃为了装饰而堆砌的假分数仪表盘与跨平台混淆柱图。只保留真正回答阅读与研判问题的可视化：信息流卡片内嵌微型来源权威比例条与 48h 热度火花线，探索与专题页提供可点击联动的跨平台发布脉冲图、48h 热度×6h 增速四象限、单源时间序列观测图，点击任一柱体或事件气泡直接收窄下方正文与三视图评论树；
3. **内容资产复利解决“抓取回来不只是看一眼就忘”**：现有采集回来的 `title`、`body_text`、`content_author`、`content_references`（外链/引用关系）、`platform_details`（通道/完整度）与 `content_observation`（时序指标）如果只做简单分页列表就是一次性消耗品。后续通过**已读/归档/静音阅读流状态**、**持久化的事件聚簇**与**确定性实体标签（公司/模型/人物/主题）**，让每一次抓取都在数据库内复利沉淀为可交叉透视的知识网络。

### 五种高频使用节奏与当前可用性边界

| 使用节奏 | 当前在线基线 (`prod@8e436ac`) | V2 计划深化方向 |
| :--- | :--- | :--- |
| **1. 晨间 3 分钟扫读与 08:00 日报** | 已上线：`GET /v1/content/stories`（`latest` / `hot` / `digest`），支持 8 个频道、`tier`、`language` 过滤与 Markdown 日报复制 | 卡片增配 `已读/收藏/静音` 阅读状态、轻量 AI 双语摘要胶囊与 `为你` RRF 个性化排序 |
| **2. 分频道与重点人物追踪** | 已上线：100 个活跃源按 8 个 `source_group`（`ai-firsthand`、`dev-infra`、`tech-media`、`lifestyle`、`design-visual`、`science`、`public-affairs`、`social-trends`）与 `T1`/`T1_5`/`T2` 分级持续排期采集 | 批量接入 200+ VIP 学者 X 批次与开源 `newsnow`/`bluesky` 榜单；按作者实体一键订阅/静音 |
| **3. 克制且有信息量的图表看盘** | 已上线：`GET /v1/content/facets` 与 `GET /v1/projects/:id/overview` 单 CTE `GROUPING SETS` 查询返回按日/6h 平台脉冲（前端尚未充分渲染） | 融合 `semrush` 分支可用图表逻辑，落地**卡片内嵌零依赖 SVG 微图 + 按需懒加载交互分析图**，严守分平台/分渠道指标诚实性 |
| **4. 内容探索与外部按题取证** | 已上线：`GET /v1/content` 与 `GET /v1/content/feed` 支持双字词/短词 GIN 检索、体裁/媒体/语言筛选与 `discussion`/`pain` 信号筛选 | 新增 `POST /v1/discovery/query` 联动垂直公开 API 与本地已存样本，并将发现的好站点一键转入长期排期 |
| **5. 专题监测与三视图深挖** | 已上线：`monitor_project` 三段词过滤、按需 `kaix` 评论树水合、`top`/`matches`/`op` 三视图与 RFC 4180/JSON 流式导出 | 增加多专题/多实体并排对比（`POST /v1/project-comparisons`）与单条评论独立批注 |

---

## 2. 产品能力、度量诚实性与工程准则（`docs:check` 受控规则）

| ID | 等级 | 产品能力与边界规则 | 验收出口 |
| --- | --- | --- | --- |
| PRD-01 | MUST | 全文检索与项目过滤必须支持三段词（`anyTerms`、`allTerms`、`exclusions`）、中文双字词（`算力`、`评测`）及短技术代号（`AI`、`o3`、`R1`）GIN 索引匹配；任何首页加载、频道切换或项目保存操作只读取已存库内数据，绝不在读路径触发外部收费抓取。 | PG16 `EXPLAIN` 与路由测试 |
| PRD-02 | MUST | 信源必须通过 `tier`（`T1`/`T1_5`/`T2`）、`sourceGroup`（8 业务分组）、`locale` 与 `fetchPolicy` 分类管理；接入渠道覆盖 `feed`（RSS/Atom/`web_list`/`json_list` 与 OPML/JSON 批量导入）、`newsnow`（7 大内置热榜）、`reddit`（`kaix`/`red_crawler`）、`x`（`twitterapis`/`scrapebadger`）、`bluesky_appview` 与 `external_ingest` 推流；公网列表源支持保存前“预览前 20 条”。 | 预览、导入与连接器单测 |
| PRD-03 | MUST | 多源发现的同一事件通过规范外链与 64-bit SimHash（LSH 分桶与版本号隔离）聚簇并按 `T1 > T1_5 > T2`（同级英文原题优先）选举代表报道；48 小时独立参与者热度与 6 小时升温趋势按确定性规则计算，每日北京时间 08:00 切分日报窗口；专题与探索页通过单 SQL 分面与三视图评论树（`top`/`matches`/`op`）联动钻取，支持有界流式导出。 | 事件聚簇、分面与三视图 E2E |
| PRD-04 | MUST | 后续 AI 翻译/事件综述与按题外部探索严格遵守微内核零阻塞隔离：AI 扩展以零 SDK 原生 `fetch`（按簇指纹幂等缓存于 `platform_details.extensions.ai`）或外部 Agent 经只读/限定 Scope API Key 接入，受 `source_provider_budget`（`ai_enrich`）额度控制，未配置时 100% 确定性零模型运行；任何会产生外部账单的采集或激活操作须经预算核验与浏览器管理会话明确确认。 | 权限隔离、预算熔断与降级检查 |

| ID | 等级 | 度量诚实性与样本可信度口径 | 验收出口 |
| --- | --- | --- | --- |
| MET-01 | MUST NOT | 将库内已采集的去重条目数宣传为“全网总声量”，或将 `newsnow` 榜单名次（`web.rank`）与 HTTP `304` 校验刷新冒充新增正文或互动上涨；来源停采逾期或新接入不足 6 小时窗口时，严禁伪造 6h 涨跌幅（必须标记 `trend = 'unknown'`）。 | 响应结构与图表文案审计 |
| MET-02 | MUST | 严格隔离内容身份 `(platform, kind, externalId)`、`content_discovery`（多源发现关系）与 `content_observation`（按真实 `provider` 隔离的快照观测）；同一 48 小时窗口内同一独立参与者对同一事件只贡献一次最高权重；`pull` 与 `push` 共享身份去重，但默认流、热度与趋势仅统计 `pull` 来源。 | 多源去重与热度权重测试 |
| MET-03 | MUST | 严守三轴时间分离：`publishedAt`（`created_at_source`）、`sourceObservedAt` 与 `fetchedAt` 互不冒名顶替；未知发布时间保持 `null`，禁止用 `first_seen_at` 或当前时间篡改填充。 | SQL/Connector 时间边界测试 |
| MET-04 | MUST | `threadAware = true` 下内容与分面按可见根帖（`anchor`）去重计数 `contentCount` 并单独报告 `matchedContentCount`；不同平台（如 Reddit score vs X likes）或不同 `timeBasis` 的原始互动指标禁止跨系列直接相加，可视化图表必须按 `(sourceId, provider, metricKey)` 分线并保留 `null` 断档，跨平台对比必须退回内容量/事件热度视角或返回 `422`。 | 分面计数与图表口径审查 |

| ID | 等级 | 工程可读性、建表纪律与验证准则 | 验收出口 |
| --- | --- | --- | --- |
| ENG-01 | MUST | 后端严守五模块扁平纵向切分（`access`、`collection`、`content`、`projects`、`workspace`）、`commitContentBatch` 唯一入库与进程内有界 Worker；数据库在 Post-050 20 张核心表基线上执行**节制演化纪律**：优先复用现有 JSONB/字段，新增持久关系表须证明性能/索引刚需且总表数严格控制于 **`<= 26` 张**；禁止单实现 `*Repository` 与 `InMemory*` 模拟层。 | `docs:check` 与迁移审查 |
| ENG-02 | MUST NOT | 通过删换行压行、拆出纯透传碎文件或引入未经树摇的巨型第三方重包伪装功能丰富；前端严格实行“信息流零图表重包 + 分析页按需加载”，模块代码遵守 `<= 450` 行/文件与 `<= 220` 字/非模板行，注释只说明“为何这样做”的外部约束。 | `docs:check` 与构建体积检查 |
| ENG-03 | MUST | 所有行为均以纯函数单测 + 真实 `postgres:16-alpine` HTTP 集成测试 + 无头浏览器核心流验证；任何外部付费调用在网络异常进入 `unknown` 状态时立即写库并停发待人工确认，绝不静默重试导致重复扣费。 | CI 全门禁与停发恢复测试 |

---

## 3. 全仓 `docs/` 文档索引

### A. 现行权威规范（8 份 · 随当前代码与演进同步维护）

| 文档 | 职责定位 |
| :--- | :--- |
| [AGENTS.md](../AGENTS.md) | Agent 协作总纲、Post-050 红线、分支融合禁令与代码静态护栏入口 |
| [当前状态与规划](status.md) | **唯一状态真源**：`prod@8e436ac` 实码盘点、`semrush` 分支逐项对照、已修复故障台账与 V2 Phase A–D 交付路线 |
| [开发与运维手册](development.md) | **唯一运维与历史台账真源**：Compose / PG16 参数、多阶段构建、备份演练、OPML 扩容实操与 `0.2.0–0.9.1` 至 `050` 记录 |
| [主线架构规范](architecture.md) | 5 模块内核拓扑、PostgreSQL 20→<=26 表结构升级、内容复利层、L1–L3 扩源及安全/容量预算 |
| [数据与 API 契约](contracts.md) | 核心领域对象、050 来源字段、混合批幂等、双字词 GIN、`story` 聚簇与全量 `/v1/*` 路由清单 |
| [前端与可视化交互规范](design.md) | Editorial Mineral 视觉语言、三模态界面、双层图表架构与 `feat/semrush-frontend-rebuild` 融合清单 |
| [来源矩阵与扩源分层](research/data-sources.md) | 开源标杆拆解（Folo/Miniflux/NewsNow/AIHOT/Karakeep/Ground News）、8 个活跃分组与 L1–L3 扩源策略 |
| [演进边界与外挂隔离](plans/source-expansion.md) | R1–R3 已完成资产收敛对照、Post-050 迁移准则与 R4 `plugins/zst-archive/` + L3 Sidecar 隔离规范 |

### B. 历史研究与早期审计归档（7 份 · 保留溯源，不再作现行实现依据）

- [架构审查母本 (`main@7045185` 基线)](research/architecture_audit_and_rebuild_spec.md)
- [旧来源替换与 `twitterapi_io` 清理规格 (`2026-11-16`)](research/source_replacement_and_twitterapi_io_removal_spec.md)
- [全仓深度审查与 4GB 单机蓝图 (`prod@7440058`)](research/deep-audit-and-architecture-blueprint-20261118.md)
- [产品方向与架构讨论归档 (`2026-11-18`)](research/product-architecture-conversation-20261118.md)
- [历史外部大规模架构假设讨论归档 (`2026-11-18`)](research/ChatGPT-讲解仓库文档-20261118-1807.md)
