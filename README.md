# 多源讨论研究工作台

面向品牌、运营与竞品研究：**创建项目 → 增量发现 → 确定性门控 → 按需补评论 → 阅读证据 → 保存或流式下载**。

目标架构为远端单服务器 `Fastify 5 + TypeBox + PostgreSQL 16 + React` 产品，Web 与外部 AI Agent 共用同一 HTTP API。Reddit 采用 `kaix` 主源 + `red_crawler` 备源，X 采用 `TwitterAPIs` 主源 + `ScrapeBadger` 备源，资讯补充精选 `NewsNow` MIT getter 与白名单 `feed`。历史 `.zst` 归档加工独立演进为 R4 外挂 `plugins/zst-archive/`。

## 当前开发基线

当前 `main` 可执行代码仍为 `0.9.1 / node:http`；两个并行重建分支状态、阻断与差异汇总见唯一状态真源：[docs/status.md](docs/status.md)。开发依赖 Node 22+ 与 PostgreSQL；CI 锁定 PostgreSQL 16。

```sh
npm ci && npm --prefix apps/web ci
npm run lint
npm run typecheck
```

私有凭证统一存于仓外文件，本机运行命令、安全退役步骤与完整历史交付记录见唯一开发记录：[docs/development.md](docs/development.md)。

## 文档导航

- **两大唯一真源记录**：[开发与交付记录](docs/development.md) · [当前状态与下一阶段](docs/status.md)
- **产品、架构与契约**：[产品总览](docs/README.md) · [主线架构](docs/architecture.md) · [数据与 API 契约](docs/contracts.md) · [交互规范](docs/design.md)
- **迁移计划与研究证据**：[R1–R4 重建与实删计划](docs/plans/source-expansion.md) · [架构审查母本](docs/research/architecture_audit_and_rebuild_spec.md) · [来源研究](docs/research/data-sources.md) · [来源替换与清理规格](docs/research/source_replacement_and_twitterapi_io_removal_spec.md)
- **Agent 协同规范**：[AGENTS.md](AGENTS.md)

目标架构说明不冒充主线已实施功能；任何 Git 推送均不自动触发远端服务更新。
