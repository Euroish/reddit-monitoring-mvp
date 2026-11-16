# 多源讨论研究工作台

面向研究、运营与竞品观察：**创建项目 → 增量发现 → 筛选信号 → 按需补评论 → 阅读证据 → 保存或下载**。

目标是单服务器 `Fastify 5 + PostgreSQL 16 + React` 产品，Web 与外部 AI Agent 共用同一套 TypeBox HTTP API；Reddit 采用 `kaix` 主源 + `red_crawler` 备源，X 采用 `TwitterAPIs` 主源 + `ScrapeBadger` 备源，资讯补充精选 `NewsNow` MIT getter 与通用 RSS/Atom `feed`。`Arctic Shift` 与 `TwitterAPI.io` 在线链路按计划退役；历史 `.zst` 归档加工保留为 R4 独立外挂，不进主线依赖或数据库。

## 当前开发

当前工作树为 `1.0.0-dev`：Fastify 五模块已接管，旧 runtime、Repository/InMemory、独立 worker 与旧页面已实删；可运行混合推流、统一检索、流式下载与基础项目。完整信号漏斗、双备源和 Compose 仍待完成。开发与 CI 使用 Node 24 / PostgreSQL 16；过去仅内部测试，当前不公开部署。

```sh
npm ci
npm --prefix apps/web ci
npm run lint
npm run typecheck
```

密钥仅放本机仓库外文件，按[开发与交付](docs/development.md#1-环境与私有配置)配置开发库与凭证再启动 API 与 Web（采集工作槽已在 API 进程内）；默认不开启真实收费网络。

## 文档导航

- **入门与范围**：[产品与架构总览](docs/README.md) · [当前实现状态](docs/status.md) · [开发与交付](docs/development.md)
- **目标架构与契约**：[主线架构规范](docs/architecture.md) · [数据与 API 契约](docs/contracts.md) · [产品交互规范](docs/design.md)
- **重建与替换方案**：[R1–R4 重建与实删计划](docs/plans/source-expansion.md) · [唯一母本 Master Spec](docs/research/architecture_audit_and_rebuild_spec.md)
- **数据源与清理证据**：[来源选择与开源证据](docs/research/data-sources.md) · [来源替换与清理规格](docs/research/source_replacement_and_twitterapi_io_removal_spec.md)
- **历史追溯与 Agent 准则**：[开发历史与交接](docs/history/development-log.md) · [Agent 开发入口](AGENTS.md)

文档目标不代表当前已上线功能；Git 推送不会自动触发部署。
