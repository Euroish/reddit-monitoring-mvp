# Signal Studio — 多源信息流、选择性可视化与个人知识工作台

把分散在资讯站点、技术社区、社交创作者与排行榜的高价值内容聚合成**可读、可聚类、可量化、可深挖**的单机信息流与个人/Agent 知识库。

产品围绕 **信息流优先 + 选择性数据可视化 + 内容资产复利** 演进：首页以零等待的库内事件流与日报为主视图，卡片内嵌克制的来源构成与热度微图，探索与专题页提供可联动的跨平台脉冲图与三视图评论树，所有高耗分析与按题探索严格按需触发、绝不阻塞日常阅读。

运行时基线为单机 **`Fastify 5 + TypeBox + PostgreSQL 16 + React 19`**：20 张核心表、5 模块扁平内核、`feed`（RSS/Atom/`web_list`/`json_list` + OPML 批量导入）、`newsnow`（7 大内置热榜）、Reddit（`kaix` / `red_crawler`）、X（`TwitterAPIs` / `ScrapeBadger`）与 `bluesky_appview`，Web 与外部 AI Agent 共用同一套 TypeBox 契约。

## 本地校验与运行基线

需要 **Node 24+** 与 **PostgreSQL 16**，生产镜像与运维入口详见 [开发与运维手册](docs/development.md)，真实代码现状与 V2 演进路线见 [当前状态与规划](docs/status.md)。

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run docs:check && npm run lint && npm run typecheck
npm run test:unit
```

> 私有凭证统一存于仓外文件（如 `/etc/reddit-monitoring/unified.env`）；任何 `git push` 均不自动触发远端容器重建。

## 文档导航

- **两大唯一真源**：[开发与运维手册](docs/development.md) · [当前状态与规划](docs/status.md)
- **核心架构与规范**：[产品总览](docs/README.md) · [主线架构](docs/architecture.md) · [数据与 API 契约](docs/contracts.md) · [前端与可视化交互规范](docs/design.md)
- **来源、演进与协作**：[来源矩阵与扩源分层](docs/research/data-sources.md) · [演进边界与外挂隔离](docs/plans/source-expansion.md) · [AGENTS.md](AGENTS.md)
