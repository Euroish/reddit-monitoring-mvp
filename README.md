# 多平台信息聚合与可视化

从现有 Reddit 监测工作台逐步扩展到多平台信息获取、聚合与可视化。Reddit 已接入 Arctic Shift 的帖子/评论采集与查询；X、Instagram（可替换）及外部聚合项目属于后续规划。

**共享接口已设计多平台字段，当前真实新来源为 Arctic Shift。** 产品方向、验证范围与实现状态分别见以下文档。

- [文档入口与产品计划](docs/README.md)
- [架构与数据边界](docs/architecture.md)
- [开发、Git 协作与验证](docs/development.md)
- [当前状态与下一步](docs/status.md)

Agent 从 [AGENTS.md](AGENTS.md) 开始。当前使用 Windows 本地独立功能分支；运行环境为 Node.js 22+、npm、PostgreSQL，前端为 React / Vite。安装与启动命令见开发说明。
