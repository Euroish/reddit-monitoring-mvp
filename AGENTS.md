# Agent 开发与协作入口（STD-100）

作业前核实当前检出分支（主干统一为 `main`，生产目录 `/root/workspaces/reddit-monitoring-mvp`）及 `git status`，并遵守[团队分支治理与 AI 协作准则](docs/development.md#0-团队分支治理与-ai-协作准则)。`README.md` 硬上限 `<= 60` 行；禁止在 `scripts/release-package-lib.mjs` 允许清单（`DOCUMENTATION_FILES`，共 15 份）之外新增 `.md` 文件。

## 1. 两份唯一真源

1. **[docs/development.md](docs/development.md)**：团队分支治理与 AI 协作准则、单机环境、多阶段镜像构建、PG16/Compose 参数、备份恢复、`0.2.0–0.9.1` 至 `052+` 交付台账。
2. **[docs/status.md](docs/status.md)**：`main` 实码盘点、分支收口状态、已修复故障与 V2 Phase B–D 交付路线。

## 2. 规范职责矩阵

| 文档 | 唯一管辖范围 |
| :--- | :--- |
| [产品边界与口径](docs/README.md) | 信息流优先 + 选择性可视化定位、度量诚实性、建表纪律与全仓 15 文档清单 |
| [主线架构](docs/architecture.md) | 五模块拓扑、`20 -> <= 24` 表结构演进、L1–L3 扩源、SSRF/鉴权安全与 4 GB 预算 |
| [数据与 API 契约](docs/contracts.md) | Domain 对象、版本/幂等、`[LIVE]` 已注册路径/操作 vs `[V2]` 规划接口规范 |
| [前端与融合规范](docs/design.md) | 三模态界面、`[LIVE]` vs `[V2]` 边界、双层图表选型与 `semrush` 分支蒸馏矩阵 |
| [来源矩阵](docs/research/data-sources.md) | 开源对标、8 大活跃 `source_group`（100 源）与 L1–L3 扩源策略 |
| [演进与外挂隔离](docs/plans/source-expansion.md) | 已完结 R1–R3/`050` 清单、`051+` 规则、R4 `plugins/zst-archive/` 与 L3 Sidecar 隔离 |
| [历史归档](docs/research/architecture_audit_and_rebuild_spec.md) | `main@7045185` 尸检与早期替换规格（仅作只读溯源，不作现状依据） |

## 3. 核心架构不变量（MUST / MUST NOT）

- **真实性红线**：`MUST NOT` 将 `[V2]` 规划项（如 `linkedom`/`Readability`、`story_cluster`、`stream_class`、`/discovery/query`、`/content/:id/enrich`）或未启用渠道写成 `[LIVE]`；用户指令高于规划。
- **单主干与反漂移红线**：仓库唯一常驻主干为 **`main`**（不设常驻 `develop`/`prod`）；所有改动须从最新 `origin/main` 切短分支（`feat/*` `<= 3` 天、`fix/*` `<= 1` 天），合前以 `git merge/rebase origin/main` 同步（严禁跨分支拷贝覆盖文件），AI 解冲突后必须核对 `git diff origin/main --stat` 且全量 CI 绿灯后 `Squash and Merge`；发版打 `vX.Y.Z` 不可变 Tag。
- **精简建表纪律**：`001..050` 为不可变已应用迁移（由 `scripts/check-docs.ts` 强制拦截篡改），已合入 `main` 的 `051+` 迁移同样不可改写；当前核心库为 `23` 张表（含 `051`/`052` 凭证与动态配额），总表上限严格 **`<= 24` 张**，PR 须声明表增量与顺延编号，永不恢复已删 27 张历史表、7 张 R4 设想表或冻结导出表。
- **主线与外挂隔离**：主线只运行轻量 `Fastify 5 + TypeBox + PG16 + React`（零 Python/DuckDB/Chromium）；R4 `plugins/zst-archive/` 与 L3 重型/强反爬采集器 `MUST` 外置运行，只持带明确 `allowedSourceIds` 与 `ingest` scope 的 Machine Key 调用 `POST /v1/sources/:id/ingest`。
- **五模块与写入纪律**：`access`、`collection`、`content`、`projects`、`workspace` 仅允许平铺命名 SQL 函数（`<= 450` 行/文件、`<= 220` 字/代码行、禁 `class`/`*Repository`/`InMemory*`）；全库唯一内容写入口为 `commitContentBatch`；`/v1/content/*` 仅 `GET/HEAD` 映射 `read` scope；付费渠道 `unknown` 永不自动重放；禁输出密钥、禁无授权 `git push --force`。
