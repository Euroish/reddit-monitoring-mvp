# 开发与交付

## 1. 本机密钥

密钥只存本机仓库外文件。已为本机准备`/root/.config/reddit-monitoring/credentials.env`，目录700、文件600；文件只含空密钥槽，不复制到仓库。

在本机SSH终端打开编辑器填写，不在对话框、命令参数或Git里粘贴密钥：

```sh
nano ~/.config/reddit-monitoring/credentials.env
```

```dotenv
NODE_ENV=development
SOURCE_RUN_MODE=live
SOURCE_NETWORK_ENABLED=true
APIFY_API_TOKEN=
TWITTERAPIS_API_KEY=
SCRAPEBADGER_API_KEY=
```

| 变量 | 服务 | 当前用途 |
| --- | --- | --- |
| APIFY_API_TOKEN | Apify账户；供kaix与red_crawler使用 | 已有kaix adapter读取 |
| TWITTERAPIS_API_KEY | TwitterAPIs（X主源） | 私有预留；R2接adapter后读取 |
| SCRAPEBADGER_API_KEY | ScrapeBadger（X独立备源） | 私有预留；与TwitterAPIs独立，供搜索切换与批量ID水合 |

API/worker支持LOCAL_ENV_FILE；shell已定义值优先。可用下列命令验证配置结构，输出不含密钥值，不发送采集请求：

```sh
LOCAL_ENV_FILE="$HOME/.config/reddit-monitoring/credentials.env" npm run config:check
```

此文件不会自动注入运行中的systemd服务；当前服务仍使用`/etc/reddit-monitoring/*.env`。不得将私有文件复制进发布目录或改名为VITE_*变量；前端不持有供应商密钥。

## 2. 当前可执行入口

当前应用0.9.1，node:http主链；开发Node22+、CI Node24/PG16。目标栈见[产品与架构](README.md)。

```sh
npm ci
npm --prefix apps/web ci
npm run lint
npm run typecheck
```

开发使用独立数据库，配置DATABASE_URL、API_BEARER_TOKEN和明确origin；本地HTTP另设API_SESSION_COOKIE_SECURE=false。

```sh
npm run db:migrate
npm run auth:bootstrap-owner   # 仅新空库，BOOTSTRAP_OWNER_*由私有环境提供
LOCAL_ENV_FILE="$HOME/.config/reddit-monitoring/credentials.env" npm run app:api
# 另开终端，确需执行来源任务时才启动worker
LOCAL_ENV_FILE="$HOME/.config/reddit-monitoring/credentials.env" npm run worker:sources
npm --prefix apps/web run dev
```

来源网络默认关闭；只填key不入队/不启动worker不会收费。开发机按本次授权放宽kaix的数据库配额；新环境仍默认禁用provider，管理员可经`/v1/source-provider-budgets/kaix`配置。日/月requests和resources是保守计数，不是账单。单页数据上限与缺失功能见[状态](status.md)。

当前来源/任务为`/v1/sources`、`/v1/source-jobs`、`/v1/source-ops`，内容为`/v1/content`，个人研究为saved-queries/annotations。新项目、标准推流、机器scope key、capabilities/OpenAPI尚未落地；不要按目标表面猜测当前可调用接口。

## 3. 自动门禁

```sh
npm run lint             # 文档/架构规则 + Web ESLint
npm run typecheck
npx tsx --test tests/unit/repository-policy.test.ts tests/unit/kaix-content.connector.test.ts tests/unit/release-package.test.ts
npm run test:offline
npm run test:postgres    # 独立TEST_SOURCE_DATABASE_URL，必须真实执行
npm run verify:repo      # 构建与compiled smoke
```

`npm run docs:check`同时检查文档目录、规则编号、链接、目标模块布局/旧依赖/空壳class、被Git跟踪的私有配置。旧实现不冒充已满足新架构；边界lint对src/modules的新内核生效。规则和测试留在现有入口，不另建框架。

PG测试使用UTF8、loopback、source_validation_*专用库；不得指向业务库。离线测试强制零真实采集，provider使用固定响应。业务变更先跑对应风险场景，阶段出口再跑整条HTTP/浏览器流程；不为文案重复全套测试。

## 4. R1–R4实施顺序

| 阶段 | 交付 | 出口 |
| --- | --- | --- |
| R1 | Fastify/TypeBox五模块、访问/key/能力发现；两张项目表及旧表字段迁移；逻辑来源、混合批次、稳定证据、Apify异步run恢复、推流、分页/流式文件 | 一条真实Reddit发现→入库→查询→故障续读同run→下载；PG证明幂等/租约/权限/回滚 |
| R2 | 项目/三段词/信号/联动树/概览/比较/个人研究；Reddit备源、TwitterAPIs主源与ScrapeBadger备源、NewsNow/feed | 同一HTTP与浏览器任务从项目走到证据/文件；按日/类型钻取ID集一致，agent无需DB/浏览器旁路 |
| R3 | 资产迁出、实删旧代码、代表负载/恢复/安全验证、Compose上线 | 新主链独立运行，真实来源与部署分别验收 |
| R4 | 独立历史外挂，只经ingest | 原档/许可/资源明确后另行授权，不阻塞主线 |

### 迁移与实删

1. 盘点账户、来源、内容、观测、个人查询/批注/冻结文件；副本演练并输出ID映射/对账。
2. 仅合并语义相同的逻辑目标；迁移discovery/observation/job/个人查询关联，保留实际provider。无法证明等价的不自动合并。观测唯一键纳入provider，防主备证据碰撞。
3. 新增迁移扩展collection_source的主备配置、job的operation/request/provider_state/回执、session的机器scope、content版本与搜索投影；不改已应用SQL。
4. 新内核和UI接通后删除下表对象，不保留兼容空壳；冻结/不等价个人资产先按owner导出、验证、交付。

| 删除对象 | 替代/保护条件 |
| --- | --- |
| create-api-server、Phase1 runtime/scheduler、旧heat/growth/jobs与旧UI | 五模块/五导航闭环，不加载旧运行时 |
| 单实现Repository、InMemory镜像、pass-through service | 命名SQL/纯规则及真实PG测试；不复制职责到新class |
| Arctic Shift与TwitterAPI.io在线connector/注册/配置/CI/单测 | 先抽离kaix共享指标并移出source-lifecycle中free标记；解耦tests夹具并迁移x-content-pipeline.test.ts；历史DB软归档（详见[来源替换与清理规格](research/source_replacement_and_twitterapi_io_removal_spec.md)） |
| ResearchExport服务/表/API/UI、旧个人查询载体 | 个人文件交付/查询转换完成，不静默丢资产 |
| opossum/旧circuit breaker、旧限流包、独立worker部署 | 无活跃调用后删依赖，使用Fastify与进程内调度 |

## 5. 运行与发布

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| OPS-01 | MUST | 公网仅proxy HTTPS，DB不映射公网端口；精确可信代理/Origin/登录限流，feed仅受控目标，秘密不进镜像。 | 部署检查 |
| OPS-02 | MUST | 普通SQL10s/lock3s/idle10s；导出仅按EXPORT-02临时调整。停机先停领任务/新请求，应用15s、supervisor30s，事务提交或回滚后退出。 | 超时/退出 |
| OPS-03 | MUST | 破坏性切换先备份与真实恢复演练；未配置保留政策前不自动删除。回执至少7天，个人引用/未决收费任务不得被清理截断。 | 恢复/对账 |

当前Linux仍为systemd/Nginx，未有Compose文件。切换需维护窗口：停旧写入/清点未完成任务，核查未决收费；备份、迁移/资产对账、同版本API/Web/worker smoke后开放。失败恢复匹配数据库与构建，不能只退镜像或覆盖开放后的新数据。

现有工具：`npm run db:backup`、`db:restore`、`release:pack`、`release:verify`、`storage:plan`、`ops:backfill:public-search`；参数用对应脚本帮助/源码确认。报告放output，不另写交接稿。旧不可变发布包可继续验证，但新包只带四份现行文档。

生产目标只需DATABASE_URL、SESSION_SECRET、一次性ADMIN_BOOTSTRAP_PASSWORD及启用provider的凭证；这些目标变量不能代替当前API_BEARER_TOKEN/BOOTSTRAP_OWNER_*入口。
