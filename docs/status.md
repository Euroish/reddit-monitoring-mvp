# 主干交付状态、生产基线与演进路线

本页是仓库唯一维护实时工程进度的页面，严格区分**线上生产运行态**、**`origin/main` 主干代码**与**未合入的 Backend V2 分支（PR #32）**，绝不把未部署代码写成线上事实。

---

## 1. 三层实时基线对照

| 层级 | 提交 / 版本 | 状态摘要与实测证据 |
| :--- | :--- | :--- |
| **线上生产环境**<br>（2026-11-22 抽样，未改动） | `f3bcc1b` (`monitoring-unified:f3bcc1b3f402` / `...-web:f3bcc1b3f402`) | 5 个健康容器运行中（`proxy` / `app` / `db` / `apify-relay` / `apify-secure-gateway`）。PG16 已应用至 `058`（46 表，~51 MiB）；库内为 V2 清洗前构成：101 活跃源（95 `feed`、4 `newsnow`、1 `kaix`、1 `external_ingest`；3,492 篇 Web、10 条 Reddit 帖、5 条评论、5 条 X 帖），90 条 AI 发布事件可查（`AI_SYNC_ENABLED=false`）。 |
| **`origin/main` 主干**<br>（PR #31 已合入，待上线） | `4b05369` | 完成 7 域严格无环 DAG 重构、`check-table-ownership` 单写归属守卫、全路由声明式 `config.auth` 与 PG16 `LISTEN/NOTIFY` 运行时优化；迁移至 `058`（46 表）。 |
| **Backend V2 开发分支**<br>（PR #32 · **Draft 未完成态**） | `feat/backend-v2-feed-intelligence` | 已落地迁移 `059–061`（9 域 55 表）、Reddit/X 连接器富化（媒体/域名/粉丝画像/Top 排序）、`content` 标量物化与 `heuristic_v1`、`feed`（6 操作）+ `intelligence`（13 操作）BFF、`DELETE /v1/sources/:id`；`115` OpenAPI 路径 / `131` 操作、全套单测与隔离 PG16 15 套集成测试通过；正按下方第 2 节清单逐项收口。 |

---

## 2. Draft PR #32 待收口缺口（Merge / Un-draft 前核对）

为保证与[核心度量诚实性](README.md#3-度量诚实性与工程规则docscheck-受控-id)及 [Backend V2 蓝图](plans/backend-v2-blueprint.md) 100% 一致，以下 5 项已核实缺口明确挂账，将在 PR #32 转为 Ready 前处理或显式裁决：

1. **热榜合成假 `sparkline`（高优先级）**：`src/modules/feed/sql.ts` 当前返回 `[heat*0.45, heat*0.72, heat*0.88, heat]` 硬编码曲线，违背零伪造指标红线；需改为基于 `content_observation` 真实时序快照计算（不足 2 点时如实返回空/现有节点）。
2. **`feed_user_event` 幂等与 KOL/GEO 指标精度（高优先级）**：
   - `feed_user_event`（迁移 `060` / `src/modules/feed/sql.ts`）需增加 `(user_id, content_id, event_type)` 去重防刷机制，避免重复上报 `bookmark`/`useful` 叠加权重；
   - `src/modules/intelligence/analytics.ts` 的 KOL 个人页 ER 需补充聚合 `comments`/`reposts`/`bookmarks`；
   - `src/modules/content/intel-queries.ts` 的 GEO 外链域名榜当前排除评论区，需区分或纳回评论区高赞引用。
3. **跨源共振度 `corroborationCount`（中优先级）**：`src/modules/content/feed-queries.ts` 当前返回字面量 `1 AS corroboration_count`，需接入 `story-groups.ts` 的 SimHash 多源聚簇计数。
4. **`community_bundle` 自动 P80 评论补采（中优先级）**：当前 Worker `onBatchCommitted` 仅刷新 `intel_rollup_bucket`，尚缺自动识别超出板块 P80 热度的主帖并按预算入队 `hydrate` 评论任务的触发器（目前仅支持手动带 `includeComments: true` 触发）。
5. **高讨论信源重建（上线后运营动作）**：`059` 归档被动新闻与 V2EX 后，待新版本部署上线再由人工精选补充 HN/Lobsters/GitHub Trending/HF Papers 与目标 Subreddit/KOL（本项有意留到部署后执行）。

> **仓库在途 PR 清单**：仅 **PR #32**（`feat/backend-v2-feed-intelligence` · Draft · Backend V2）与 **PR #30**（`codex/source-operations-ux` · Draft，按指令保留不关闭）。

---

## 3. 下一阶段推进顺序

1. **收口 PR #32 后端 V2 缺口**：补齐真实 `sparkline`、事件防重、KOL ER / GEO 引用精度与自动 P80 水合/跨源共振 -> `Squawk` + PG16 全套绿灯 -> 取消 Draft 并 Squash 合入 `main`。
2. **生产库备份与安全升级**：在 `agy-server` 执行 `db:backup` 与隔离恢复验证，构建 `runtime` + `proxy` 镜像升级线上容器（安全应用 `059–061`）。
3. **精选高讨论 L1/L2 信源与压测验证**：启用高讨论社区源与重点监控器，核验单机 4 GB / 60 GB 资源水位与 <15 ms 仪表盘聚合响应。
4. **启动 Frontend V2 全面重做**：在稳定冻结的 `/v1/feed/*` 与 `/v1/intelligence/*` 契约上重构全新现代 UI/UX。
