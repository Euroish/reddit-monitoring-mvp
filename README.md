# 多源信息监测工作台

面向研究、运营与竞品观察：增量发现Reddit/X讨论，确定性筛信号，按需批量补全评论树，读证据并留档。

目标是单机Fastify/PostgreSQL/React产品，Web与agent共用HTTP API；Reddit采用kaix/备源、X采用TwitterAPIs/TwitterAPI.io，NewsNow/feed补充。Arctic Shift在线链路退役；历史加工仅R4独立外挂，核心不依赖Python/DuckDB/原档。

## 当前开发

当前仍为node:http旧实现，**Fastify、项目/漏斗、主备/混合树、推流与Compose尚未实现**。开发需Node22+、npm、PostgreSQL；CI为Node24/PG16。

```sh
npm ci
npm --prefix apps/web ci
npm run docs:check && npm run typecheck
```

按[开发说明](docs/development.md#1-安装与启动)配置独立开发库/当前凭证、迁移，再分别启动API、来源worker和Web；默认不开真实网络，不触发费用。

## 文档入口

- [产品范围与文档导航](docs/README.md) · [当前状态](docs/status.md)
- [架构](docs/architecture.md) · [契约与agent操作](docs/contracts.md) · [交互](docs/design.md)
- [重建/迁移/实删计划](docs/plans/source-expansion.md)
- [唯一母本Master Spec](docs/research/architecture_audit_and_rebuild_spec.md) · [来源证据](docs/research/data-sources.md)
- [开发、验证与当前部署](docs/development.md)；Agent先读[AGENTS.md](AGENTS.md)。

文档目标不代表已上线功能；Git推送不会自动部署。
