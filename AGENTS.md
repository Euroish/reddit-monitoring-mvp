# Agent 开发与协作入口

开工前核实当前检出分支（主干统一为 `main`，生产工作目录 `/root/workspaces/reddit-monitoring-mvp`）与 `git status`，并参考[开发与运维手册](docs/development.md)的分支与验证规范。

## 协作与遇阻直报原则

- **遇阻直报（最重要）**：如发现某条工程约束与当前缺陷修复或简洁设计存在明显冲突，**严禁为了过门禁而写绕道代码、复制逻辑或拆无意义薄包装**；必须先向维护者直白说明冲突点与原因，再决定遵守还是调整约束。
- **交付看质量与真实证据**：PR 为候选方案，按价值、质量、风险与真实依赖合入，不按编号/时间排队。交付前重读完整 diff，优先复用已有能力与清晰数据流，不伪造运行、性能、生产状态或审批，不削弱测试来制造绿灯。详见[门禁分级与评审原则](docs/development.md#11-门禁分级与评审原则)。

## 1. 两份动态状态真源

1. **[docs/development.md](docs/development.md)**：单主干协作流程、CI 门禁分级、本地验证、多阶段 Docker 构建、安全加固与生产运维。
2. **[docs/status.md](docs/status.md)**：生产环境最近实测基线、`origin/main` 主干与后续路线。

## 2. 规范职责矩阵（唯一真源）

| 文档 | 唯一管辖范围 |
| :--- | :--- |
| [产品边界与口径](docs/README.md) | 产品目标、不做清单、2026-11-23 定案与指标诚实性规则 |
| [系统架构与边界](docs/architecture.md) | 4 GB 运行拓扑、模块架构、表所有权、检索、L1–L3/R4 隔离与 SSRF/资源边界 |
| [核心不变量台账](docs/invariants.md) | `INV-001`..`INV-010` 强制门禁与自动化回归测试映射 |
| [数据与 API 契约](docs/contracts.md) | 领域模型、认证/MFA/Scope、采集幂等、`feed`/`intelligence` 契约与全量路由清单 |
| [前端 V2 交互规范](docs/design.md) | 现有 UI 基线与面向 `/v1/feed/*`、`/v1/intelligence/*` 的 Frontend V2 重构设计 |
| [Backend V2 蓝图](docs/plans/backend-v2-blueprint.md) | 已批准的 Backend V2 产品与架构总设计 |

## 3. 核心工程红线（MUST / MUST NOT）

- **真实性红线**：`MUST NOT` 混淆“生产运行版本”、“`origin/main` 已合入代码”与“未合入 PR 分支代码”；`MUST NOT` 伪造趋势、火花线、百分比或把未实装接口写成 `[LIVE]`；用户明确指令高于历史文档。
- **单主干与安全操作**：唯一常驻主干为 **`main`**，从最新 `origin/main` 切分支开发，通过 `CI Gate` 与评审后 `Squash and Merge`；发版使用 `vX.Y.Z` 不可变 Tag；禁输出密钥、禁无授权 `git push --force`。
- **前向迁移不可变**：主干已合入的 SQL 迁移严禁改写、移动或删除；新迁移按当前主干最大编号顺延，由 `lint:policy`、`Squawk`、PG16 回滚测试与 `.github/CODEOWNERS` 把关；`050` 退役旧表永不复活。
- **主线与外挂隔离**：主线只运行 `Fastify 5 + TypeBox + PostgreSQL 16 + React`（零 ORM、Redis、Python、DuckDB、无头浏览器）；R4 `plugins/zst-archive/` 与重型/反爬 L3 采集器 `MUST` 外置运行，只持锁死 `allowedSourceIds` 与 `ingest` scope 的 Machine Key 调 `POST /v1/sources/:id/ingest`。
- **安全与数据底线**：严格遵守[核心不变量台账](docs/invariants.md)（`INV-001`..`INV-010`）；全库内容写唯一入口为 `commitContentBatch`；`/v1/content/*` 仅 `GET/HEAD` 映射 `read` scope；付费渠道 `unknown` 永不自动重放。

## 4. 代码质量准则

- 优先在 SQL 层与热路径标量列完成过滤与聚合，消除无谓 `JSONB` 解包与重放写放大。
- 保持轻量、模块化、高内聚低耦合，严禁单实现 `*Repository` / `InMemory*` 样板包装。
- 随代码变动同步清理过期文档与漂移规则，降低长期迭代成本。
