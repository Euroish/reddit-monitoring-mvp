# Agent 开发入口

开始任何任务前，先读[产品与架构](docs/README.md)和[当前实现状态](docs/status.md)；涉及模块、SQL、部署与安全基线再读[主线架构规范](docs/architecture.md)与[开发与交付](docs/development.md)；涉及领域模型与 HTTP/数据语义读[数据与 API 契约](docs/contracts.md)；涉及界面流程读[交互设计](docs/design.md)；架构演进与重构删改总纲对照[Master Spec](docs/research/architecture_audit_and_rebuild_spec.md)及[R1–R4 计划](docs/plans/source-expansion.md)。正式项目文档只放在 `docs/`，根目录 `README.md` 仅作入口（≤ 60 行）。

- 用户当前明确指令优先。`docs/research/architecture_audit_and_rebuild_spec.md` 与现行 `docs/` 专项文档共同构成唯一目标规范，新设计以已合并更新的正式文档为准，消除文档间漂移；`docs/status.md` 与源码、迁移和实际检查结果证明当前真实行为，禁止把目标规范当成已实现功能。
- 发现文档与代码不一致时，指出差异并在本次任务范围内修正；历史阶段记录仅用于追溯，不作为现行约束。
- 当前主线产品形态为三阶信号漏斗：**低成本增量发现（Radar）→ 确定性噪声门控（Signal Gate）→ 按需批量水合讨论树（Hydrate）→ 联动证据研判与流式留档**。Reddit 采用 `kaix`（主）+ `red_crawler`（备），X 采用 `TwitterAPIs`（主）+ `ScrapeBadger`（备，支持批量 ID 补全），资讯补充 `NewsNow` 精选 getter 与受控 `feed`。`Arctic Shift` 在线连接器与超预算的 `TwitterAPI.io` 按 R1–R3 退役实删，不继续修补或回退；已存历史 DB 内容与观测保留真实 `provider`，本地 `.zst` 归档加工仅作 `R4` 独立外挂。
- 修改前先检查 `git status`、相关源码、迁移与测试，保留他人工作；只做本次范围，不因路线图存在而擅自实现未授权平台或功能。
- 使用当前环境独立工作目录或分支，不 `reset`/`clean`/`stash` 覆盖未提交改动；逐路径暂存提交，共享对象库串行改 refs，远端推送与生产部署须经当前授权，禁止强推。
- 主线是远端单服务器 `Fastify 5 + TypeBox + PostgreSQL 16 + 在线 Connectors + React` 产品；**全系统仅新增 `monitor_project` 与 `monitor_project_source` 两张表**。Python / DuckDB / `.zst` 属于 `R4` 独立外挂 `plugins/zst-archive/`，仅经鉴权 `POST /v1/sources/:id/ingest` 推流，严禁进入主线依赖、容器镜像、发布包、数据库迁移或日常 CI；绝不恢复七张归档表、数据集界面或库内 `ResearchExport` 冻结模型。
- 逻辑来源（`collection_source`）与实际渠道（`primaryProvider`/`fallbackProvider`）分离；仅在明确失败/限流且目标/操作兼容时单跳切备，禁止对空结果、partial 或状态未知收费调用自动切备/重放。在线批量写入与推流共用唯一 `commitContentBatch`，同事务支持“主帖 + 附属评论 + 父链”混合 `UNNEST` 写入，按每条真实 `kind` 与 `provider` 校验，严禁强锁 `item.kind === source.contentKind`。
- 五个纵向模块（`access`、`collection`、`content`、`projects`、`workspace`）默认仅包含 `routes.ts + sql.ts`（真实必要时就近加 `worker.ts`/`search.ts`），内部命名 SQL 函数直接接收 `Pool | PoolClient`。**仅外部多实现采集边界保留 `ContentProvider` 接口**，禁止单实现 `*Repository`、14 个 `InMemory*` SQL 模拟器、空壳 `service`、通用 DI/ORM/队列/规则引擎。新内核必须遵守 `scripts/check-docs.ts` 的模块布局、反类封装、禁引入旧层与单条注释 ≤ 300 字符门禁。
- 人类与外部 AI Agent 共用同一套 TypeBox HTTP 契约、权限与 `compileContentFilter(scope, filter)`（`/v1/capabilities` + `/v1/openapi.json` + 复用 `app_session` 的机器 API Key）；绝不开放直连数据库旁路或第二套 Agent 后台，且严禁把第三方检索正文当作系统执行指令。
- UI 保持“项目、内容库、来源、我的研究、设置”五导航，每屏只留一个明确主操作；三段式词组、确定性信号、联动根帖与三视图评论树由后端统一输出，禁止前端堆砌内部契约代号、大段说明框或自拼另一套业务。
- 变更配套比例相称的真实验证：**纯函数单测 + 一套真实 PostgreSQL 16 + HTTP E2E + 关键浏览器任务流**；停止双跑内存与 PG 测试，严禁删核心权限/幂等/事务断言或缩小样本换通过，严禁以压行（Code Golfing）或机械切文件伪装精简；注释只写代码本身无法表达的原因与外部约束。
- 数据库变更新增向前迁移（`041+`），绝不修改已应用的 `001..040` SQL；真实密钥、Token、原始数据与报告放仓库外私有目录或被忽略的 `output/`，绝不提交 Git。
- 每次修改文档、规则编号、模块文件清单或发布白名单后，同步更新对应唯一文档与 `scripts/release-package-lib.mjs` / `scripts/check-docs.ts`；提交前运行 `npm run lint`、`npm run typecheck`、相关单测及 `git diff --check`。
