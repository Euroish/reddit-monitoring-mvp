# Signal Studio — 多源信息流与选择性可视化工作台

单机高密度多源信息流、可控数据可视化与个人/Agent 知识库（`Fastify 5 + TypeBox + PostgreSQL 16 + React 19`）。

- **`[LIVE]`（`prod@8e436ac`）**：20 张 PG16 核心表、`42` 个后端核心 TS 文件、`43` 个 HTTP 路径（`50` 条 OpenAPI 操作）、`100` 个活跃排期源（`97` `feed` + `3` `newsnow`，8 大 `source_group`）；支持动态 SSRF 校验 HTTPS 订阅、`web_list`/`json_list`、OPML/JSON 批量导入、`GET /v1/content/stories` 事件聚簇与双字词 GIN 检索。
- **`[V2]`（未上线规划，见 [status.md](docs/status.md)）**：前端融合（卡片内嵌 SVG 微图 + 懒加载分析图）、阅读状态与 `为你` RRF、持久化事件归属、L3 实时推流、Readability 正文提取与按需 AI 摘要。

## 本地门禁与文档校验

需要 **Node 24+** 与 **PostgreSQL 16**；运维、多阶段构建（`--target runtime` / `--target proxy`）与备份恢复见 [开发与运维手册](docs/development.md)。

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run docs:check && npm run lint && npm run typecheck && npm run test:unit
```

> 私有凭证仅存仓外文件（如 `/etc/reddit-monitoring/unified.env`）；`git push` 不触发自动部署。

## 规范与真源索引

- **唯一真源**：[当前状态与 V2 路线](docs/status.md) · [开发与运维手册](docs/development.md)
- **标准规范**：[产品口径](docs/README.md) · [主线架构](docs/architecture.md) · [数据与 API 契约](docs/contracts.md) · [前端与融合规范](docs/design.md)
- **来源与隔离**：[来源矩阵](docs/research/data-sources.md) · [演进边界与外挂隔离](docs/plans/source-expansion.md) · [AGENTS.md](AGENTS.md)
