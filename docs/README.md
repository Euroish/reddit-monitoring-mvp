# 产品规范与文档总览

本文定义产品范围、度量口径与工程准则；系统布局与安全基线见[主线架构规范](architecture.md)，数据语义与接口表面见[数据与 API 契约](contracts.md)，页面交互见[产品交互规范](design.md)，R1–R4 资产迁移清单见[重建计划](plans/source-expansion.md)。真实源码状态、实码缺陷台账与下一阶段规划唯一以[当前状态](status.md)为准，开发操作与历史验证台账唯一以[开发记录](development.md)为准。

规范等级 `MUST` / `MUST NOT` / `SHOULD` / `MAY` 严格执行，全仓编号全局唯一且由 `npm run docs:check` 静态校验。

## 1. 产品定位转型与核心链路（极简确定性微内核 · 可插拔 AI 翻译与摘要 · 全景数据可视化）

产品已从早期的“单一平台监测与重型研究工作台”全面转型为面向个人与小规模开放读者的**中英双语高价值信息流、事件聚簇、按题动态探索、全景数据可视化与推荐平台**（聚焦 **AI 与前沿开发**、**全球科技与数码产品**、**大众生活文化娱乐与全网热议** 三大高频支柱，暂不展开重度金融行情接入；**后端采用极简高性能的 `Fastify 5 + TypeBox + PostgreSQL 16` 五模块微内核，默认 100% 确定性零模型运行、原生双语直出不强制翻译，同时内建轻量可插拔的 AI 翻译/事件摘要扩展缝隙与单 SQL 驱动的多维交互式图表可视化体系**）。

一次采集与归组同时服务五种消费与分析节奏：
1. **早上 3 分钟扫读今日精选与 08:00 自动日报**：同一事件（官网发一篇、核心开发者实测、社区讨论一天、10 家中文自媒体转述）自动聚合成一张**事件卡**，由 **英文一手官方源（`T1`）或认证核心学者/主创（`T1_5`）** 担任代表报道，默认以**原始语种标题与确定性导语摘录**原生呈现（不阻塞入库、不强制机器翻译，同簇下的中文讨论/报道自动并列作为跨语种视角；开启或按需触发 AI 扩展后，仅对簇代表或当前卡片生成高质量**中英双语对照标题与三点事件综述**，较逐篇调用省 90% Token）；
2. **分频道与按人物追踪**：在“关注的人（VIP 学者与创作者）”“AI 与开发”“科技与产品”“大众生活与娱乐热榜”之间一键切换，或按“公司与模型 / 领域方向 / 内容体裁”三维主题浏览；
3. **遇到具体问题时向外动态探索 20–30 个网站**：输入查询问题，系统按确定性规则拆解为 4 个正交取证方向（官方一手、独立评测、真实复现、失败反例），通过免费垂直 API 联邦与网页搜索索引在 3.5 秒内流式返回首批证据，并支持将新发现的作者或站点 RSS 一键加入长期自动排期；
4. **全景交互式数据可视化与跨专题对比**：原有的趋势与分面图表体系全面适配双语事件流与专题工作台——单条 PostgreSQL `GROUPING SETS` 查询同时驱动**按日/6h 跨平台与权威级叠柱脉冲图**、**48h 事件热度 × 6h 升温增速矩阵**、**`T1/T1_5/T2` 信源传播结构条**与**多专题/多实体声量对比图**，点击任一柱体、平台或事件气泡即可联动收窄下方列表；
5. **进入专题项目与三视图评论树深挖**：遇到值得长期跟踪的话题时保存查询或建立轻量监测专题，按需对高价值 Reddit/X 根帖发起评论树水合。

| ID | 等级 | 产品能力与边界规则 | 验收出口 |
| --- | --- | --- | --- |
| PRD-01 | MUST | 支持三段词过滤（`anyTerms` 任一、`allTerms` 全含、`exclusions` 排除）、中文双字词（如 `开源`、`算力`、`评测`、`游戏`）与短技术代号（如 `AI`、`o3`、`R1`、`v4`）GIN 索引检索及逻辑来源绑定；打开首页、切换频道或创建/修改项目只检索已存库内样本，绝不在读路径触发外部收费抓取。 | Web / PG E2E 与 EXPLAIN |
| PRD-02 | MUST | 信源按权威度分为 `T1`（官方一手英文 Blog/Releases/公告及中资大模型官方源）、`T1_5`（认证核心学者/工程师/主创账号，支持 X/Reddit 批次搜索合并降本）与 `T2`（精选科技/生活娱乐媒体与社区热榜）；支持 `rss`、`web_list`（选择器列表）、`json_list`、`x`（`TwitterAPIs` 主 + `ScrapeBadger` 备）、`reddit`（原生 `.rss` 雷达 + `kaix` 主 + `red_crawler` 备）、`newsnow`（B站/知乎/微博/V2EX/IT之家/HN/GitHub Trending 等主流热榜）与 `external_ingest`；新建来源支持“先预览前 20 条再保存”与首次入库限流（`initialBackfillLimit: 8` 及 48 小时旧文不刷屏门控）。 | 真实受控样本 + 预览与防刷屏测试 |
| PRD-03 | MUST | 入库内核通过规范化实体链接（GitHub/arXiv/URL/原帖 ID）与 64-bit SimHash + LSH 分桶将同一事件的多源报道聚簇（`storyKey`），按 `T1 > T1_5 > T2` 选举一手代表报道（默认原语种直出，支持按簇/按需接入 AI 双语翻译与三点摘要）并标注角色（`primary_release` / `benchmark_eval` / `community_discussion` / `syndicated_repost`）；计算 48 小时独立参与者热度（24h 半衰期）与 6 小时升温趋势（`surge` / `rising` / `new`），每日 08:00 零模型成本按规则汇编日报（可选叠加 AI 晨间综述）；统一提供按日/6h 趋势、热度增速矩阵、权威级分布及多专题对比四类交互可视化图表，专题钻取支持三视图评论树（`top` / `matches` / `op`）与无状态流式下载。 | 事件聚簇、图表联动与三视图 E2E |
| PRD-04 | MUST | 支持按题动态探索 20–30 个候选网站（复用 `delivery_mode='push'` 的 `radar` 系统源分三波渐进提交，默认不污染 `pull` 长期趋势，支持一键将发现的作者/RSS 升级为长期 `pull` 源）；AI 翻译与摘要通过零 SDK 原生 `fetch`（兼容任意 OpenAI 格式端点）或外部只读/写回 Agent 挂载于 `platform_details.extensions.ai` 并受 `source_provider_budget`（`ai_enrich`）额度门控，未配置 AI 时 100% 确定性无损运行，付费或改状态操作必须经预算评估与浏览器会话人工确认。 | 探索流、AI 降级与 release 检查 |

## 2. 统一度量与可信度口径

| ID | 等级 | 度量定义与样本诚实性边界 | 验收出口 |
| --- | --- | --- | --- |
| MET-01 | MUST NOT | 将已存内容去重条数冒充全网讨论总量，或将 `NewsNow` 榜单名次（`web.rank`）与 HTTP `304` 检查刷新冒充互动量或新入库内容；禁止在来源落后停采（`behind`）或新接入未满窗口（`late`）时伪造 6 小时热度飙升百分比（须标 `trend = 'unknown'`）。 | UI 文案与响应 meta 核对 |
| MET-02 | MUST | 严格区分实体身份 `(platform, kind, externalId)`、`discovery`（发现来源关系，多源发现不重复计入主内容总量）与 `observation`（按真实 `provider` 区分的指标快照）；事件热度（`heat`）在同一 48 小时窗口内对每个独立来源/参与者只计一次权重（重复抓取不虚增热度）；`pull` 与 `push`（含按题探索临时抓回页面与外部导入）共享身份去重，默认趋势与热度只算 `pull`。 | 概览、事件热度与多源 ID 集测试 |
| MET-03 | MUST | 三轴时间彻底分离：`publishedAt`（`content.created_at_source`）、`sourceObservedAt` 与 `fetchedAt`；未知发布时间保持 `null`，禁止用 `first_seen_at`、`retrieved_on` 或 `0` 填补；无可靠发布时间或发布超过 48 小时的首次回填存量按原时间归档，不得挤占今日首页精选与日报。 | PG 边界与旧文防刷屏测试 |
| MET-04 | MUST | `threadAware = true` 下列表、概览与导出对命中节点所属可见根帖（`anchor`）去重计数（`contentCount`），同时单独报告实际命中节点数（`matchedContentCount`）；跨平台或不同 `provider`/`timeBasis` 互动比较一律返回 `422` 并给出切回“内容量/事件热度”的就地操作。 | 对比 422 与联动聚合测试 |

## 3. 工程纪律与文档治理准则

| ID | 等级 | 代码可读性与验证纪律 | 验收出口 |
| --- | --- | --- | --- |
| ENG-01 | MUST | 五个纵向模块（`access`、`collection`、`content`、`projects`、`workspace`）共享单数据库、`commitContentBatch` 唯一入库通道与进程内有界自适应调度；全库严守 `PLAN-03` 不新增第 3 张业务表（信源分级 `tier`、实体归属、事件聚簇 `storyKey` 与探索状态均编码于既有 `JSONB` 扩展与引用索引）；禁止单实现 `*Repository`、14 个 `InMemory*` 模拟与空壳 `service`。 | AST lint / 依赖审查 |
| ENG-02 | MUST NOT | 通过压行删换行（Code Golfing）、拆出纯透传碎文件或删除核心幂等/权限断言伪装精简；模块文件允许按职责自然拆分并在 `scripts/check-docs.ts` 检查可读行宽（`<= 220` 字符）与文件行数（`<= 450` 行），注释只写代码无法表达的外部约束或理由。 | `npm run docs:check` |
| ENG-03 | MUST | 测试收敛为纯函数单测、唯一真实 PostgreSQL 16 + HTTP 集成套件与核心浏览器任务流，停止双跑 `InMemory` 与 PG 用例；外部付费连接器或可选模型在结果 `unknown` 时立即凭回执停发待人工核验，绝不自动重放扣费。 | CI 门禁与停发测试 |

## 4. `docs/` 文档职责索引

| 文档路径 | 唯一职责 |
| --- | --- |
| [当前状态与下一阶段](status.md) | **唯一真源**：当前实码状态、7 项代码缺陷台账、分支审计基线与 Phase 1–3 实施路线 |
| [开发与交付记录](development.md) | **唯一真源**：本机密钥、可执行命令、4GB/60GB 容量运维、分层保留 SQL 及历史 `0.2.0–0.9.1` 台账 |
| [主线架构规范](architecture.md) | 架构鸟瞰、五模块地图、自适应调度/双字词 GIN/事件聚簇/动态探索/无 Redis 缓存与 4GB 单机安全基线 |
| [数据与 API 契约](contracts.md) | 信源三级（`T1`/`T1_5`/`T2`）与六类采集、版本元组、混合批 `commitContentBatch`、探索/日报/排序与 HTTP 契约 |
| [产品交互规范](design.md) | 首页信息流（最新/为你/三大频道/日报）、事件聚簇卡、按题探索渐进流、三视图评论树与无障碍标准 |
| [R1–R4 重建与实删计划](plans/source-expansion.md) | R1–R4 资产迁移矩阵、遗留代码实删明细与 R4 离线归档外挂规格 |
| [全仓深度审查与 4GB 单机架构蓝图](research/deep-audit-and-architecture-blueprint-20261118.md) | `prod@7440058` 全量源码与迁移尸检、五路成熟开源技术（`miniflux`/`newsnow`/`Vane`/`AIHOT`/`pg_trgm`）对比与完整推导 |
| [来源研究与双语高流量信源矩阵](research/data-sources.md) | `AIHOT` / `NewsNow` / `RSSHub` 源码核验、英文一手 AI + 全球科技 + 大众生活娱乐双语信源矩阵与 VIP 批次降本算账 |
| [架构审查母本](research/architecture_audit_and_rebuild_spec.md) | `a078c9c` 基线代码尸检、`GAP-01..06`、SQL 参考模板与代码减法预算 |
| [来源替换与清理规格](research/source_replacement_and_twitterapi_io_removal_spec.md) | X/Reddit 定价对比、OpenAPI 参数/响应详细映射与旧渠道逐文件清理定位点阵 |
| [产品方向与架构讨论归档](research/product-architecture-conversation-20261118.md) | 2026-11-18 早期产品方向演进对话原始记录 |
| [ChatGPT 仓库文档讨论归档](research/ChatGPT-讲解仓库文档-20261118-1807.md) | 历史外部大规模架构假设讨论输入（仅供对比参考，实际约束以 `status.md` 与 `architecture.md` 为准） |
