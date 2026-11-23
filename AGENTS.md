# Agent 开发与协作入口

开工前核实当前检出分支（主干统一为 `main`，生产工作目录 `/root/workspaces/reddit-monitoring-mvp`）与 `git status`，并严格遵守[开发与运维手册](docs/development.md)的分支与验证规范。

## 变更质量协议（MUST）

Agent 在开工、提交 PR 和合入前必须阅读 [变更准入与工程质量](docs/development.md#11-变更准入与工程质量)，并完成其中的影响分析、实现后审查、简化复核和验证。首轮生成结果不是交付结果。

- 以可维护性、明确价值、风险和已验证的依赖安排集成；编号与创建时间不决定设计优先权。冲突方案按契约完整性、复杂度和验证证据取舍，不为保留较早实现而引入重复模型或兼容胶水。
- PR 为候选方案；CI 通过只是必要条件。缺少价值、降低代码健康或尚无足够证据时，应请求修改、保留 Draft 或关闭，不影响无关就绪变更。
- 优先复用明确的现有能力、缩小状态与依赖面；新增层次须隐藏真实复杂度。不得以搬文件、压行数、薄包装或新框架代替简化；不得因暂未调用而删除已批准的扩展契约或停用能力。
- 按 PR 模板提交真实验证、复杂度前后对照、简化复核与兼容性证据。不得伪造运行、性能、生产状态或审批；前端验收必须覆盖实际用户任务与受影响状态。
- 审查意见说明需求/规则、代码或复现场景、影响及验收办法；建议与阻断分开，并接受反证。作者自查、Agent 审查建议与 GitHub 独立批准分别记录。
- 仓库写操作遵循当前任务授权；提交前核实实际 head、检查结果和未收口项，不得伪造审批、隐藏失败或削弱测试来制造就绪状态。

## 1. 两份动态状态真源

1. **[docs/development.md](docs/development.md)**：单主干协作流程、分层 CI 门禁、本地验证、多阶段 Docker 构建、安全加固、备份恢复与生产只读巡检 SQL。
2. **[docs/status.md](docs/status.md)**：生产环境最近实测基线、`origin/main` 主干与在途候选修复的实时状态、未收口缺口与后续路线。

## 2. 规范职责矩阵（唯一真源）

| 文档 | 唯一管辖范围 |
| :--- | :--- |
| [产品边界与口径](docs/README.md) | 产品目标、不做清单、2026-11-23 定案与指标诚实性规则 |
| [系统架构与边界](docs/architecture.md) | 4 GB 运行拓扑、9 域 DAG、58 表所有权、检索、L1–L3/R4 隔离与 SSRF/资源边界 |
| [核心不变量台账](docs/invariants.md) | `INV-001`..`INV-010` 强制门禁与自动化回归测试映射 |
| [数据与 API 契约](docs/contracts.md) | 领域模型、认证/MFA/Scope、采集幂等、`feed`/`intelligence` 契约与全量路由清单 |
| [前端 V2 交互规范](docs/design.md) | 现有 UI 基线与面向 `/v1/feed/*`、`/v1/intelligence/*` 的 Frontend V2 重构设计 |
| [Backend V2 蓝图](docs/plans/backend-v2-blueprint.md) | 已批准的 Backend V2 产品与架构总设计 |

## 3. 核心工程红线（MUST / MUST NOT）

- **真实性红线**：`MUST NOT` 混淆“生产运行版本”、“`origin/main` 已合入代码”与“未合入 PR 分支代码”；`MUST NOT` 伪造趋势、火花线、百分比或把未实装接口写成 `[LIVE]`；用户明确指令高于历史文档。
- **单主干与反漂移红线**：仓库唯一常驻主干为 **`main`**（不设常驻 `develop`/`prod`）；所有改动从最新 `origin/main` 切短分支（`feat/*` `<= 3` 天、`fix/*` `<= 1` 天），通过 `CI Gate` 与评审后 `Squash and Merge`；发版使用 `vX.Y.Z` 不可变 Tag；禁输出密钥、禁无授权 `git push --force`。
- **前向迁移不可变**：主干已合入的所有 SQL 迁移严禁改写、移动或删除；新迁移按当前主干最大编号顺延，由 `docs:check`、`Squawk`、PG16 回滚测试与 `.github/CODEOWNERS` 联合把关；`050` 退役旧表永不复活。
- **主线与外挂隔离**：主线只运行 `Fastify 5 + TypeBox + PostgreSQL 16 + React`（零 ORM、Redis、Python、DuckDB、无头浏览器）；R4 `plugins/zst-archive/` 与重型/反爬 L3 采集器 `MUST` 外置运行，只持锁死 `allowedSourceIds` 与 `ingest` scope 的 Machine Key 调 `POST /v1/sources/:id/ingest`。
- **9 域 DAG、唯一写入口与安全底线**：严格遵守[核心不变量台账](docs/invariants.md)（`INV-001`..`INV-010`）与 `eslint`、`depcruise`、`check-table-ownership`、`check:openapi` 门禁；全库内容写唯一入口为 `commitContentBatch`；`/v1/content/*` 仅 `GET/HEAD` 映射 `read` scope；付费渠道 `unknown` 永不自动重放。

## 4. PR 代码质量准则

- 全面追求低时空复杂度，优先在 SQL 层与热路径标量列完成过滤与聚合，消除无谓 `JSONB` 解包与重放写放大。
- 保持轻量、模块化、高内聚低耦合，严禁单实现 `*Repository` / `InMemory*` 样板包装与跨模块深挖内部文件。
- 随代码变动同步清理过期文档与漂移规则，维持库表与接口契约零歧义，降低长期迭代成本。
