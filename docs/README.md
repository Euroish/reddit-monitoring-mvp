# 产品规范、业务边界与度量诚实性

本文定义 SIFTLINE 的核心产品定位、业务边界、2026-11-23 定案以及不可妥协的数据口径原则。实现状态与生产基线见 [status.md](status.md)，接口实测清单见 [contracts.md](contracts.md)。

## 1. 核心产品支柱（共享单核底座）

| 产品支柱 | 解决的核心用户任务 | 数据与核心引擎 | 典型入口 |
| :--- | :--- | :--- | :--- |
| **高价值讨论流与热榜** | 像刷信息流一样高效消费高讨论度技术/产品内容，持续破除信息茧房且滑动绝不重复 | `feed_lane` 隔离新闻、`4` 池破茧重排（`50%` 兴趣 / `25%` 全网热议 / `15%` 未知高赞探索 / `10%` 6h 飙升）、`14d` 半衰期 + Plackett-Luce + 滑窗打散、`feed_user_seen` | `/v1/feed/stream`、`/v1/feed/hot`、`/v1/feed/events`、`/v1/feed/preferences` |
| **Semrush 级社媒与 GEO 监测** | 追踪 Reddit 与 X 上的关键词声量占比（SoV）、被大模型引用的高权重外链域名（GEO）、关注 KOL 动态画像及一揽子 Subreddit 对比分析 | `intel_monitor` 三合一模型（`keyword` / `author_list` / `community_bundle`）、15–20 账号批查询拼装、`6h/1d` 增量预聚合分桶 `intel_rollup_bucket`、先估价后采门禁 | `/v1/intelligence/monitors*`、`/v1/intelligence/authors*`、`/v1/intelligence/communities*` |
| **AI 发布情报中心** | 跟踪全球 AI 厂商模型与产品发布、官方一手证据链与第三方榜单 | `ai_vendor` / `ai_release_event` / `ai_model`、离线可验证历史基线 `data/ai/history/v1/`、管理员审核发布队列 | `/v1/ai/*`、`/v1/admin/ai/*` |

## 2. 产品边界与 2026-11-23 定案

### 明确不做（Out of Scope）

- **不做通用新闻阅读器或营销热榜搬运站**：默认流仅采信高讨论社区与官方一手发布源。
- **不做传统搜索引擎 SEO 排名或广告归因**：不做 Google SERP 排名追踪、外链技术审计、购买流量估算或代发帖控评。
- **不做无边界大模型黑盒打分**：摘要、意图与推荐理由必须可追溯至原帖、评论或观测证据；AI 分析与高成本扩源受预算与开关门控。

### 2026-11-23 已确认执行决议

1. **信源清洗**：迁入 `059` 归档现有被动媒体新闻与 V2EX/营销榜单源（完整保留 `ai_vendor_source` 官方发布源）；后续高讨论 L1/L2 信源由维护者精选补充。
2. **摘要与意图识别**：采用可插拔 `heuristic_v1` + 版本化升级钩子（`upgradeContentEnrichment`）低复杂度起步，保证结构化卡片立即可用且便于后期平滑替换为分类器/LLM。
3. **采集预算额度**：X + Reddit 直调 API 总上限校准为 `<= 20,000` 条/天，采集前通过 `estimate` 预估配额。
4. **分期交付顺序**：2026-11-23 原定先完成 Backend V2（当前 `/v1/feed/*` 与 `/v1/intelligence/*` 已合入 `main` 为 `[LIVE]`），匿名访客在信息流自动使用非个性化高价值混排，前端由运维闭环（Stage 1）与 V2 产品融合（Stage 2）分批落地。

## 3. 度量诚实性与核心产品规则

| ID | 等级 | 规则描述 | 验收出口 |
| :--- | :--- | :--- | :--- |
| **PRD-01** | MUST | 检索、列表、导出与统计只读库内已存数据并共享权限交集（`allowedSourceIds`），读路径严禁触发付费采集；全库仅按 `commitContentBatch` 唯一入库。 | 权限一致性与读路径隔离测试 |
| **PRD-02** | MUST | 监测先经 `estimate` 预估费用再 `collect`；外部推流（`POST /v1/sources/:id/ingest`）与内部调度清晰分离。 | 估价门禁与推流幂等测试 |
| **MET-01** | MUST NOT | 将库内样本量或样本内品牌提及占比夸大为“全网声量/全网触达”；`overview` 强制附带 `{ coverage, sampleSize, windowFrom, windowTo, jobSuccessCount, jobFailedCount }` 样本声明。 | 契约响应与前端覆盖条审查 |
| **MET-02** | MUST | **零伪造曲线与零假零值**：趋势/火花线 `sparkline` 必须源于真实 `content_observation` 或分桶快照（缺测则如实返回空/现有节点，禁拼造假斜率）；X 互动率（ER）明确标注分母口径（`by_views` \| `by_followers`），分母均缺时返回 `null` 而非 `0`；Velocity 前窗无覆盖返回 `deltaPct = null`。 | `intelligence-metrics` 与火花线真实性测试 |
| **MET-03** | MUST | 严格分离 `publishedAt`、`sourceObservedAt`、`fetchedAt` 三轴时间（未知存 `null`）；跨平台热度仅通过平台内 7 天基线百分位归一化（`unifiedHeat 0..100`）横向比较，原始指标禁止跨平台混加。 | 时间边界与归一化单测 |
| **ENG-01** | MUST | 保持零循环依赖与公开门面（`lint:arch`）、每表唯一写归属与凭证表读隔离（`check-table-ownership.ts`），新增 SQL 迁移通过 `Squawk`、`PG16` 回滚与 `CODEOWNERS` 审查，禁止为 UI 卡片私建旁路表。 | CI 架构与 SQL 门禁 |
| **ENG-02** | MUST | 付费渠道 `unknown` 永不自动重放（须 `acknowledgePotentialCharge` 人工解封）；上线前必须隔离 PG16 备份演练与版本回退核验。 | 停发闸门与恢复演练 |

## 4. 文档维护职责矩阵

| 文档 | 唯一职责 |
| :--- | :--- |
| [README.md](../README.md) | 仓库总入口、核心能力概览与开发启动 |
| [AGENTS.md](../AGENTS.md) | Agent 与协作者红线约束 |
| [README.md](README.md)（本文） | 产品支柱、业务边界、2026-11-23 定案与度量诚实性 |
| [architecture.md](architecture.md) | 4 GB 运行拓扑、模块化领域边界、单写表与凭证表隔离、检索、L1–L3/R4 隔离与安全底线 |
| [invariants.md](invariants.md) | `INV-001`..`INV-010` 核心工程不变量与门禁索引 |
| [contracts.md](contracts.md) | Domain 对象、认证授权、采集/查询/导出规则与 `check:openapi` 全量路由清册 |
| [design.md](design.md) | 现有 UI 基线与 Frontend V2 信息架构/交互视觉规范 |
| [status.md](status.md) | 生产最近已知基线、主干已合入代码、在途质量修复与未收口事项 |
| [development.md](development.md) | 分支协作、CI 门禁、本地验证、Docker 部署与生产运维手册 |
| [backend-v2-blueprint.md](plans/backend-v2-blueprint.md) | 已批准 Backend V2 产品与架构完整设计规格 |
