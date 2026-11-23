# Agent 开发与协作入口（STD-100）

作业前核实当前检出分支（主干统一为 `main`，生产目录 `/root/workspaces/reddit-monitoring-mvp`）及 `git status`，并遵守[团队分支治理与 AI 协作准则](docs/development.md#0-团队分支治理与-ai-协作准则)。仓库可按需新增 Markdown 文档，发布包按 `scripts/release-package-lib.mjs` 的 `DOCUMENTATION_FILES` 选档。

## PR 准入硬门槛（所有 Agent MUST 遵守）

- **按质量、价值、风险与真实依赖决定合入顺序，不按编号或提交时间。无依赖且已就绪的 PR 可先合入；未达标的 PR 请求修改、转 Draft 或关闭，不阻塞其他交付。** PR 是候选方案，完成开发、投入工时、CI 全绿均不构成必须接收的理由。
- 开工前、创建/更新 PR 前、建议/执行合入前，MUST 重读 [PR 质量准入与合入决策](docs/development.md#04-pr-质量准入与合入决策)，依据实际 diff、调用方、测试和运行证据判断；不得迎合作者、审查者或用户情绪捏造缺陷/成果。
- 创建 PR MUST 使用 `.github/pull_request_template.md`，填写具体价值与验收、真实依赖、设计复杂度、验证证据、风险回退。前端改动还须实际渲染与用户旅程证据；不得把截图、构建通过或 mock 成功当完整业务验收。
- 不改善整体代码健康、无明确项目价值、引入无必要耦合/重复状态/抽象，或证据不足的改动 MUST 停止推荐合入。无法判断时标明缺失证据，留 Draft/请求修改；不为凑交付强行并入，不靠降低测试和门禁消除失败。
- Agent MUST 区分作者自查、Agent 审查建议与 GitHub 独立批准，不得伪造审批。未经用户针对具体 PR 明确授权，不得合入或启用自动合并；管理员绕过还需明确授权绕过及理由，不得以管理员身份自行豁免。
- 审查只评价改动：用「规则/需求 + 文件/场景证据 + 影响 + 验收办法」提出阻断，个人审美标为非阻断建议；不得因同辈关系放行，也不得因作者身份或个人偏好拒绝。作者负责修复，维护者负责取舍。

## 1. 两份唯一真源

1. **[docs/development.md](docs/development.md)**：团队分支治理与 AI 协作准则、分层 CI 门禁、单机环境、多阶段镜像构建、PG16/Compose 参数、备份恢复、交付历史与生产发布核对。
2. **[docs/status.md](docs/status.md)**：`main` 实码盘点、生产采样与两条研发路线。

## 2. 规范职责矩阵

| 文档 | 唯一管辖范围 |
| :--- | :--- |
| [产品边界与口径](docs/README.md) | 社媒情报分析与高质量信息分发、共同度量及规范索引 |
| [主线架构](docs/architecture.md) | 模块边界、数据演进与迁移安全、L1–L3 扩源、SSRF/鉴权安全与 4 GB 预算 |
| [核心不变量台账](docs/invariants.md) | `INV-001`..`INV-010` 系统不可破坏约束与自动化验证映射 |
| [数据与 API 契约](docs/contracts.md) | Domain 对象、版本/幂等、`[LIVE]` 已注册路径/操作 vs `[V2]` 规划接口规范 |
| [前端与融合规范](docs/design.md) | 公开站与研究工作台、分析下钻、推荐交互和图表边界 |
| [来源矩阵](docs/research/data-sources.md) | 来源准入、采样快照与 L1–L3 扩源策略 |
| [演进与外挂隔离](docs/plans/source-expansion.md) | 已完结 R1–R3/`050` 清单、`051+` 规则、R4 `plugins/zst-archive/` 与 L3 Sidecar 隔离 |
| [产品策略研究](docs/research/product-strategy.md) | 行业实践、样本就绪、推荐反馈与分阶段验收 |
| [历史归档](docs/research/architecture_audit_and_rebuild_spec.md) | `main@7045185` 尸检与早期替换规格（仅作只读溯源，不作现状依据） |

## 3. 核心架构不变量（MUST / MUST NOT）

- **真实性红线**：`MUST NOT` 将 `[V2]` 规划项（如 `linkedom`/`Readability`、`story_cluster`、`stream_class`、`/discovery/query`、`/content/:id/enrich`）或未启用渠道写成 `[LIVE]`；用户指令高于规划。
- **单主干与反漂移红线**：仓库唯一常驻主干为 **`main`**（不设常驻 `develop`/`prod`）；从最新 `origin/main` 切短分支（`feat/*` `<= 3` 天、`fix/*` `<= 1` 天），独立 PR 直接指向 `main`，评审通过且 `CI Gate` 绿灯即可 `Squash and Merge`。遇到冲突或关键文件重叠时，同步 `origin/main`，核对 `git diff origin/main --stat` 并重跑相关检查；发版打 `vX.Y.Z` 不可变 Tag。
- **迁移安全纪律（不设僵化表数上限）**：主干已合入迁移（`001..058`）不可改写、移动或删除；新迁移顺延编号，由 `docs:check`、`Squawk`（防锁表/并发索引隐患）、PG16 事务回滚测试与 `.github/CODEOWNERS` 联合把关；`050` 退役旧表不可复活。
- **主线与外挂隔离**：主线只运行轻量 `Fastify 5 + TypeBox + PG16 + React`（零 Python/DuckDB/Chromium/ORM/Redis）；R4 `plugins/zst-archive/` 与 L3 重型/强反爬采集器 `MUST` 外置运行，只持带明确 `allowedSourceIds` 与 `ingest` scope 的 Machine Key 调用 `POST /v1/sources/:id/ingest`。
- **模块化边界与代码质量纪律**：允许按独立业务域新增 `src/modules/<domain>/` 与子目录（不设僵化模块数或 450 行硬上限），但 `MUST` 通过 `eslint`（异步安全 `no-floating-promises` / 禁 `*Repository` 与 `InMemory*`）、`dependency-cruiser`（零循环依赖、禁跨模块引 `routes.ts`、禁越界耦合 `access`/`workspace`、禁跨模块深挖内部文件、禁前端引后端 `src/`）与路由鉴权/表写归属契约校验；全库唯一内容写入口为 `commitContentBatch`；`/v1/content/*` 仅 `GET/HEAD` 映射 `read` scope；付费渠道 `unknown` 永不自动重放；禁输出密钥、禁无授权 `git push --force`。
4.开发代码提交pr原则
  全面低复杂度，最大程度利用代码效率和性能
  尽可能轻量/模块化/长期迭代
  不断提高仓库的代码质量，定期清理漂移
