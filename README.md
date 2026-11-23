# SIFTLINE

面向研究者与产品团队的**高价值讨论信息流**与 **Semrush 级社媒/GEO 智能监测平台**。全仓围绕 **Fastify 5 + TypeBox + PostgreSQL 16 + React 19** 构建，在单机 **4 GB RAM / 60 GB Disk** 预算内坚持零 ORM、零 Redis/BullMQ、零 Python/Chromium 主线运行。

## 核心能力与研发路线

- **高价值讨论流与跨平台热榜（`/v1/feed/*` · V2 后端在途）**：隔离新闻 RSS 与营销水帖，采用四池公平配额（个性化 / 全网热议 / 未知探索 / 6h 飙升）+ 14 天半衰期衰减 + Plackett-Luce 采样 + 滑动窗口打散 + 14 天已读防重，提供可解释推荐理由与跨平台百分位热度榜。
- **Semrush 级社媒与 GEO 监测（`/v1/intelligence/*` · V2 后端在途）**：覆盖 **关键词声量与外链 GEO 引用（SoV/Domain）**、**KOL 账号批量打包（15–20 号合成查询）与作者画像**、**一揽子 Subreddit 象限矩阵与 7×24 热力图**，执行先估价（`estimate`）后采集（`collect`）预算门禁。
- **AI 发布情报中心（`/v1/ai/*` · `[LIVE]`）**：基于官方一手证据链与 `data/ai/history/v1/` 离线可验证基线，提供厂商时间矩阵、模型演进、评测榜单与管理员审核队列。

## 快速开始

环境要求 **Node 24+** 与 **PostgreSQL 16**：

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run lint:policy && npm run lint:api && npm run lint:arch
npm run typecheck && npm run check:openapi && npm run test:unit
```

隔离 PG16 集成测试、多阶段 Docker 构建（`--target runtime` / `--target proxy`）及生产运维规程详见[开发与运维手册](docs/development.md)。私有密钥仅存放于仓外环境文件，`git push` 不触发自动部署。

## 文档导航（Single Source of Truth）

| 文档 | 唯一管辖范围 |
| :--- | :--- |
| [产品边界与指标口径](docs/README.md) | 核心产品支柱、不做什么边界、2026-11-23 决议与度量诚实性铁律 |
| [系统架构与边界](docs/architecture.md) | 4 GB 运行拓扑、9 域无环 DAG、58 表所有权、检索核心、L1–L3/R4 隔离与安全边界 |
| [核心不变量台账](docs/invariants.md) | `INV-001`..`INV-010` 不可破坏约束与自动化 CI 门禁映射 |
| [数据与 API 契约](docs/contracts.md) | 领域语义、鉴权/会话/MFA 契约、幂等导出、V2 BFF 摘要与 115 路由实测清单 |
| [前端 V2 交互与视觉规范](docs/design.md) | 已部署界面盘点与 Frontend V2 重构蓝图（B1 信息流卡片 × B2 Semrush 监测台） |
| [当前状态与缺口台账](docs/status.md) | 生产基线、`main` 主干、Draft PR #32 后端 V2 进度、5 项待收口缺口与演进路线 |
| [开发与运维手册](docs/development.md) | 单主干协作、CI 路径分流、本地验证、Docker/Caddy/Tunnel、备份恢复与巡检 SQL |
| [Backend V2 演进蓝图](docs/plans/backend-v2-blueprint.md) | 已审批的 Backend V2 数据底座、推荐算法、Semrush 监测与 5 切片交付规格 |
| [Agent 协作与工程红线](AGENTS.md) | AI 与协作者开工必读红线、真源索引与 PR 质量原则 |
