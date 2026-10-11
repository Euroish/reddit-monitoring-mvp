# 多平台信息聚合与可视化

从现有 Reddit 监测工作台逐步扩展到多平台信息获取、聚合与可视化。Reddit 的下一步数据源是 Arctic Shift；X、Instagram（可替换）及外部聚合项目属于后续规划。

**当前代码仍是 Reddit 实现，Arctic Shift 尚未接入。** 产品方向与实现状态分别见以下文档。

- [文档入口与产品计划](docs/README.md)
- [架构与数据边界](docs/architecture.md)
- [开发、Git 协作与验证](docs/development.md)
- [当前状态与下一步](docs/status.md)

Agent 从 [AGENTS.md](AGENTS.md) 开始。运行环境为 Node.js 22、npm、PostgreSQL；前端使用 React / Vite。安装与启动命令见开发说明。
