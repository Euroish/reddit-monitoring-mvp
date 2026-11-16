# 当前实现与证据状态

核对日期：`2026-11-16`。源码实际行为基于代码基线 `main@93ca276`；本轮恢复并统一全套 14 份正式产品、架构、契约、交互、重建计划与来源规格文档，未改动生产部署，也未新发起收费采集。目标设计与架构均**尚未实施**，以本文件记录的实码事实为准。

## 1. 实码事实与缺口盘点

| 领域范围 | 当前源码已有实现（`0.9.1`） | 目标规范待重构 / 实删缺口 |
| :--- | :--- | :--- |
| **API / Web 框架** | 手写 `node:http`（`create-api-server.ts` 3,606 行 + `readyz-observability.ts` 793 行）、React/Vite 旧页面（含 Phase1/Markets/TargetDetail 等 21 页） | 未建 Fastify 5 + TypeBox 五模块（`access`/`collection`/`content`/`projects`/`workspace`）、OpenAPI/`capabilities`、机器 API Key、`monitor_project*` 两新表与五导航干净工作台；旧入口与 `ResearchExport` UI 待 R3 实删 |
| **存储与仓储层** | PostgreSQL（42 项迁移，末号 `040`）、30 个 PG 仓储、27 个单实现 `Repository` 接口、14 个 `InMemory*Repository`（2,185 行 / 106 KB） | 列表热路径仍跑全库 `coverage COUNT`；`038` 失效触发器仍在；`contentWorkbench` 反复全表 `contentStats`；`listAnnotations` `1+N`；`commitPage` 逐条 4 SQL/项；`listContent` 用 `first_seen_at` 补空排序；未加 `content_evidence_key`/`content_version_fetched_at` |
| **Reddit (`kaix`)** | 跨社区 search、社区/账号/帖子评论、build `0.2.25`、未知收费结果停重放；已解除 `$0.01` 事件帽、45s 超时、512MiB 内存与禁代理限制 | 仍导入 `ARCTIC_SHIFT_CAPABILITY.metrics`；锁死 `includeComments=false`、1–100 条、`mode="post"` 丢主帖、`literal()` 误杀布尔式；同步 `waitForFinish=60` 遇到 `RUNNING` 直接报错且未持久化 `runId`/`datasetId`；落库锁死 `item.kind === source.contentKind` |
| **Reddit / X 新与旧渠道** | `Arctic Shift` 在线代码仍在；`TwitterAPI.io` 在线代码仍在；`Bluesky` AppView 有两页小样本闭环；`defaultProviderBudget` 仍含 `arctic_shift` 免费回退 | `TwitterAPIs`、`ScrapeBadger`、`red_crawler`、`NewsNow`、通用 `feed` **均未编写代码**；`Arctic Shift` 与 `TwitterAPI.io` 按 R1–R3 解耦实删与软归档 |
| **检索、漏斗与导出** | 已有单平台指标过滤、数组导出（上限 2,000）与 `research_export` RR 冻结（2 万行 / 32 MiB） | 三段词组 `anyTerms/allTerms/exclusions`、确定性信号、联动 `threadAware`、三视图评论树、单列 `search_text`、`REPEATABLE READ` + `SET LOCAL 35s` 游标流式导出均未落地；冻结资产待 R3 迁出后实删 |
| **推流与外挂边界** | 已在 `scripts/release-package-lib.mjs`、`.ts` lint 与单测完成核心隔离规则 | `POST /v1/sources/:id/ingest` 标准推流未实现；R4 `plugins/zst-archive/` 未开始且不阻塞 R1–R3 |
| **运维与部署** | `deploy/` 下 `systemd` + Nginx 模板，备份/恢复/发布包脚本 | 无 Docker Compose（`proxy`/`app`/`db`）文件，无进程内并发 2 调度器与 15s 优雅退出 |

`main` 已合入 E0 详情 SQL 优化、Bluesky/`040`、`kaix` 去硬覆盖、静态资源与初始会话竞态修复，重建时禁止从过时分支重引旧代码；现存依赖中 `opossum` 与 `rate-limiter-flexible` 将随旧代码实删一并清理。

## 2. 分层验证与公开资料核对证据

| 证据来源 | 可支持的结论 | 明确不能推出的结论 |
| :--- | :--- | :--- |
| **2026-11-16 文档系统补全与交叉核对** | 统一 `a078c9c` 代码尸检、7 项漂移修正、`fefdb8c`/`8ba0d65`/`90dbe9a`/`93ca276` 最新三阶漏斗与源选型定案（`TwitterAPIs`+`ScrapeBadger`、`kaix`+`red_crawler`），恢复全部 14 份权威文档并保证全仓规则 ID 零冲突、链接锚点与 `src/modules/` AST 检查对齐 | 不代表 Fastify/五模块/新连接器/迁移已编码或运行 |
| **2026-11-16 公开页与实测连通性** | 核验 `kaix` build `0.2.25`、`red_crawler` FREE 计费、TwitterAPI.io `/pricing.json` 超限、TwitterAPIs `$0.0008/call` 及 ScrapeBadger OpenAPI 字段与 `X-Credits-Used`；用户授权直连 OpenAI 词搜索实测：`kaix` 成功 1 run 采 20 帖，`TwitterAPIs` HTTP 200 采 20 推文（报告留于 `output/` 未进 Git）；实测 `Arctic Shift` 在线 `422/10s` 超时限流及匿名 Reddit `403` | 不代表固定长期成功率、完整账单预算或新 adapter 闭环已通过 |
| **历史本机与云 CI 检查** | `93ca276` 文档阶段 `npm run lint` / `typecheck` / 发布与策略单测 9/9 通过；历史快照 `cf05c12`（531 离线 / 43 PG14 SQL + 账户/内容/研究浏览器通过）、`413bb75`（530 离线 + kaix 长 ID 重放）、`3551900` [CI 43358775922](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/43358775922)、E0 1,029 条暖缓存详情 SQL 23→4（P95 179→51ms）、`c805ca1` 逐条写入约 128 条/秒、E1 Bluesky 两页 6 条小样本 | 均属于旧代码基线快照证据，不代替新主线实测与百万级容量验收 |

本机开发状态备忘：用户已在仓库外 `credentials.env`（`chmod 600`）填入 `APIFY_API_TOKEN` 与 `TWITTERAPIS_API_KEY`，并对本机旧库 `kaix` 配额做过开发期放宽；新环境仍受迁移默认关闭保护。

## 3. 既有线上环境部署备忘（历史记录，未重探）

保留原工作区记录（本轮未登录或重启远端服务）：
- `11-13` 本机 HTTP/IP 验收服务运行在 `main@3551900` 干净构建（`/opt/reddit-monitoring-releases/main-3551900-20261113T073415Z`，配置位于 `/etc/reddit-monitoring/`），42 项迁移 checksum 一致，`SOURCE_NETWORK_ENABLED=false`、`Apify` 未启用、`public-tunnel`/`desktop`/`chrome`/`bridge` 保持 `inactive`。仅 Git 推送**绝不会**触发服务自动更新或重启。

## 4. 下一步实施队列（以[R1–R4 重建计划](plans/source-expansion.md)为准）

1. **R1（待启动）**：搭建 Fastify 5 + TypeBox 五模块内核与安全限流边界、`041` 核心迁移与旧来源安全退役、`commitContentBatch` 混合批 4 组 `UNNEST`、`kaix` 4 项解封与异步 `runId` 恢复、`POST /v1/sources/:id/ingest`、NULL 双分支分页、`REPEATABLE READ` + `SET LOCAL 35s` 游标导出与 `x-content-pipeline.test.ts` 迁移，同步打通薄 Web 闭环。
2. **R2（待开始）**：`042` 建 `monitor_project*` 两张表，落地三段词组、信号门控、`GROUPING SETS`、三视图评论树、Agent `/v1/capabilities` + `/v1/openapi.json`、接通 `red_crawler` / `TwitterAPIs` / `ScrapeBadger` / `NewsNow` / `feed` 与五导航干净 UI。
3. **R3（待开始）**：迁出并交付旧个人研究与冻结资产，物理实删仓储双轨/旧 runtime/旧前端与遗留驱动，完成真实负载与恢复演练，Docker Compose 维护窗口上线。
4. **R4（后续独立研究）**：在线主线稳定后，按需单独验证并开发 `plugins/zst-archive/`。
