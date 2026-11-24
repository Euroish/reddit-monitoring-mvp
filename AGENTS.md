# Agent 开发与协作入口

开工前核实当前检出分支（主干统一为 `main`，生产工作目录 `/root/workspaces/reddit-monitoring-mvp`）与 `git status`，并严格遵守[开发与运维手册](docs/development.md)的分支与验证规范。

## 变更质量

按[开发手册](docs/development.md#11-变更准入与工程质量)围绕实际行为、风险和维护成本审查。用最小有效的验证证明关键行为；自由描述，无必填章节、复杂度打分或固定验证清单。未验证的事项如实说明；测试和自查不代替独立审批。仓库写操作以当前授权为准。

## 1. 协作与交付入口

1. **[docs/development.md](docs/development.md)**：单主干协作流程、分层 CI 门禁、本地验证、多阶段 Docker 构建、安全加固、备份恢复与生产只读巡检 SQL。
2. **[docs/status.md](docs/status.md)**：生产、主干与候选快照，并索引审计待办和已交付归档。

## 2. 规范职责矩阵（唯一真源）

| 文档 | 唯一管辖范围 |
| :--- | :--- |
| [产品边界与口径](docs/README.md) | 产品目标、不做清单、2026-11-23 定案与指标诚实性规则 |
| [系统架构与边界](docs/architecture.md) | 4 GB 运行拓扑、模块 DAG、表写归属、检索、L1–L3/R4 隔离与 SSRF/资源边界 |
| [核心不变量台账](docs/invariants.md) | `INV-001`..`INV-010` 强制门禁与自动化回归测试映射 |
| [数据与 API 契约](docs/contracts.md) | 领域模型、认证/MFA/Scope、采集幂等、`feed`/`intelligence` 契约与全量路由清单 |
| [前端 V2 交互规范](docs/design.md) | 现有 UI 基线与面向 `/v1/feed/*`、`/v1/intelligence/*` 的 Frontend V2 重构设计 |
| [Backend V2 蓝图](docs/plans/backend-v2-blueprint.md) | 已批准的 Backend V2 产品与架构总设计 |

## 3. 核心工程红线（MUST / MUST NOT）

- **真实性红线**：`MUST NOT` 混淆“生产运行版本”、“`origin/main` 已合入代码”与“未合入 PR 分支代码”；`MUST NOT` 伪造趋势、火花线、百分比或把未实装接口写成 `[LIVE]`；用户明确指令高于历史文档。
- **单主干与反漂移红线**：仓库唯一常驻主干为 **`main`**（不设常驻 `develop`/`prod`）；从最新 `origin/main` 创建变更分支，通过 `CI Gate` 与评审后 `Squash and Merge`；发版使用 `vX.Y.Z` 不可变 Tag；禁输出密钥、禁无授权 `git push --force`。
- **前向迁移不可变**：主干已合入的所有 SQL 迁移严禁改写、移动或删除；新迁移按当前主干最大编号顺延，由 `docs:check`、`Squawk`、PG16 回滚测试与 `.github/CODEOWNERS` 联合把关；`050` 退役旧表永不复活。
- **主线与外挂隔离**：主线只运行 `Fastify 5 + TypeBox + PostgreSQL 16 + React`（零 ORM、Redis、Python、DuckDB、无头浏览器）；R4 `plugins/zst-archive/` 与重型/反爬 L3 采集器 `MUST` 外置运行，只持锁死 `allowedSourceIds` 与 `ingest` scope 的 Machine Key 调 `POST /v1/sources/:id/ingest`。
- **9 域 DAG、唯一写入口与安全底线**：严格遵守[核心不变量台账](docs/invariants.md)（`INV-001`..`INV-010`）与 `eslint`、`depcruise`、`check-table-ownership`、`check:openapi` 门禁；全库内容写唯一入口为 `commitContentBatch`；`/v1/content/*` 仅 `GET/HEAD` 映射 `read` scope；付费渠道 `unknown` 永不自动重放。

## 4. PR 代码质量准则

- 关注实际执行成本，验证热路径的查询、并发和资源开销。
- 保持状态所有权和公开契约清晰；只有能隔离变化或减少重复时才引入抽象，不限制命名或函数规模。
- 随代码变动同步清理过期文档与漂移规则，维持库表与接口契约零歧义，降低长期迭代成本。
