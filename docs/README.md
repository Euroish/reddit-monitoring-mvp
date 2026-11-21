# 产品规范、指标口径与文档总览（STD-100）

本文规定产品边界、度量诚实性、建表纪律与规范与发布文档索引。规格关键词 `MUST` / `MUST NOT` / `SHOULD` / `MAY` 由 `npm run docs:check` 静态校验，全仓规则 ID 全局唯一。

---

## 1. 产品定位：信息流优先 · 选择性可视化 · 内容资产复利

系统已从早期单一平台监控看板收敛为运行于 **4 vCPU / 3.8 GiB RAM / 58 GiB 磁盘** 单机上的**多源双语信息流、选择性交互可视化与数据分析个人/Agent 知识工作台**：
1. **信息流解决高效获取**：`/` 首页直接读取库内已聚簇事件卡与 08:00 日报，同源转发按 `T1 > T1_5 > T2` 折叠选举一手代表报道；
2. **选择性可视化解决可信研判**：拒绝装饰性评分仪表与跨平台混淆计数；仅提供卡片内嵌权威比例条/48h 火花线及探索/专题页的可点击跨平台脉冲、热度×增速与单源时序观测图；
3. **内容资产复利解决知识沉淀**：在稳定核心表内叠加阅读状态、持久化事件成员归属与既有 GIN/全文过滤，使抓取内容可持续检索、对比与二次利用。

| 使用场景 | `[LIVE]` 已上线基线 | `[V2]` 演进方向（见 `status.md`） |
| :--- | :--- | :--- |
| **1. 首页流与 08:00 日报** | `GET /v1/content/stories`（`latest`/`hot`/`digest`），支持 8 频道/`tier`/`language` 过滤与 Markdown 复制 | Phase A 补 `tierBreakdown`+`sparkline48h` 微图；Phase B 补 `read_before_at` 水位与 `为你` RRF |
| **2. 分频道与批量信源** | `100` 个活跃源（8 业务 `source_group`），支持动态 HTTPS/`web_list`/`json_list` 预览与 OPML/JSON 导入 | Phase C 扩 `newsnow`/`bluesky`/VIP X 批次/Readability，并通过 `stream_class='live'` 接入 L3 Sidecar |
| **3. 选择性图表与三视图** | 后端 `GET /v1/content/facets` 与 `/v1/projects/:id/overview` 提供 `GROUPING SETS`；`ThreadTreeView` 待融合 | Phase A 落地 Tier-1 原生 SVG 微图 + Tier-2 懒加载 `echarts/core` 交互图与三视图评论树 |
| **4. 检索与专题对比** | 三段词 + 中文双字词/短代号（`算力`/`o3`）GIN 检索、信号筛查、专题水合（`kaix`）与 RFC 4180 流式导出 | Phase B 新增基于 GIN 的 `POST /v1/project-comparisons` 与单条评论批注 |
| **5. 外部探索与按需 AI** | 仅支持静态库内查询与受限 API Key 只读/导出 | Phase D 按需落地 `/v1/discovery/query` 与零 SDK `/v1/content/:id/enrich` |

---

## 2. 规范规则表（`docs:check` 受控 ID）

| ID | 等级 | 产品能力与边界规则 | 验收出口 |
| --- | --- | --- | --- |
| PRD-01 | MUST | 三段词（`anyTerms`/`allTerms`/`exclusions`）、中文双字词与短代号 GIN 检索 `MUST` 只读库内已存数据；页面切换或项目保存 `MUST NOT` 在读路径触发收费外网抓取。 | PG16 `EXPLAIN` 与路由测试 |
| PRD-02 | MUST | 信源 `MUST` 归属 `tier`（`T1`/`T1_5`/`T2`）、`sourceGroup`、`locale` 与 `fetchPolicy`；新来源首次未检查状态限制 8 条采集，且 `[V2]` `MUST` 强制实现超 48 小时旧文按原发布时间归档而不挤占今日精选与日报；`feed`/`newsnow` 支持保存前预览前 20 条与 OPML/JSON 批量导入。 | 预览、导入与防刷屏测试 |
| PRD-03 | MUST | 多源事件通过规范链接、版本防混淆与 64-bit SimHash 聚簇，代表报道严格按 `T1 > T1_5 > T2`（同级英文优先）选举；48h 热度（24h 半衰期）与 6h 趋势按确定性规则计算，08:00 切换日报；专题钻取支持三视图评论树与有界流式导出。 | 事件聚簇与三视图 E2E |
| PRD-04 | MUST | `[V2]` 按题动态探索与按簇 AI 双语/三点综述 `MUST` 保持微内核无阻塞解耦：AI 扩展以零 SDK `fetch` 幂等写入 `platform_details.extensions.ai`，受 `source_provider_budget (ai_enrich)` 与非 `read` Key 权限隔离控制；产费与状态变更须经预算与浏览器管理员确认。 | 权限与预算熔断测试 |

| ID | 等级 | 度量诚实性与样本口径规范 | 验收出口 |
| --- | --- | --- | --- |
| MET-01 | MUST NOT | `MUST NOT` 将库内去重条数冒充全网声量，或将 `newsnow` 排名（`web.rank`）与 HTTP `304` 刷新冒充新增互动/正文；来源停采逾期或接入未满 6 小时 `MUST` 标记 `trend = 'unknown'`。 | 响应结构与文案审计 |
| MET-02 | MUST | 内容身份 `(source_id, kind, external_id)`、`content_discovery` 与 `content_observation`（按真实 `provider` 隔离）互不混用；48h 同一参与者仅计一次最高贡献；当前 `[LIVE]` 默认流/趋势仅算 `pull`，`[V2]` 引入 `stream_class` 后默认纳入 `live`（含 L3 实时推流）并排除 `archive`/`adhoc`。 | 多源去重与口径测试 |
| MET-03 | MUST | 三轴时间 `publishedAt`（`created_at_source`）、`sourceObservedAt`、`fetchedAt` 严格分离；未知发布时间保持 `null`，`MUST NOT` 以抓取时间冒充原文时间挤压当日信息流。 | 时间轴边界单测 |
| MET-04 | MUST | `threadAware = true` 下按可见根帖（`anchor`）去重计 `contentCount` 并另报 `matchedContentCount`；跨平台或跨 `timeBasis` 的原始互动分/赞 `MUST NOT` 直接相加，观测图必须按 `(sourceId, provider, metricKey)` 分线并保留 `null` 断档，跨平台对比仅允许内容量/事件热度，否则返 `422`。 | 对比 422 与图表审计 |

| ID | 等级 | 工程精简与验证规范 | 验收出口 |
| --- | --- | --- | --- |
| ENG-01 | MUST | 后端严守五模块扁平结构、`commitContentBatch` 唯一入库与进程内 Worker；核心数据库自 Post-050 `20` 张表起严守 **`<= 24` 张表** 上限（优先复用已有字段与 JSONB，不建投机性低收益关联表）；禁止单实现 `*Repository` 与 `InMemory*` 模拟。 | `docs:check` 与迁移审查 |
| ENG-02 | MUST NOT | `MUST NOT` 压行删换行或引入全量重型前端图表包；前端严守“首页 SVG 微图 0 重包 + 分析页 `React.lazy` 懒加载 `echarts/core`”，源码遵守 `<= 450` 行/文件与 `<= 220` 字/非模板行。 | `docs:check` 与构建检查 |
| ENG-03 | MUST | 测试锁定纯函数单测 + 隔离 `postgres:16-alpine` HTTP 集成 + 核心浏览器验证；任何外部付费调用处于 `unknown` 状态 `MUST` 立即落库停发并待人工 `acknowledgePotentialCharge` 解封，禁止静默重试。 | CI 门禁与停发测试 |

---

## 3. 规范与发布文档索引

以下文档随发布包分发，由 `DOCUMENTATION_FILES` 维护。仓库可新增 Markdown 文档，新增文件默认留在源码仓库。

### A. 项目入口与合作规范（2 份）
- [README.md](../README.md)：仓库总入口（`<= 60` 行）、`[LIVE]`/`[V2]` 边界与校验入口
- [AGENTS.md](../AGENTS.md)：Agent 协作总纲、Post-050 红线与分支融合禁令

### B. 现行权威规范（8 份 · 与 `prod` 代码同步维护）
- [docs/README.md](README.md)：产品定位、度量口径、规则表与规范文档索引
- [docs/status.md](status.md)：**唯一状态真源**：实码盘点、`semrush` 审计与 V2 Phase A–D 路线
- [docs/development.md](development.md)：**唯一运维与台账真源**：构建、环境、PG16 运维与 `0.2.0–050+` 记录
- [docs/architecture.md](architecture.md)：五模块拓扑、`20 -> <= 24` 演进、L1–L3 扩源与 4 GB 安全预算
- [docs/contracts.md](contracts.md)：领域语义、`050` 新字段、`[LIVE]` 43 路径/50 操作与 `[V2]` 接口契约
- [docs/design.md](design.md)：三模态设计、双层图表架构与 `feat/semrush-frontend-rebuild` 融合矩阵
- [docs/research/data-sources.md](research/data-sources.md)：开源标杆拆解、8 个活跃分组与 L1–L3 扩源分级
- [docs/plans/source-expansion.md](plans/source-expansion.md)：R1–R3/`050` 完结档案、`051+` 边界与 R4/L3 外部隔离

### C. 历史研究与早期审计归档（5 份 · 只读溯源，不作现状依据）
- [docs/research/architecture_audit_and_rebuild_spec.md](research/architecture_audit_and_rebuild_spec.md)（`main@7045185` 尸检母本）
- [docs/research/source_replacement_and_twitterapi_io_removal_spec.md](research/source_replacement_and_twitterapi_io_removal_spec.md)（旧双源清理规格）
- [docs/research/deep-audit-and-architecture-blueprint-20261118.md](research/deep-audit-and-architecture-blueprint-20261118.md)（`prod@7440058` 审计蓝图）
- [docs/research/product-architecture-conversation-20261118.md](research/product-architecture-conversation-20261118.md)（`2026-11-18` 早期讨论记录）
- [docs/research/ChatGPT-讲解仓库文档-20261118-1807.md](research/ChatGPT-讲解仓库文档-20261118-1807.md)（外部架构输入归档）
