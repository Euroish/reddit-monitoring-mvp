# 核心工程与业务不变量台账（Invariants）

本文件记录系统**任何 PR 与 Agent 修改均不可破坏**的核心不变量，以及对应的自动化验证入口。修改行为前必须核对，新增故障修复应将根因沉淀为新的不变量与回归测试。

| 编号 | 不变量（Invariant） | 强制门禁 / 验证入口 |
| :--- | :--- | :--- |
| **INV-001** | **默认拒绝、全路由声明式鉴权与对象级隔离**：所有注册路由必须在路由定义中显式声明 `config.auth`（启动期 `onRoute` 与请求期 `preParsing` 双重 Fail-Closed）；未认证请求禁止访问私有接口；Machine Key 永不可调用 `/v1/auth/*`、`/v1/access/*`、`/v1/admin/*`、`/v1/workspace/*`、`/v1/quotas*`、`/v1/sources/credentials*`；`/v1/content*` 仅允许 `GET/HEAD` 映射 `read` scope 且禁止暴露 `DELETE`；带 `allowedSourceIds` 的账号/Key 只能读取和检索范围交集内的数据。 | `apps/api/src/route-policy.ts`、`npm run check:openapi`、`tests/unit/route-auth-invariants.test.ts`、`tests/unit/platform-security.test.ts`、`tests/integration/platform-security-postgres.test.ts` |
| **INV-002** | **唯一内容写入口与摄入幂等**：全库所有内容节点写入必须经由 `commitContentBatch`（`src/modules/content/index.ts`）；乱序到达与重复摄入不得产生重复节点或覆盖更新的观测证据。 | `tests/unit/content-batch.test.ts`、`scripts/check-table-ownership.ts` |
| **INV-003** | **付费渠道 `unknown` 永不自动重放与租约隔离**：付费采集器进入 `unknown` 或无 `runId` 的 `starting` 状态时绝不自动重放请求；Worker 失去租约（`lease_token` 不匹配）后 `saveState` 必报 `409`。 | `tests/unit/kaix-content.connector.test.ts`、`tests/integration/collection-postgres.test.ts` |
| **INV-004** | **配额与预算并发扣减不超发**：Viewer 配额预扣（`admitViewerCollection`）与 Provider 预算校验必须在数据库行锁事务内原子完成，并发请求不得透支日/月限额。 | `src/modules/collection/policy.ts`、`tests/integration/credentials-access-postgres.test.ts` |
| **INV-005** | **迁移前向不可变与 DDL 回滚安全**：已合入 `main` 的 SQL 迁移永不改写/删除；新迁移顺延编号且单文件失败必须完整回滚 DDL 与 `schema_migration` 台账；`050` 退役表永不复活。 | `npm run lint:policy`、`Squawk` (`sql-lint`)、`tests/integration/migration-assets-postgres.test.ts` |
| **INV-006** | **前端构建产物零后端密钥泄漏**：前端构建产物中严禁出现 `VITE_*` 敏感密钥、Apify Token、私钥或数据库连接串；图表（含 ECharts）可自由按场景加载渲染。 | `npm run check:web-bundle`、`tests/unit/repository-policy.test.ts` |
| **INV-007** | **严格单向 DAG、公开门面与零循环依赖**：`access`/`docs`/`content` 为严格叶子域，仅允许 `collection` -> `{access,content}`、`feed`/`workspace`/`ai` -> `{content}`、`intelligence`/`projects` -> `{content,collection}` 单向依赖且只经 `index.ts` 公开门面；`apps/api/src/` 禁引模块内部文件；全仓零循环依赖。 | `.dependency-cruiser.cjs`（`npm run lint:arch`） |
| **INV-008** | **数据库表唯一写归属与受控读契约**：9 域 55 表执行严格零共享写归属（每表唯一写模块），且除契约许可的 `source`/`collection_source` 供 `content` 只读关联外，严禁跨模块直接 `FROM/JOIN` 读取他域数据表。 | `scripts/check-table-ownership.ts`（`npm run lint:arch`） |
| **INV-009** | **主线 4 GB 轻量运行时边界**：主线服务端零 ORM（Prisma/TypeORM/Drizzle）、零 Redis/BullMQ、零无头浏览器/Python/DuckDB；重型与反爬采集通过外置 Sidecar + 受限 Machine Key 接入。 | `eslint.config.mjs`、`.dependency-cruiser.cjs`、`docker-dryrun` |
| **INV-010** | **验证不可自降级**：禁止在 PR 中通过添加 `.only(` 屏蔽测试，修改 CI/ESLint/边界检查规则或新增 `.skip`/抑制注释须经 `Governance Guard` 高亮提示与 `CODEOWNERS` 审查。 | `scripts/check-governance-diff.mjs`、`.github/CODEOWNERS` |
