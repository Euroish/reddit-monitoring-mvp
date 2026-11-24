# 开发流程、CI 门禁与生产运维手册

本文为团队单主干协作、CI 验证分流、本地隔离测试、Docker 多阶段构建及单机 4 GB 生产运维的唯一操作手册。架构与边界约束见 [architecture.md](architecture.md) 与 [invariants.md](invariants.md)。

---

## 1. 单主干协作与冲突治理

从最新 `main` 开发，按能独立验证、交付与回退的范围组织改动；不规定分支名称或存续天数。走 GitHub 评审与 `CI Gate` 后 Squash 合入。发版用不可变版本 Tag，发布 runtime 和 proxy 镜像。遇到并行改动，核实契约、鉴权、迁移与写入口的实际重叠，按影响重测，不按 PR 编号决定合入顺序。

### 1.1 变更准入与工程质量

审查以结果为准：改动是否解决实际问题、行为是否正确、失败是否可控，以及设计是否比可行的更简单方案更难维护。按风险追踪真实调用者、状态所有者及故障路径。优先复用已有能力，消除重复状态和规则；不为缩短函数、减少行数或贴合命名而拆包装。不设代码规模、复杂度或操作次数配额。

PR 自由描述。只提供有助于判断的背景、实际验证结果和相关风险；没有固定章节、自评、截图数量或交付清单。评审不以是否填表或是否按期完成作结论。用可指出的行为、风险或维护代价说明阻断理由；看重安全、隐私、数据和付费行为的验证，不把自查、CI 或截图当成独立批准。

测试按风险选最便宜的有效证据。优先复用或扩展已有测试；重复覆盖、只锁内部实现或不能发现真实回退的测试可以删除。数据持久化、事务与并发用隔离 PG16 验证，路由契约可用 Fastify `inject()`，浏览器测试覆盖关键用户任务。交互改变时检查实际操作、权限、错误恢复和受影响的无障碍场景。未运行、未覆盖及仍有风险的事项如实说明。

---

## 2. CI 分层门禁与测试组织

`.github/workflows/verify.yml` 和 `scripts/ci-scope.mjs` 按改动分流。公共任务检查密钥、仓库链接和迁移历史，不安装应用依赖；`CI Gate` 汇总实际需要的任务。不检查 PR 描述、标签或圈复杂度。分支保护和 CODEOWNERS 不变。

| 改动范围 | 自动验证 |
| :--- | :--- |
| 文档、PR 模板、仓库策略脚本 | 公共任务；不跑应用套件 |
| 工作流、CI 分流 | 工作流语法与分流测试；与产品改动同批时叠加对应检查 |
| 后端、集成测试、迁移 | 后端类型、lint、架构、OpenAPI、单元测试、PG16 与编译冒烟；新迁移另跑 Squawk。只改单元测试或后端 lint/架构配置不加跑 PG16 |
| 前端、浏览器测试 | Web 构建、包密钥检查及受影响的 Chromium 测试入口；只改 Web lint 配置不跑浏览器 |
| 共享契约与依赖 | 双端与 PG16；共享契约加浏览器验证 |
| Docker、部署文件 | 容器校验 |

推送主干同样按影响执行，不重复拉起无关套件。需要完整组合验证时手动运行 Core verification；版本 Tag 保留完整项目验证，发布构建另生成镜像。安全工作流定期运行全历史密钥扫描、生产依赖与镜像检查。

---

## 3. 本地开发、PG16 测试与常用 CLI

环境依赖 **Node 24+** 与 **PostgreSQL 16**（`test:postgres` 强校验回环地址与 `source_validation_*` 库名）：

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run lint                  # 串联 lint:policy + lint:api + lint:arch + lint:web
npm run typecheck             # 服务端 tsc + 前端 apps/web tsc
npm run check:openapi         # 零库启动验证 OpenAPI 3.x 与 100% 声明式鉴权
npm run test:unit             # 全量单元测试
npm run build && npm run check:web-bundle   # 编译前后端、同步 SQL/历史资产并扫描前端包密钥泄漏
```

使用一次性隔离 `postgres:16-alpine` 容器跑真实 PG16 集成测试与编译冒烟：

```sh
docker run -d --rm --name pg16-dev-test -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=source_validation_v2 postgres:16-alpine
export TEST_SOURCE_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/source_validation_v2"
npm run test:postgres && npm run smoke:compiled
docker stop pg16-dev-test
```

- **离线 AI 历史数据工具**：`npm run ai:history:validate|plan|apply|backfill`（详见 `data/ai/history/README.md`）。
- **离线批量触发采集**：`npm run collect:batch -- output/collect-plan.json`（配 `COLLECT_API_URL` 与限定作用域 Machine Key 加 `--apply` 提交）。

---

### PR #32 迁移兼容与 Worker 边界

- 主干已合入 `059_project_batches_and_ownership.sql`、`060_batch_visibility_and_field_policy.sql`，文件名及 SHA-256 必须保持不变；PR #32 已合入，V2 迁移编号为 `061–064`，同样受不可变约束。回归覆盖 `058 → 064`、保有项目/批次的 `060 → 064` 及幂等重跑。
- 曾应用旧 PR #32 `059–062` 的开发库不能直接套用新编号。可丢弃的测试库重建；需保留数据的库先备份、核实 `schema_migration` 文件名与哈希，再单独制定台账转换方案。禁止清空台账或关闭校验来绕过升级。
- `WorkerHooks.onProjectBatchCommitted` 在内容事务内执行，关联失败回滚整页；`onSourceContentCommitted` 在提交后执行，回算/自动水合失败独立记录，不能触发已提交采集重放。
- 批次累计数按实际新增 membership 增量维护；历史批次即使任务已清理也阻止来源物理删除，改为归档。

### V2 上线前核对信源与预算

先在隔离恢复库记录迁移前配置，再应用候选版本并按来源 ID 和供应商对比。`061` 会停掉命中的被动媒体来源，并抬高四个社媒渠道的日月预算。先让运维确认有意归档的来源、应保留的官方发布源及预算值，再启用对外采集。

```sql
SELECT cs.id, cs.label, cs.source_group, cs.state, cs.schedule, cs.next_due_at
FROM collection_source cs
WHERE NOT EXISTS (SELECT 1 FROM ai_vendor_source avs WHERE avs.source_id=cs.id)
  AND (cs.source_group IN ('public-affairs','lifestyle','tech-media','design-visual','science')
    OR cs.label ~* '(v2ex|bilibili|zhihu|ithome|ifanr|cnbeta|technews|google\.com/trends|google-trends)'
    OR cs.target::text ~* '(v2ex|bilibili|zhihu|ithome|ifanr|cnbeta|technews\.tw|google-trends|trends\.google)')
ORDER BY cs.label, cs.id;

SELECT provider, enabled, daily_requests, monthly_requests, daily_resources, monthly_resources, minimum_interval_ms
FROM source_provider_budget
WHERE provider IN ('kaix','red_crawler','twitterapis','scrapebadger')
ORDER BY provider;
```

对误归档项使用来源管理恢复既有 ID，并按迁移前记录恢复状态和调度。按确认后的配置恢复渠道预算，再验证公开首页与 `/app/feed` 有代表性来源、旧研究项目可查、Worker 未出现异常付费排队。保留迁移前清单以便失败时回退与复核。

已经运行过 `063` 的环境还需在应用 `065` 后检查历史 `monitor_only` 来源。以下结果是待核对清单。只有核实来源归属和实际用途后，才从来源管理关闭无人使用的调度。已经发起的请求遵循原有未决付费处理流程。

```sql
SELECT cs.id, cs.label, cs.state, cs.schedule, COUNT(m.id) AS enabled_monitor_refs
FROM collection_source cs
LEFT JOIN intel_monitor_source ms ON ms.collection_source_id=cs.id
LEFT JOIN intel_monitor m ON m.id=ms.monitor_id AND m.enabled
WHERE cs.feed_lane='monitor_only' AND NOT cs.monitor_managed
  AND cs.schedule @> '{"enabled":true}'
GROUP BY cs.id
ORDER BY enabled_monitor_refs, cs.label, cs.id;
```

## 4. Docker 多阶段构建与单机 Compose

[Dockerfile](../Dockerfile) 依次定义 `build` -> `runtime` -> **`proxy`（默认末段目标）**。打包生产镜像必须显式指定 `--target` 并传入同一提交 SHA 标签：

```sh
docker build --target runtime --label org.opencontainers.image.revision=$(git rev-parse HEAD) -t monitoring-unified:<tag> .
docker build --target proxy   --label org.opencontainers.image.revision=$(git rev-parse HEAD) -t monitoring-unified-web:<tag> .
```

本地三服务联调可配置 `POSTGRES_PASSWORD`、`SESSION_SECRET`（`>=32` 字符）、`APP_ORIGIN=https://localhost:8443`、`SITE_ADDRESS=https://localhost`、`HTTPS_PORT=8443`、`TLS_CONFIG='tls internal'` 后执行：

```sh
docker compose -p monitoring-local up --build -d --wait
curl --insecure https://localhost:8443/readyz
```

---

## 5. 生产安全配置与运维规程

### 5.1 仓外环境模板与采集网关

真实密钥仅存于仓外受限文件（生产 `/etc/reddit-monitoring/unified.env`，权限 `600`），严禁写入 Git 或 `VITE_*`：

```dotenv
NODE_ENV=production
SOURCE_NETWORK_ENABLED=true
# 留空 = 开启全 DNS 公网 IP 校验下动态 HTTPS 抓取；非空 = 逗号分隔白名单
FEED_ALLOWED_URLS=
WORKER_CONCURRENCY=6
CREDENTIALS_MASTER_KEY=
APIFY_API_TOKEN=
TWITTERAPIS_API_KEY=
SCRAPEBADGER_API_KEY=
PUBLIC_READ_ENABLED=true
PUBLIC_REGISTRATION_ENABLED=false
AI_SYNC_ENABLED=false
```

- **渠道约束**：`WORKER_CONCURRENCY` 范围 `[1, 12]`（默认 `6` + `1500ms` 同域冷却）；`twitterapis` 单页自动钳制 `<= 20`；`scrapebadger` `POST /v1/sources/:id/refresh` 支持 `1..20` ID 批刷；`kaix` 水合每次限 `<= 30` 根帖 × `50` 评论。若使用私有独立 Apify 转发网关（[deploy/apify-relay.compose.yml](../deploy/apify-relay.compose.yml)），将 `APIFY_RELAY_ORIGIN` 指向内网转发容器并在主应用留空 `APIFY_API_TOKEN`。

### 5.2 边缘代理、Tunnel 与宿主机防护

- **代理信任与缓存头**：`Caddy`（[deploy/Caddyfile](../deploy/Caddyfile)）强制 `/api/*` `Cache-Control: no-store` 与防 iframe 头；`Fastify` 仅通过 `TRUST_PROXY_ADDRESS` 信任 `proxy_transport` 内网网段上的 Caddy（单 IP），冲突时可用 `PROXY_TRANSPORT_IP` / `PROXY_TRANSPORT_SUBNET` / `APP_TRANSPORT_IP` 覆盖。
- **零公网端口 Tunnel**：`docker compose -f docker-compose.yml -f deploy/tunnel.compose.yml up -d --wait` 通过受保护 `CLOUDFLARED_TOKEN_FILE` 接入，公网存活探针走 `/healthz`。
- **宿主机防火墙提醒**：Docker `-p 443:443` 会直接写入 `iptables nat` 绕过 `ufw`；公网暴露必须在 Caddy 启用 Cloudflare mTLS 并在 **`DOCKER-USER`** 链限制仅放行 Cloudflare 回源网段，或保持 `PROXY_BIND=127.0.0.1` 纯走隧道；`db` 禁宿主机端口映射；建议配 `2 GiB /swapfile`（`vm.swappiness=10`）与 `journald` `SystemMaxUse=100M`。

### 5.3 账户安全、MFA 与主密钥轮换运维

- **开放邮件注册/找回**：默认关闭；需配置 HTTPS `APP_ORIGIN`、已验域 Resend 与 Cloudflare Turnstile 密钥（`AUTH_EMAIL_ENABLED=true`）方生效。
- **管理员 TOTP MFA**：配置 32 字节 base64url `AUTH_MFA_ENCRYPTION_KEY`，先离线执行 `node dist/src/modules/access/mfa-cli.js --enroll <user-id>` 为所有管理员完成登记后再开 `AUTH_MFA_REQUIRED=true`；遗失验证器时由运维核验后执行 `--recover <user-id>`（同时废弃旧会话、挑战与恢复码）。
- **密码哈希平滑升版（`scrypt v1 -> v2`）**：先上线支持双读的镜像（保持 `AUTH_SCRYPT_V2_WRITE_ENABLED=false`），压测确认登录 p95 无虞后再开启渐进重哈希；开启期间双版本 KDF 均不降回只读 v1 的旧镜像。
- **服务商凭证主密钥轮换**：备份并停 Worker 后传入旧 `CREDENTIALS_MASTER_KEY` 与新 `NEXT_CREDENTIALS_MASTER_KEY`，依次执行 `node dist/src/modules/collection/credential-rotation.js --check` 与 `--apply` 短事务重加密后切换环境变量启动。

### 5.4 备份恢复与只读巡检

```sh
npm run db:backup -- --file output/backups/<unique-name>.dump
npm run db:restore -- --file output/backups/<unique-name>.dump --target info_workbench_restore_check
```

> 切记在部署前于隔离恢复库演练新迁移、前后端冒烟及回退兼容性；生产切换后核对两个容器镜像的 `org.opencontainers.image.revision` 与 `/readyz`。

**生产只读巡检命令与 SQL**：

```sh
docker compose --env-file /etc/reddit-monitoring/unified.env -f /opt/reddit-monitoring/compose.yml -p monitoring-unified ps
```

```sql
-- 1. 库体积与 Top 12 表/索引膨胀巡检
SELECT now(), pg_size_pretty(pg_database_size(current_database())) AS db_size;
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_sz,
       n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12;

-- 2. 来源健康异常排查
SELECT label, feed_lane, primary_provider,
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

- **自动清理策略**：普通采集任务每小时清理各源最新 5 条外且超 14 天的终结记录（永久保留带 `request_key` / `ingest_key` 幂等回执与未决付费状态）；`feed_user_seen`（14 天）与 `feed_user_event`（30 天）随清理任务滚动裁剪，控制 60 GB 磁盘空间稳态运行。
