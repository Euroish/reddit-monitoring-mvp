# 开发记录与运维交付手册（STD-100 唯一真源）

> **核对基准**：`2026-11-21` · 团队分支治理、Docker 构建、PG16 运维、恢复与交付台账。架构见[主线架构](architecture.md)，现状与规划见[当前状态](status.md)。

---

## 0. 团队分支治理与 AI 协作准则

本仓面向 2–3 人 + AI 高频并行开发，采用 **单主干（Trunk-Based）+ 短任务分支 + 不可变发布 Tag**，不设常驻 `develop` / `prod` 双主干，直接匹配 `.github/workflows/verify.yml`（按变更面选测试，统一由 `CI Gate` 收敛）、`.github/workflows/security-scheduled.yml`（周级安全与镜像巡检）与 `.github/workflows/release.yml`（`v*` Tag 镜像构建）。

### 0.1 分支与发布角色

| 引用 | 职责与权限 | 生命周期 |
| :--- | :--- | :--- |
| **`main`** | **全仓唯一集成与发布主干**。通过 GitHub 分支保护要求 `CI Gate`、一名独立评审人批准、讨论已解决。管理员遵守相同门禁。仅允许 `Squash and Merge`。 | 永久 |
| **`feat/<模块>-<短名>`** | 新功能分支（如 `feat/access-quotas`、`feat/web-reader`），永远从最新 `origin/main` 切出。 | `<= 3` 天，合后即删 |
| **`fix/<短名>`** | 缺陷修复或线上紧急热修，从 `origin/main` 切出。 | `<= 1` 天，合后即删 |
| **`vX.Y.Z`（Tag）** | 正式发版与回滚锚点（触发 `release.yml` 完整验真后构建 `runtime`/`proxy` 镜像）；预演使用 `vX.Y.Z-rc.1`，不另建长期分支。 | 永久不可变 |

### 0.2 独立 PR 的开工、评审与合入

从最新 `origin/main` 开分支，每个独立 PR 直接指向 `main`。满足评审和 `CI Gate` 即可合入，可使用 GitHub Auto-merge。GitHub 分支保护采用 loose required checks，同事的无关 PR 合入后可继续使用已有验证。需要前置 PR 的改动在描述中写明依赖，依赖合入后重新确认差异和测试。

```sh
git fetch origin && git switch -c feat/<module>-<topic> origin/main
git diff --stat origin/main...HEAD
```

- 遇到实际冲突，或 `main` 已改动同一迁移、契约、鉴权策略或关键写入口时，先同步 `origin/main`，确认合并结果后再跑相关检查。共享分支用 merge，个人短分支可 rebase。解冲突后核对 `git diff origin/main --stat` 和具体冲突文件，保留主干已有行为及测试证据。
- 未就绪的改动用 Draft。评审时检查失败路径、权限、数据兼容、测试是否覆盖改动行为，并要求说明新增的跨模块依赖或抽象。质量问题用 Request changes 退回该 PR。作者修改代码后重新评审。
- 将鉴权、迁移、共享契约、依赖和门禁交给对应 `CODEOWNERS` 评审。每类受保护路径配置两名维护者，其中一位独立批准即可。新 `CODEOWNERS` 合入后，在 GitHub 分支保护中启用代码所有者必审。
- 以可独立验证和回滚的业务行为切片。超过 4,000 行的改动按现有约定拆分，依赖只有在确有兼容性或顺序要求时才声明。未就绪入口可先通过现有功能开关隐藏。
- `main` 检查失败时先核查合入组合，尽快修复或回滚，恢复绿灯后发布。当前仓库由个人账号持有，GitHub 原生 Merge Queue 适用于组织仓库，团队规模增长并迁移到组织后再按实际排队耗时评估。

### 0.3 四大冲突热区与轻量同步约定

- **SQL 迁移（`src/storage/schema/`）**：已合入 `main` 的迁移严禁改写。两个迁移 PR 使用同一编号时，先合入者占用编号，另一个 PR 同步后顺延。迁移评审检查锁与旧版本兼容性，由 Squawk、PG16 回滚用例与代码所有者联合把关。
- **共享契约（`packages/contracts/src/*`）**：唯一契约真源，严禁在前端复制平行副本或做破坏式字段重命名；由 `npm run check:openapi` 与 `CODEOWNERS` 共同守护。
- **入口与前端架构**：`app.ts` / `App.tsx` 保持薄装配；首页 `/` 严禁静态引入 ECharts（由 `npm run check:web-bundle` 自动拦截），分析页统一 `React.lazy` 模块化 `echarts/core`；后端允许按业务域新增模块与子目录，由 `eslint.config.mjs`、`.dependency-cruiser.cjs` 与路由/表归属检查强制守住异步安全与依赖方向边界。
- **文档与开工声明**：仓库可新增 Markdown 文档，发布包继续按 `DOCUMENTATION_FILES` 选档。代码变动同 PR 更新对应规范。开分支前发 1 行同步：`[feat/xxx] 负责人：@A | 触碰区域：... | 新迁移：无/+N表`；PR 描述附 3 行：**变更摘要 / 影响范围（表、契约、冲突清单）/ 验证结果**。

---

## 1. 构建、测试与 Compose 多阶段验收

### 1.1 CI 范围与后端测试职责

| 变更或事件 | 执行范围 |
| :--- | :--- |
| 文档 PR 或文档合入 | 文档、仓库策略、密钥扫描；PR 附变更范围摘要 |
| 普通后端 PR | ESLint、依赖及表写入边界、类型、OpenAPI、单测、真实 PG16 集成、编译运行时冒烟 |
| 前端或高风险入口 PR | 在适用检查外用编译产物跑 Chromium 业务旅程。适用于前端、API 装配、访问控制、主要用户模块和共享契约，其他 PR 可加 `run-e2e` |
| 新 SQL 或部署配置 | 新 SQL 运行 Squawk；Docker / Compose 文件变更运行 Compose 解析和两种镜像构建。工作流变更运行 actionlint |
| 运行时变更合入 `main` | 验证合入后的 API、Web、PG16、编译冒烟和 Chromium，用于发现独立改动组合后的问题 |
| 手动全量或 `v*` Tag | 完整运行时检查与发布包验真。手动运行也检查 Docker，Tag 必须指向 `main` 上的提交，检查通过后构建并发布两种镜像。周级工作流检查完整历史密钥、依赖审计和 Docker |

路径规则见 [CI 分流脚本](../scripts/ci-scope.mjs)。未知路径走共享代码验证；每次执行只编译一次所需的 API 和 Web。GitHub Actions 的 `CI Gate` 要求所有选中的作业成功。

- 纯业务规则放单测。路由注册、鉴权及请求响应边界优先用 Fastify `inject()`。SQL、事务、并发、幂等和数据所有权用隔离 PG16。Chromium 用于真实浏览器的登录入口、页面交互和可用性。删除重叠用例前，确认字段、权限或失败路径仍有相同强度的断言。
- 依赖方向、循环依赖和越界写入由 `lint:arch` 拦截。后端复杂度大于 25 的新违规计入 ESLint 错误，既有违规记录在 `eslint-suppressions.json`。简化函数后执行 `npx eslint . --prune-suppressions`，随改动收缩基线。基线扩张和接口新增都要写明原因由维护者评审。先在同一模块解决业务规则，共享操作走既有公开接口。
- 实际发现不稳定测试时，先用失败断言定位缺失的时序或隔离条件，修复后保留原有断言。评估 CI 用量时按 docs、API、含浏览器的 PR 分别比较总作业时间、`CI Gate` 耗时和失败后重跑次数。

实践参考见 [Fastify 路由测试](https://fastify.dev/docs/latest/Guides/Testing/)、[Google 代码审查标准](https://google.github.io/eng-practices/review/reviewer/standard.html)、[Kubernetes Prow Tide 的就绪判定](https://github.com/kubernetes-sigs/prow/blob/main/site/content/en/docs/components/core/tide/config.md)及 [GitHub 分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)。

### 1.2 本地构建与验证

开发与构建要求 **Node 24+** 与 **PostgreSQL 16**（`test:postgres` 需独立回环库 `TEST_SOURCE_DATABASE_URL`）。开发入口 `npm run app:api`，发布入口 `node dist/apps/api/src/server.js`，迁移入口 `node dist/src/storage/schema/run-migrations.js`（长超时 `600s`、按 SHA-256 严格核对已应用 SQL）。

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run lint:policy        # 发布文档、Markdown 断链/锚点、退役路径、私密文件与主干迁移不可变校验
npm run lint:api           # 后端 TypeScript ESLint（异步安全、禁 *Repository/InMemory*/ORM、复杂度门禁）
npm run lint:arch          # dependency-cruiser 模块依赖边界、零循环依赖与前后端隔离校验
npm run lint:web           # apps/web ESLint
npm run lint               # 串联 lint:policy + lint:api + lint:arch + lint:web
npm run typecheck          # API + Web 全局 tsc 校验
npm run check:openapi      # 零数据库 Fastify OpenAPI 3.x 与路由契约自检
npm run build              # 编译 dist/、apps/web/dist/ 并同步 schema/*.sql 至 dist/
npm run check:web-bundle   # 校验首页入口不静态加载 charts(ECharts) 且零后端密钥泄漏
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

### API 缓存与边缘响应头

Caddy 在 `/api` 和 `/api/*` 返回 `Cache-Control: no-store`，Fastify 直连 API 也采用同一默认值。该边界涵盖匿名或登录态 AI 数据、管理控制面以及带 Bearer 的请求。Cloudflare 应在这些路径显式绕过缓存，避免缓存携带 Cookie、Authorization 或 Set-Cookie 的 API 流量。HTML 和静态文件当前要求重新验证。

Caddy 拒绝站外 iframe 嵌入，并设置 MIME 检查、Referrer 与浏览器权限策略。预演需验证边缘缓存规则、流式导出与 readiness 的外部访问范围。

### Caddy 与 Fastify 的代理信任

Compose 在专用内部网络连接 Caddy 和 Fastify。Fastify 通过 `TRUST_PROXY_ADDRESS` 仅信任 Caddy 的固定地址和直连一跳。单独启动 Fastify 时该地址默认留空。若原部署使用 `TRUST_PROXY_HOPS=1`，迁移到新版 Compose 时用 `PROXY_TRANSPORT_IP` 和 `PROXY_TRANSPORT_SUBNET` 与 `APP_TRANSPORT_IP` 覆盖冲突网段，保留 Caddy 作为该网段上唯一受信代理。普通入口按实际对端生成 X-Forwarded-For。Tunnel 模式只从固定连接器 IP 读取 CF-Connecting-IP，缺失时回退至连接器 IP。只有 Caddy 和 Tunnel 服务加入边缘网络，其他容器或宿主服务不得共享该网络。

### Cloudflare Tunnel 预演与回退

- 使用支持 `!reset` 的 Compose 2.24.4+ 和支持 token file 的 cloudflared 2025.4.0+。在仓外受保护文件存放 Tunnel token，通过 `CLOUDFLARED_TOKEN_FILE` 指定路径，并验证容器运行用户具备只读访问。使用 `CLOUDFLARED_IMAGE` 传入经过核验的镜像 digest。使用同一 revision 的 API 和 Proxy 镜像。
- 启动命令为 `docker compose -f docker-compose.yml -f deploy/tunnel.compose.yml up -d --wait`。在 Cloudflare 配置生产 HTTPS 主机名，Tunnel 服务地址为 `http://proxy:8080`，应用 `APP_ORIGIN` 仍是公网 HTTPS origin。连接器到 Caddy 的 HTTP 仅在同机专用边缘网络内传输，需信任 Docker 宿主机。Compose 取消 Caddy 的宿主端口映射，仍通过 App 容器 healthcheck 检查 readiness。公网健康检查使用 `/healthz`。
- 先核对 WAF/限流套餐和规则限额。先拦截明显异常协议，再对 `POST /api/v1/auth/login`、`POST /api/v1/auth/register` 单独配置频率限制。优先观察误杀、429、503、DB pool、Worker 积压和 Tunnel 断连。整站 JS challenge 会阻断合法机器客户端，应以路径和方法限定挑战。确认未开启替换客户端 IPv6 的 Pseudo IPv4 模式。
- 核对权威 DNS、现有 TTL、历史 A/AAAA 与 MX、源站地址及 80/443 的云防火墙规则。启用 DNSSEC 时核对注册商 DS 与权威 DNSKEY，对域名账户启用 MFA 与转移锁。发信域的 SPF、DKIM、DMARC 在服务商选定后单独验收。
- 回退前确认现有 DNS、边缘规则及镜像恢复点。回退到上一版可用 Tunnel 或经 ACL 与 origin mTLS 验收的受控入口。生产 Docker、防火墙、DNS、WAF、TLS 和备份恢复均由授权管理员验收。本地 Caddy 验证覆盖头部与 readiness，真实边缘连接、资源余量和回退还需预演。

### 公开注册开关

邮件注册与找回默认关闭。设置 `AUTH_EMAIL_ENABLED=true` 前配置 HTTPS `APP_ORIGIN`、Resend 已验证发件域及 `AUTH_EMAIL_FROM`、`RESEND_API_KEY`、`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`。生产只有邮件和人机验证配置生效且 `PUBLIC_REGISTRATION_ENABLED=true` 才允许免邀请注册。Resend 使用一次请求和幂等键，未知结果保留额度，用户可在冷却后重新发起。出站仅允许 Resend 与 Cloudflare 的固定 API，预演需验收域名投递、Turnstile 域名绑定和失败提示。匿名阅读单独由 `PUBLIC_READ_ENABLED` 控制。

### 管理员 MFA 启用与恢复

在受信运维主机使用独立的 `AUTH_MFA_ENCRYPTION_KEY`，格式为 32 字节 base64url。保留安全备份。先为每位 active Owner/Admin 离线登记验证器，再启用 `AUTH_MFA_REQUIRED=true`。从受限环境加载当前数据库连接、随机 20 字节 Base32 种子 `AUTH_MFA_SETUP_SEED` 和当前验证器代码 `AUTH_MFA_SETUP_CODE`，执行 `node dist/src/modules/access/mfa-cli.js --enroll <user-id>`。种子由管理员在受信设备导入标准 SHA-1 / 6 位 / 30 秒验证器，工具输出结果状态。最后一个 Owner 完成双因素登录和恢复演练后再开启强制模式。新邀请的管理员与提权用户同样需离线登记。

登录后可在设置页生成恢复码并安全保存。恢复码只允许登录，敏感写操作仍需 TOTP。验证器遗失时，由受信运维管理员核验账户身份并使用新种子及其当前代码，执行同一命令的 `--recover`。工具原子废弃旧浏览器会话、预认证挑战和恢复码并写入审计，机器 Key 保留单独撤销流程。配置关闭时，已登记账号仍需 MFA；回退需使用支持 MFA 的镜像和原密钥，避免回到会跳过第二因素的旧镜像。

### 密码哈希平滑切换（scrypt v1 → v2）

主干迁移至 `058`（含 `057_auth_email_challenges.sql` 与 `058_admin_mfa.sql`，全库合计 46 表）。发布时先部署能读取 v1/v2 的版本，`AUTH_SCRYPT_V2_WRITE_ENABLED=false` 保持兼容写。v2 为 scrypt N=32768/r=8/p=3，最多并行两次，超限返回 503；生产容量验证后才开启写入和成功登录的惰性重哈希。启用期间登录对旧、新和不存在的账户均执行两代 KDF，以减小迁移期的邮箱枚举时间差。已写入 v2 后继续使用支持两代且启用均衡校验的构建。只读 v1 的旧镜像不能接管已有 v2 的账户。账户限流为每个规范化邮箱 15 分钟内 10 次，包括失败与成功，4096 个并行账户窗口，写入前校验，进程重启清空。生产可独立配置 `AUTH_THROTTLE_KEY`，兼容回退以 Session key 做用途隔离的 HMAC。

本机 Node 24.14.0、i5-13500H（16 逻辑核）、63.7 GiB RAM，使用合成密码分别串行测 20 次直接 KDF 校验。v1 的 p50/p95 为 24.6/27.0 ms，v2 为 135.4/139.2 ms。各测试的双路并发进程 RSS 峰值约为 97.3/129.3 MiB。该数据只覆盖 KDF。生产 4 GB 宿主机上仍需联测登录 p95、429/503、数据库等待、Worker 心跳和回填推进。

### 服务商凭证主密钥轮换

运维演练先备份并验证恢复，暂停使用旧密钥的应用和 Worker。经授权，在隔离的运维进程内从仓外受限文件载入当前 `DATABASE_URL`、`SESSION_SECRET` 和已有的 `CREDENTIALS_MASTER_KEY`，以及独立的 `NEXT_CREDENTIALS_MASTER_KEY`。先执行 `node dist/src/modules/collection/credential-rotation.js --check`，再执行同一命令的 `--apply`。工具只输出验证行数，批量重加密在一个短事务内完成，解密或写入失败会整体回滚。成功后把新值设为运行环境的 `CREDENTIALS_MASTER_KEY`，再启动应用验证凭证状态。用相同方法从新密钥反向轮换可回退；镜像和密钥必须配套。独立 relay 的仓外密钥另由原流程管理。轮换服务商凭证后可独立轮换 Cookie 签名，旧浏览器需重新登录，机器 Key 的哈希无需随之更改。

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
```

- **动态扩源与 OPML 批量导入**：管理员在前端 **`/sources`** 页面或直接调 `POST /v1/sources/import` 批量提交 JSON（1–200 条）或 OPML 2.0 XML（`<=512 KiB`），遇已存在源走 `ON CONFLICT DO NOTHING` 跳过；`FEED_ALLOWED_URLS` 留空时无需重启容器即可生效。
- **`WORKER_CONCURRENCY`**：`docker-compose.yml` 透传该环境变量至 `app`（钳制区间 `[1, 12]`，默认 `6` 协程 + `1500ms` 同域冷却）。
- **外部 API 参数口径**：`TWITTERAPIS_TIMEOUT_MS` / `SCRAPEBADGER_TIMEOUT_MS` 允许 `[100, 120000]ms`（默认 `20000ms`）；`twitterapis` 单页 `<=20`，`scrapebadger` 支持 `POST /v1/sources/:id/refresh` 批量刷推文（`1..20` ID）；`APIFY_API_TOKEN` 由 `kaix` 与 `red_crawler` 共用，`POST /v1/projects/:id/hydrate` 当前仅走 `kaix`（`<=30` 根帖 × `50` 评论）。
- **可选独立 Apify 网关**：生产配置设置 `APIFY_RELAY_ORIGIN` 指向仅 app 可访问的私有转发容器（[Compose 配置](../deploy/apify-relay.compose.yml)），app 中的 `APIFY_API_TOKEN` 留空。该模式下由转发容器挂载 Token 文件并经独立代理访问 Apify，设置页仅支持验证。轮换时先验证新 Token，再原子替换挂载目录中的文件。部署前验证网关断线时仅 Apify 调用失败，并核对其他采集渠道与生产健康检查。
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

发布 API 和代理为同一已验证主干版本的一对镜像。核对两个镜像的 `org.opencontainers.image.revision` 与发布提交一致，并记录镜像摘要或本地镜像 ID、数据库最后应用的迁移及部署时间。现场构建时使用同一干净提交，两个 target 均传入 `--label org.opencontainers.image.revision=<完整提交 SHA>`。本地补丁或不同提交配对运行时记录原因和回归范围。

更换镜像前，在隔离恢复库执行迁移、完整 UI/API 冒烟和回滚演练。首次部署 `053` 验证文档读取、草稿授权、附件、任务调度及常用分析路径。生产更新后核对 `/readyz`、Worker 心跳与任务增长，验证匿名与登录态界面实际使用的 API。若应用版本需要回退，先验证旧镜像可与新 schema 共存。恢复生产数据库会影响备份之后的写入，须单独决定。

### 生产只读巡检与数据维护

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

- **普通作业清理**：每小时保留各源最新 5 条，且只清理超过 14 天的普通终结任务。带 `request_key` 或 `ingest_key` 的回执与未决付费状态继续保留。监测回执增长，任何保留期调整都需要先定义客户端重试和付费对账语义。
- **样本与观测保留**：前向版本默认保留观测时序和搜索投影。清理前确认受影响的平台、窗口、专题和指标；多个观测点是增长分析的证据。经专项评审的压缩或冷归档要验证可恢复，并同步更新可查询覆盖和时间窗口。清理搜索投影会影响关键词命中；只有能解释覆盖变化才允许收缩该窗口。
- **运行指标**：分别记录来源覆盖、成功/失败、配额与响应耗时；应用和数据库 CPU/内存、数据库磁盘增长、备份恢复耗时由生产抽样记录。变更窗口保留旧镜像及可验证的备份。
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

- **`2026-11-22` AI 可信历史冷启动与回填 (`056`)**：新增 `056_ai_history_bootstrap_and_backfill.sql`（`ai_history_import_run`、`ai_history_backfill_run`，总表 `43`）、版本化历史基线 `data/ai/history/v1/`（10 厂商、87 模型、142 别名、90 条官方核验事件、89 条一手引用）、共享去重身份 `ai-event-identity.ts`、离线幂等导入与断点分页回填 CLI（`ai:history:validate|plan|apply|backfill`），并打通 `build-api.mjs`、`release-package-lib.mjs` 与 `Dockerfile`/`docker-compose.yml` 容器首启离线冷启动链路。
- **`2026-11-21` 采集源退役**。移除知乎热榜内置采集器和 V2EX 技术节点线上 RSS 配置。备份后清理两个源及其独有的 419 条资讯（知乎 228 条、V2EX 191 条）、搜索索引条目和采集记录。数据库表数维持 23。
- **`2026-11-20` 开放式编辑部重构与源治理（`20261120-v3`）**：开放匿名只读白名单（`/v1/public/sources` 与内容只读接口）及 `PUBLIC_REGISTRATION_ENABLED` 免邀请码 `viewer` 注册；`/v1/content/stories` 升级为 7 天 `latest` 窗 + `offset/nextOffset/totalCount` 分页 + 单源防刷屏混排 + 默认隔离 `social-trends`；修复 `google-trends-us` 优先取 `<ht:news_item_url>` 主链与真实标题并新增 `excludeTitlePatterns` 与 4h 退避上限；重做编辑部纸面 UI、左侧 8 频道导航、右侧阅读抽屉与登录注册弹窗；完成 `pg_dump` 物理备份后归档 7 个重度营销/灌水源、升级 V2EX 技术节点并补入 8 个高信噪一手源。
- **`2026-11-20` 单主干 `main` 统一融合与冗余裁剪**：将 `prod@254213b` 完整历史无强推合入 `main`，融合 `dev/siftline-workbench`（归档于 `archive/dev-siftline-20261120`）的加密凭证库（`051`）、Free/Pro 动态配额与 RBAC（`052`，总表 `23/24`）及裁剪后的 Siftline 前端（去除静态营销页、1.7 MB 无用图、多主题工坊、R4 离线面板与违背 `MET-04` 的虚假图表，改用 `React.lazy` 模块化 `echarts/core` 并补齐开放阅读 `StoriesPage` 与 `/v1/public/sources` 适配）；同步修复 `worker.ts` 连接池潜在死锁、`policy.ts` 跨渠道配额竞态、`credentials.ts` 探测异常与 `jobs.ts` 重试配额计算，退役 `prod` 与 `dev/siftline-workbench` 分支并落地团队单主干协作准则。
