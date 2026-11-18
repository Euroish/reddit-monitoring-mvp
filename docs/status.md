# 当前状态与下一阶段规划（唯一状态与规划真源）

> **核对日期**：`2026-11-18`。第 0 节记录 `r1-content-batch` 的实现与验收。第 1–2 节保留旧 `main` 和双分支审计基线，第 3 节记录合并与交付条件。远端 `main@dac7ab7` 仍是 `0.9.1 / node:http`，迁移至 `040`。

---

## 0. 当前重整分支执行记录

`r1-content-batch` 通过 `11e7864` 引入 `main@dac7ab7`。当前交付范围为开发分支。

唯一迁移链为原样保留的 `001..040`（含历史重复前缀的两个 018、两个 020）→ `041_content_batch.sql` → `042_monitor_projects.sql` → `043_kernel_cutover.sql` → `044_stage_one_safety.sql` → `045_web_sources.sql`，共 47 个 SQL 文件。另一开发分支的同号迁移不得组合应用；其隔离开发库应备份并重建，禁止改 ledger。041–043 已有隔离库校验和也保持不变；044 在同一迁移事务中恢复旧搜索投影兼容列、补齐项目字段、Run ID 和采集幂等唯一索引，将后续删除留到稳定版本。043 对未决旧付费任务的切换阻断继续保留，必须核查回执后迁移。

Stage 0/1 已交付单 Fastify 入口、编译迁移、付费 Run 的持久化恢复、幂等采集与混合入库、Keyset 检索及流式下载。Stage 1 的 Caddy 双 IP 限流、HTTP 断流清理和停机恢复证据在 `output/validation/stage-one/`。既有云端 [Core verification #62](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/44029823730) 对应提交 `46a37d8`。

### 本轮 R1–R3 进度

当前实现已在隔离环境通过 13 项单测、17 项 PG16/HTTP 验证和 1 条编译态 Chromium 主流程。Node 24 Compose 从空库应用 47 个迁移并通过 HTTPS readiness。本地生产依赖审计与发布包校验通过。

| 范围 | 实现与验收 | 待验收或交付 |
| --- | --- | --- |
| R1 尾项与 X 主源 | 设置页从共享契约读取六种 scope，浏览器实际创建 `read` + `export` Key 并用它检索。真实 kaix 任务持久化 Run 后收到 SIGTERM，退出码 0，重启复用同一 Run，队列只记一次收费启动，唯一写入并检索回 2 条主帖。TwitterAPIs 通过来源、预算、单页任务及同一写入内核，以 1 次真实搜索写入并检索回 20 条。 | kaix 此次开启评论采集，实际样本为 0 条评论。TwitterAPIs 真实验收覆盖搜索，账号时间线未做付费验收。自动排期和多页推进留待后续。 |
| R2 核心研究流 | 项目创建、编辑、删除、来源交集及 revision；浏览器钻取项目内容，根帖归组和缺失上下文提示；`discussion` / `pain`，手选最多 30 个 Reddit 根帖水合，三视图评论树，保存查询、批注和流式下载。推流样本默认从项目统计排除，仍可在项目内容中阅读。 | PostgreSQL 16 通过 kaix 协议夹具验收水合排队、top 参数、入库和水位保持。真实水合与项目对比待验收。 |
| 备源、资讯与 R3 | 可显式配置并选用 red_crawler / ScrapeBadger 备源，ScrapeBadger 备源与批量 ID 刷新通过协议夹具及 PG16 队列验证，任务记录 `X-Credits-Used`。NewsNow 的 Hacker News 榜与白名单 RSS 源经真实任务入库并分别检索回 20 条、10 条。PG16 隔离库备份修复扩展漏打包，恢复后 47 张表的行数与 47 条迁移校验和均一致。CI 锁定 Action SHA，并增加 gitleaks、生产依赖审计和标签触发的 GHCR App / Caddy 镜像发布链。 | ScrapeBadger 缺实测凭据，red_crawler 未发真实收费任务。旧冻结导出仍需原 owner 交付和对账后再做向前删除。GHCR 发布、生产恢复演练和公网切流待授权。 |

本分支账户及个人研究接口继续使用 `/v1/access/keys`、`/v1/workspace/*`，路由统一命名见第 3 节。脱敏验收摘要、本地检查日志与隔离库备份位于忽略目录 `output/validation/next-stage/`。真实采集只对隔离库开放。未启动自动水合或 R4。

---

## 1. `main` 实码现状与验证证据

### 1.1 `main` 与目标架构的核心差距

| 领域范围 | `main@0.9.1` 真实代码现状 | 目标规范待重建 / 待实删项 |
| :--- | :--- | :--- |
| **API / Web 框架** | 手写 `node:http`（`create-api-server.ts` 3,606 LOC + `readyz-observability.ts` 793 LOC）；React 含旧 Phase1/Markets/TargetDetail 等 21 页 | 未合入 Fastify 5 + TypeBox 五模块、`/v1/capabilities` + `/v1/openapi.json`、机器 API Key、`monitor_project*` 两新表与五导航干净工作台 |
| **存储与仓储层** | PG 迁移止于 `040`（`src/storage/schema/030_source_lifecycle.sql` 已包含 `parent_job_id`）、30 个 PG 仓储、27 个单实现接口、14 个 `InMemory*`（106 KB） | 热路径仍扫 `coverage COUNT`；`038` 失效触发器未撤；`commitPage` 逐条 SQL；`listContent` 用 `first_seen_at` 补空；缺 `content_evidence_key` / `content_version_fetched_at` |
| **Reddit (`kaix`)** | 已有跨区搜索与贴评抓取（build `0.2.25`），已去开发期 `$0.01`/45s/512MiB 硬覆写 | 仍依赖 `ARCTIC_SHIFT_CAPABILITY.metrics`、锁死 `includeComments=false`、100 条、`mode="post"` 丢主帖、`literal()` 误杀、阻塞 60s 丢 `runId` 及锁死 `item.kind === source.contentKind` |
| **X / 资讯 / 退役源** | `Arctic Shift` 与 `TwitterAPI.io` 代码仍在；`Bluesky` 小样本已有；`defaultProviderBudget` 仍含 `"arctic_shift"` | `TwitterAPIs`、`ScrapeBadger`、`red_crawler`、`NewsNow`、白名单 `feed` 尚未在 `main` 落地；旧双源待删与软归档 |
| **检索、导出与部署** | 旧配列导出上限 2,000、`research_export` RR 冻结（2 万 / 32 MiB）、`deploy/` 为 `systemd` + Nginx 模板 | 缺 `search_text` 单列、三段词、`REPEATABLE READ` + `QueryStream` 流式下载与 `caddy / app / postgres:16` Compose 三服务文件 |

### 1.2 已核验的外部连通性与既有测试范围（区分已测与未测）

- **2026-11-16 授权连通实测**：用户授权直连（报告留存仓外/`output/`，不进 Git）证明 `kaix`（1 run 取 20 帖）与 `TwitterAPIs`（HTTP 200 取 20 推文）可用；同步证实 `Arctic Shift` 大版块搜索 `422 Timeout` / 树接口 `x-ratelimit-reset: 51` 限流且 Reddit 匿名请求返回 `HTTP 403`。另核对 `kaix` `$0.02/1k`、`red_crawler` 作者费 `FREE`、`TwitterAPI.io` `/pricing.json` 固定 `$0.15/1k`、`ScrapeBadger` OpenAPI 与 `X-Credits-Used`。**上述连通探针不等于长期生产 SLA、完整账单预算或全模块集成通过**。
- **旧 main 内测**：`cf05c12`、`3551900`、`93ca276` 等快照及 11-13 内测均属于 `0.9.1`，用于当时的内部验收。现分支 PG16 与浏览器证据见第 0 节。

---

## 2. 双开发分支客观实测对照（待下一轮决策如何融合）

当前远端并存两条未合入开发分支，二者与 `main` 均存在分叉且共享路径、同名迁移（`041_*`、`042_monitor_projects.sql`）互不兼容，**绝不允许直接对两支执行盲目 `git merge` 或相加测试通过数**。以下全为基于源码、工作树实码、`code_map`、`arch_audit` 的直接观测事实：

### 2.1 量化对照矩阵

| 对比维度 | Branch A：`origin/r1-content-batch@353fd9b` | Branch B：`origin/feat/r1-core-and-r2-wip@3e77a3e` |
| :--- | :--- | :--- |
| **分叉基线** | `004e819` 之上已并入 `74717a8` | 分叉自落后提交 `f580d60` |
| **代码体量与拓扑（`arch_audit`）** | **128 文件**；生产 **5,469 LOC / 41 文件**、测试 **2,012 LOC / 11 文件**（比值 `0.37:1`）；**0 SCC 循环依赖、0 分层违规** | **610 文件**；生产 **55,180 LOC / 355 文件**、测试 **23,808 LOC / 155 文件**（比值 `0.43:1`）；保留 `create-api-server.ts`（3,437 LOC）、`postgres-repository-bundle.ts`（`Ce=49`）、27 处 `InMemory*` 引用及 1 个边界外 Python 桥脚本 |
| **已实现重心** | **先完成 R3 物理实删 + 重建 R1 核心骨架**：单 Fastify 5 入口、5 模块、五导航薄 Web、4x `UNNEST` `commitContentBatch`、`POST /ingest`、Keyset 翻页与 `QueryStream` | **未删旧基线 + 写入较多 R1/R2 业务**：并存 `v2-server.ts`、保留双跑、写入 `monitor_project*`、评论树、5 个新来源适配器原型与 R2 前端/E2E 用例 |
| **本支自报检验局限** | 本机通过离线+部分 PG16/HTTP/浏览器冒烟，但缺 Compose、缺 X/资讯新源、且**下列 6 类运行时问题在单测下漏网** | R2 后未复跑全量测试；前端仍残调旧 `/v1/content/workbench` 与 `/auth/sessions`；新渠道核心代码多依赖 Mock 或幻觉端点 |

### 2.2 Branch A（`353fd9b`）实证阻断清单（不可直接合入 `main` 也不应未经修复上线）

1. **编译态迁移静默归零（`A-1`）**：`package.json` `db:migrate:compiled` 执行 `dist/src/storage/schema/run-migrations.js`，但 `build:api` 未复制 `*.sql` 文件至 `dist/`，造成上线后找到 0 个 SQL 却以退出码 0 静默成功；`build:api` 含单引号 `node -e` 在 Windows 失败；迁移复用带 `10s` `statement_timeout` 的连接池，建大索引会超时中断。
2. **滚动停机误锁活跃来源（`A-2`）**：`collection/worker.ts` 收到 `SIGTERM` 产生的 `AbortError` 后，把在跑 `kaix` `running`/`reading` 任务直接判成 `failed` 并设 `automatic_collection_blocked=TRUE`，且缺 `/v1/source-jobs/:id/{retry,cancel,continue}` 与 `/unblock` 接口；`POST /collect` 忽视 `Idempotency-Key`（双击重放重复扣费）；`kaix` 搜帖触 `maxItems` 截断仍前推 `incremental_to`。
3. **反代限流塌缩与 TypeBox 严格边界缺失（`A-3`）**：`app.ts` 硬编码 `trustProxy: false`（部署 Caddy 后所有公网请求共用代理内网 IP 触发全站限流封锁）；`server.ts` 绑回环地址且无 `Dockerfile`/Compose；`Type.Composite` 剥离 `additionalProperties: false` 放行多余非法字段；`scopes` 仍用 `content:read`/`collection:run` 未对齐 `SEC-01` 且允许 `ingest` 传空 `allowedSourceIds: []`；`HEAD` 误映写权限返 `403`、Swagger 缺 `operationId`、`/readyz` 在鉴权之后、PG `55P03`/`53300` 未映射为 `503`。
4. **混合入库内核二次覆盖与伪更新计数（`A-4`）**：`prepareContentBatch` 第二轮循环覆写第一轮 `mergeSameVersion` 的缺失字段拼合结果且丢弃较晚 `fetchedAt`；`commitContentBatch` 接受客户端传入 `id` 易撞 `23505` 主键、`observations` 未确定排序有死锁风险、`ON CONFLICT DO UPDATE` 无 `IS DISTINCT FROM` 判断导致零变更重放也算进 `updated` 并重写搜索表、`permalink` 误取 `v->>'url'`。
5. **流式导出缺信号量、上限与 `ROLLBACK` 误调（`A-5`）**：虽用了 `QueryStream` 与 `REPEATABLE READ`，但缺 `concurrency=1` 信号量与 `maxRows=50,000` 上限、`COMMIT` 后未设 `released=true` 导致 `finally` 多发一次 `ROLLBACK`、缺少 JSON `complete:true` 结束帧、30s 定时器缺 `.unref()`、前端仍用 `<a href>` 绕过交互提示。
6. **未上线切分迁移提前 `DROP` 旧列与前端缺陷（`A-6`）**：`043_kernel_cutover.sql` 立即删 `normalized_title`/`normalized_text` 且遇活跃任务即中止（缺乏 Expand-Migrate-Contract 回退余地）；`042` 与目标项目字段不对齐；前端存在不受控 `<select defaultValue>` 覆写 `sourceId`、`key` 变化清空草稿并提交 `revision: 0`、使用 `window.prompt`、`Workspace.tsx` 错传数组对象、`--muted: #7a827b` 未过 WCAG AA（~3.86:1）及单测残留 `output/validation/` 临时目录。

> 补充复核上一轮 `bb4d2271` 审计报告中的两处勘误：（1）切勿按其草稿在 `043` 添加 `parent_job_id`，因 `030_source_lifecycle.sql:14` 已建该列（会报 `SQLSTATE 42701`）；（2）Branch A 的 `access/sql.ts:60` 已生成正确的 43 字符 base64url Session/API Key，`app.ts:61` 的 64 位十六进制串是 HMAC Cookie 签名后缀而非错误 Token。

### 2.3 Branch B（`3e77a3e`）核查发现与“洁净重写参考清单”

- **为什么不可直接合并或 Cherry-pick B**：保留了旧 `create-api-server.ts` 默认启动与双服务；`041` 缺少 `content_evidence_key COLLATE "C"`；`content/sql.ts`（1,292 LOC 上帝文件）使用残缺的 2 元版本对比元组并吞掉观测冲突；`projects/sql.ts` 允许请求参数覆写项目原 `filter` 并越权读取项目外来源；`search.ts` 退回不可走 GIN 的 `strpos()`；`TwitterAPIs` / `ScrapeBadger` 对收费请求启用了 `automaticRequestReplay: true` 并写错多处端点/响应字段；`red_crawler` 调用不存在的同步 `red_crawler~reddit`；`newsnow` 缺 `hackernews` 与 `snapshotBucket`；`feed` 用正则拆 XML 且未封堵 DNS 重绑定（`::ffff:7f00:1`、跳转重绑定）；`workspace` 放行了机器 Key。
- **B 中唯一具有实质复用价值、建议按重写契约移植的 6 项资产**：
  1. `ThreadTreeDrawer.tsx`（32 跳环检测与 `contextMissing` 展示骨架）、`AccessTokenPanel.tsx`（一次性密钥显示交互）及 `Projects.tsx` 推送隔离切换 UI；
  2. `v2-core-e2e-postgres.test.ts`、`r2-projects-thread-postgres.test.ts`（修正其中 `total=3 -> 2` 错漏）与 `smoke-r2-ui.ts` 测试场景思路；
  3. `readBoundedText` 16 MiB 流式限读器；
  4. `assertSafePublicUrl` 思路（移植时必须补齐完整 IPv4/IPv6 保留网段 + `undici` IP 绑定 `lookup` + `redirect: 'error'`）；
  5. `canonicalWebIdentityNamespace` 计算逻辑；
  6. `kaix` 三阶段异步 Run/Dataset/Items 分离方法模板。

---

## 3. 收敛前置条件与分阶段验收目标

当前分支已统一入口与迁移链。合入前剩余工作如下：

1. 在授权预算及凭据下验收真实评论样本、付费水合与两条备源，补齐项目对比、契约中的过滤字段与标准路由命名。
2. 按原 owner 完成旧冻结导出的交付与对账，然后以新增迁移退役旧表。兼容列在稳定发布后收缩，保留已应用迁移的校验和。
3. 核对待合并提交的 CI，完成发布镜像验收、生产恢复演练与切流审批。

仅在线上观测 14–30 天后评估阈值驱动的演进。10 万行以上导出导致 `pg.Pool` 队列 P95 超过 500ms 时评估独立导出读池或 worker。手工水合超过 80% 呈稳定规律时评估有上限的自动水合。R4 历史大档推流保持外挂路径。

### 目标 CI/CD 收敛标准（对标 `actualbudget` / `umami` / `fastify/demo`）

- **Fast Gate**：全部 GitHub Actions 锁 **40 位 Commit SHA** 与 `npm ci --ignore-scripts`；运行 `docs:check`（含 `041+` 迁移号检查）、`lint`、全仓 `typecheck`、确认 `dist/**/*.sql` 存在与离线单测，并同步运行 `gitleaks` 与生产依赖 `npm audit`。
- **Compiled + PG16 E2E Gate**：使用 `postgres:16-alpine` 服务容器，先执行 `npm run build` + `npm run db:migrate:compiled` 并启动编译后 `dist/apps/api/src/server.js`，执行核心 PG16/HTTP 契约测试与 1 条主流程 Playwright 浏览器冒烟（不再双跑 `InMemory`）。
- **单机镜像构建**：打 tag 构建同一多阶段 `Dockerfile` 推 GHCR（开启 GHA layer cache），VPS 通过 `docker compose pull && docker compose up -d` 升级，`app` 强制 `${SESSION_SECRET:?required}`、`init: true`、`stop_grace_period: 20s`，`db` 永不对外映射端口。
