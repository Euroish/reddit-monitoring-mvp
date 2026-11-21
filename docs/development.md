# 开发记录与运维交付手册（STD-100 唯一真源）

> **核对基准**：`2026-11-20` · 团队分支治理、环境构造、Docker 多阶段构建、PG16 运维与历史交付台账唯一真源（禁另起 `handoff.md`）。架构见[主线架构](architecture.md)，现状与规划见[当前状态](status.md)。

---

## 0. 团队分支治理与 AI 协作准则

本仓面向 2–3 人 + AI 高频并行开发，采用 **单主干（Trunk-Based）+ 短任务分支 + 不可变发布 Tag**，不设常驻 `develop` / `prod` 双主干，直接匹配 `.github/workflows/verify.yml`（PR 全量门禁）与 `.github/workflows/release.yml`（`v*` Tag 镜像构建）。

### 0.1 分支与发布角色

| 引用 | 职责与权限 | 生命周期 |
| :--- | :--- | :--- |
| **`main`** | **全仓唯一集成与发布主干**。开启分支保护，禁直接 `push` / `force-push`，仅接受 CI 全绿 PR 的 `Squash and Merge`。 | 永久 |
| **`feat/<模块>-<短名>`** | 新功能分支（如 `feat/access-quotas`、`feat/web-reader`），永远从最新 `origin/main` 切出。 | `<= 3` 天，合后即删 |
| **`fix/<短名>`** | 缺陷修复或线上紧急热修，从 `origin/main` 切出。 | `<= 1` 天，合后即删 |
| **`vX.Y.Z`（Tag）** | 正式发版与回滚锚点（触发 `release.yml` 构建 `runtime`/`proxy` 镜像）；预演使用 `vX.Y.Z-rc.1`，不另建长期分支。 | 永久不可变 |

### 0.2 合并秩序与 AI 解冲突四条护栏

原则：**先过审先合入，后合者自行同步最新 `main` 解冲突并自证无回归**。

```sh
# 1. 开工前基于最新 main 切短分支
git fetch origin && git checkout -b feat/<module>-<topic> origin/main
# 2. 合入前若 main 已推进，同步最新 main（严禁跨分支拷贝文件覆盖提交，防止切断共同祖先链）
git fetch origin && git merge origin/main   # 个人短分支可用 git rebase origin/main
# 3. 冲突解决后必须核对变更边界再推送
git diff origin/main --stat
npm run docs:check && npm run lint && npm run typecheck && npm run test:unit && npm run build
```

1. **明确 AI 解冲突底线**：要求 AI *“以 `origin/main` 现有行为、鉴权与测试为不可破坏底线，仅叠加本分支增量，不得为编译通过删改 `origin/main` 新增逻辑或测试”*。
2. **强制 `diff --stat` 审计**：推送前人工扫一眼 `git diff origin/main --stat`，凡出现无关模块改动或测试大段删减立即拦截重解。
3. **只认全量 CI 绿灯**：含冲突解决的 PR 须过 `verify.yml` 全链（`gitleaks`、`docs:check`、`lint`、`typecheck`、`test:unit`、`test:postgres`、`build`、`smoke:compiled`、`test:browser`），且统一 **Squash and Merge** 以便一键 `git revert`。
4. **控制 PR 体积消灭巨型冲突**：单 PR 目标 `<= 500` 行净变动；超 `3000` 行必须拆为垂直小切片（`迁移/契约 PR → 后端 PR → 前端接入 PR`），未完结入口先用开关隐藏、每日合入 `main`。

### 0.3 四大冲突热区与轻量同步约定

- **SQL 迁移（`src/storage/schema/`）**：`001..050` 及已合入 `main` 的迁移严禁改写；**编号先合先占**，后合者同步时顺延重编号；PR 必须声明 `表变更：+N（总计 X/24）`。
- **共享契约（`packages/contracts/src/*`）**：唯一契约真源，严禁在前端复制平行副本或做破坏式字段重命名；多方共享契约变更先发小 PR 合入 `main`。
- **入口与前端架构**：`app.ts` / `App.tsx` 保持薄装配；首页 `/` 严禁引入 ECharts（原生 SVG 微图），分析页统一 `React.lazy` 模块化 `echarts/core`；后端守五模块 `<= 450` 行/文件与 `<= 220` 字/代码行。
- **文档白名单与开工声明**：严禁在 `DOCUMENTATION_FILES`（15 份）外随意新建 `.md`，代码变动同 PR 增量更新对应文档条目。开分支前发 1 行同步：`[feat/xxx] 负责人：@A | 触碰区域：... | 新迁移：无/+N表`；PR 描述附 3 行：**变更摘要 / 影响范围（表、契约、冲突清单）/ 验证结果**。

---

## 1. 构建、测试与 Compose 多阶段验收

开发与构建要求 **Node 24+** 与 **PostgreSQL 16**（`test:postgres` 需独立回环库 `TEST_SOURCE_DATABASE_URL`）。开发入口 `npm run app:api`，发布入口 `node dist/apps/api/src/server.js`，迁移入口 `node dist/src/storage/schema/run-migrations.js`（长超时 `600s`、按 SHA-256 严格核对已应用 SQL）。

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run docs:check         # 15 文档清单、48 规则、链接/锚点、5 模块 AST、001..050 迁移不可变与 >=041 前缀唯一校验
npm run lint               # docs:check + apps/web ESLint
npm run typecheck          # API + Web 全局 tsc 校验
npm run build              # 编译 dist/、apps/web/dist/ 并同步 schema/*.sql 至 dist/
npm run test:unit          # 纯函数与打包清单单测
npm run test:postgres      # 隔离 postgres:16-alpine PG16 集成套件
npm run smoke:compiled     # 编译态迁移、readiness、登录与 SIGTERM 冒烟
```

### Dockerfile 多阶段构建（CRITICAL）

[Dockerfile](../Dockerfile) 包含 `build` → `runtime`（API+Worker）→ **`proxy`（`caddy:2-alpine`，末段默认输出）**。构造生产服务端镜像 `MUST` 显式加 `--target runtime`：

```sh
docker build --target runtime -t monitoring-unified:<tag> .
docker build --target proxy   -t monitoring-unified-web:<tag> .
```

### 本地三服务 Compose 验收

设置 `POSTGRES_PASSWORD`、`SESSION_SECRET`（`>=32` 字符）、`APP_ORIGIN=https://localhost:8443`、`SITE_ADDRESS=https://localhost`、`HTTPS_PORT=8443`、`TLS_CONFIG='tls internal'` 后执行：

```sh
docker compose -p monitoring-local up --build -d --wait
curl --insecure https://localhost:8443/readyz
docker compose -p monitoring-local stop && docker compose -p monitoring-local up -d --wait
```

---

## 2. 仓外环境变量、渠道配额、批量导入与采集工具

真实密钥仅存于仓外受限文件（本机 `~/.config/reddit-monitoring/credentials.env` 或生产 `/etc/reddit-monitoring/unified.env`，权限 `700/600`），`MUST NOT` 写入 Git 或 `VITE_*`。运行实例核查见[当前主干基线](status.md#0-当前主干基线与实测资产清单live)。

```dotenv
NODE_ENV=production
SOURCE_NETWORK_ENABLED=true
# 留空 = 开启全 DNS 公网 IP 校验下的动态 HTTPS 抓取；非空 = 仅放行逗号分隔白名单
FEED_ALLOWED_URLS=
WORKER_CONCURRENCY=6
CREDENTIALS_MASTER_KEY=
APIFY_API_TOKEN=
TWITTERAPIS_API_KEY=
TWITTERAPIS_TIMEOUT_MS=20000
SCRAPEBADGER_API_KEY=
SCRAPEBADGER_TIMEOUT_MS=20000
# [V2 Phase D] 可选 AI 翻译与综述扩展（未配置时 100% 确定性零模型运行）
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

- **动态扩源与 OPML 批量导入**：管理员在前端 **`/sources`** 页面或直接调 `POST /v1/sources/import` 批量提交 JSON（1–200 条）或 OPML 2.0 XML（`<=512 KiB`），遇已存在源走 `ON CONFLICT DO NOTHING` 跳过；`FEED_ALLOWED_URLS` 留空时无需重启容器即可生效。
- **`WORKER_CONCURRENCY`**：`docker-compose.yml` 透传该环境变量至 `app`（钳制区间 `[1, 12]`，默认 `6` 协程 + `1500ms` 同域冷却）。
- **外部 API 参数口径**：`TWITTERAPIS_TIMEOUT_MS` / `SCRAPEBADGER_TIMEOUT_MS` 允许 `[100, 120000]ms`（默认 `20000ms`）；`twitterapis` 单页 `<=20`，`scrapebadger` 支持 `POST /v1/sources/:id/refresh` 批量刷推文（`1..20` ID）；`APIFY_API_TOKEN` 由 `kaix` 与 `red_crawler` 共用，`POST /v1/projects/:id/hydrate` 当前仅走 `kaix`（`<=30` 根帖 × `50` 评论）。
- **离线批量采集计划（`collect:batch`）**：`npm run collect:batch -- output/collect-plan.json` 校验并汇总计划后，配 `COLLECT_API_URL`（经 Caddy 时须包含 `/api` 前缀）与限定范围的 `read`/`collect` Machine Key 加 `--apply` 提交（每轮 32 项、遵守 `Retry-After`、断点存 `.progress.json`）。

---

## 3. 单机 4 GB / 60 GB 安全加固、备份恢复与运维 SQL

### 边缘防火墙与单机配额

- **宿主机防护**：配 `2 GiB /swapfile`（`vm.swappiness=10, vm.vfs_cache_pressure=50`），`journald` `SystemMaxUse=100M`；**注意 Docker 映射端口（`0.0.0.0:443:443`）会直接写入 `iptables nat PREROUTING` 从而绕过 `ufw`**，公网部署 `MUST` 在 Caddy 开启 Cloudflare Authenticated Origin Pulls (mTLS) 并在宿主机 **`DOCKER-USER` 链** 限制仅放行 Cloudflare IPv4/IPv6（或保持 `PROXY_BIND=127.0.0.1` 配隧道零公网端口暴露，同时 `db` 禁宿主机端口映射）。
- **Compose 配额**（[docker-compose.yml](../docker-compose.yml)）：`db: 1350m`、`app: 1536m`、`proxy: 128m`，容器日志 `json-file (max-size=10m, max-file=3)`。

### 备份、隔离恢复与发布校验

```sh
# 若宿主机默认 psql/pg_restore 为旧版，通过 PG_BIN=/path/to/pg16/bin 指定 PG16 客户端
# 备份归档不按 schema 过滤，以连带恢复 public 下的 pg_trgm 扩展与索引；恢复须先落独立测试库验真
npm run db:backup -- --file output/backups/<unique-name>.dump
npm run db:restore -- --file output/backups/<unique-name>.dump --target info_workbench_restore_check
npm run release:pack
npm run release:verify -- output/releases/<dir>
```

### 生产只读巡检与 30d/90d 安全维护原则

```sh
git -C /root/workspaces/reddit-monitoring-mvp status --short --branch
cat /opt/reddit-monitoring/release
docker compose --env-file /etc/reddit-monitoring/unified.env -f /opt/reddit-monitoring/compose.yml -p monitoring-unified ps
```

```sql
-- 1. 库总体积与 Top 12 表/索引大小及死元组观测
SELECT now(), pg_size_pretty(pg_database_size(current_database())) AS db_size;
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_sz,
       n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12;

-- 2. 来源健康异常排查（截断/失败/高耗时）
SELECT label, source_group, primary_provider,
       (health->>'lastDurationMs')::numeric AS last_ms,
       (health->>'lastTruncated')::boolean AS truncated,
       (health->>'consecutiveFailures')::int AS failures,
       health->>'lastError' AS last_error
FROM collection_source
WHERE state = 'active'
  AND ((health->>'lastTruncated')::boolean IS TRUE OR COALESCE((health->>'consecutiveFailures')::int, 0) > 0)
ORDER BY failures DESC, last_ms DESC NULLS LAST;

-- 3. 渠道日配额消耗核对
SELECT u.provider, u.day, u.requests, b.daily_requests, u.resources_reserved, b.daily_resources
FROM source_provider_usage u JOIN source_provider_budget b USING (provider)
WHERE u.day >= (now() AT TIME ZONE 'UTC')::date - 1
ORDER BY u.day DESC, u.provider;
```

- **自动作业清理**：`worker.ts` 每小时自动清理各来源最新 5 条以外且超过 14 天的终结 `source_collection_job`。
- **30d / 90d 分层维护窗口**：
  - 永久保留所有 `content` 身份骨架与被 `content_annotation`/活跃 `monitor_project` 引用的条目完整正文；
  - 30 天超期历史 `content_observation` 按 `(content_id, collection_source_id)` 折叠仅留最新 1 条；
  - 90 天冷内容清理（因 `search.ts` 使用 `LEFT JOIN` 且 `workspace/sql.ts` 不连搜索表，删投影行不会导致详情/评论树/收藏不可读）：按批清理未收藏/未入项目冷条目的 `public_content_search_document` 行，可选将 `body_text` 截断保留前 500 字摘要并更新 `platform_details = platform_details || '{"textCompleteness":"summary"}'::jsonb`（**禁止写入无效键 `textState`**）。

---

## 4. `twitterapi_io` 与 `arctic_shift` 安全退役记录

1. `source_provider_budget` 中 `arctic_shift` 与 `twitterapi_io` 已通过前向迁移设为 `enabled = false` 与全零额度；
2. 主线已彻底删除 `twitterapi-io*` 与 `arctic-shift-content.connector.ts`，同时完整保留历史 `content`、`content_observation` 真实 `provider` 标识不可物理删除。

---

## 5. 全阶段交付与演进台账

### 5.1 早期 `0.2.0 – 0.9.1`（旧 `node:http` 基线留档）

| 版本 | 提交范围 | 核心交付里程碑 |
| :--- | :--- | :--- |
| **`0.2.0 – 0.4.0`** | `52636a1`..`e88ca2e` | `001..032`：Phase 1–3 修复、图表口径、来源生命周期、X 平台适配、共享 web 身份与 2,000 条导出 |
| **`0.5.0 – 0.7.0`** | `a9f5403`..`2e05935` | `033..035`：调度并发安全、账号审计、CAS `revision`、`pg_dump`/`pg_restore` 与不可变发布包验证 |
| **`0.8.0 – 0.9.1`** | `f190678`..`ddf144f` | `036..040`：个人查询/批注、公开检索投影、`Bluesky` 接入与桌面/移动合成校验 |

### 5.2 主线重整、`050` 升级与规范收敛台账

| 里程碑 / 提交 | 执行动作与实测结果 | 备份与验证记录 |
| :--- | :--- | :--- |
| **R1–R3 内核重构 (`041..046`)** | 物理实删 `create-api-server.ts`、27 个单实现 `Repository` 与 14 个 `InMemory*`；落地 Fastify 5 五模块内核、`4×UNNEST` 批写与 `QueryStream` 导出。 | `docs:check`、`typecheck`、PG16 集成测试通过 |
| **`5ce2e1d..ef9e170` (`047..048`)** | 生产从 PG14 + 旧进程迁至 PG16 + `monitoring-unified`（备份 `/opt/reddit-monitoring-backups/pgt16-cutover.j7N5gume/`）；上线双字词 GIN、`lz4`、自适应排期、`bilibili-hot-video` 与 7 YouTube 频道。 | 登录、导出、Worker 心跳与 37 RSS / 7 YouTube 任务通过 |
| **`7ff733c` (`049`) + 百源扩容** | 上线 `tier`/`ownerEntityId` 与 `/v1/content/stories`（latest/hot/digest）、知乎/Google Trends（备份 `/opt/reddit-monitoring-backups/pre-stories.GBRV4l/`）；解决 UTC 02:32 Feed 额度耗尽问题并扩充至 **100 个活跃源**。 | `monitoring-unified:20261118-stories` 上线验收 |
| **`8e436ac` (`050` / `20261119-v2`)** | 执行 `050` 删 27 张历史零行表（47→20）及冗余列；启用 `source_group`/`tags`/`locale`/`fetch_policy`/`health`、1,500 字索引上限、`FEED_ALLOWED_URLS` 动态 HTTPS、`6` 并发+`1.5s` 冷却、`newsnow` 1h 桶、`preParsing` 限流与 `POST /v1/sources/import`。 | 备份 `/opt/reddit-monitoring-backups/pre-050-20261119T135511Z/`（332 TOC 验证）；`typecheck`、`lint`、`build`、`test:unit` (20/20)、`test:postgres` (24/24) 全通；`/readyz` 200 |
| **`f4ef2a8` + STD-100 加固** | 升级 `check-docs <= 50` 迁移守卫、`app.ts` `/v1/content/*` 方法级鉴权、`search.ts` `LEFT JOIN` 防冷删隐身、`docker-compose.yml` 透传 `WORKER_CONCURRENCY`；全套 15 文档收敛为 STD-100 精确规格与 V2 Phase A–D 蓝图并同步至 `origin/prod`。 | `docs:check`、`lint`、`typecheck`、`build`、`test:unit`、隔离 PG16 `test:postgres` 与 `smoke:compiled` 全通过 |

- **`2026-11-20` 开放式编辑部重构与源治理（`20261120-v3`）**：开放匿名只读白名单（`/v1/public/sources` 与内容只读接口）及 `PUBLIC_REGISTRATION_ENABLED` 免邀请码 `viewer` 注册；`/v1/content/stories` 升级为 7 天 `latest` 窗 + `offset/nextOffset/totalCount` 分页 + 单源防刷屏混排 + 默认隔离 `social-trends`；修复 `google-trends-us` 优先取 `<ht:news_item_url>` 主链与真实标题并新增 `excludeTitlePatterns` 与 4h 退避上限；重做编辑部纸面 UI、左侧 8 频道导航、右侧阅读抽屉与登录注册弹窗；完成 `pg_dump` 物理备份后归档 7 个重度营销/灌水源、升级 V2EX 技术节点并补入 8 个高信噪一手源。
- **`2026-11-20` 单主干 `main` 统一融合与冗余裁剪**：将 `prod@254213b` 完整历史无强推合入 `main`，融合 `dev/siftline-workbench`（归档于 `archive/dev-siftline-20261120`）的加密凭证库（`051`）、Free/Pro 动态配额与 RBAC（`052`，总表 `23/24`）及裁剪后的 Siftline 前端（去除静态营销页、1.7 MB 无用图、多主题工坊、R4 离线面板与违背 `MET-04` 的虚假图表，改用 `React.lazy` 模块化 `echarts/core` 并补齐开放阅读 `StoriesPage` 与 `/v1/public/sources` 适配）；同步修复 `worker.ts` 连接池潜在死锁、`policy.ts` 跨渠道配额竞态、`credentials.ts` 探测异常与 `jobs.ts` 重试配额计算，退役 `prod` 与 `dev/siftline-workbench` 分支并落地团队单主干协作准则。
