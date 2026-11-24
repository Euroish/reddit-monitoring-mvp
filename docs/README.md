# 产品规范、业务边界与度量诚实性

本文定义 SIFTLINE 的核心产品定位、业务边界、2026-11-23 定案以及不可妥协的数据口径原则。实现状态与生产基线见 [status.md](status.md)，接口实测清单见 [contracts.md](contracts.md)。

## 1. 核心产品支柱（共享单核底座）

| 产品支柱 | 解决的核心用户任务 | 数据与核心引擎 | 典型入口 |
| :--- | :--- | :--- | :--- |
| **高价值讨论流与热榜** | 像刷信息流一样高效消费高讨论度技术/产品内容，增加高质量探索，并在已读保留窗内去重 | `feed_lane` 隔离新闻、`4` 池破茧重排（`50%` 兴趣 / `25%` 全网热议 / `15%` 未知高赞探索 / `10%` 6h 飙升）、`14d` 半衰期 + Plackett-Luce + 滑窗打散、`feed_user_seen` | `/v1/feed/stream`、`/v1/feed/hot`、`/v1/feed/events`、`/v1/feed/preferences` |
| **社媒研究与外链分析** | 追踪 Reddit 与 X 库内样本的关键词提及占比（SoV）、帖子/评论引用外链、关注账号与社区讨论；不将外链讨论等同于大模型实际引用 | `intel_monitor` 三合一模型（`keyword` / `author_list` / `community_bundle`）、15–20 账号批查询拼装、`6h/1d` 增量预聚合分桶 `intel_rollup_bucket`、先估价后采门禁 | `/v1/intelligence/monitors*`、`/v1/intelligence/authors*`、`/v1/intelligence/communities*` |
| **AI 发布情报中心** | 跟踪全球 AI 厂商模型与产品发布、官方一手证据链与第三方榜单 | `ai_vendor` / `ai_release_event` / `ai_model`、离线可验证历史基线 `data/ai/history/v1/`、管理员审核发布队列 | `/v1/ai/*`、`/v1/admin/ai/*` |

## 2. 产品边界与 2026-11-23 定案

### 明确不做（Out of Scope）

- **不做通用新闻阅读器或营销热榜搬运站**：默认流仅采信高讨论社区与官方一手发布源。
- **不做传统搜索引擎 SEO 排名或广告归因**：不做 Google SERP 排名追踪、外链技术审计、购买流量估算或代发帖控评。
- **不做无边界大模型黑盒打分**：摘要、意图与推荐理由必须可追溯至原帖、评论或观测证据；AI 分析与高成本扩源受预算与开关门控。

### 2026-11-23 已确认执行决议

1. **信源清洗**：迁移 `061` 归档现有被动媒体新闻与 V2EX/营销榜单源（完整保留 `ai_vendor_source` 官方发布源）；后续高讨论 L1/L2 信源由维护者精选补充。
2. **摘要与意图识别**：采用可插拔 `heuristic_v1` + 版本化升级钩子（`upgradeContentEnrichment`）低复杂度起步，保证结构化卡片立即可用且便于后期平滑替换为分类器/LLM。
3. **采集预算额度**：当前主干在 Worker 派发前执行 X + Reddit 全站每天 `20,000` 资源预留单位与分渠道预算，预检说明预计消耗；资源单位不等于实际内容条数或金额。在线配置仍为候选能力。
4. **分期交付顺序**：Backend V2 已合入，原 #32 的前端冻结已结束。前端可围绕用户任务独立改进，不等待“全面重做”才修复现有流程；匿名访客在新信息流使用非个性化混排，具体上线状态见 [status.md](status.md)。

### 产品决策：第一性原理与奥卡姆剃刀

从“谁在什么情境下要得到什么结果”出发，不从表、接口、页面或旧方案出发。研究用户要拿到可核验的证据并形成判断；读者要快速发现值得看的内容；管理员要定位故障、控制成本并恢复服务。

- **最简完整闭环**：先交付目标 → 数据/证据 → 分析/使用；减少重新输入、重复确认、跨页找入口和周期性人工维护。点击少不以隐藏风险、默认收费或丢失控制权为代价。
- **先减后加**：先试现有契约、默认值、原处操作与已有数据复用，再决定是否需要新字段、路由、服务或后台任务。新增复杂性必须解决当前可演示的失败或用户需求；不以“将来通用”作为唯一理由。
- **一个事实一个权威来源**：派生信息不重复持久化并同步；项目、监测规则、来源与批次各守职责，前端任务统一不要求合并领域实体。必要的物化状态说明写方、重算与失败恢复。
- **渐进呈现**：默认只问完成当前任务所需的信息，高级筛选按能力展开；保留专家效率、键盘、可访问性、权限反馈和已有功能。
- **规则服务结果**：不为固定章节、页面数、接口数、文件数或圈复杂度分数增加包装。按 [开发手册](development.md#11-变更准入与工程质量)保留可执行的安全/数据门禁，按 [设计规范](design.md#4-以用户任务验收)验证真实任务。

#35 的 [业务任务](research/business-audit-2026-11-23/SIFTLINE_全面业务梳理报告_2026-11-23.md)仍需交付；其历史表结构、页面划分与实现路线不构成必须照搬的约束。所有剩余项统一在 [审计台账](research/business-audit-2026-11-23/SIFTLINE_修复进度完成表_2026-11-23.md)追踪。

## 3. 度量诚实性与工程规则（`docs:check` 受控 ID）

| ID | 等级 | 规则描述 | 验收出口 |
| :--- | :--- | :--- | :--- |
| **PRD-01** | MUST | 检索、列表、导出与统计只读库内已存数据并共享权限交集（`allowedSourceIds`），读路径严禁触发付费采集；全库仅按 `commitContentBatch` 唯一入库。 | 权限一致性与读路径隔离测试 |
| **PRD-02** | MUST | 新付费采集先预估并向用户说明消耗，再由明确提交授权；不要求额外的勾选/弹窗或单独页面。后端派发仍独立检查权限与预算；外部推流（`POST /v1/sources/:id/ingest`）与内部调度清晰分离。 | 估价门禁与推流幂等测试 |
| **MET-01** | MUST NOT | 将库内样本量或样本内品牌提及占比夸大为“全网声量/全网触达”；`overview` 强制附带 `{ coverage, sampleSize, windowFrom, windowTo, jobSuccessCount, jobFailedCount }` 样本声明。 | 契约响应与前端覆盖条审查 |
| **MET-02** | MUST | **零伪造曲线与零假零值**：趋势/火花线 `sparkline` 必须源于真实 `content_observation` 或分桶快照（缺测则如实返回空/现有节点，禁拼造假斜率）；X 互动率（ER）明确标注分母口径（`by_views` \| `by_followers`），分母均缺时返回 `null` 而非 `0`；Velocity 前窗无覆盖返回 `deltaPct = null`。 | `intelligence-metrics` 与火花线真实性测试 |
| **MET-03** | MUST | 严格分离 `publishedAt`、`sourceObservedAt`、`fetchedAt` 三轴时间（未知存 `null`）；跨平台热度仅通过平台内 7 天基线百分位归一化（`unifiedHeat 0..100`）横向比较，原始指标禁止跨平台混加。 | 时间边界与归一化单测 |
| **ENG-01** | MUST | 保持 9 域单向无环 DAG（`lint:arch`）与每表唯一写归属（`check-table-ownership.ts`），新增 SQL 迁移通过 `Squawk`、`PG16` 回滚与 `CODEOWNERS` 审查，禁止为 UI 卡片私建旁路表。 | CI 架构与 SQL 门禁 |
| **ENG-02** | MUST | 付费渠道 `unknown` 永不自动重放（须 `acknowledgePotentialCharge` 人工解封）；上线前必须隔离 PG16 备份演练与版本回退核验。 | 停发闸门与恢复演练 |

## 4. 文档维护职责矩阵

| 文档 | 唯一职责 |
| :--- | :--- |
| [README.md](../README.md) | 仓库总入口、核心能力概览与开发启动 |
| [AGENTS.md](../AGENTS.md) | Agent 与协作者红线约束 |
| [README.md](README.md)（本文） | 产品支柱、业务边界、2026-11-23 定案与度量诚实性 |
| [architecture.md](architecture.md) | 4 GB 运行拓扑、9 域 DAG、58 表所有权、检索、L1–L3/R4 隔离与安全底线 |
| [invariants.md](invariants.md) | `INV-001`..`INV-010` 核心工程不变量与门禁索引 |
| [contracts.md](contracts.md) | Domain 对象、认证授权、采集/查询/导出规则与 OpenAPI 路由清单 |
| [design.md](design.md) | 现有 UI 基线与 Frontend V2 信息架构/交互视觉规范 |
| [status.md](status.md) | 生产最近已知基线、主干已合入代码、在途质量修复与未收口事项 |
| [development.md](development.md) | 分支协作、CI 门禁、本地验证、Docker 部署与生产运维手册 |
| [backend-v2-blueprint.md](plans/backend-v2-blueprint.md) | 已批准 Backend V2 产品与架构完整设计规格 |
