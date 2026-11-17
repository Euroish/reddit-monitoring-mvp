# 当前状态与下一阶段规划（唯一状态与规划真源）

> **核对日期**：`2026-11-17`（代码基线与仓库 `main` 对齐 `0.9.1 / node:http`，迁移至 `040`）。
> 本文件是全仓**唯一的真实实现现状、双开发分支核查对照与下一阶段融合规划真源**。规范文档描写的 Fastify 5、五模块、`monitor_project*`、`kaix` 异步恢复、新源适配器与 Compose **均未合入 `main`**，任何时候禁止将设计目标或分支进度冒充为 `main` 已落地能力。

---

## 0. 当前重整分支执行记录

`r1-content-batch` 已通过合并提交 `11e7864` 合入指定 `main@dac7ab7`。下文 main 与双分支审计表保留为修复前基线；本节只描述当前分支，不表示 main 已合并或已部署。

唯一迁移链为原样保留的 `001..040`（含历史重复前缀的两个 018、两个 020）→ `041_content_batch.sql` → `042_monitor_projects.sql` → `043_kernel_cutover.sql` → `044_stage_one_safety.sql`，共 46 个 SQL 文件。另一开发分支的同号迁移不得组合应用；其隔离开发库应备份并重建，禁止改 ledger。041–043 已有隔离库校验和也保持不变；044 在同一迁移事务中恢复旧搜索投影兼容列、补齐项目字段、Run ID 和采集幂等唯一索引，将后续删除留到稳定版本。043 对未决旧付费任务的切换阻断继续保留，必须核查回执后迁移。

- Stage 0：跨平台 Node 构建脚本复制全部 SQL 到 `dist/`；空 SQL 目录与新增重复编号失败；迁移独立单连接、10 分钟语句超时与 30 秒锁超时。Node 24.22.3 + 空白 `postgres:16-alpine` 已由编译产物应用 46 个迁移，证据键列排序为 `C`；编译服务器已完成 readiness、登录、鉴权读取与 SIGTERM 正常退出。
- Stage 1：已修复停机归还租约与 Run 续读、采集幂等与人工任务恢复、截断不推进水位；严格 Schema 合并、六种 scope、HEAD/readiness/PG 503 与单跳可信代理；确定性服务端内容 UUID、同版本合并、稳定锁顺序与零变更计数；导出并发 1、行数边界、JSON 终结统计与断流清理；来源选择、数组查询恢复、批注草稿/revision 与下载错误反馈。HTTP 接口仍为当前分支的 `/v1/access/keys`、`/v1/workspace/*`，统一命名和完整 R2 HTTP 表面留待 Stage 2。
- 验证证据：13 项纯函数/协议夹具、16 项真实容器 PG16/HTTP（含父测试）与 1 条编译态 Chromium 主流程均零失败、零跳过，lint/typecheck/build/发布包校验通过；报告位于被忽略的 `output/validation/stage-one/`。真实付费 kaix SIGTERM 与 TwitterAPIs 入库探针尚未执行，不以协议夹具代替供应商验收；新 X 连接器属于 Stage 2。
- Compose：已新增多阶段 `Dockerfile`、Caddy/App/PG16 三服务、强制秘密配置、私网 DB、健康依赖、init 与 20 秒停止窗口。已在全新隔离卷完成 46 个迁移、三服务健康、HTTPS Chromium 登录/五导航及 Caddy 双 IP 限流（首客户端 125 次中 5 次 429，第二客户端 200，伪造转发头不绕过）；停止耗时 3.07 秒、App 退出码 0，重启后 readiness 与 46 条 ledger 均正常。未连接旧内部测试库；已推送远端 `r1-content-batch`，未部署公网。

- 云端检查：`edcf271` 的 #60 因 Vite 彩色 URL 日志匹配失败而超时；`46a37d8` 改用真实 HTTP 就绪判断后，[Core verification #62](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/44029823730) 全部通过，包括 lint、typecheck、单测、PG/HTTP、构建、编译态启动、浏览器与发布打包。此结论仅覆盖该提交与现有检查范围。

### 当前 R1–R3 完成度与下一步

2026-11-17 重新 fetch 核对：`origin/main` 仍为 `dac7ab7`，当前分支代码基线为 `46a37d8`；分支已包含 main 全部规范，并更新了本文件、开发入口和迁移计划。其余目标架构、契约、交互与研究规范与 main 相同。当前分支第 0 节是最新执行事实，第 1–2 节继续作为旧 main / 修复前双分支的审计基线，不能混用完成度。R1–R3 是重建工作范围，Stage 0–3 是分期验收与推进顺序，二者不一一对应。

| 范围 | 当前可证实完成 | 尚未完成 / 验收缺口 |
| --- | --- | --- |
| R1 内核与运行底座 | 单 Fastify 入口、五模块、严格 HTTP Schema、混合集合写与推流幂等、Keyset 检索、导出生命周期、任务人工恢复、PG16 编译态与 Compose 验收；Stage 0 完成，Stage 1 六类核心修复已落地。 | 设置页 `Account.tsx` 仍发送旧 scope，创建机器 Key 会被新契约拒绝；真实收费 kaix 进程 SIGTERM / 重启续接及 TwitterAPIs 经任务链落库尚未验收。worker 当前只消费已有队列、每任务提交一页；自动增量排期、多页推进与实际费用核对不能记为已完成。 |
| R2 产品闭环与来源扩展 | 项目建表、创建/列表/基础概览、三段词过滤、五导航、保存查询/批注与 Key 后端基础能力。 | TwitterAPIs、ScrapeBadger、red_crawler、NewsNow、feed 均未装配；项目编辑/删除/内容钻取、`threadAware` 根帖去重、`discussion`/`pain`、显式批量 Hydrate、三视图树、对比与推流统计隔离未闭环；目标 HTTP 命名和游标 `projectRevision` 待对齐。 |
| R3 遗留实删与交付收口 | 旧 API、Repository/InMemory、旧调度运行时、Arctic Shift / TwitterAPI.io 在线连接器、旧页面和 systemd 链已从当前源码移除，新运行时独立启动。 | 历史冻结导出表仍保留；已有 `assets:export` 工具不等于真实库按 owner 导出、对账和交付已完成。资产交付后才能向前删表；旧兼容搜索列稳态后再收缩。CI 仍使用 Action 标签，尚缺 SHA 固定、gitleaks / 生产依赖审计和 GHCR 发布链。未公网部署或做生产恢复演练。 |

本次授权仅做简单真实供应商验证：使用仓外凭据，kaix 经当前编译连接器创建 **1 个 Run**，限制 2 主帖、每帖最多 2 评论，实际返回 **2 主帖 + 1 评论**，混合批准备通过，截断时 `exhausted=false`；TwitterAPIs 仅 **1 次搜索请求**，HTTP 200 返回 **20 条**字符串 ID 推文。回执、响应与脱敏摘要保存在忽略目录 `output/validation/live-source-check/`，不进入 Git。未自动重试收费请求、未写业务库、未执行进程重启试验；因此仅证明当前凭据/协议/kaix 规范化可用，不把它算作 Stage 1 全链路验收。

下一阶段按以下顺序推进，每个切片完成后复用现有 PG16/HTTP 套件和一条关键浏览器流程，不新增平行测试体系：

1. **先收 R1 尾项**：修正设置页六种 scope 与现有契约的一致性，在现有浏览器流程中补一次真正创建只读 Key 的操作；修正当前分支环境加载说明。真实 kaix 中断续接只做一次有界任务，并核对重启前后同一 Run、没有新增收费启动。
2. **打通双主源最小闭环**：重写 TwitterAPIs adapter，严格响应校验、每页最多 20 条、收费结果不明停发；接入来源、预算、队列和唯一入库内核，完成一次受控实际入库。按此补齐 Stage 1 外部验收，不重新重复全部本地基础设施测试。
3. **交付 R2 核心研究流**：项目 CRUD / 权限 / revision → 项目限定内容与根帖联动 → `discussion` / `pain` → 显式手选 Hydrate → 有界三视图树 → 保存/下载。统一过滤和授权交集、默认排除推流统计；同一条 PG16 + HTTP + Chromium 流程贯穿验收。
4. **扩展与发布收口**：先补 red_crawler / ScrapeBadger 的显式备源及批量 ID 能力，再补 NewsNow / 安全 feed；ScrapeBadger 真实验收需其凭据。独立核对旧资产、备份恢复、安全 CI 与镜像发布，完成 R3 交付门禁后再安排正式切流。Stage 3 的自动水合、重型拆分与 R4 不提前启动。

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
- **既有历史与本地检验界限**：`main` 此前快照（`cf05c12`/`3551900`/`93ca276` 等）及 `11-13 main@3551900` 内测均属于旧 `0.9.1` 基线证据，且历次服务仅作内部验收、未公开运营。**本轮本机环境为 PostgreSQL 18 且未配置 `TEST_SOURCE_DATABASE_URL`，因此本机仅可执行 `docs:check`、`lint`、`typecheck` 与离线单测，尚未在本地跑通 PG16 集成、HTTP 端到端或 Playwright 浏览器实测**。

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

无论下一步选择以哪条具体操作融合，在最终合并进 `main` 前**必须同时满足以下前置条件**：
1. 全仓仅保留唯一入口 `apps/api/src/server.ts`（`create-api-server.ts`、`InMemory*` 与 `research_export*` 全量清理且历史个人资产已完成核对交付）；
2. `041+` 迁移尚未触及生产库，须先收敛并去重 `041` / `042` 规范表结构（`COLLATE "C"`、`provider_run_id`、完整 `monitor_project*`、`from_at/to_at DROP NOT NULL`、绝不重加 `030` `parent_job_id`），并将删旧列延后至稳态后续 `043+`；
3. 必须以 **编译后 `dist/` + 真实 `postgres:16-alpine` 容器 + 真实 HTTP / 浏览器冒烟** 替代纯开发态或 Mock 绿灯。

### 分阶段实施蓝图（Stage 0 – Stage 3）

| 阶段 | 核心交付与工程动作 | 必须跑通的端到端验收证据 |
| :--- | :--- | :--- |
| **Stage 0**<br>（底座收口） | 确定主干整合分支基线；清理/重整 `041`（及延后 `043`）；修复跨平台 `build:api` 复制 `*.sql`；`run-migrations.ts` 使用独立长超时连接并在 0 个 SQL 时失败；确保 `docs:check` 全绿。 | `npm run build && npm run db:migrate:compiled` 在空白 PG16 容器至少应用 41+ 迁移，`\d content` 含 `COLLATE "C"`。 |
| **Stage 1**<br>（R1 运行与上云切片） | 修复上述 A-1 至 A-6 全部 6 组运行时问题（含 `strictMerge`、`trustProxy: 1`、`closeWithGrace 15s`、`SIGTERM` 不锁源、`Idempotency-Key`、`prepareContentBatch`/`commitContentBatch` 与 `concurrency=1` 纯 RFC 4180 CSV + JSON 结尾帧导出）；交付 **`Dockerfile` + 3 服务 `docker-compose.yml`（Caddy + App + PG16）+ `Caddyfile`**。 | 四项实证：空白 PG16 编译启动；`POST /ingest` 首写 `201` / 重放 `200(updated=0)` / 并发导出 `429` + 断流 PG 活跃零残余；Caddy 反代双 IP 独立限流；1 次受控 `kaix`（带评论）中途 `SIGTERM` 重启靠 `runId` 续接完成及 1 次 `TwitterAPIs` 实探入库。 |
| **Stage 2**<br>（精简高价值 R2） | 接入重写版 `TwitterAPIs` / `ScrapeBadger`（手选批量 ID） / `red_crawler`（异步轮询） / `NewsNow`（含 `hackernews`） / 安全版 `feed`（`rss-parser` + `sanitize-html` + IP 绑定 SSRF）；上线 `monitor_project*`、三段词、`discussion`/`pain`、手选批量 `Hydrate`、单次有界树 + 移植 `ThreadTreeDrawer`/`AccessTokenPanel`、只读 Agent 机器 Key。 | 一条真 PG16 + HTTP + Chromium 端到端贯穿创建项目 -> 发现 -> 筛选 -> 手动水合 -> 三视图阅读 -> 保存/导出；权限越权（403/404）与各实跑源报告留 `output/`。 |
| **Stage 3**<br>（阈值触发演进与 R4） | **仅当线上 14–30 天观测命中阈值才启用**（不预设复杂）：若 10 万+ 行导出引发 `pg.Pool` 队列 P95 > 500ms 再独立导出读池/拆 worker；若 >80% 手工水合高度规律再启用硬上限自动 `COL-10`；历史大档推流独立启动 `plugins/zst-archive/`。 | 对应监控 P95 曲线、预算对账报告与独立外挂推流回归。 |

### 目标 CI/CD 收敛标准（对标 `actualbudget` / `umami` / `fastify/demo`）

- **Fast Gate**：全部 GitHub Actions 锁 **40 位 Commit SHA** 与 `npm ci --ignore-scripts`；运行 `docs:check`（含 `041+` 迁移号检查）、`lint`、全仓 `typecheck`、确认 `dist/**/*.sql` 存在与离线单测，并同步运行 `gitleaks` 与生产依赖 `npm audit`。
- **Compiled + PG16 E2E Gate**：使用 `postgres:16-alpine` 服务容器，先执行 `npm run build` + `npm run db:migrate:compiled` 并启动编译后 `dist/apps/api/src/server.js`，执行核心 PG16/HTTP 契约测试与 1 条主流程 Playwright 浏览器冒烟（不再双跑 `InMemory`）。
- **单机镜像构建**：打 tag 构建同一多阶段 `Dockerfile` 推 GHCR（开启 GHA layer cache），VPS 通过 `docker compose pull && docker compose up -d` 升级，`app` 强制 `${SESSION_SECRET:?required}`、`init: true`、`stop_grace_period: 20s`，`db` 永不对外映射端口。

> 本轮已获授权在现有重整分支执行 Stage 0/1；执行事实见第 0 节。Stage 2/3 仍按对应范围推进，不整支合入另一分支。
