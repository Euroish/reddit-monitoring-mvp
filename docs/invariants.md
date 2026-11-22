# 核心工程与业务不变量台账（Invariants）

本文件记录系统**任何 PR 与 Agent 修改均不可破坏**的核心不变量，以及对应的自动化验证入口。修改行为前必须核对，新增故障修复应将根因沉淀为新的不变量与回归测试。

| 编号 | 不变量（Invariant） | 强制门禁 / 验证入口 |
| :--- | :--- | :--- |
| **INV-001** | **默认拒绝与对象级隔离**：未认证请求禁止访问私有接口；Machine Key 永不可调用 `/v1/auth/*`、`/v1/access/*`、`/v1/admin/*`、`/v1/workspace/*`、`/v1/quotas*`、`/v1/sources/credentials*`；`/v1/content*` 仅允许 `GET/HEAD` 映射 `read` scope 且禁止暴露 `DELETE`；带 `allowedSourceIds` 的账号/Key 只能读取和检索范围交集内的数据。 | `apps/api/src/route-policy.ts`、`npm run check:openapi`、`tests/unit/route-auth-invariants.test.ts`、`tests/unit/platform-security.test.ts`、`tests/integration/platform-security-postgres.test.ts` |
| **INV-002** | **唯一内容写入口与摄入幂等**：全库所有内容节点写入必须经由 `commitContentBatch`（`src/modules/content/index.ts`）；乱序到达与重复摄入不得产生重复节点或覆盖更新的观测证据。 | `tests/unit/content-batch.test.ts`、`scripts/check-table-ownership.ts` |
| **INV-003** | **付费渠道 `unknown` 永不自动重放与租约隔离**：付费采集器进入 `unknown` 或无 `runId` 的 `starting` 状态时绝不自动重放请求；Worker 失去租约（`lease_token` 不匹配）后 `saveState` 必报 `409`。 | `tests/unit/kaix-content.connector.test.ts`、`tests/integration/collection-postgres.test.ts` |
| **INV-004** | **配额与预算并发扣减不超发**：Viewer 配额预扣（`admitViewerCollection`）与 Provider 预算校验必须在数据库行锁事务内原子完成，并发请求不得透支日/月限额。 | `src/modules/collection/policy.ts`、`tests/integration/credentials-access-postgres.test.ts` |
| **INV-005** | **迁移前向不可变与 DDL 回滚安全**：已合入 `main` 的 SQL 迁移永不改写/删除；新迁移顺延编号且单文件失败必须完整回滚 DDL 与 `schema_migration` 台账；`050` 退役表永不复活。 | `npm run lint:policy`、`Squawk` (`sql-lint`)、`tests/integration/migration-assets-postgres.test.ts` |
| **INV-006** | **前端首屏轻量与零密钥泄漏**：公开站首屏入口严禁静态打包 ECharts（`charts-*.js`）；前端构建产物中严禁出现 `VITE_*` 敏感密钥、Apify Token、私钥或数据库连接串。 | `npm run check:web-bundle`、`tests/unit/repository-policy.test.ts` |
| **INV-007** | **模块公开门面与零循环依赖**：`src/modules/` 跨模块引用只允许经由目标模块的 `index.ts` 公开门面，禁止深挖内部 `sql.ts`/`routes.ts`；全仓保持零循环依赖、纯 `packages/contracts`、前后端隔离。 | `.dependency-cruiser.cjs`（`npm run lint:arch`） |
| **INV-008** | **数据库表唯一写归属**：除显式白名单外，每张数据表的 `INSERT/UPDATE/DELETE` 仅允许由单一归属模块执行，跨模块写操作必须调用归属模块 `index.ts` 导出的事务函数。 | `scripts/check-table-ownership.ts`（`npm run lint:arch`） |
| **INV-009** | **主线 4 GB 轻量运行时边界**：主线服务端零 ORM（Prisma/TypeORM/Drizzle）、零 Redis/BullMQ、零无头浏览器/Python/DuckDB；重型与反爬采集通过外置 Sidecar + 受限 Machine Key 接入。 | `eslint.config.mjs`、`.dependency-cruiser.cjs`、`docker-dryrun` |
| **INV-010** | **验证不可自降级**：禁止在 PR 中通过添加 `.only(` 屏蔽测试，修改 CI/ESLint/边界检查规则或新增 `.skip`/抑制注释须经 `Governance Guard` 高亮提示与 `CODEOWNERS` 审查。 | `scripts/check-governance-diff.mjs`、`.github/CODEOWNERS` |
