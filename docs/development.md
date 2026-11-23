# 开发流程、CI 门禁与生产运维手册

本文为团队单主干协作、CI 验证分流、本地隔离测试、Docker 多阶段构建及单机 4 GB 生产运维的唯一操作手册。架构与边界约束见 [architecture.md](architecture.md) 与 [invariants.md](invariants.md)。

---

## 1. 单主干协作与冲突治理

仓库仅设唯一常驻主干 **`main`**（不设常驻 `develop`/`prod` 分支）；发版打 **`vX.Y.Z`** 不可变 Tag（预演 `vX.Y.Z-rc.1`），触发 `.github/workflows/release.yml` 完整验真并推送 `ghcr.io` 的 `runtime` 与 `proxy` 镜像。

| 分支类型 | 切出基准与规则 | 生命周期与合入要求 |
| :--- | :--- | :--- |
| **`feat/<模块>-<短名>`** | 从最新 `origin/main` 切出（允许整域垂直交付，不设僵化行数上限） | `<= 3` 天；`CI Gate` 绿灯 + `.github/CODEOWNERS` 审查后 `Squash and Merge` |
| **`fix/<短名>`** | 从最新 `origin/main` 切出 | `<= 1` 天；附带复现/回归测试，同上合入后删除 |

```sh
git fetch origin && git switch -c feat/<module>-<topic> origin/main
git diff --stat origin/main...HEAD
```

- **四大高冲突热区同步约定**：修改 **`src/storage/schema/*.sql`**（已合入迁移严禁改动，撞号顺延）、**`packages/contracts/src/`**（禁止前端复制平行副本）、**`apps/api/src/{app,route-policy}.ts` / `apps/web/src/App.tsx`**（保持薄装配）、**`docs/`** 前，若 `origin/main` 已前移须先 `rebase/merge` 并重跑完整本地门禁；未就绪 PR 一律保持 **Draft**。

---

## 2. CI 分层门禁与测试组织

`.github/workflows/verify.yml` 经 `scripts/ci-scope.mjs` 按变更路径精确分流，所有 PR 最终收敛至单一必过 **`CI Gate`**（周级安全/依赖/镜像全量巡检见 `.github/workflows/security-scheduled.yml`）：

| 变更范围 | 自动触发门禁 |
| :--- | :--- |
| 纯文档（`docs/**`、`README.md`、`AGENTS.md`） | `lint:policy`（断链/锚点/退役路径/迁移不可变；`docs/` 允许图片/示意图资产）+ `Gitleaks` 密钥扫描 |
| 纯后端代码（`src/**`、`apps/api/**`、`tests/{unit,integration}/**`） | `lint:arch`（`depcruise` + 表写归属）+ `lint:api`（ESLint）+ `tsc` + `check:openapi` + `test:unit` + `test:postgres` + `smoke:compiled`（**不再拖慢触发旧前端 Chromium E2E**） |
| 新增 SQL 迁移 | 自动运行 **`Squawk`** 锁表与索引并发风险扫描 + PG16 集成验证 |
| 前端 / 浏览器 / 契约 / 合入主干 | 前端改动及 `run-e2e` 标签或 `push` 到 `main` 时触发 `lint:web` + `build:web` + `check:web-bundle`（仅查密钥泄漏）+ Chromium `test:browser`；改 `packages/contracts/` 双端联动校验；改 `Dockerfile`/`compose`/`deploy/` 触发容器构建校验 |
| PR 治理防弱化 | `scripts/check-governance-diff.mjs`（新增 `.only(` 直接阻断，改动门禁/加 `.skip`/`eslint-disable` 高亮审计） |

**测试分层原则**：纯算法/解析/规范化进 `tests/unit/*.test.ts`；路由契约与鉴权用 Fastify `inject()`；SQL/事务/并发/幂等使用隔离 `postgres:16-alpine` 运行 `tests/integration/*-postgres.test.ts`；多端交互与可用性进 `tests/browser/*.test.ts`。

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
