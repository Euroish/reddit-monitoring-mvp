# 产品规范与文档总览

本文定义产品范围、度量口径与工程准则；系统布局与安全基线见[主线架构规范](architecture.md)，数据语义与接口表面见[数据与 API 契约](contracts.md)，页面交互见[产品交互规范](design.md)，R1–R4 资产迁移清单见[重建计划](plans/source-expansion.md)。真实源码状态与下一阶段规划唯一以[当前状态](status.md)为准，开发操作与历史验证台账唯一以[开发记录](development.md)为准。

规范等级 `MUST` / `MUST NOT` / `SHOULD` / `MAY` 严格执行，全仓编号全局唯一且由 `npm run docs:check` 静态校验。

## 1. 产品定位与核心链路

本系统是**远端单机运行、以监测项目为中心的多源讨论研究工作台**：
**创建项目（三段词与来源） → 增量发现（Radar） → 确定性噪声门控（Signal Gate） → 按需批量补全评论（Hydrate） → 联动证据研判 → 保存查询或流式留档**。

服务对象为所有者与受邀成员（`owner` / `admin` / `viewer`），Web 端与外部 AI Agent 共用同一套 TypeBox HTTP 契约。产品不做多租户 SaaS、商业计费中心、全平台全量抓取保证或通用工作流引擎。

| ID | 等级 | 产品能力与边界规则 | 验收出口 |
| --- | --- | --- | --- |
| PRD-01 | MUST | 项目支持三段词过滤（`anyTerms` 任一、`allTerms` 全含、`exclusions` 排除）与逻辑来源绑定；创建或修改项目只检索已存库内样本，绝不自动发起收费抓取。 | Web / PG E2E |
| PRD-02 | MUST | Reddit 采用 `kaix` 主源 + `red_crawler` 备源，X 采用 `TwitterAPIs` 主源 + `ScrapeBadger` 备源与批量 ID 补全，资讯补充精选 `NewsNow` MIT getter 与白名单 RSS/Atom `feed`；`Arctic Shift` 与 `TwitterAPI.io` 在线代码在主线重建阶段彻底实删。 | 真实受控样本 + HTTP 测试 |
| PRD-03 | MUST | 支持项目概览钻取至 `threadAware` 根帖联动列表，点击在侧栏打开三视图评论树（`top` 高赞 / `matches` 命中上下文 / `op` 楼主互动）与就地显式批量水合，个人资产仅含保存查询、收藏批注与无状态流式下载（彻底退役 `research_export` 冻结模型）。 | PG + HTTP + 浏览器冒烟 |
| PRD-04 | MUST | 开放鉴权 `/v1/capabilities` 与 `/v1/openapi.json` 及绑定来源范围的机器 API Key 供外部 Agent 协同；R4 离线外挂 `plugins/zst-archive/` 独立演进并仅通过 `POST /v1/sources/:id/ingest` 推流，严禁进入主线依赖、镜像或数据库迁移。 | Agent 权限与 release 检查 |

主导航固定五个一级入口：**项目、内容库、来源、我的研究、设置**。来源任务明细与预算收入对应来源详情，不单设运维子产品或面向用户的契约说明墙。

## 2. 统一度量与可信度口径

| ID | 等级 | 度量定义与样本诚实性边界 | 验收出口 |
| --- | --- | --- | --- |
| MET-01 | MUST NOT | 将已存内容去重条数冒充全网讨论总量，或将 `NewsNow` 榜单名次（`web.rank`）与 HTTP `304` 检查刷新冒充互动量或新入库内容。 | UI 文案与响应 meta 核对 |
| MET-02 | MUST | 严格区分实体身份 `(platform, kind, externalId)`、`discovery`（发现来源关系，多源发现不重复计入主内容总量）与 `observation`（按真实 `provider` 区分的指标快照）；`pull` 与 `push` 共享身份去重，项目默认统计只算 `pull`，手动勾选推流样本须明示“含导入样本”。 | 概览与多源 ID 集测试 |
| MET-03 | MUST | 三轴时间彻底分离：`publishedAt`（`content.created_at_source`）、`sourceObservedAt` 与 `fetchedAt`；未知发布时间保持 `null`，禁止用 `first_seen_at`、`retrieved_on` 或 `0` 填补。 | PG 边界与分页测试 |
| MET-04 | MUST | `threadAware = true` 下列表、概览与导出对命中节点所属可见根帖（`anchor`）去重计数（`contentCount`），同时单独报告实际命中节点数（`matchedContentCount`），仅作上下文的父链不混入命中数；跨平台或不同 `provider`/`timeBasis` 互动比较一律返回 `422` 并给出切回“内容量”的就地操作。 | 对比 422 与联动聚合测试 |

## 3. 工程纪律与文档治理准则

| ID | 等级 | 代码可读性与验证纪律 | 验收出口 |
| --- | --- | --- | --- |
| ENG-01 | MUST | 五个纵向模块共享单数据库、`commitContentBatch` 唯一入库通道与进程内有界调度；模块内部直接调用参数化 SQL 函数，禁止单实现 `*Repository`、14 个 `InMemory*` 模拟与空壳 `service`。 | AST lint / 依赖审查 |
| ENG-02 | MUST NOT | 通过压行删换行（Code Golfing）、拆出纯透传碎文件或删除核心幂等/权限断言伪装精简；模块文件允许按职责自然拆分并在 `scripts/check-docs.ts` 检查可读行宽与文件行数，注释只写代码无法表达的外部约束或理由。 | `npm run docs:check` |
| ENG-03 | MUST | 测试收敛为纯函数单测、唯一真实 PostgreSQL 16 + HTTP 集成套件与少量核心浏览器任务流，停止双跑 `InMemory` 与 PG 用例；外部付费连接器在结果 `unknown` 时立即停发待人工核验。 | CI 门禁与停发测试 |

## 4. `docs/` 文档职责索引

| 文档路径 | 唯一职责 |
| --- | --- |
| [当前状态与下一阶段](status.md) | **唯一真源**：当前实现、重整前历史基线、分支审计对照与下一阶段规划 |
| [开发与交付记录](development.md) | **唯一真源**：本机密钥、可执行命令、安全退役顺序、发布备份运维及历史 `0.2.0–0.9.1` 台账 |
| [主线架构规范](architecture.md) | 架构鸟瞰、模块文件地图与不变量、SQL/调度不变量、单机安全与 Compose/CI 蓝图 |
| [数据与 API 契约](contracts.md) | 来源主备、版本元组、混合批 `commitContentBatch`、`ingest`/筛选/导出与 HTTP 契约 |
| [产品交互规范](design.md) | 五大导航、核心工作流、三视图评论树、错误恢复与 `1440/768/390` 无障碍标准 |
| [R1–R4 重建与实删计划](plans/source-expansion.md) | R1–R4 资产迁移矩阵、遗留代码实删明细与 R4 离线归档外挂规格 |
| [架构审查母本](research/architecture_audit_and_rebuild_spec.md) | `a078c9c` 基线代码尸检、`GAP-01..06`、SQL 参考模板与代码减法预算 |
| [来源研究与开源证据](research/data-sources.md) | 开源项目源码核验（`NewsNow` / `RSSHub` / `TrendRadar`）与 R4 `.zst` 物理格式论证 |
| [来源替换与清理规格](research/source_replacement_and_twitterapi_io_removal_spec.md) | X/Reddit 定价对比、OpenAPI 参数/响应详细映射与旧渠道逐文件清理定位点阵 |
