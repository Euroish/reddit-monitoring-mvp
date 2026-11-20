# Signal Studio — 多源信息流与选择性可视化工作台

单机高密度多源信息流、可控数据可视化与个人/Agent 知识库（`Fastify 5 + TypeBox + PostgreSQL 16 + React 19`）。

- **`[LIVE]`（`main` 单主干）**：`23` 张 PG16 核心表（`001..052`，含凭证加密库与 Free/Pro 动态配额）、开放式匿名阅读故事流、防刷屏 7d 分页与精简 Siftline 前端（首页原生 SVG 零重包 + 分析页 `React.lazy` `echarts/core`）；支持动态 SSRF 校验 HTTPS 订阅、`web_list`/`json_list`、OPML/JSON 批量导入与双字词 GIN 检索。
- **`[V2]`（未上线规划，见 [status.md](docs/status.md)）**：阅读状态与 `为你` RRF、持久化事件归属（须协调 `<= 24` 表预算）、L3 实时推流、Readability 正文提取与按需 AI 摘要。

## 本地门禁、协作准则与文档校验

需要 **Node 24+** 与 **PostgreSQL 16**；团队单主干分支治理与 AI 协作准则、多阶段构建（`--target runtime` / `--target proxy`）与备份恢复见 [开发与运维手册](docs/development.md#0-团队分支治理与-ai-协作准则)。

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run docs:check && npm run lint && npm run typecheck && npm run test:unit
```

> 私有凭证仅存仓外文件（如 `/etc/reddit-monitoring/unified.env`）；`git push` 不触发自动部署。

## 规范与真源索引

- **唯一真源**：[当前状态与 V2 路线](docs/status.md) · [开发与运维手册](docs/development.md)
- **标准规范**：[产品口径](docs/README.md) · [主线架构](docs/architecture.md) · [数据与 API 契约](docs/contracts.md) · [前端与融合规范](docs/design.md)
- **来源与隔离**：[来源矩阵](docs/research/data-sources.md) · [演进边界与外挂隔离](docs/plans/source-expansion.md) · [AGENTS.md](AGENTS.md)
