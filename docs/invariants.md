# 核心工程与业务不变量台账（Invariants）

本文件记录系统**任何 PR 与 Agent 修改均不可破坏**的核心不变量，以及对应的自动化验证入口。修改行为前必须核对，新增故障修复应将根因沉淀为新的不变量与回归测试。

| 编号 | 不变量（Invariant） | 强制门禁 / 验证入口 |
| :--- | :--- | :--- |
| **INV-001** | **默认拒绝、全路由声明式鉴权与对象级隔离**：所有注册路由必须在路由定义中显式声明 `config.auth`（启动期 `onRoute` 与请求期 `preParsing` 双重 Fail-Closed）；未认证请求禁止访问私有接口；Machine Key 永不可调用 `/v1/auth/*`、`/v1/access/*`、`/v1/admin/*`、`/v1/workspace/*`、`/v1/quotas*`、`/v1/sources/credentials*`；`/v1/content*` 仅允许 `GET/HEAD` 映射 `read` scope 且禁止暴露 `DELETE`；带 `allowedSourceIds` 的账号/Key 只能读取和检索范围交集内的数据。 | `apps/api/src/route-policy.ts`、`npm run check:openapi`、`tests/unit/route-auth-invariants.test.ts`、`tests/unit/platform-security.test.ts`、`tests/integration/platform-security-postgres.test.ts` |
| **INV-002** | **唯一内容写入口与摄入幂等**：全库所有内容节点写入必须经由 `commitContentBatch`（`src/modules/content/index.ts`）；乱序到达与重复摄入不得产生重复节点或覆盖更新的观测证据。 | `tests/unit/content-batch.test.ts`、`scripts/check-table-ownership.ts` |
| **INV-003** | **付费渠道 `unknown` 永不自动重放与租约隔离**：付费采集器进入 `unknown` 或无 `runId` 的 `starting` 状态时绝不自动重放请求；Worker 失去租约（`lease_token` 不匹配）后 `saveState` 必报 `409`。 | `tests/unit/kaix-content.connector.test.ts`（容量拒绝码与其他 402 的区分、Relay 透传边界）；`tests/integration/collection-postgres.test.ts` 的 PG16「Apify slot accounting, authorized capacity retries, and read-only recovery」覆盖共享并发槽位、明确未启动的容量 402 有界退避、普通或不透明 402 与网关失败不得重放，以及保留付费 Run ID 的只读恢复。 |
| **INV-004** | **配额与预算并发扣减不超发**：Viewer 配额预扣（`admitViewerCollection`）与 Provider 预算校验必须在数据库行锁事务内原子完成，并发请求不得透支日/月限额。 | `src/modules/collection/policy.ts`、`tests/integration/credentials-access-postgres.test.ts` |
| **INV-005** | **迁移前向不可变与 DDL 回滚安全**：已合入 `main` 的 SQL 迁移永不改写/删除；新迁移顺延编号且单文件失败必须完整回滚 DDL 与 `schema_migration` 台账；`050` 退役表永不复活。 | `npm run lint:policy`、`Squawk` (`sql-lint`)、`tests/integration/migration-assets-postgres.test.ts` |
| **INV-006** | **前端构建产物零后端密钥泄漏**：前端构建产物中严禁出现 `VITE_*` 敏感密钥、Apify Token、私钥或数据库连接串；图表（含 ECharts）可自由按场景加载渲染。 | `npm run check:web-bundle`、`tests/unit/repository-policy.test.ts` |
| **INV-007** | **零循环依赖、公开门面与基础层隔离**：全仓零循环依赖；`access`/`content` 为严格叶子域、`contracts`/`shared`/`platform`/`connectors` 保持纯净、前端禁引后端源码；跨模块调用须经 `index.ts` 公开门面且禁引他域 `routes.ts`；业务模块之间在无循环依赖前提下可按需协作。 | `.dependency-cruiser.cjs`（`npm run lint:arch`） |
| **INV-008** | **数据库表唯一写归属与敏感凭证表读隔离**：全库业务表执行单模块写归属（每表唯一写主模块）；`app_user_password`、`app_session`、`app_auth_challenge`、`app_auth_mfa`、`app_auth_mfa_login` 与 `source_provider_credential` 仅限所属域读取；普通业务数据表允许跨模块 SQL `SELECT/JOIN`。 | `scripts/check-table-ownership.ts`（`npm run lint:arch`） |
| **INV-009** | **主线 4 GB 轻量运行时边界**：主线服务端零 ORM（Prisma/TypeORM/Drizzle）、零 Redis/BullMQ、零无头浏览器/Python/DuckDB；重型与反爬采集通过外置 Sidecar + 受限 Machine Key 接入。 | `.dependency-cruiser.cjs`、`docker-dryrun` |
| **INV-010** | **验证不可自降级**：禁止在 PR 中通过添加 `.only(` 屏蔽测试，修改 CI/ESLint/边界检查规则、`AGENTS.md`/`docs/invariants.md` 或新增 `.skip`/抑制注释须经 `Governance Guard` 高亮提示与 `CODEOWNERS` 审查。 | `scripts/check-governance-diff.mjs`、`.github/CODEOWNERS` |
