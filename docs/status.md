# 主干交付状态、生产基线与演进路线

本页是仓库唯一维护实时工程进度的页面，严格区分**线上生产运行态**、**`origin/main` 主干代码**与**未合入的 Backend V2 分支（PR #32）**，绝不把未部署代码写成线上事实。

---

## 1. 三层实时基线对照

| 层级 | 提交 / 版本 | 状态摘要与实测证据 |
| :--- | :--- | :--- |
| **线上生产环境**<br>（2026-11-22 抽样，未改动） | `f3bcc1b` (`monitoring-unified:f3bcc1b3f402` / `...-web:f3bcc1b3f402`) | 5 个健康容器运行中（`proxy` / `app` / `db` / `apify-relay` / `apify-secure-gateway`）。PG16 已应用至 `058`（46 表，~51 MiB）；库内为 V2 清洗前构成：101 活跃源（95 `feed`、4 `newsnow`、1 `kaix`、1 `external_ingest`；3,492 篇 Web、10 条 Reddit 帖、5 条评论、5 条 X 帖），90 条 AI 发布事件可查（`AI_SYNC_ENABLED=false`）。 |
| **`origin/main` 主干**<br>（PR #31 已合入，待上线） | `4b05369` | 完成 7 域严格无环 DAG 重构、`check-table-ownership` 单写归属守卫、全路由声明式 `config.auth` 与 PG16 `LISTEN/NOTIFY` 运行时优化；迁移至 `058`（46 表）。 |
| **Backend V2 开发分支**<br>（PR #32 · **待审查**） | `feat/backend-v2-feed-intelligence` | 已落地迁移 `059–062`（9 域 55 表）、Reddit/X 连接器富化（媒体/域名/粉丝画像/Top 排序）、`content` 标量物化与 `heuristic_v1`、`feed`（6 操作）+ `intelligence`（13 操作）BFF、`DELETE /v1/sources/:id`；`115` OpenAPI 路径 / `131` 操作、全套单测与隔离 PG16 15 套集成测试通过；接口收口见第 2 节。 |

---

## 2. PR #32 后端收口交付

- **热榜**采用 48 小时内的真实互动快照，并按近似标题和外链聚簇计算候选集中的独立信源数。
- **Feed 事件**通过迁移 `062`、唯一索引和事务内实际入库结果实现收藏、有用反馈的幂等。
- **情报指标**将评论、转发、收藏纳入 KOL 互动率，并将获正向评分的评论外链纳入 GEO 域名榜。
- **社区监测**自动为评论量超过本社区近 7 天 P80 的主帖安排 Top 评论补采，使用队列防重和预算门控。
- **部署后运营**由维护者精选补充 HN、Lobsters、GitHub Trending、HF Papers 与目标 Subreddit/KOL。

> **仓库在途 PR 清单**：PR #32（`feat/backend-v2-feed-intelligence`，待审查）与 PR #30（`codex/source-operations-ux`，Draft）。

---

## 3. 下一阶段推进顺序

1. **审查 PR #32**：`CI Gate` 与代码审查通过后 Squash 合入 `main`。
2. **生产库备份与安全升级**：在 `agy-server` 执行 `db:backup` 与隔离恢复验证，构建 `runtime` + `proxy` 镜像升级线上容器（安全应用 `059–062`）。
3. **精选高讨论 L1/L2 信源与压测验证**：启用高讨论社区源与重点监控器，核验单机 4 GB / 60 GB 资源水位与 <15 ms 仪表盘聚合响应。
4. **启动 Frontend V2 全面重做**：在稳定冻结的 `/v1/feed/*` 与 `/v1/intelligence/*` 契约上重构全新现代 UI/UX。
