# 开发记录与运维交付手册（唯一开发与运维真源）

> **核对日期** `2026-11-19` · 本文件是全仓**唯一的环境配置、构建发布、容量运维与历史交付台账真源**（严禁另建 `handoff.md`）。架构原理见[主线架构规范](architecture.md)，产品需求与当前状态见[当前状态与规划](status.md)。

---

## 1. 本地与生产多阶段构建、校验入口

开发依赖 **Node 24+** 与 **PostgreSQL 16**（运行 `test:postgres` 需设置独立回环库 `TEST_SOURCE_DATABASE_URL`）。开发模式入口 `npm run app:api`，生产编译入口 `dist/apps/api/src/server.js`，迁移入口 `node dist/src/storage/schema/run-migrations.js`。

```sh
# 1. 静态、构建与离线单测门禁
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run docs:check         # 文档允许清单、48 规则唯一性、锚点校验、5 模块 AST 与 001..050 不可变检查
npm run lint               # docs:check + apps/web ESLint
npm run typecheck          # API + Web 全局 TypeScript 检查
npm run build              # 编译 API/Worker、Web 静态包并同步 schema/*.sql 至 dist/
npm run test:unit          # 纯函数与打包安全单测（含 DOCUMENTATION_FILES 清单检查）

# 2. 隔离 PG16 全量集成与编译冒烟门禁（不触碰生产库）
npm run test:postgres
npm run smoke:compiled
```

### Dockerfile 多阶段构建注意事项

[Dockerfile](../Dockerfile) 包含三个 stage：`build` → `runtime`（`node:24-alpine`，API+Worker）→ **`proxy`（`caddy:2-alpine`，末段默认阶段）**。
因此手动构建生产镜像时**必须显式指定 `--target`**：

```sh
docker build --target runtime -t monitoring-unified:<tag> .
docker build --target proxy   -t monitoring-unified-web:<tag> .
```

### 本地三服务 Compose 验收

配置 `POSTGRES_PASSWORD`、`SESSION_SECRET`（`>= 32` 字符）、`APP_ORIGIN=https://localhost:8443`、`SITE_ADDRESS=https://localhost`、`HTTPS_PORT=8443`、`TLS_CONFIG='tls internal'` 后执行：

```sh
docker compose -p monitoring-local up --build -d --wait
curl --insecure https://localhost:8443/readyz
docker compose -p monitoring-local stop && docker compose -p monitoring-local up -d --wait
```

---

## 2. 仓外环境变量、渠道配额与扩源实操

私有凭证仅保存在仓外权限受限文件（本机 `~/.config/reddit-monitoring/credentials.env` 或生产 `/etc/reddit-monitoring/unified.env`，目录 `700` / 文件 `600`），严禁写入仓库或前端 `VITE_*`。完整生产状态与分支基准见[当前基线记录](status.md#0-当前生产基线与实测资产清单prod8e436ac)。

```dotenv
NODE_ENV=production
SOURCE_NETWORK_ENABLED=true
# 空值 = 开启动态公网 HTTPS 抓取（经 src/connectors/web/http.ts 全部 DNS 公网 IP 严格校验）
# 非空 = 仅放行逗号分隔的白名单 URL
FEED_ALLOWED_URLS=
WORKER_CONCURRENCY=6
APIFY_API_TOKEN=
TWITTERAPIS_API_KEY=
SCRAPEBADGER_API_KEY=
# V2 Phase D 可选扩展（未配置时 100% 确定性零模型运行）
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

### 渠道与调优关键参数

| 变量 / 功能 | 当前生效行为与边界说明（`prod@8e436ac` 核实） |
| :--- | :--- |
| **`FEED_ALLOWED_URLS`** | 自 `8e436ac` 起不再强制要求每加一条 RSS 就写白名单并重启容器；**留空即启用全 DNS 公网校验后的动态公网 HTTPS 抓取**，填写则恢复严格白名单模式。 |
| **`WORKER_CONCURRENCY`** | 默认 `6` 协程并发消费采集队列（硬钳制区间 `[1, 12]`），配合 `1500ms` 同域冷却与 `workerPool (max=4)` 防止单站并发撞墙或拖垮读库连接池。 |
| **`POST /v1/sources/import`** | 管理员浏览器会话可通过 `Content -> Import` 或 API 一次性提交 `format: "opml"`（<=512 KiB OPML 2.0 XML）或 `format: "json"`（1–200 条），走 `ON CONFLICT DO NOTHING` 幂等跳过已存在来源，新增订阅**无需重启容器**。 |
| **`APIFY_API_TOKEN`** | `kaix`（主力 Reddit 搜索与贴评水合）与 `red_crawler`（备源）共用；`red_crawler` 不支持 `account` 目标；`hydrate` 每次最多勾选 30 根帖、每帖最多 50 评论。 |
| **`TWITTERAPIS_API_KEY` / `SCRAPEBADGER_API_KEY`** | 超时区间 `[100, 120000]ms`（默认 `20000ms`）。`twitterapis` 单页硬钳制 `<= 20` 条；`scrapebadger` 支持批量 ID 刷新 `POST /v1/sources/:id/refresh`（每批 1–20 条）。 |

### 生产巡检常用命令（仅读观察）

```sh
git -C /root/workspaces/reddit-monitoring-mvp status --short --branch
cat /opt/reddit-monitoring/release
docker compose --env-file /etc/reddit-monitoring/unified.env -f /opt/reddit-monitoring/compose.yml -p monitoring-unified ps
docker exec monitoring-unified-db-1 psql -X -U monitoring -d monitoring   -c 'SELECT count(*) AS applied, max(filename) AS latest FROM schema_migration'   -c "SELECT source_group, primary_provider, count(*) FROM collection_source WHERE state='active' GROUP BY 1,2 ORDER BY 1,2"
```

---

## 3. 备份恢复、容量观测与日常运维

### 4 GB RAM / 60 GB 磁盘单机配额基线

- **宿主机防护**：开启 `2 GiB /swapfile`（`vm.swappiness=10, vm.vfs_cache_pressure=50`），`journald` 设置 `SystemMaxUse=100M`；公网反代时使用 Cloudflare Authenticated Origin Pulls (mTLS) + `DOCKER-USER` 防火墙链封堵绕过 CDN 的 `:443` 直连，保持 `db` 零宿主机端口映射。
- **Compose 实配上限**（[docker-compose.yml](../docker-compose.yml)）：`db: 1350m`、`app: 1536m`、`proxy: 128m`（容器日志统一 `json-file max-size=10m, max-file=3`）。
- **备份与发布包校验**（变更生产库前必跑物理导出与目录校验）：

```sh
# 在仓库目录使用内置脚本，或直接容器化 pg_dump -Fc 并用 pg_restore --list 验真
npm run db:backup -- --file output/backups/<unique-name>.dump
npm run db:restore -- --file output/backups/<unique-name>.dump --target info_workbench_restore_check
npm run release:pack
npm run release:verify -- output/releases/<dir>
```

### 生产容量、死元组与保留窗口观测 SQL

`050` 已物理移除 `normalized_title` / `normalized_text` 冗余双列并把 `search_text` 正文索引控制在 1,500 字符；同时 `worker.ts` 每小时自动执行一次 `source_collection_job` 滚动清理（保留每个来源最新 5 条及 14 天内任务）。日常排查磁盘与健康状态统一运行以下只读查询：

```sql
-- 1. 库总大小、前 10 大表体积与死元组率
SELECT now(), pg_size_pretty(pg_database_size(current_database())) AS db_size;
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_sz,
       n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12;

-- 2. 来源健康与截断/失败异常定位
SELECT label, source_group, primary_provider,
       (health->>'lastDurationMs')::numeric AS last_ms,
       (health->>'lastTruncated')::boolean AS truncated,
       (health->>'consecutiveFailures')::int AS failures,
       health->>'lastError' AS last_error
FROM collection_source
WHERE state = 'active'
  AND ((health->>'lastTruncated')::boolean IS TRUE OR COALESCE((health->>'consecutiveFailures')::int, 0) > 0)
ORDER BY failures DESC, last_ms DESC NULLS LAST;

-- 3. 渠道当日预算消耗对账
SELECT u.provider, u.day, u.requests, b.daily_requests, u.resources_reserved, b.daily_resources
FROM source_provider_usage u
JOIN source_provider_budget b USING (provider)
WHERE u.day >= (now() AT TIME ZONE 'UTC')::date - 1
ORDER BY u.day DESC, u.provider;
```

**长期 30d / 90d 分层保留维护建议**（当单库增长至数 GB 级别后在维护窗口按需执行）：
- **永久保留**：所有 `content` 行去重身份/标题/引用骨架，以及被 `content_annotation` 收藏/批注或绑定活跃 `monitor_project` 的完整正文与搜索投影；
- **30 天观测折叠**：超过 30 天的 `content_observation` 按 `(content_id, collection_source_id)` 仅保留最新 1 条快照；
- **90 天冷正文微缩**：超过 90 天且无收藏/项目绑定的条目删其 `public_content_search_document` 行并将 `body_text` 截保留前 500 字摘要（`platform_details.textState = 'truncated'`）。

---

## 4. `twitterapi_io` 与 `arctic_shift` 安全退役记录（已完成）

两项高成本/脆弱旧渠道已随 `043_kernel_cutover.sql` 与 `050` 完成彻底源码删除与库内软归档：
1. `source_provider_budget` 中 `arctic_shift` 与 `twitterapi_io` 已保持 `enabled = false` 与全零配额；历史保留的 `content_observation` 与 `content` 行保留真实历史 `provider` 标识不可删除；
2. 主线代码与依赖中已零残留 `twitterapi-io*` 与 `arctic-shift-content.connector.ts`。

---

## 5. 全阶段历史交付与演进台账（`0.2.0 – 0.9.1` 至 `050+`）

### 5.1 早期旧运行时里程碑（`0.2.0 – 0.9.1`，`node:http` 基线留档）

| 版本 / 阶段 | 提交 / 标签 | 关键历史事实（旧链，现已被 Fastify 5 内核与 `050` 取代） |
| :--- | :--- | :--- |
| **初始至 0.4.0** | `cd920c5`..`e88ca2e` | `001..032` 初始化、X 平台适配、工作台导出与共享 Web 身份。 |
| **0.5.0 – 0.7.0** | `a9f5403`..`2e05935` | `033..035` 并发安全、CAS `revision`、账号权限与 PG 备份/发布验真脚本。 |
| **0.8.0 – 0.9.1** | `f190678`..`ddf144f` | `036..040` 保存查询、个人批注、`public_content_search_document`、`research_export`（后于 `050` 清理）。 |

### 5.2 主线重构、上线切换与 `050` 升级台账（`2026-11-17` – `2026-11-19`）

| 里程碑 / 提交 | 执行动作与实测结果 | 备份与验证证据 |
| :--- | :--- | :--- |
| **R1–R3 内核重建 (`041..046`)** | 物理移除 `create-api-server.ts`、27 个单实现 Repository 与 14 个 `InMemory*` 模拟；收敛至 Fastify 5 + TypeBox 5 模块扁平内核、`commitContentBatch` 4×`UNNEST` 与流式导出。 | `docs:check`、`typecheck`、PG16 集成套件通过。 |
| **`5ce2e1d..ef9e170` (`047..048`)** | 生产从 PG14 + 旧进程切换至 PG16 + `monitoring-unified` 单应用容器（`/opt/reddit-monitoring-backups/pgt16-cutover.j7N5gume/`）；上线双字词 GIN、`lz4`、自适应排期、`bilibili-hot-video` 与 7 个 YouTube Atom。 | 登录、导出、Worker 心跳与 37 RSS / 7 YouTube 任务全成功。 |
| **`7ff733c` (`049`)** | 引入 `tier`（`T1`/`T1_5`/`T2`）与 `ownerEntityId`，上线 `/v1/content/stories`（latest/hot/digest）、知乎热榜与 Google Trends；随后两轮补源扩充至 **100 个活跃源**。 | `monitoring-unified:20261118-stories` 上线验收。 |
| **`8e436ac` (`050` / `20261119-v2`)** | 执行 `050_legacy_cleanup_and_schema_upgrade.sql`：实删 27 张零行历史表（47→20）及死列；激活 `source_group`、新增 `tags`/`locale`/`fetch_policy`/`health` 并回填 100 源；搜索正文截断 1,500 字；解除 `FEED_ALLOWED_URLS` 硬绑定、`6` 并发+`1.5s` 同域冷却、真 304/耗时统计、`newsnow` 改 1h 快照桶、`preParsing` 限流前移及 `POST /v1/sources/import` 上线。 | 备份 `/opt/reddit-monitoring-backups/pre-050-20261119T135511Z/`（332 TOC 验证）；`typecheck`、`lint`、`build`、`test:unit` (20/20)、`test:postgres` (24/24) 全通过；生产 `/readyz` 200，App ~104 MiB / DB ~91 MiB。 |
| **文档全量重对齐 (`2026-11-19`)** | 清理 `prod` 全套规范与手册中的 pre-050 漂移；完成 `feat/semrush-frontend-rebuild@dbf8713` 逐项蒸馏融合设计；确立 V2 Phase A–D 与 `20 → <=26` 表节制演进规范并推送至 `origin/prod`。 | `npm run docs:check`、`lint`、`typecheck`、`test:unit` 与 `taste_judge` 全通过。 |
