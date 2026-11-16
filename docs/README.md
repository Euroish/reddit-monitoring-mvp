# 产品规范与文档总入口

本文定义项目产品边界、核心原则、度量口径与全套文档分工；系统架构与安全基线见[主线架构规范](architecture.md)，数据与 HTTP 行为见[数据与 API 契约](contracts.md)，交互流程见[产品交互规范](design.md)，分阶段实施与实删计划见[重建计划](plans/source-expansion.md)，当前真实实现情况见[实现状态](status.md)。

规范关键词 `MUST` / `MUST NOT` / `SHOULD` / `MAY` 分别表示必须、禁止、默认建议、可选。全仓每条规范拥有唯一编号与唯一定义位置，并由 `npm run docs:check` 静态校验。

## 1. 产品定位与用户任务

面向研究、运营与竞品观察，提供一个**远端单机运行、以监测项目为中心的多源信息监测与讨论证据研究系统**：
**创建项目 → 增量发现（Radar）→ 确定性噪声门控（Signal Gate）→ 按需批量补全讨论树（Hydrate）→ 证据研判 → 保存或流式下载留档**。

产品服务本人及少量受邀成员（`owner` / `admin` / `viewer` 角色 + 个人查询/收藏/批注隔离），同时向人类 Web 端与外部 AI Agent 开放完全一致的 HTTP API。首版不做多租户 SaaS、计费系统、全网覆盖承诺、LLM 自动评分或通用工作流引擎。

| ID | 等级 | 规则与用户任务 | 验收出口 |
| --- | --- | --- | --- |
| PRD-01 | MUST | 创建监测项目时通过三组词规则（任一提及 `anyTerms`、同时包含 `allTerms`、排除词 `exclusions`）定义本地信号范围，关联逻辑来源后预览已存命中；创建与编辑默认不触发付费网络采集。 | Web / PG E2E |
| PRD-02 | MUST | Reddit 以 `kaix` 为主力源、`red_crawler` 为备源/评论补充，X 以 `TwitterAPIs` 为主力低价源、`ScrapeBadger` 为独立备源及批量 ID 补全源，资讯补充精选 `NewsNow` MIT getter 与通用 RSS/Atom `feed`（支持受控 RSSHub）；`Arctic Shift` 在线 API 与 `TwitterAPI.io` 按 R1–R3 退役，精准词可连带 Top 15 评论，宽泛词先发现 100–300 根帖经门控后批量水合。 | 真实受控样本 + HTTP 闭环 |
| PRD-03 | MUST | 项目概览（按日/平台/证据类型/渠道）→ 钻取列表（默认 `threadAware` 根帖+命中评论联动卡片）→ 详情三视图可折叠评论树（Top 高赞 / 命中词父链 / 楼主互动）→ 收藏与批注共用同一过滤与权限口径，支持在结果内显式批量补全讨论。 | 真实 PG + HTTP + 浏览器闭环 |
| PRD-04 | MUST | 支持项目间与前后时间窗对比，统一 `threadAware` 与日期窗并列展示差值与增长率；跨平台互动或指标口径不兼容时返回 `422` 并给出具体原因与就地切换至“内容量”的修正动作。 | HTTP / 浏览器 |
| PRD-05 | MUST | 个人研究资产仅为保存查询（`content_saved_query`）、收藏/批注（`content_annotation`）与流式文件下载（`GET /v1/content/export`）；文件下载即唯一留档，服务器端退役 `ResearchExport` 冻结表与快照副本。切换前先按原 owner 迁出交付现有冻结资产。 | 资产对账 + 断流/背压 E2E |
| PRD-06 | MUST | 有权限的外部客户端或 R4 离线外挂通过标准批量推流口 `POST /v1/sources/:id/ingest` 提交规范化内容，与在线采集共用 `commitContentBatch` 写入、检索、项目分析与流式导出。 | PG + HTTP 幂等测试 |
| PRD-07 | MUST | 来源不可用、无匹配结果、部分覆盖（`partial`）、凭证失效与未知收费状态必须分别清晰表达；明确区分普通可重试错误与“可能重复计费的未知上游结果”，不误导重试。 | HTTP + UI 恢复流程 |
| PRD-08 | MUST | Web 与外部 AI Agent 共用同一套 TypeBox HTTP 契约、权限边界与 `compileContentFilter(scope, filter)`；通过鉴权的 `/v1/capabilities` 与 `/v1/openapi.json` 及受限机器 Key 让 Agent 独立完成发现→采集→筛选→补全→导出的完整闭环，无数据库旁路。 | Agent 身份闭环测试 |

主导航固定为五个区域：**项目、内容库、来源、我的研究、设置**。来源任务明细与预算放回来源详情；技术诊断默认折叠展开，不占用主研判视图。

## 2. 主线与外挂边界

| ID | 等级 | 核心边界决定 | 验收出口 |
| --- | --- | --- | --- |
| CORE-01 | MUST | 主线是远端单服务器在线产品：Node 24、Fastify 5、TypeBox、PostgreSQL 16、React/Vite、在线 Connectors。生产镜像、迁移、启动、备份与日常测试严禁依赖 Python、DuckDB 或历史 `.zst` 原档。 | 构建 / 发布清单 lint |
| CORE-02 | MUST | 历史 `.zst` 归档加工独立演进为未来 R4 外挂 `plugins/zst-archive/`。主线仅识别鉴权后的 `POST /v1/sources/:id/ingest`，不识别 `.zst`/Parquet、离线包协议、manifest/release 或归档统计总量；外挂未开发不阻塞 R1–R3 主线交付。 | release-package 测试 |
| CORE-03 | MUST | 全系统数据库仅新增 `monitor_project` 与 `monitor_project_source` 两张新表；其余所需状态扩展既有表（`app_session`、`collection_source`、`source_collection_job`、`content`、`public_content_search_document`），不引入 7 张归档表、导出冻结表或通用 token/任务平台。 | 迁移文件静态与实库检查 |
| CORE-04 | MUST | 个人工作区采用方案 B：保存查询 + 收藏/批注 + 流式文件。R3 迁出并核对所有现有 `research_export` 历史资产交付物后，实删冻结服务、表、API 与 UI。 | 对账报告 + R3 实删检查 |
| CORE-05 | MUST | 仅外部多实现采集边界保留 `ContentProvider` 接口；5 个业务模块内部直接调用接收 `Pool | PoolClient` 的命名参数化 SQL 函数，彻底删除单实现 `*Repository` 接口与 14 个 `InMemory*` SQL 模拟器。 | AST lint + PG E2E |
| CORE-06 | MUST | 生产默认部署为单机 Docker Compose 三服务（`proxy` 唯一公网 443 + 静态 Web、`app` 含进程内有界调度器、`db` 私有网络 PostgreSQL 16），共用一个 `pg.Pool`。不同时维护 systemd 作为长期第二套发布流，不承诺单机重启零停机。 | Compose 启动与退出验证 |

外挂推入主线的是**经过筛选的少量明确选入内容**，不是离线全档汇总。推送样本进入主线后可以减少对已归档月份的 API 回查，但不得把离线全档统计数字直接加进在线项目趋势。

## 3. 度量与可信度口径

| ID | 等级 | 指标与数据口径规则 | 验收出口 |
| --- | --- | --- | --- |
| MET-01 | MUST NOT | 将系统内已存去重内容量/提及量宣称为全平台真实总讨论量，或将单次抽样成功冒充为全量连续覆盖。 | UI 文案与 meta 核对 |
| MET-02 | MUST | 严格分离内容实体身份 `(platform, kind, externalId)`、发现来源关系（`discovery`）与通道观测快照（`observation`）；同帖被多来源或多渠道发现时正文只计 1 份，`byDiscoveryProvider` 分布允许重叠。 | 概览 ID 集测试 |
| MET-03 | MUST | 在线采集（`pull`）与外部推流（`push`）共用内容身份去重；项目默认趋势统计仅纳入 `deliveryMode = 'pull'` 来源，用户显式勾选纳入推流来源时必须标注“含导入样本”。 | 概览过滤 E2E |
| MET-04 | MUST | 发布时间（`publishedAt`，对应 SQL `content.created_at_source`）、上游观测时间（`sourceObservedAt`）、系统取回时间（`fetchedAt`）三轴严格分离；未知发布时间保持 `null`，严禁用 `first_seen_at`、`retrieved_on` 或 `0` 替代缺失值。 | PG 与分页边界测试 |
| MET-05 | MUST | `NewsNow` 的 `web.rank` 是榜单名次而非互动量；互动筛选、对比与增长判定仅在同一平台、同一 `provider`、同一 `metricKey` 及同一 `timeBasis` 下进行，单次快照不算增长速度，禁止跨平台捏造总热度。 | 比较接口 422 测试 |
| MET-06 | MUST | 每个查询结果明确回显实际匹配范围（`resolvedFilter`）、`unknownTimeCount`、`coverage` 状态与局限；日桶无记录不自动代表经证实的平台零讨论。 | 响应信封契约测试 |
| MET-07 | MUST | 期间环比采用完全相同长度的前一时间窗口与相同有效范围；前期为 `0` 时增长率返回 `null`；来源集或过滤规则发生变更时标注不可直接比较。 | 项目比较单测/E2E |
| MET-08 | MUST | 保存查询的命中结果随已存数据动态更新；CSV/JSON 下载文件只固定导出当前切片内容，不提供服务端历史快照回放。 | 导出契约测试 |
| MET-09 | MUST | 修改项目三组关键词只重查库内已存内容，不回溯修改共享来源的上游召回 `target`，也不自动购买历史回填。 | 项目修改 E2E |
| MET-10 | MUST | `threadAware = true`（项目默认）下，概览、列表与导出均以命中证据映射到的可见讨论根帖（`anchor`）去重计数（`contentCount`），同时单独报告命中节点数（`matchedContentCount`）；仅作上下文的父链节点不计入命中数与分母。 | 联动聚合 ID 集核对 |
| MET-11 | MUST | 二次发酵信号（`growing`）必须基于同来源、同 `provider`、同指标口径的两次独立观测且达到最小时间间隔与差值阈值；主备切换前后两条渠道观测不能直接相减拼出增长，未知值不补 `0`。 | 信号门控单测/PG |

## 4. 工程纪律与代码质量

| ID | 等级 | 工程质量要求 | 验收出口 |
| --- | --- | --- | --- |
| ENG-01 | MUST | 五个纵向模块共享同一数据库、一条 `commitContentBatch` 写入通道与一套进程内有界调度；严禁拆分为微服务、引入通用插件框架或数据湖控制面。 | AST lint / 依赖审查 |
| ENG-02 | MUST | 每条规范在全仓仅允许一个编号与一处规范定义；源码注释只解释代码本身无法表达的外部约束或理由，禁止复述类型或规范，新内核模块单条注释不超过 300 字符。 | `npm run docs:check` |
| ENG-03 | MUST NOT | 用压缩换行（Code Golfing）、机械按行数拆分文件、删减关键校验断言或缩水测试样本来伪装“代码精简”或“高性能”。 | Diff 审查 + lint |
| ENG-04 | MUST | 新模块默认只使用 `routes.ts + sql.ts`，具备独立边界职责时才就近增加 `worker.ts` 或 `search.ts` 并登记至 `scripts/check-docs.ts`；内部结构校验只在 I/O 边界执行一次，不重复无意义 `typeof` 防御。 | `npm run docs:check` |
| ENG-05 | MUST | 验证组合收敛为：有真实输入域的纯函数单测 + 一套真实 PostgreSQL 16 + HTTP E2E + 关键端到端浏览器任务验证；彻底终止 `InMemory` 与 PG 双跑及实现镜像测试膨胀。 | CI 门禁与阶段出口 |
| ENG-06 | MUST | `GET` 请求绝不启动外部采集或付费调用；在已明确授权的 `scope`、来源白名单与预算限额内的增量巡检、自动门控水合与单跳切换可以直接执行，无需人工重复点击确认，但付费结果未知时必须立刻停发等待人工核查。 | 权限与收费护栏测试 |
| ENG-07 | MUST | 界面全部使用研究任务语言且每屏仅设一个明确主操作；严禁在默认研究页堆砌 `Phase`、`Legacy`、`Repository`、合同编号或大段实现说明框，技术诊断统一收纳在可展开详情内。 | UI 审查与浏览器验收 |

## 5. 全仓文档职责与索引

| 文档路径 | 唯一职责 |
| --- | --- |
| [主线架构规范](architecture.md) | 拓扑依赖、5 模块与表所有权（`MOD`）、集合写与检索 SQL（`SQL`）、调度（`RUN`）、远端单机安全基线（`SAFE`）与发布（`OPS`） |
| [数据与 API 契约](contracts.md) | 领域模型、主备切换（`SRC`）、版本幂等与混合批（`DAT`）、巡检/水合/推流及各供应商上限（`COL`/`ING`）、三段词/信号/树/分页（`QRY`/`TREE`）、权限与 Agent 契约（`SEC`/`OP`）、流式导出（`EXP`）与 HTTP 表面 |
| [产品交互规范](design.md) | 五个主导航页面、三阶漏斗到证据阅读完整流程、三视图评论树、错误恢复与响应式可访问性验收（`UX`） |
| [R1–R4 重建与实删计划](plans/source-expansion.md) | 切换原则（`PLAN`）、资产盘点与迁移、R1–R3 主线交付与物理实删矩阵、R4 外挂边界与最小验证出口 |
| [唯一母本 Master Spec](research/architecture_audit_and_rebuild_spec.md) | `a078c9c` 基线代码尸检、7 项隐患与 `GAP` 溯源、三阶漏斗与 Agent-First 总纲、核心零漂移 SQL 蓝图与目录瘦身预算 |
| [来源选择与开源证据](research/data-sources.md) | 固定源码提交与开源许可分析（`NewsNow` / `RSSHub` 等）、Reddit/X 平台路线比较及 R4 `.zst` 离线证据边界 |
| [来源替换与清理规格](research/source_replacement_and_twitterapi_io_removal_spec.md) | `TwitterAPI.io` 淘汰商业证据、`TwitterAPIs` / `ScrapeBadger` OpenAPI 字段映射、逐文件实删定位点阵与测试迁移方案 |
| [开发与交付](development.md) | 本机私有密钥配置、当前 `0.9.1` 可执行命令、自动门禁、安全来源退役操作顺序与数据备份恢复工具 |
| [当前实现状态](status.md) | 当前源码与设计目标的真实差距清单、分层验证证据记录与现网部署实况 |
| [历史记录与交接](history/development-log.md) | 前期阶段日志（与[交接摘要](history/handoff.md)共同仅作历史追溯，不构成本版规范） |
