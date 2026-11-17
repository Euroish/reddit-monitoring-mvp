# 当前开发与交付

本文件按当前检出分支的源码记录可执行命令；两个开发分支的实现及验证分别见[主线协调记录](status.md#0-主线与开发分支的唯一协调记录)。

第 1–5 节记录**当前 main 仓库（`0.9.1 / node:http`）真实可执行入口**。新版[产品与架构](README.md)与[重建计划](plans/source-expansion.md)中的 Fastify 5、五模块、项目三阶漏斗、混合评论树、主备切换、标准推流、机器 Key、游标流式导出与 Docker Compose **均未合入 main**，切勿按目标规范猜测当前可调用命令。第 6 节总结重构期安全切换与目标环境基线；单机运行安全硬约束以[架构规范 OPS-01–04](architecture.md#7-发布维护与扩展边界)与[SAFE-01–06](architecture.md#6-远端单机公网安全与稳定运行基线)为唯一定义。

## 1. 本机私有密钥与环境变量

密钥只存仓库外本机私有文件（例如 `/root/.config/reddit-monitoring/credentials.env`，目录 `700`、文件 `600`），严禁复制到仓库、对话日志、测试夹具或前端 `VITE_*` 变量中。配置模板见 `deploy/env/`。

```sh
nano ~/.config/reddit-monitoring/credentials.env
```

```dotenv
NODE_ENV=development
SOURCE_RUN_MODE=live
SOURCE_NETWORK_ENABLED=true
APIFY_API_TOKEN=
TWITTERAPIS_API_KEY=
SCRAPEBADGER_API_KEY=
```

| 变量 | 服务说明 | 当前源码消费情况 |
| --- | --- | --- |
| `APIFY_API_TOKEN` | Apify 账户令牌（供 `kaix` 与未来 `red_crawler` 共用） | 已有 `kaix` adapter 读取 |
| `TWITTERAPIS_API_KEY` | `TwitterAPIs`（目标 X 主源） | 上游小样本直连已通；待 R2 写入新 adapter 后读取 |
| `SCRAPEBADGER_API_KEY` | `ScrapeBadger`（目标 X 独立备源与批量 ID 补全） | 预留凭证名；待 R2 写入新 adapter 后读取 |

API 与公共来源 worker 支持通过 `LOCAL_ENV_FILE` 指定环境变量文件（shell 显式变量优先；设 `LOCAL_ENV_FILE=none` 禁用）；检查配置结构（脱敏输出且零网络请求）：

```sh
LOCAL_ENV_FILE="$HOME/.config/reddit-monitoring/credentials.env" npm run config:check
```

`TWITTERAPIS_TIMEOUT_MS` / `SCRAPEBADGER_TIMEOUT_MS` 为待实现配置（默认 `20000ms`、允许 `100..120000ms`），认证头与响应细节见[来源替换规格](research/source_replacement_and_twitterapi_io_removal_spec.md#2-x-新双源连接器-openapi-字段映射)；请勿与待淘汰的 `TWITTERAPI_IO_*` 混用。此私有文件不会自动注入当前系统运行的 `systemd` 服务（现网服务仍读 `/etc/reddit-monitoring/*.env`）。

## 2. 当前可执行启动入口（`0.9.1` 旧主链）

当前开发基线 Node 22+（CI Node 24 / PostgreSQL 16，当前库兼容 PG 14+）；升级至 Node 24 / PG 16 时按迁移计划单独验证。第三方自托管 `RSSHub` 运行时单独管理，不混入主产品。

```sh
npm ci
npm --prefix apps/web ci
npm run lint
npm run typecheck
```

配置独立开发 `DATABASE_URL`、`API_BEARER_TOKEN` 与允许源，本地明文 HTTP 调试设 `API_SESSION_COOKIE_SECURE=false`（默认 `SOURCE_NETWORK_ENABLED=false` 不连真网）：

```sh
npm run db:migrate
npm run auth:bootstrap-owner   # 仅新空库执行，BOOTSTRAP_OWNER_* 由私有环境提供
LOCAL_ENV_FILE="$HOME/.config/reddit-monitoring/credentials.env" npm run app:api
# 另开终端，确需执行来源任务时再启动 worker：
LOCAL_ENV_FILE="$HOME/.config/reddit-monitoring/credentials.env" npm run worker:sources
npm --prefix apps/web run dev
```

API 当前仍通过 `createPostgresPhase1Runtime()` 装配新旧边界；公共内容开发只启动 `worker:sources`，切勿启动旧 Phase 1 调度器。Vite 默认通过代理转发 API（端口变更设 `VITE_API_PROXY_TARGET`；跨域才配 `API_CORS_ALLOW_ORIGINS`）。连接池每进程默认 `5`（可用 `PG_POOL_MAX` 调节），计算整机连接数时须合并 API、worker 与 CLI。

### Windows 本地合成演示（现有工具）

需本机提供完整 PostgreSQL `bin`/`share`（不会覆盖已有 `.env.local`）；仅跑独立 loopback 库与合成来源，不连接外部 Reddit/X：

```powershell
npm run local:setup -- --pg-bin 'C:\your-postgresql\bin'
npm run local:start
npm run local:status
npm run local:account
npm run local:stop
```

运行记录写入被忽略的 `output/local-dev/`；Linux 正式环境绝不复用 Windows 路径或进程管理方式。

## 3. 当前来源与接口实现状态

`SOURCE_RUN_MODE=demo|live`（`production` 拒绝 `demo`/`mock`）；即使在 `live` 模式下也需同时启用 `SOURCE_NETWORK_ENABLED=true`、相应凭证及管理员打开 provider 限额开关。

| 当前注册 provider | 现有源码能力 | 当前约束与重建去向 |
| --- | --- | --- |
| `arctic_shift` | 社区/账号/帖子评论、范围词/ID 入口 | 实测高超时与限流，**主线决定退役**：不继续修补在线 ID 校验或回退逻辑；R1 新链不注册，R3 物理删代码并保留历史 DB 观测。 |
| `kaix` | Reddit 跨社区 search、社区/账号帖、账号/帖评论 | `APIFY_API_TOKEN`；开发期事件帽/45s/512MiB/禁代理硬覆盖已移除，但仍锁死 `includeComments=false`、单页 `1..100`、`mode="post"` 丢主帖与 `literal()` 误杀、且依赖 `ArcticShift` 指标常量。R1 集中改造。 |
| `twitterapi_io` | X 账号/关键词/ID 帖子 | `TWITTERAPI_IO_API_KEY`；单价超参考线且同源冗余，未真实验收；按 R1–R3 全量淘汰实删并迁出 X 集成用例至 `x-content-pipeline.test.ts`。 |
| `bluesky_appview` | 公开账号作者帖/回复 | 无密钥；保留现有能力不扩展，不是 Reddit/X 替代源。 |
| `demo_reddit` / `demo_x` | 明确标示的合成样本 | 仅用于离线联调，不算真实数据源。 |

当前**尚无** `red_crawler`、`TwitterAPIs`、`ScrapeBadger`、`NewsNow`、通用 `feed`、`POST /v1/sources/:id/ingest` 或项目工作台接口。`kaix` 当前单次保守预留 101 resources / 1 request，依然采用阻塞式 `waitForFinish=60` 后要求 `SUCCEEDED`（未知状态不重发 `POST`，待 R1 改为 `runId`/`datasetId` 异步续读）。当前 Web 默认入口为 `/content`、`/content/:id`、`/saved`、`/account`（与旧 Phase 1 `/markets`、`/queries`、`/target` 等并存，按 R3 退役）。当前检索缺投影返回 `503`，即时导出上限 `2,000` 条，`research_export` RR 冻结上限 `20,000` 条 / `32 MiB`。

## 4. 自动门禁与测试脚本

```sh
npm run lint             # 全仓文档/架构边界检查 (docs:check) + Web ESLint
npm run docs:check       # 文档 allowlist、唯一规则编号、链接/锚点、src/modules AST 门禁
npm run typecheck
npx tsx --test tests/unit/repository-policy.test.ts tests/unit/kaix-content.connector.test.ts tests/unit/release-package.test.ts
npm run test:offline
npm run test:postgres    # 必须提供独立 TEST_SOURCE_DATABASE_URL (UTF8/loopback)
npm run verify:repo      # docs、typecheck、API/Web 构建与 compiled smoke
```

- `npm run docs:check` 目前同步校验：14 份注册文档完整、根目录 `README.md <= 60` 行、全仓库相对链接与标题锚点有效、规范表 ID 全局唯一且含规范关键词、`src/modules/` 新内核严格限制文件列表、禁止包装类/`*Repository` 接口、禁止导入旧 `application/services|domain/repositories|storage/repositories|runtime` 层、单条注释不超过 `300` 字符、以及无 `.env` / 私钥进入 Git 跟踪。
- `npm test` 存在未设测试库即 skip 的历史行为，不能替代 `npm run test:postgres`；真实数据源验证绝不混入日常离线 CI，相关样本报告留存 `output/`。
- 其他历史验证/性能脚本：`smoke:accounts:local`、`smoke:content:local`、`smoke:research:local`、`benchmark:sources -- --rows 20000 --repeats 20 --out output/validation/report.json`（Playwright 可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有浏览器）。

## 5. 数据维护、发布与来源安全退役顺序

现有可手工调用工具（**绝非授权自动执行**）：

```sh
npm run ops:backfill:public-search -- --limit=100 --dry-run
npm run storage:plan -- --out output/validation/storage-preview.json
npm run db:backup -- --file output/backups/唯一名称.dump
npm run db:restore -- --file output/backups/唯一名称.dump --target info_workbench_restore_唯一名称
npm run release:pack
npm run release:verify -- output/releases/目录
```

- 备份恢复需版本匹配的完整 `PG_BIN`，严禁直接覆盖活跃库，必须恢复至新库核验迁移摘要与资产完整性后再评估切换。
- 当前 Linux 运行环境沿用 `deploy/` 下的 `systemd` + `Nginx`（已知历史预览为 Nginx 8080 $\to$ API 3000、发布目录 `/opt/reddit-monitoring`、私有配置 `/etc/reddit-monitoring/`）；切公网必须启用 HTTPS、安全 Cookie、精确 `Origin` 与反向代理真实 IP 覆写，保持 `public-tunnel`/`desktop`/`chrome`/`bridge` 关闭。

### 来源退役顺序

针对 `twitterapi_io` 与 `arctic_shift` 的下线迁移**必须严格按以下门禁推进**，严禁直接跑无状态检查的批量强删 SQL：

1. **停领与云端状态盘点**：停止旧调度器领任务与外部新入队，盘点库内所有 `queued` / `running` / `retrying` 任务及云端 Run 回执。对于已有 `runId` 的任务先续读结果或确认已终止；对于收费状态 `unknown` 的记录先经人工查明，**严禁仅把本地 `job` 标成 `cancelled` 就当作云端计费已停止**。
2. **迁移关闭旧预算与免费回退**：通过新迁移（按当时未占用版本号，不硬锁）对 `twitterapi_io` 与 `arctic_shift` 的 `source_provider_budget` 执行 `UPSERT` 禁用与零额度（`enabled = FALSE, daily_* = 0, monthly_* = 0`）并同步递增 `revision`；同步移除代码 `defaultProviderBudget` 中对 `"arctic_shift"` 的免费回退（避免空库回弹放行），禁止物理删 `budget` 或 `usage` 行。
3. **软归档残留绑定来源**：确认无在途或未决付费任务后，清理残余本地可取消任务与租约，对仍绑定旧渠道的 `collection_source` 设 `state = 'archived'`、清调度时间并递增 `revision`（不推进高水位）。**已切换新主渠道的逻辑来源绝不因历史上曾有旧渠道观测而被误归档**。
4. **历史数据保全**：完整保留所有既有 `content`、`content_discovery`、`content_observation` 与真实历史 `provider` 标识、用户批注与读取授权（不改造已应用 `031` 等历史 SQL）；仅在核实等价关系后才可把项目关联迁移到新逻辑来源。
5. **预置新源默认关闭预算**：通过 `INSERT ... ON CONFLICT DO NOTHING` 预置 `twitterapis`、`scrapebadger`、`kaix`、`red_crawler` 默认关闭、零额度预算行（不覆盖开发/现网已有有效 `kaix` 配额）。
6. **源码实删与防退化检验**：按[来源替换规格](research/source_replacement_and_twitterapi_io_removal_spec.md#3-twitterapi_io-与-arctic_shift-在线源码实删定位矩阵)解除 `kaix` 与 ~29 个公共夹具依赖，把 `twitterapi-io-content-pipeline.test.ts` 迁为 `x-content-pipeline.test.ts` 保住 X 集成断言，再物理删文件并执行真 PG、离线、构建、compiled smoke 与新旧观测可读性检验。

## 6. 重建期目标部署与验收基线

- **技术底座**：Node 24 / PG 16 / Fastify 5 / TypeBox，五模块 `routes.ts + sql.ts`，`commitContentBatch` 混合批四组 `UNNEST`、单列 `search_text` + `title_length`、`compileContentFilter` + 三段词组/信号 + `GROUPING SETS` + 有界流式导出；
- **来源基线**：`kaix`（解封）+ `red_crawler`（Reddit），`TwitterAPIs` + `ScrapeBadger`（X），`NewsNow` + `feed`（资讯）；推流 `ING-01/02` 仅接规范 JSON；`plugins/zst-archive/` 保留为独立 R4 外挂，不进主线构建、发布包与测试；
- **Compose 与极简密钥**：`R3` 新增并验证 Docker Compose（`proxy` / `app` / `db`）替换 `systemd` 默认交付后同步更新本节启动命令；生产启动应用仅强制 `DATABASE_URL`、`SESSION_SECRET`、`ADMIN_BOOTSTRAP_PASSWORD` 三项核心配置（引导后即移除），第三方来源凭据按需加载；
- **交付纪律**：改动文档或脚本允许清单同步更新 `scripts/release-package-lib.mjs` / `scripts/check-docs.ts` 并通过 `npm run lint`、`npm run typecheck`、单测及 `git diff --check`。

### 分支与规范收敛

- `main` 的 14 份正式文档共同定义唯一合并规范；`status.md` 记录各分支的真实完成情况。分支状态可随代码更新，产品目标、接口语义与迁移决策须先回到 main 的对应唯一文档，禁止复制第二套规格或用 WIP 状态覆盖主线现状。
- 只保留 `main`、整体重整 `r1-content-batch` 和另一 agent 的 `feat/r1-core-and-r2-wip` 三个活跃远端分支。后续复用这两个开发分支及各自 PR，不再创建重复 R1、R2 或整合分支；先同步 main 的文档提交，再继续开发。
- 整体重整通过已有分支 PR 上传审查；保留原提交与 main 同步记录，不强推、不将未经整合的 R2 整支覆盖上去。合并完成才删除已交付开发分支；新的产品行为只有经源码与对应真实检查证明后才能写入 main 的实现状态。
- 两个候选的 `041+` 仅在隔离验证库使用，不能组合应用。`001..040` 保持原 checksum；合入前选定唯一字段/迁移链，对已应用分歧迁移的开发库单独备份、重建或制定向前转换，禁止编辑已应用 SQL 或改 ledger 假装兼容。
- 已完全并入 main 的旧远端分支可删除；含独有历史提交的蓝本先保留归档标签 `archive/frontend-blueprint-20261108` 再移除分支。归档内容不恢复为现行文档。`dev/dev-a` 与 `shared-dev` 由其他本地 worktree 占用且尚有独有记录，保持原样，不恢复已删除的远端 `shared-dev`。
- 本轮 Git 上传只更新代码与文档，不执行部署或迁移既有测试库；GitHub 检查结果与分支本机检查分开记载。
