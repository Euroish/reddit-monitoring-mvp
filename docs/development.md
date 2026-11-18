# 开发记录与运维交付手册（唯一开发记录真源）

> **文档定位**：本文件是全仓**唯一的开发操作手册与阶段交付台账真源**（已完整整合原 `docs/history/` 历史记录，禁止再新建 `handoff.md` 或独立日志）。开头与第 1 节记录 **重整分支入口和配置**，第 2–4 节记录旧 `main@0.9.1 / node:http` 操作与退役步骤；第 5 节记录历史阶段 `0.2.0–0.9.1` 交付事实与文档收敛里程碑。目标架构、契约及各开发分支实况分别见[主线架构规范](architecture.md)、[数据与 API 契约](contracts.md)和[当前状态与下一阶段](status.md)。

---

## 当前分支的编译与 Compose 验收入口

Compose 从完整源码检出构建镜像；`release:pack` 是供 Node 直接运行的编译包。开发入口为 `npm run app:api`，唯一发布入口为 `node dist/apps/api/src/server.js`；构建用 `npm run build`，迁移用 `npm run db:migrate:compiled`。`DATABASE_URL` 必须指向独立 PG16 验证库，随后运行 `npm run smoke:compiled`，验证发布态 SQL、readiness、登录与 SIGTERM。迁移 runner 使用独立长超时连接，找不到 SQL 直接失败；空库应用共 48 个文件，完整迁移链见[当前执行记录](status.md#0-当前重整分支执行记录)。

本地三服务验收设置 `POSTGRES_PASSWORD`（URL 安全字符）、`SESSION_SECRET`（至少 32 字符）、`APP_ORIGIN=https://localhost:8443`、`SITE_ADDRESS=https://localhost`、`HTTPS_PORT=8443`、`TLS_CONFIG='tls internal'`，可选一次性 `ADMIN_BOOTSTRAP_PASSWORD`，再运行：

```sh
docker compose -p monitoring-local up --build -d --wait
curl --insecure https://localhost:8443/readyz
docker compose -p monitoring-local stop
docker compose -p monitoring-local up -d --wait
```

自签证书仅用于本地验收。公网部署使用真实域名、`APP_ORIGIN=https://域名`、`SITE_ADDRESS=域名`、`HTTPS_PORT=443`、`PROXY_BIND=0.0.0.0` 并留空 `TLS_CONFIG`，由 Caddy 签发证书。app/db 不映射宿主机端口；`TRUST_PROXY_HOPS=1` 仅在此私有网络单跳反代拓扑设置，直接运行 API 默认不信任转发头。主线默认关闭外部网络采集。发布标签通过 CI 门禁后产出 App 与 Caddy 镜像，设置 `APP_IMAGE` 指向发布标签的 App 镜像，`PROXY_IMAGE` 指向对应的 `-proxy` 标签。

模块内职责文件现为 `content/batch.ts`（事务外归约）、`content/sql.ts`（唯一集合写）、`content/search.ts`（统一检索）、`content/export.ts`（下载生命周期）与 `collection/jobs.ts`（人工任务恢复）；其余维持原五模块。门禁继续拒绝旧运行时/连接器回流，保持 450 行文件与 220 字符代码行约束。流式 JSON 下载现在返回 `{items, result:{exportedCount,truncated,nextCursor,complete}}`，CSV 保持纯 RFC 4180 数据行。

## 1. 本机私有密钥与环境变量

密钥仅存于仓外本机私有文件（如 `~/.config/reddit-monitoring/credentials.env`，目录 `700`、文件 `600`），严禁写入仓库、测试夹具、文档日志或前端 `VITE_*` 变量；模板见 `deploy/env/`。

```dotenv
NODE_ENV=development
SOURCE_NETWORK_ENABLED=true
APIFY_API_TOKEN=
TWITTERAPIS_API_KEY=
SCRAPEBADGER_API_KEY=
```

| 环境变量 | 服务角色 | 当前分支 |
| :--- | :--- | :--- |
| `APIFY_API_TOKEN` | Apify 账户令牌（供 `kaix` 与 `red_crawler` 共用） | 两个 Reddit 连接器读取 |
| `TWITTERAPIS_API_KEY` | `TwitterAPIs`（目标 X 主源） | 搜索任务在隔离 PG16 已真实落库 |
| `SCRAPEBADGER_API_KEY` | `ScrapeBadger`（目标 X 备源与批量 ID 补全） | 选配备源和批量刷新凭据 |

当前重整分支仅从进程环境读取配置，不再支持旧 main 的 `LOCAL_ENV_FILE` / `config:check` / 独立 `worker:sources` 入口。Node 24 可显式加载仓外凭据后启动编译服务器（应用必需的 DB、会话与 Origin 配置仍须另行提供）：

```sh
node --env-file="$HOME/.config/reddit-monitoring/credentials.env" dist/apps/api/src/server.js
```

`TWITTERAPIS_TIMEOUT_MS` / `SCRAPEBADGER_TIMEOUT_MS` 的默认值为 `20000ms`（区间 `100..120000ms`），认证头与映射见[来源替换规格](research/source_replacement_and_twitterapi_io_removal_spec.md)。Compose 默认关闭采集，显式设置 `SOURCE_NETWORK_ENABLED=true` 后透传环境中的供应商凭据，`FEED_ALLOWED_URLS` 用逗号分隔精确的 HTTPS 订阅地址，连接绑定到解析出的公网 IPv4。开启相应来源预算后才可提交任务。凭据仅从进程环境或仓外私有文件加载。

TwitterAPIs 单任务一页、最多 20 条。需要备源时在来源创建或 PATCH 中设置 `fallbackProvider`，提交采集时显式传 `useFallback: true`。ScrapeBadger 批量刷新用 `POST /v1/sources/:id/refresh`，每次 1–20 个库内内容 ID，带 `Idempotency-Key`。Reddit 项目手选水合用 `POST /v1/projects/:id/hydrate`，每次最多 30 个现有根帖。两类任务均可在来源页查看。

单帖 Reddit 采集在来源目标中使用 `{type: "post", postId: "t3_…"}` 和 `contentKind: "comment"`。Kaix 的 `maxCommentsPerPost` 最大为 50，实际取两项中较小者（任务 `limit` 与评论上限）；预算另为同批返回的主帖预留 1 条。任务结束后通过 `GET /v1/source-jobs/:id` 查看 `job.result_summary.warning`，评论缺失时用对应 `provider_run_id` 核对 Apify Run。

### 批量提交采集计划

`npm run collect:batch -- output/collect-plan.json` 在本地解析 JSON 计划并汇总任务数和请求条数上限。计划是对象数组，每项填写已有 `sourceId`、ISO 时间 `from` / `to` 和 `limit`。可选字段为 `includeComments`、`maxCommentsPerPost` 和 `useFallback`，每个来源继续遵循对应供应商页大小与预算。

执行时从环境提供 `COLLECT_API_URL`（经 Caddy 时包含 `/api`）和拥有 `read`、`collect` 权限的来源范围 Machine Key，再给命令加 `--apply`。脚本每轮最多提交 32 项，合并查询状态，按服务端 `Retry-After` 退避。遇到排队预算提示或等待超时会保留进度。等额度或任务状态更新后，用同一计划和命令继续，已提交的任务沿用回执。服务端继续控制实际供应商调用。脚本将进度保存到计划旁的 `.progress.json`，计划和进度可一并放入 `output/`。

当前每个采集任务仍为供应商的一页或一个 Actor Run。计划中的记录上限用于估算，实际供给受来源覆盖、供应商页大小和额度约束。

## 2. 历史版本 `main@0.9.1` 的入口与门禁脚本

本节保留 `main@0.9.1` 的历史运维记录。当前版本以本页开头的编译与 Compose 入口及 `package.json` 为准。

当前环境兼容 Node 22+（CI 目标 Node 22/24 与 PostgreSQL 16）。`SOURCE_NETWORK_ENABLED` 默认 `false`（不发真实收费网包），本地明文调试设 `API_SESSION_COOKIE_SECURE=false`。

```sh
npm ci && npm --prefix apps/web ci
npm run docs:check         # 文档允许清单、唯一规则 ID、链接锚点、5 模块 AST 与 041+ 迁移守卫
npm run lint               # docs:check + apps/web ESLint
npm run typecheck          # 全局 tsc --noEmit（含 src/apps/workers/packages/scripts/tests）
npm run db:migrate
npm run auth:bootstrap-owner
LOCAL_ENV_FILE="$HOME/.config/reddit-monitoring/credentials.env" npm run app:api
LOCAL_ENV_FILE="$HOME/.config/reddit-monitoring/credentials.env" npm run worker:sources
npm --prefix apps/web run dev
```

- **Windows 本机合成演示（不连外部平台）**：`npm run local:setup -- --pg-bin 'C:\your-postgresql\bin'`、`local:start`、`local:status`、`local:account`、`local:stop`（日志写于被忽略的 `output/local-dev/`；Linux 生产环境禁止复用 Windows 进程工具）。
- **测试脚本**：`npm run test:offline`、`npm run test:postgres`（需独立 loopback 库 `TEST_SOURCE_DATABASE_URL`）、`npm run verify:repo`；`npm test` 遇未配测试库会 skip，不得代替 `test:postgres`。

## 3. 旧版本维护脚本与切换记录

以下命令属于旧版本；当前可用命令见根目录 package.json，其中备份与恢复分别使用 npm run db:backup 和 npm run db:restore（**未经明确授权不得对生产数据运行写动作**）：

```sh
npm run ops:backfill:public-search -- --limit=100 --dry-run
npm run storage:plan -- --out output/validation/storage-preview.json
npm run db:backup -- --file output/backups/唯一名称.dump
npm run db:restore -- --file output/backups/唯一名称.dump --target info_workbench_restore_唯一名称
npm run release:pack
npm run release:verify -- output/releases/目录
```

PG16 实测使用不按 schema 过滤的备份归档，将 `pg_trgm` 与搜索索引一并恢复。归档清单在隔离恢复后对账表行数和迁移校验和。历史仅含 public schema 的归档需先核对扩展，不能作为已演练恢复凭据。


- 备份恢复必须使用版本匹配的完整 PostgreSQL 客户端，禁止直接覆盖活跃生产库，先恢复至独立新库核验迁移摘要后再切流。
- 现有遗留 `deploy/` 为 `systemd` + Nginx 过渡模板；**目标生产形态已收敛为单机 3 服务 Docker Compose（`caddy` `:80/:443` 静态 Web + `/api/*` 反代与导出去缓冲、`app` 单容器 `HOST=0.0.0.0` + `trustProxy: 1` + `15s` 优雅退场、`db` 内网 `postgres:16-alpine` 零端口映射）**，正式上线时同步替代本节旧启动命令。生产首次空库仅强依赖 `DATABASE_URL`、`SESSION_SECRET`、`ADMIN_BOOTSTRAP_PASSWORD`（引导首号后移除），来源凭证按需配置。

## 4. `twitterapi_io` 与 `arctic_shift` 安全退役操作顺序

执行源码清理与数据库下线前，必须严格按以下六步推进：

1. **停领与云端状态盘点**：停掉旧调度器领单，盘点库内 `queued`/`running`/`retrying` 任务与云端回执；已有 `runId` 的任务先续读或确认终止，收费结果 `unknown` 须先人工核实，严禁直接批量改本地 `cancelled` 掩盖云端在跑任务。
2. **迁移关闭预算与免费回退**：通过前向迁移对 `twitterapi_io` 与 `arctic_shift` 的 `source_provider_budget` 执行 `UPSERT` 禁用与置零额度（递增 `revision`），代码层移除 `"arctic_shift"` 默认免费回退，禁止物理删 `budget` / `usage` 行。
3. **软归档绑旧源逻辑对象**：清理可取消残余任务后，仅把仍绑定旧渠道的 `collection_source` 设 `state = 'archived'`（绝不误归档已切新主渠道的来源）。
4. **历史数据保全**：完整保留库内既有 `content`、`content_discovery`、`content_observation` 与真实历史 `provider` 标识（`001..040` SQL 一律不动）。
5. **预置新渠道零额度预算**：使用 `INSERT ... ON CONFLICT DO NOTHING` 为 `twitterapis`、`scrapebadger`、`kaix`、`red_crawler` 写入默认关闭零额度行（不覆盖开发/现网已配置的 `kaix` 有效配额）。
6. **源码删除与防退化测试**：先解除 `kaix` 与约 29 处测试夹具对 `ArcticShift` 的常量依赖、把 `twitterapi-io-content-pipeline.test.ts` 迁为 `x-content-pipeline.test.ts` 保住 X 断言，再删旧文件并全量通过 `docs:check`、`typecheck` 与 PG16 集成验证。

---

## 5. 全阶段历史开发与验证交付台账（`0.2.0 – 0.9.1`，整合原 `docs/history/`）

> 以下记录反映截至 `2026-10-14` 基于旧 `node:http / Express-style PG Repository` 基线的个人分支（`codex/arctic-shift-content-query`）阶段交付事实，后续主线重构规划以[当前状态与下一阶段](status.md)为准。所有离线/合成验证外部请求均为 `0`，原始证据留在仓外或被忽略的 `output/`。

### 5.1 里程碑版本总表

| 版本 / 阶段 | 提交 / 本地标签 | 核心交付内容与关键事实 | 历史实测验证记录 |
| :--- | :--- | :--- | :--- |
| **初始快照** | `cd920c5` -> `abd24f5` | Arctic Shift 34 路径核对快照。 | 仅旧小样本留档 |
| **0.2.0 (阶段 1)** | `52636a1` / `local-phase1-v0.2.0` | 修复 17 项既有失败、图表日期并集与生命周期、受控保存路由、`.env.local` 加载及 Windows `local:*` 工具。 | 离线/独立快照 `365` 项（362 pass / 3 SQL skip）；Chromium 合成与 390px 通过 |
| **0.3.0 / 0.3.1 (阶段 2)** | `0a05f41` -> `0496b1d` / `local-phase2-v0.3.1` | `030` 来源生命周期（active/paused/archived）、purpose 互斥、72h 调度模拟、预算 heartbeat 及提前交付工作台导出（`0.3.0` 曾漏稳态 ID 前缀，在 `0.3.1` 修复不移动旧标签）。 | `0.3.1` 独立全量 `386` 项（382 pass / 4 skip）；真本地 `local:start` 合成链路通过 |
| **0.4.0 (阶段 3)** | `e88ca2e` / `local-phase3-v0.4.0` | `031` X 平台、`032` 请求观测、`TwitterAPI.io` 合成适配、共享 web identity、upsert 规范字段守卫与 JSON/CSV `2,000` 条续页导出。 | 离线 `400` pass / `7` SQL（另跑 7/7）、两套合成 UI 与 34 项 SQL 事务通过 |
| **0.5.0 (阶段 4A)** | `2eab855..a9f5403` / `local-phase4a-v0.5.0` | 修复候选前 20 饥饿、采样/发布口径分离、共用执行政策、`033`（SHA256 `3E26D15B27D7BF23CAA67C35581BA909DFB776B4072B2DD18D983D0AD3D0D1E7`）与 CI workflow。 | `425` 离线全通 + `15` 隔离 SQL 全通零 skip |
| **4B WIP 暂停点** | `local-phase4b-wip-20261013` | 单代理接管检查点（发现损坏 scrypt hex 认证漏洞已离线复现修复，留 `034`/`035` 初稿与 3 项写安全红测）。 | 账户隔离 SQL `1/1`，未合并待 4B 收口 |
| **0.6.0 (阶段 4B)** | `0b09c7a` / `local-phase4b-v0.6.0` | 账号权限/审计、`034`、`035`（SHA256 `608705B7C2FCCBE529E584767C0AADEE0B5A3DE0300F4B72EE16BEA5680AA619`）、CAS `revision` 并发保稿与密码/会期隔离。 | `455` 离线 / `24` 原生 SQL 全通零 skip；18 API 请求本地账户/审计验证通过 |
| **0.7.0 (阶段 4C)** | `2e05935` / `local-phase4c-v0.7.0` | 只读库容量预览、`pg_dump`/`pg_restore`（配对 EDB PG17.11 工具）RR 恢复演练、580 文件清单发布打包、`systemd` 模板及 2 万/4 万观测基准。 | `460` 离线 / `25` SQL 全通；`580` 文件 SHA 验证通过 |
| **0.8.0 (阶段 5A)** | `f190678` / `local-phase5a-v0.8.0` | `036`（SHA256 `45AE4B5CDAA4D305A35BE1A88AED599D9E29F7F561877E9F328E79DA47FA5BFC`）、作者/语言/排序、详情与引用、保存查询、个人批注 CAS 与主动媒体预览。 | `471` 离线 / `27` SQL 零 skip；35 请求 PG 内容与 390px 截图通过 |
| **0.9.0 (阶段 5B)** | `e05cd5c` / `local-phase5b-v0.9.0` | `037`/`038`（`038` SHA256 `BB465D92...207D5`）、公共 NFKC 检索索引、RR `research_export`（2 万行 / `32 MiB` 预检，现已规划随方案 B 退役）与最后 `2万内容/4万观测` 性能测量（SHA256 `8778BDB8...68CE`：all `P95 214.116/294.220ms`，字面 `138.580/625.340ms`）。 | `495` 离线 / `30` SQL 零 skip；633 文件不可变包校验与 104 成员 PG 冻结验证通过 |
| **0.9.1 (收口基线)** | `ddf144f` -> 个人分支提交 | `039` 失败分类与源自动阻塞（3 次启动尝试上限 + UTC 时区边界修补）、12–128 字符统一口令、`readyz`/限流/CORS Origin 修补，本地管理演示升级至 40 SQL（含后续 `040` Bluesky）并按授权推送 GitHub PR。 | `511` 离线 / `41` 原生 SQL 全通零 skip；桌面/移动浏览器合成链路通过 |

### 5.2 2026-10-12 修订任务矩阵（`P0–P3` 审计追踪摘要）

原 60 项任务审计表已随架构转向（`0.9.1` 旧入口 -> Fastify 5 五模块重整 + 方案 B 去冻结表）保留最终核对结论供追溯：

- **P0（基础设施与正确性，P0-01..P0-10）**：测试无静默跳过、图表日期并集与生命周期、保存视图、`4A` 采样/发布时间隔离与执行政策已完成软件目标；`P0-05/07/09/10` 在旧架构下仅部分落地（新主线已由 `SQL-01/02`、`SAFE-01/02` 与独立迁移连接重定义）。
- **P1（核心平台与运维，P1-01..P1-22）**：来源配置 CAS、多语言字面查询、Windows 启停与 `037` 研究导出在旧主线已完成软件目标，但其中旧调度同步等待、`Arctic Shift`、`TwitterAPI.io` 与 `research_export` 已在新主线规格中被主动重构或淘汰实删。
- **P2（高阶分析与治理，P2-01..P2-20）**：RSS/web（`P2-01`）、平台内可比口径（`P2-07`）、跨平台榜单全分页（`P2-05`）、百万级性能与生产恢复演练（`P2-10`/`P2-20`）留归新主线 R1–R3 逐阶段验收。
- **P3（当时待确认扩展，P3-01..P3-08）**：Instagram、语义检索、AI 摘要、推荐与多租户扩展均列为**未经明确授权严禁擅自实施**。

### 5.3 文档体系去漂移收敛记录（`2026-11-17`）

- 完成历史文档整合：将 `docs/history/development-log.md` 与 `docs/history/handoff.md` 并入本文件第 5 节并清理重复目录，确保 `AGENTS.md` 只指向[开发记录](development.md)与[当前状态](status.md)两份唯一真源。
- 修正治理门禁：`scripts/check-docs.ts` 移除诱导千行上帝文件的 `moduleFiles` 两文件白名单与 300 字符注释限制，替换为五模块顶层约束、非模板单行 `<= 220` 字符、单文件 `<= 450` 行、全量 AST 禁止类封装/旧层导入及 `041+` 前向迁移号唯一检查；`scripts/release-package-lib.mjs` 同步精简 `DOCUMENTATION_FILES` 为 12 份同时保留历史归档验证兼容。
