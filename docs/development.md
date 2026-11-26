# 开发流程、CI 门禁与生产运维手册

本文为团队单主干协作、CI 验证分流、本地隔离测试、Docker 多阶段构建及单机 4 GB 生产运维的唯一操作手册。架构与边界约束见 [architecture.md](architecture.md) 与 [invariants.md](invariants.md)。

---

## 1. 单主干协作与冲突治理

仓库仅设唯一常驻主干 **`main`**（不设常驻 `develop`/`prod` 分支）；发版打 **`vX.Y.Z`** 不可变 Tag（预演 `vX.Y.Z-rc.1`），触发 `.github/workflows/release.yml` 完整验真并推送 `ghcr.io` 的 `runtime` 与 `proxy` 镜像。

| 分支类型 | 切出基准与规则 | 建议节奏与合入要求 |
| :--- | :--- | :--- |
| **`feat/<模块>-<短名>`** | 从最新 `origin/main` 切出（允许整域垂直交付，不设行数上限） | 推荐短分支（建议 `<= 3` 天，视范围调整）；`CI Gate` 绿灯 + 评审后 `Squash and Merge` |
| **`fix/<短名>`** | 从最新 `origin/main` 切出 | 推荐短分支（建议 `<= 1` 天）；附带复现/回归测试，合入后删除 |

```sh
git fetch origin && git switch -c feat/<module>-<topic> origin/main
git diff --stat origin/main...HEAD
```

- **高冲突热区同步约定**：修改 **`src/storage/schema/*.sql`**（已合入迁移严禁改动，撞号顺延）、**`packages/contracts/src/`**（禁止前端复制平行副本）、**`apps/api/src/{app,route-policy}.ts` / `apps/web/src/App.tsx`** 前，若 `origin/main` 已前移应先 `rebase/merge` 并重跑本地门禁；未就绪 PR 保持 **Draft**。

### 1.1 门禁分级与评审原则

CI 只做**高信噪比、指向真实缺陷的硬阻断**；PR 描述格式、复杂度取舍与设计好坏交给人做实质审查，不以机械指标替代工程判断。

#### 门禁分级

| 级别 | 内容 | 失败后果 |
| :--- | :--- | :--- |
| **硬阻断（`CI Gate`）** | 迁移不可变与锁表安全（`lint:policy` / `Squawk`）、核心架构边界与单写表/凭证表读隔离（`lint:arch`）、100% 声明式路由鉴权（`check:openapi`）、类型与 ESLint、单元/PG16 集成/编译冒烟/浏览器测试、前端产物密钥检查、禁 `.only(` | 无法合并 |
| **人工评审与摘要提示** | `scripts/check-governance-diff.mjs`（变更面统计、治理文件改动、`.skip`/`eslint-disable`/`@ts-expect-error` 高亮）；代码设计、可维护性与产品价值 | 写入摘要供评审判断，需叫停时由维护者使用 GitHub 原生 **Request changes** |

#### 评审与协作约定

- **按价值、质量与真实依赖合入**：PR 是候选方案，CI 绿灯仅是必要条件；PR 编号与提交先后不决定设计优先权。
- **遇阻直报，禁止形式主义绕道**：如发现某条约束阻碍了干净的缺陷修复或简洁设计，不要为了过门禁去写绕道代码或拆无意义薄包装，直接向维护者说明冲突点。
- **诚实验证**：只记录实跑命令与真实结果，不伪造测试/性能/生产状态，不删断言或弱化测试来凑绿灯；改前端 UI 时结合真实交互与受影响状态验收。
- **聚焦高危 `CODEOWNERS`**：仅锁定数据库迁移、鉴权核心、CI/检查脚本、部署与依赖锁文件以及 `AGENTS.md`/`docs/invariants.md`；`packages/contracts/`、`apps/api/src/app.ts`、`docs/development.md` 与 PR 模板保持开放，不拖慢日常业务与文档迭代。
- **PR 模板自由填写**：`.github/pull_request_template.md` 仅为可选参考清单，CI 不校验正文标题或格式；编辑 PR 描述或打标签不会触发全量 `verify.yml` 重跑。

---

## 2. CI 分层门禁与测试组织

`.github/workflows/verify.yml` 仅在代码/就绪状态变更（`opened`/`synchronize`/`reopened`/`ready_for_review`）、`push` 到 `main` 或手动 `workflow_dispatch` 时运行，经 `scripts/ci-scope.mjs` 按变更路径精确分流，最终收敛至单一必过 **`CI Gate`**（周级安全/依赖/镜像全量巡检见 `.github/workflows/security-scheduled.yml`）：

| 变更范围 | 自动触发门禁 |
| :--- | :--- |
| 纯文档（`docs/**`、`README.md`、`AGENTS.md`） | `lint:policy`（断链/锚点/退役路径/迁移不可变；`docs/` 允许图片/示意图资产） |
| 纯后端代码（`src/**`、`apps/api/**`、`tests/{unit,integration}/**`） | `lint:arch`（`depcruise` + 单写表与凭证表读隔离）+ `lint:api`（ESLint）+ `tsc` + `check:openapi` + `test:unit` + `test:postgres` + `smoke:compiled`（**不再拖慢触发前端 Chromium E2E**） |
| 新增 SQL 迁移 | 自动运行 **`Squawk`** 锁表与索引并发风险扫描 + PG16 集成验证 |
| 前端 / 浏览器 / 契约 / 合入主干 | 前端改动及带 `run-e2e` 标签或 `push` 到 `main` 时触发 `lint:web` + `build:web` + `check:web-bundle`（仅查密钥泄漏）+ Chromium `test:browser`；改 `packages/contracts/` 双端联动校验；改 `Dockerfile`/`compose`/`deploy/` 触发容器构建校验 |
| PR 治理防弱化 | `scripts/check-governance-diff.mjs`（新增 `.only(` 直接阻断，改动高危治理面或新增 `.skip`/`eslint-disable`/`@ts-expect-error` 高亮审计） |

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
- **Apify 并发（PR #54 候选配置）**：Worker 的 `KAIX_MAX_CONCURRENT_JOBS` 默认 `2`，有效范围为整数 `1..6`。未设置或非整数字面量使用默认值，越界整数钳制到范围内。`kaix` 和 `red_crawler` 共用这一个 Apify 并发池，不是每渠道各自的上限。
- **Apify Relay 错误边界（PR #54 候选变更）**：仅对白名单内启动 Actor Run 的 `POST`，Relay 才从上游 `402` 的完整合法 JSON（小于 4 KiB）提取并透传已知容量拒绝码 `actor-memory-limit-exceeded`。其他 `402` 仅保留 HTTP 状态并返回 `{}`；不透传上游错误正文或消息。`GET` 的 `402` 不适用此例外，无法确认未启动的付费请求仍不得自动重放。

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

研究工作台 L1/L2 的 SQL 需有语句预算（聚合事务内 8 秒/条），路由有独立的 25 秒 handler 预算；不能使用更短的 HTTP socket 空闲计时器来充当业务超时。对尚未开始发送响应的请求，数据库取消或 handler 超时应经统一错误处理返回带 `requestId` 的结构化 503，而不是上游 EOF。回归入口：`tests/unit/research-http-timeout.test.ts`。

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
