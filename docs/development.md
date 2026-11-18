# 开发记录与运维交付手册（唯一开发记录真源）

> **文档定位**：本文件是全仓**唯一的开发操作手册与阶段交付台账真源**（已完整整合原 `docs/history/` 历史记录，禁止再新建 `handoff.md` 或独立日志）。开头与第 1 节记录 **当前 Fastify 5 重整分支入口、4GB/60GB 单机容量配置、分层保留 SQL 与安全加固规程**，第 2–4 节记录旧 `main@0.9.1 / node:http` 操作与退役步骤；第 5 节记录历史阶段 `0.2.0–0.9.1` 交付事实与文档收敛里程碑。目标架构、契约及实施路线分别见[主线架构规范](architecture.md)、[数据与 API 契约](contracts.md)和[当前状态与下一阶段](status.md)。

---

## 当前分支的编译、测试与 4GB/60GB 单机 Compose 验收入口

Compose 从完整源码检出构建镜像；`release:pack` 是供 Node 直接运行的编译包。开发入口为 `npm run app:api`，唯一发布入口为 `node dist/apps/api/src/server.js`；构建用 `npm run build`，迁移用 `npm run db:migrate:compiled`。`DATABASE_URL` 必须指向独立 PG16 验证库，随后运行 `npm run smoke:compiled`，验证发布态 SQL、readiness、登录与 SIGTERM。迁移 runner 使用独立长超时连接（`600s`），找不到 SQL 直接失败；完整迁移链见[当前执行记录](status.md#0-当前重整分支执行记录)。

### 1. 本地三服务 Compose 验收命令

设置 `POSTGRES_PASSWORD`（URL 安全字符）、`SESSION_SECRET`（至少 32 字符）、`APP_ORIGIN=https://localhost:8443`、`SITE_ADDRESS=https://localhost`、`HTTPS_PORT=8443`、`TLS_CONFIG='tls internal'`，可选一次性 `ADMIN_BOOTSTRAP_PASSWORD`，再运行：

```sh
docker compose -p monitoring-local up --build -d --wait
curl --insecure https://localhost:8443/readyz
docker compose -p monitoring-local stop
docker compose -p monitoring-local up -d --wait
```

### 2. 4 GB 内存、60 GB 系统盘生产单机调优基线

在 4 GB RAM / 60 GB 磁盘 VPS 上运行时，必须锁定以下三项资源防护以杜绝 Linux OOM-Killer、日志撑爆磁盘与正文 3 倍写放大：

1. **宿主机 Swap 与系统日志上限**：
   ```sh
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   sysctl -w vm.swappiness=10 vm.vfs_cache_pressure=50
   # /etc/systemd/journald.conf 设置 SystemMaxUse=100M
   ```
2. **Docker Compose 资源配额、PG16 `lz4` 与日志轮转（`docker-compose.yml`）**：
   - 所有服务统一配置 `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }`（将容器日志总量锁死在 `90 MB` 以内）；
   - **`db`（`postgres:16-alpine`）**：`mem_limit: 1536m`、`shm_size: 832m`，启动参数锁定 `shared_buffers=768MB`、`effective_cache_size=2GB`、`work_mem=8MB`、`maintenance_work_mem=128MB`、`wal_buffers=16MB`、`max_connections=25`、`max_wal_size=1GB`、`wal_compression=lz4`、`default_toast_compression=lz4`、`gin_pending_list_limit=4MB`；
   - **`app`（`node:24-alpine`）**：`mem_limit: 1350m`、`NODE_OPTIONS="--max-old-space-size=1024"`；
   - **`proxy`（`caddy:2-alpine`）**：`mem_limit: 128m`、`GOMEMLIMIT=100MiB`。
3. **Cloudflare 源站隐身与 `DOCKER-USER` 防火墙加固**：
   - 注意 Docker 映射端口（`0.0.0.0:443:443`）会直接写入 `iptables nat PREROUTING`，绕过常规 `ufw` 规则！
   - 公网部署必须在 Caddy 开启 Cloudflare **Authenticated Origin Pulls（mTLS 客户端证书验证）** 与 `trusted_proxies`，并在宿主机 **`DOCKER-USER` 链** 限制仅放行 Cloudflare 官方 IPv4/IPv6 网段访问 `tcp/443`（或保持 `PROXY_BIND=127.0.0.1` 配合 `cloudflared` 隧道实现公网零端口暴露）。

### 3. 容量采样与 30d/90d 分层保留运维 SQL

在同一业务周期采样磁盘与表体积：

```sql
SELECT now(), pg_database_size(current_database());
SELECT relname, pg_total_relation_size(relid) AS bytes_including_indexes
FROM pg_stat_user_tables ORDER BY bytes_including_indexes DESC LIMIT 12;
SELECT status, count(*), min(next_run_at)
FROM source_collection_job WHERE status IN ('queued','retrying','running') GROUP BY status;
```

**分层裁剪原则（日采 10,000 条下将 3 年稳态体积控制在 `~13.2 GB` / 可用数据预算 `36.8 GB` 内）**：
- **永久保留**：所有 `content` 行的身份与引用骨架（`id`、`source_id`、`kind`、`external_id`、`url`、`title`、`content_author`、`created_at_source`、`content_evidence_key`、`content_references`，`~600 B/行`）+ 所有被收藏/写有批注（`content_annotation`）或关联至活跃项目（`monitor_project_source`）的完整正文与 `public_content_search_document` 搜索行；
- **30 天裁剪**：对超过 30 天的记录，每个 `(content_id, collection_source_id)` 仅保留最新 1 条 `content_observation`，按批（`LIMIT 5000`）删除旧中间观测快照与已终结超过 30 天的 `source_collection_job`；
- **90 天冷缩**：对超过 90 天且未被收藏/批注/项目引用的普通资讯，按批删除其 `public_content_search_document` 索引行并将 `content.body_text` 截断保留前 500 字摘要。

---

## 1. 本机私有密钥与环境变量

密钥仅存于仓外本机私有文件（如 `~/.config/reddit-monitoring/credentials.env`，目录 `700`、文件 `600`），严禁写入仓库、测试夹具、文档日志或前端 `VITE_*` 变量；模板见 `deploy/env/`。

```dotenv
NODE_ENV=development
SOURCE_NETWORK_ENABLED=true
APIFY_API_TOKEN=
TWITTERAPIS_API_KEY=
SCRAPEBADGER_API_KEY=
# 可选：后续按需启用可插拔 AI 双语翻译与事件簇摘要（兼容任意 OpenAI /v1/chat/completions 端点，未配置时 100% 确定性零模型运行）
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

| 环境变量 | 服务角色 | 当前分支 |
| :--- | :--- | :--- |
| `APIFY_API_TOKEN` | Apify 账户令牌（供 `kaix` 与 `red_crawler` 共用） | 两个 Reddit 连接器读取 |
| `TWITTERAPIS_API_KEY` | `TwitterAPIs`（X 主源，支持 VIP 批次 `advanced_search` 与时间线） | 搜索任务在隔离 PG16 已真实落库 |
| `SCRAPEBADGER_API_KEY` | `ScrapeBadger`（X 备源与批量 ID 补全） | 选配备源和批量刷新凭据 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 可插拔 AI 翻译与事件摘要端点（兼容 DeepSeek / Qwen / OpenAI / Gemini OpenAI 端点 / 本地 Ollama） | 选配扩展；受 `source_provider_budget` (`ai_enrich`) 额度门控，未设置时默认零模型运行 |

Node 24 可显式加载仓外凭据后启动编译服务器（应用必需的 DB、会话与 Origin 配置仍须另行提供）：

```sh
node --env-file="$HOME/.config/reddit-monitoring/credentials.env" dist/apps/api/src/server.js
```

`TWITTERAPIS_TIMEOUT_MS` / `SCRAPEBADGER_TIMEOUT_MS` 的默认值为 `20000ms`（区间 `100..120000ms`）。Compose 默认关闭采集，显式设置 `SOURCE_NETWORK_ENABLED=true` 后透传环境中的供应商凭据，开启相应来源预算后才可提交任务。

`FEED_ALLOWED_URLS` 接受逗号分隔的完整 HTTPS 地址，RSS、HTML 列表和 JSON 列表共用这份配置。使用 `primaryProvider: "feed"`、`contentKind: "article"` 和 `target.type: "feed"`。RSS/Atom 仅需 `target.url`。HTML 在 `target.list` 设置 `format: "web_list"` 与 `items`、`link`、`title` 选择器，支持标签、类、ID、后代及直接子节点。JSON 使用 `format: "json_list"` 和同名字段的点路径，例如 `data.items`、`links.canonical`、`title`，顶层数组可用 `items: "$"`。两种列表均可映射 `summary`、`publishedAt`、`author`，按响应地址解析相对链接，从前 200 个候选项中取样。先向 `POST /v1/sources/preview` 提交与创建相同的请求体，确认样本后用该请求体创建来源。

TwitterAPIs 每页最多 20 条。账号用带时间窗的 `from:` 搜索，批量追踪用 `from:u1 OR from:u2` 搜索源。手动任务取一页，自动排期按配置限制游标页数。手动任务可传 `useFallback: true`，自动排期仅在首次请求明确返回 429、尚无 Run 回执及提交页，并已配置兼容备源时单跳切备。ScrapeBadger 批量刷新用 `POST /v1/sources/:id/refresh`，每次 1–20 个库内内容 ID，带 `Idempotency-Key`。Reddit 项目手选水合用 `POST /v1/projects/:id/hydrate`，每次最多 30 个现有根帖。

### 搜索投影存量维护

`047` 创建双字 GIN 索引并调整压缩设置。现有 TOAST 值维持原存储方式，新写入和变更按列配置压缩。搜索投影新写入将 `normalized_title`、`normalized_text` 置空，旧记录可按主键分批清理。估算实际索引构建空间、WAL 与备份余量后，在授权的维护窗口执行。单批最多 2,000 行，使用上次返回的主键继续直到返回空值：

```sql
WITH batch AS MATERIALIZED (
  SELECT content_id FROM public_content_search_document
  WHERE content_id > :'after_id'::uuid ORDER BY content_id LIMIT 2000
), cleaned AS (
  UPDATE public_content_search_document d SET normalized_title='', normalized_text=''
  FROM batch WHERE d.content_id=batch.content_id AND (d.normalized_title<>'' OR d.normalized_text<>'')
)
SELECT content_id FROM batch ORDER BY content_id DESC LIMIT 1;
```

首批的 `after_id` 为全零 UUID。常规 VACUUM 让释放的空间可复用，文件大小与 WAL 实际变化按维护结果记录。

### 批量提交采集计划

`npm run collect:batch -- output/collect-plan.json` 在本地解析 JSON 计划并汇总任务数和请求条数上限。执行时从环境提供 `COLLECT_API_URL`（经 Caddy 时包含 `/api`）和拥有 `read`、`collect` 权限的来源范围 Machine Key，再给命令加 `--apply`。脚本每轮最多提交 32 项，合并查询状态，按服务端 `Retry-After` 退避，并将进度保存到计划旁的 `.progress.json`。

---

## 2. 历史版本 `main@0.9.1` 的入口与门禁脚本

本节保留 `main@0.9.1` 的历史运维记录。当前版本以本页开头的编译与 Compose 入口及 `package.json` 为准。

```sh
npm ci && npm --prefix apps/web ci
npm run docs:check         # 文档允许清单、唯一规则 ID、链接锚点、5 模块 AST 与 041+ 迁移守卫
npm run lint               # docs:check + apps/web ESLint
npm run typecheck          # 全局 tsc --noEmit
npm run db:migrate
npm run test:unit
npm run test:postgres      # 需独立 loopback 库 TEST_SOURCE_DATABASE_URL
```

---

## 3. 备份恢复与发布包校验命令

以下命令用于数据库备份、隔离恢复与发布包完整性验证（**未经明确授权不得对生产数据运行写动作**）：

```sh
npm run db:backup -- --file output/backups/唯一名称.dump
npm run db:restore -- --file output/backups/唯一名称.dump --target info_workbench_restore_唯一名称
npm run release:pack
npm run release:verify -- output/releases/目录
```

PG16 实测使用不按 schema 过滤的备份归档，将 `pg_trgm` 与搜索索引一并恢复。归档清单在隔离恢复后对账表行数和迁移校验和。备份恢复必须使用版本匹配的完整 PostgreSQL 客户端，禁止直接覆盖活跃生产库，先恢复至独立新库核验迁移摘要后再切流。

本机无端口部署使用 `monitoring-unified` Compose 项目和 `/opt/reddit-monitoring/compose.yml`。安装清单仅包含 `app` 与 `db`，后台采集由 `app` 进程内的 Worker 处理。应用健康由容器内 `/readyz` 检查。切流前使用旧库同版本客户端导出，使用 PG16 客户端还原和应用迁移；最终快照、校验和、对账结果及旧运行文件同存于权限受限的备份目录。回退前先停止新版写入，再根据切流后的写入情况决定旧库的恢复点。

部署使用仓外配置 `/etc/reddit-monitoring/unified.env`，应用版本和镜像摘要记在 `/opt/reddit-monitoring/release`。接续前在当前宿主机核对运行实例、迁移和来源排期：

```sh
git status --short --branch
git ls-remote origin refs/heads/prod
cat /opt/reddit-monitoring/release
docker compose --env-file /etc/reddit-monitoring/unified.env -f /opt/reddit-monitoring/compose.yml -p monitoring-unified ps
docker exec monitoring-unified-db-1 psql -X -U monitoring -d monitoring \
  -c 'SELECT count(*) AS applied, max(filename) AS latest FROM schema_migration' \
  -c "SELECT primary_provider, state, schedule->>'enabled' AS scheduled, count(*) FROM collection_source GROUP BY 1,2,3 ORDER BY 1,2,3"
```

新增 RSS 或 YouTube 频道 Atom 时，将完整地址加入运行配置的 `FEED_ALLOWED_URLS`。候选配置通过 `docker compose config --quiet` 后只重建 `app`。通过来源预览、创建和手动采集接口实抓，核对任务状态及 `content_discovery` 后再启用自动排期。热榜使用内置查询目标和独立渠道预算。更新运行配置前保留仓外备份，并核对宿主机端口映射仍为空。

---

## 4. `twitterapi_io` 与 `arctic_shift` 安全退役操作顺序

执行源码清理与数据库下线前，严格按以下六步推进（已在 `043_kernel_cutover.sql` 落实）：

1. **停领与云端状态盘点**：停掉旧调度器领单，盘点库内 `queued`/`running`/`retrying` 任务与云端回执；收费结果 `unknown` 须先人工核实。
2. **迁移关闭预算与免费回退**：通过前向迁移对 `twitterapi_io` 与 `arctic_shift` 的 `source_provider_budget` 执行 `UPSERT` 禁用与置零额度（递增 `revision`），禁止物理删 `budget` / `usage` 行。
3. **软归档绑旧源逻辑对象**：清理可取消残余任务后，仅把仍绑定旧渠道的 `collection_source` 设 `state = 'archived'`。
4. **历史数据保全**：完整保留库内既有 `content`、`content_discovery`、`content_observation` 与真实历史 `provider` 标识（`001..040` SQL 一律不动）。
5. **预置新渠道零额度预算**：使用 `INSERT ... ON CONFLICT DO NOTHING` 为 `twitterapis`、`scrapebadger`、`kaix`、`red_crawler`、`newsnow`、`feed` 写入默认关闭零额度行。
6. **源码删除与防退化测试**：移除旧连接器文件并全量通过 `docs:check`、`typecheck` 与 PG16 集成验证。

---

## 5. 全阶段历史开发与验证交付台账（`0.2.0 – 0.9.1`，整合原 `docs/history/`）

> 以下记录反映截至 `2026-10-14` 基于旧 `node:http / Express-style PG Repository` 基线的阶段交付事实，后续主线重构与 Phase 1–3 进展以[当前状态与下一阶段](status.md)为准。

### 5.1 里程碑版本总表

| 版本 / 阶段 | 提交 / 本地标签 | 核心交付内容与关键事实 | 历史实测验证记录 |
| :--- | :--- | :--- | :--- |
| **初始快照** | `cd920c5` -> `abd24f5` | Arctic Shift 34 路径核对快照。 | 仅旧小样本留档 |
| **0.2.0 (阶段 1)** | `52636a1` / `local-phase1-v0.2.0` | 修复 17 项既有失败、图表日期并集与生命周期、受控保存路由、`.env.local` 加载及 Windows `local:*` 工具。 | 离线/独立快照 `365` 项（362 pass / 3 SQL skip）；Chromium 合成与 390px 通过 |
| **0.3.0 / 0.3.1 (阶段 2)** | `0a05f41` -> `0496b1d` / `local-phase2-v0.3.1` | `030` 来源生命周期（active/paused/archived）、purpose 互斥、72h 调度模拟、预算 heartbeat 及提前交付工作台导出。 | `0.3.1` 独立全量 `386` 项（382 pass / 4 skip）；真本地 `local:start` 合成链路通过 |
| **0.4.0 (阶段 3)** | `e88ca2e` / `local-phase3-v0.4.0` | `031` X 平台、`032` 请求观测、`TwitterAPI.io` 合成适配、共享 web identity、upsert 规范字段守卫与 JSON/CSV `2,000` 条续页导出。 | 离线 `400` pass / `7` SQL（另跑 7/7）、两套合成 UI 与 34 项 SQL 事务通过 |
| **0.5.0 (阶段 4A)** | `2eab855..a9f5403` / `local-phase4a-v0.5.0` | 修复候选前 20 饥饿、采样/发布口径分离、共用执行政策、`033` 与 CI workflow。 | `425` 离线全通 + `15` 隔离 SQL 全通零 skip |
| **0.6.0 (阶段 4B)** | `0b09c7a` / `local-phase4b-v0.6.0` | 账号权限/审计、`034`、`035`、CAS `revision` 并发保稿与密码/会期隔离。 | `455` 离线 / `24` 原生 SQL 全通零 skip；18 API 请求本地账户/审计验证通过 |
| **0.7.0 (阶段 4C)** | `2e05935` / `local-phase4c-v0.7.0` | 只读库容量预览、`pg_dump`/`pg_restore` RR 恢复演练、580 文件清单发布打包、`systemd` 模板及 2 万/4 万观测基准。 | `460` 离线 / `25` SQL 全通；`580` 文件 SHA 验证通过 |
| **0.8.0 (阶段 5A)** | `f190678` / `local-phase5a-v0.8.0` | `036`、作者/语言/排序、详情与引用、保存查询、个人批注 CAS 与主动媒体预览。 | `471` 离线 / `27` SQL 零 skip；35 请求 PG 内容与 390px 截图通过 |
| **0.9.0 (阶段 5B)** | `e05cd5c` / `local-phase5b-v0.9.0` | `037`/`038`、公共 NFKC 检索索引、RR `research_export`（现已随方案 B 退役）与 `2万内容/4万观测` 性能测量。 | `495` 离线 / `30` SQL 零 skip；633 文件不可变包校验通过 |
| **0.9.1 (收口基线)** | `ddf144f` | `039` 失败分类与源自动阻塞、12–128 字符统一口令、`readyz`/限流/CORS Origin 修补，升级至 40 SQL（含 `040` Bluesky）。 | `511` 离线 / `41` 原生 SQL 全通零 skip；桌面/移动浏览器合成链路通过 |

### 5.2 文档体系去漂移收敛记录（`2026-11-17` – `2026-11-18`）

- **2026-11-17**：将 `docs/history/development-log.md` 与 `docs/history/handoff.md` 并入本文件第 5 节并清理重复目录，确保 `AGENTS.md` 只指向[开发记录](development.md)与[当前状态](status.md)两份唯一真源；`scripts/check-docs.ts` 实施五模块顶层约束、非模板单行 `<= 220` 字符、单文件 `<= 450` 行、AST 禁类/旧层导入及 `041+` 前向迁移号唯一检查。
- **2026-11-18**：完成全仓 54 个生产文件与 48 个 SQL 迁移逐行审计，输出[深度审查与 4GB 单机架构蓝图](research/deep-audit-and-architecture-blueprint-20261118.md)，并对 `docs/README.md`、`docs/status.md`、`docs/architecture.md`、`docs/contracts.md`、`docs/design.md`、`docs/development.md`、`docs/research/data-sources.md` 执行全面去漂移对齐：录入 7 项实存代码缺陷台账、吸收 `KKKKhazix/AIHOT` / `miniflux/v2` / `newsnext/newsnow` / `ItzCrazyKns/Vane` 核心机制、确立“英文一手 AI (`T1`/`T1_5`) + 全球科技数码 + 大众生活娱乐”三大双语高频支柱与 Phase 1–3 唯一实施路线。

### 5.3 统一后端切流与在线采集验证（`2026-11-18`）

| 版本 | 开发与运维记录 | 验证 |
| --- | --- | --- |
| `5ce2e1d` | 新版统一 Fastify 应用与内嵌 Worker 切流，PG14 数据恢复到 PG16；旧服务停用并归档。切流快照和旧运行文件归档至仓外权限受限目录 `/opt/reddit-monitoring-backups/pgt16-cutover.j7N5gume/`。 | 迁移文件校验和、原账户登录、历史内容读取、流式导出、Worker 心跳和宿主机端口。 |
| `dafff76` | 接入 37 个 RSS/Atom，修复请求头兼容性和同一文章跨订阅的版本冲突。 | 首批和首轮自动任务各 37 个成功。 |
| `faa84a8` | 启用 B 站全站热门。 | 首轮自动入库 20 条，保留榜单名次。 |
| `ef9e170` | 接入 7 个 YouTube 频道，存储视频链接、简介和缩略图地址。网页采集支持有界 gzip，普通列表省去搜索投影关联。 | 16 项 PG16 集成测试通过。YouTube 首批和首轮自动任务各 7 个成功，信息流及关键词检索可读。 |
