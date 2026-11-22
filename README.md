# SIFTLINE — 社媒情报分析与高质量信息流

面向研究者、产品团队与个人的多源数据工作台。围绕社媒社区、品牌与话题做可追溯分析，同时提供高质量信源聚合、个性化阅读和订阅推送。技术基线为 `Fastify 5 + TypeBox + PostgreSQL 16 + React 19`。

- **社媒情报与分析**。采集帖子、评论与指标观测，以检索、专题、时间趋势、平台分布和讨论树连接判断与证据。交互借鉴 Ahrefs/Semrush 的研究工作流，度量围绕已采集社媒样本与内容表现。
- **高质量信息流与分发**。以一手信源、跨源去重、事件排序与日报降低信息噪声，逐步加入显式兴趣、反馈驱动推荐和可控订阅推送。
- **`[LIVE]` 主干实现**。`main` 已实现凭证加密库、动态配额、文档中心、AI 发布情报中心和账号安全功能。迁移水位与表数见[当前状态](docs/status.md)。已实现混合采集、受限 Sidecar 入库、GIN 检索、专题趋势、讨论树、观测曲线、事件信息流和日报。代码合入与生产部署分别核验。
- **`[V2]` 规划**。可复现的跨专题对比、覆盖质量视图、阅读反馈、个性化排序、订阅投递，以及按需正文提取与 AI 辅助研究。验收边界见 [产品规范](docs/README.md) 和 [当前状态](docs/status.md)。

## 开发与验证

需要 Node 24+ 与 PostgreSQL 16。协作、构建、备份及部署记录见 [开发与运维手册](docs/development.md)。

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run docs:check && npm run lint && npm run typecheck && npm run test:unit
```

私有凭证存于仓外配置，`git push` 不触发自动部署。生产版本、迁移水位和已启用渠道以部署记录与运行库为准。

## 文档入口

- [产品边界与指标口径](docs/README.md) · [研究依据与交付验收](docs/research/product-strategy.md)
- [当前实现与路线](docs/status.md) · [架构与容量](docs/architecture.md) · [数据与 API 契约](docs/contracts.md)
- [交互与分析设计](docs/design.md) · [来源矩阵](docs/research/data-sources.md) · [扩源与外挂隔离](docs/plans/source-expansion.md)
- [开发与运维手册](docs/development.md) · [Agent 协作入口](AGENTS.md)
