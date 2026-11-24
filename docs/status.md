# 主干交付状态、生产基线与演进路线

本页区分线上最近已知运行态与 `origin/main` 已合入代码，不把本地验证或主干合入写成生产部署。

---

## 1. 基线对照

| 层级 | 提交 / 版本 | 状态与证据 |
| :--- | :--- | :--- |
| **线上生产环境** | 最近记录 `f3bcc1b` | 本轮未部署、未写生产库，未重新巡检生产容器。2026-11-22 历史抽样为迁移至 `058`、46 表、约 51 MiB、101 活跃源；不代表当前实时运行态。 |
| **`origin/main` 主干** | `f5dec60`（已合入 `#44`） | 迁移至 `067`（`ai_provider_credential`），OpenAPI `136` 路径 / `158` 操作；已合入 Stage 1 闭环（统一 `intel_monitor_usage` 日预算、`AUD-04` 非调度孤立源可见性、`AUD-05`/`21` 批量治理与 `061` 归档恢复及内嵌预览、`AUD-13`/`B07` 导出筛选与截断提示、`AUD-19`/`20` AI 事件 CRUD + 在线凭证 + 注册表开关）。尚未部署生产。 |
| **PR #45 队列分支** | `feat/multi-target-sort-and-limits`（`ab70796`） | 已完成与 `origin/main@f5dec60` 的冲突解决，迁移顺延至 `068_collection_limits_and_tiers.sql`（10k/5k/2k 配额与多目标采集 + `sort=engagement`），GitHub CI 全绿（`mergeable: true`，待维护者合并）。 |
| **当前候选分支（Stage 2 + 研究工作台）** | `feat/workspace-content-research` | 基于 `f5dec60`（预留 `068` 给 PR #45，自身迁移使用 `069_research_tasks_and_cache.sql`），OpenAPI `149` 路径 / `173` 操作；包含 Stage 2（`AUD-06` `/projects?view=intelligence` 洞察下钻、`AUD-22` `/sources?tab=ops` 总控 `[5]`、`/app/feed?view=stream\|hot-v2`）、项目内容研究工作台重构（L1 概览、L2 跨关键词对比与 PG16 缓存、L3 异步情感/主题任务与证据钻取、`ContentExplorerPage` 高级多选过滤）以及 `Stories` 渠道洞察面板（`GET /v1/content/stories/insights`）。 |

---

## 2. V2 已合入的集成边界

- **迁移不可变**：保留 `059/060` 的历史文件及哈希；V2 为 `061` 内容富化与 lane、`062` Feed、`063` Intelligence、`064` 正向事件幂等。PR #32 已验证 `058 → 064`、保有项目与批次状态的 `060 → 064`、重跑及失败完整回滚。曾应用旧 V2 编号的需保留数据库须另行转换台账，见 [开发手册](development.md#pr-32-迁移兼容与-worker-边界)。
- **Worker 装配**：事务内项目关联和提交后情报回算/自动水合是两个具名钩子；前者失败回滚整页，后者失败不能重放已提交的采集。
- **批次累计与历史**：成员数按实际插入增量累计；任务清理后仍有历史批次的来源归档而非物理删除。
- **产品能力保留**：48 小时互动快照热榜、独立信源聚簇、收藏/有用事件幂等、KOL 互动率、正向评论 GEO 外链统计、社区 P80 评论补采和预算门控。尚未全面完成线上业务验收。
- **质量规则**：CI 仅保留高信噪比硬阻断（密钥、迁移安全、核心架构边界与单写表/凭证表读隔离、OpenAPI 鉴权、类型/lint、单元/集成/冒烟/浏览器测试及禁 `.only(`），移除形式化的 PR 正文校验与圈复杂度硬门禁，并将遇阻直报写入 `AGENTS.md`。

## 3. 未收口项（均已进入候选审查队列）

- **`AUD-22`（Stage 2 候选 `fix/v2-ops-and-feed-ui` 已落地，待评审合入）**：运维空间 `[5]`（全站监测器干预、P80 自动补采总控、Rollup 回算与 Feed 清理控制）与 Frontend V2 产品界面融合（`/app/feed?view=stream|hot-v2` 与 `/projects?view=intelligence`）已在 Stage 2 候选分支完成全栈实现与端到端校验，详情见 [审计修复进度表](research/business-audit-2026-11-23/SIFTLINE_修复进度完成表_2026-11-23.md)。

---

## 4. 后续交付与验收出口

1. **Stage 1 合入与验收**：完成 `fix/audit-p1-ops-closure`（`AUD-03`/`04`/`05`/`13`/`19`/`20`/`21` 闭环）全量自动化门禁与容器端到端验收后 `Squash and Merge` 至 `main`。
2. **Stage 2 Frontend V2 与运维融合（`AUD-22`）**：在稳定 BFF 上分批交付推荐流/热榜、监测总览与作者/社区下钻及运维空间 `[5]`，按状态所有权逐项收敛，保留研究采集、批次权限、R4 接入和 AI 发布情报能力。
3. **安全升级**：生产备份、隔离恢复和 `058 → 069`（含 PR #45 `068`）迁移演练后，再构建同 SHA 的 `runtime` / `proxy`；上线需核对镜像 revision、健康状态及旧研究项目与新 Feed/Intelligence/AI 冒烟。
4. **运行与性能验证**：以目标来源真实样本核验配额、补采防重、SQL 执行计划和单机 4 GB / 60 GB 水位；仪表盘 `< 15 ms` 仍为待实测目标。
5. **后续后端功能**：按 [已批准蓝图](plans/backend-v2-blueprint.md) 与实际缺口拆分支，每项提供契约、授权/预算与回归证据。
