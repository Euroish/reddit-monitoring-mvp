# Agent 开发与协作入口

开始任何任务前，先核实当前检出分支与运行目标（本地工作区或远端生产机 `/root/workspaces/reddit-monitoring-mvp`），再按职责读取 `docs/` 权威文档。根目录 `README.md` 只作项目入口（硬上限 `<= 60` 行），正式规范统一维护于 `docs/`；禁止在 `scripts/release-package-lib.mjs` 允许清单外新增 `.md` 文件。

## 1. 两份唯一真源记录（严禁另起第三份状态/历史/交接文档）

1. **唯一开发记录与运维手册**：[docs/development.md](docs/development.md)：维护单机环境、多阶段构建（`--target runtime` / `--target proxy`）、Compose 与 PG16 调优、备份恢复、扩容实测与 `0.2.0–0.9.1` 至 `050` 完整历史台账。
2. **唯一当前状态与演进规划**：[docs/status.md](docs/status.md)：维护 `prod@8e436ac` 实码盘点、跨分支（`main` / `feat/semrush-frontend-rebuild`）对照审计、已修复故障台账与下一阶段 V2 交付路线（Phase A–D）。

## 2. 规范文档分工

| 文档 | 唯一管辖范围 |
| :--- | :--- |
| [产品边界与指标口径](docs/README.md) | 信息流 + 选择性可视化产品定位、8 大来源分组、度量诚实性口径与工程准绳 |
| [主线架构规范](docs/architecture.md) | 5 模块微内核拓扑、PostgreSQL 20→<=26 表节制演进、内容复利四层模型、L1–L3 扩源、安全与容量预算 |
| [数据与 API 契约](docs/contracts.md) | Domain 对象、`CollectionSource` 元数据、混合批写、双字词 GIN、`story` 聚簇与全量 `/v1/*` HTTP 契约 |
| [前端与可视化交互规范](docs/design.md) | Editorial Mineral 视觉系统、双层图表引擎（SVG 微图 + 懒加载分析图）、三模态布局与 `semrush` 分支蒸馏融合方案 |
| [来源矩阵与扩源分层](docs/research/data-sources.md) | 开源标杆对标、8 个活跃渠道分组与 L1 直连 → L2 预算 API → L3 外部 Sidecar 推流扩容矩阵 |
| [演进边界与外挂隔离](docs/plans/source-expansion.md) | R1–R3 已完成归档、Post-050 建表纪律、`plugins/zst-archive/` R4 外挂边界与外部采集器推流隔离 |
| [历史研究与审查档案](docs/research/architecture_audit_and_rebuild_spec.md) | 重整前基线尸检、旧双源替换规格与早期讨论归档（均保留只读历史溯源，不作现状依据） |

## 3. 核心架构不变量与操作红线

- **严守实测真源，禁止幻觉扩张**：用户显式指令高于路线图；严禁将 V2 规划功能、未安装库（如 `linkedom` / `pgvector`）或未启用渠道写成“已上线”；涉及分支融合时，严格按 [前端交互规范](docs/design.md#2-featsemrush-frontend-rebuild-分支审计与融合矩阵) 对 `origin/feat/semrush-frontend-rebuild` 执行逐项蒸馏，**严禁直接整支 merge 到 `prod`**。
- **Post-050 20 表干净内核与节制演化纪律**：`050` 已物理清理 27 张旧表并收敛为 20 张核心表。新业务优先利用既有字段与 `JSONB` 缝隙（L1–L2）；仅当关系索引、稳定事件主键或高频统计确实需要时，方可通过 **`051+` 前向迁移** 引入紧致新表（核心库总量上限 **`<= 26` 张**），**严禁恢复已删除的 27 张历史表、7 张 R4 归档设想表或服务端冻结导出表**。
- **主线与重型抓取外挂物理隔离**：主线运行轻量 `Fastify 5 + TypeBox + PG16 + React`（无 Chromium/Playwright、无 Python/DuckDB）；所有需无头浏览器、住宅代理或高反爬站点解析的 L3 采集器及 R4 `plugins/zst-archive/`，只能部署为独立外部 Sidecar/脚本，通过只含 `ingest` 作用域的 Machine Key 向 `POST /v1/sources/:id/ingest` 推流。
- **唯一写入与成本熔断**：逻辑来源 `collection_source` 与通道 `primaryProvider`/`fallbackProvider` 解耦；仅 `commitContentBatch`（4×`UNNEST`）执行内容落库；仅对明确失败/限流且兼容的通道按策略单跳切备，**严禁对空结果、`partial` 或结果 `unknown` 的付费任务自动重放**。
- **五模块扁平代码纪律**：`access`、`collection`、`content`、`projects`、`workspace` 内仅允许平铺接收 `Pool | PoolClient` 的命名函数，禁 `*Repository`/class 封装、禁 `InMemory*` 模拟、`<= 450` 行/文件、`<= 220` 字/非模板行；`scripts/check-docs.ts` 每次提交前必过。
- **不可变历史迁移与生产操作纪律**：`001..050` 为已应用迁移，禁止回改校验和；结构演进严格使用 Expand-Migrate-Contract 追加 `051+`。`pg_dump` 物理备份与隔离 PG16 全量验证是修改生产库前的前置门禁；禁止输出环境密钥，禁止无授权 `git push --force`。
