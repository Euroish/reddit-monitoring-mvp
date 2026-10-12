# 开发、协作与验证

## 安装与开发

使用 Node.js 22+ 与 npm，本轮 Windows 本地验证使用 Node.js 24.14.0、PowerShell 7。从仓库根目录执行：

```powershell
npm ci
npm --prefix apps/web ci
npm run docs:check
npm run typecheck
```

数据库流程需要 PostgreSQL 和本地 `DATABASE_URL`。连接池默认每进程 5，`PG_POOL_MAX` 调整池大小；构造参数 `max` 优先于环境变量。环境参考 `deploy/env/`，不把示例密码用于真实环境。现有 API 入口还要求 `API_BEARER_TOKEN`；配置以 `apps/api/src/server.ts` 和 runtime 为准。运行命令不会自动加载 `.env`，需由当前 shell 或进程管理器提供环境变量。

```powershell
npm run db:migrate
npm run auth:bootstrap-owner   # 仅新空库，需 BOOTSTRAP_OWNER_* 环境变量
npm run app:api
# 另一个终端使用相同 DATABASE_URL 启动新来源 worker
npm run worker:sources
# 另一个终端启动前端
npm --prefix apps/web run dev
```

开发使用 `NODE_ENV=development`，本地 HTTP 配置 `API_SESSION_COOKIE_SECURE=false`；PowerShell 使用 `$env:变量名 = '值'` 设置当前进程环境，每个终端分别配置。前端默认通过 Vite 代理连接 API，API 使用非默认端口时设置 `VITE_API_PROXY_TARGET=http://127.0.0.1:端口`；不同端口直连时按需设置 `API_CORS_ALLOW_ORIGINS`。检查启动参数后再运行，API 的监听行为以入口代码为准。所有写入、迁移、导出先确认连接的是开发数据库。

Arctic Shift 使用独立的来源配置/任务路径：API 注册 `arctic_shift`，worker 从数据库读取来源，不需要 API key。旧 `REDDIT_RUN_MODE` 与 `REDDIT_LIVE_PROVIDER=http|scrapling` 只控制旧 Reddit 功能；不要给旧环境变量填 `arctic_shift`，也不要同时开启旧抓取调度来代替新来源 worker。

`research:export:reddit` 与 `research:export:reddit-search` 等现有导出工具仍依赖旧路径，真实采集可用性待恢复。所有生成结果归入 `output/`；旧 provider 对比和 promotion 工具的报告放 `output/provider-reports/`，没有新报告时无法生成 promotion 计划。

## Windows 本地独立 Git 工作区

当前目录为 `D:\Projects\reddit-monitoring-mvp`，使用个人功能分支；本轮为 `codex/arctic-shift-content-query`。不直接修改 main，不使用 shared-dev 或服务器 team-git。开始任务先检查分支与修改，保留所有已有工作：

```powershell
git status --short
git branch --show-current
git diff -- path/to/file
```

按具体路径暂存和提交，提交前运行 `npm run docs:check` 并核对 diff。不要全量暂存，不用 reset/clean/stash 覆盖已有修改。Git author 与远端凭证属于个人配置，token 不写入仓库或 remote URL。未经用户确认，不执行 push、force push、分支删除或 PR 合并。依赖、数据库与测试产物留在本地，不恢复旧共享服务器操作流程。

## 任务编排

先分析“接入/worker”“数据模型/仓储”“API/read model/UI”涉及的模块，再沿一份共享契约实施。平台字段、缺失值、时间与验收范围在 `source-content.ts` 定义，不各层分别造平台枚举、DTO 或热度定义。

每个功能按一个小闭环实施：契约与必要迁移 → provider/落库 → 分析/API → UI；未接通的功能明确标为进行中。本地测试不代表部署验收，发布与远端 Git 操作需要用户确认。

## Arctic Shift 来源与查询

迁移到 `029_source_content_collection.sql` 后，登录工作台进入 `/content`（“来源内容”）。管理员创建来源：平台为 Reddit、provider 为 `arctic_shift`；社区或账号可采帖子/评论，帖子 ID 仅采评论。可保存范围内关键词；上游限制较活跃目标的关键词检索，不支持无范围全站搜索。查询页的关键词是已保存标题/正文的字面匹配，支持中文，与上游检索范围分开。

设置查询时间窗后点击对应来源的采集按钮；日期为空默认最近 24 小时。HTTP 只入队，worker 另行启动。每页 1–100 条、每任务 1–20 页，默认 25 条/5 页，当前 UI 使用默认值；`worker:sources:once` 只处理一页，不代表完整任务结束。达到预算但仍有 checkpoint 的任务可继续；失败任务可重试。单来源同时只允许一个活动任务，相同参数重复提交返回同一任务，不同窗口/预算返回 409。

| 方法与端点 | 用途 |
| --- | --- |
| `GET /v1/sources` | 已保存来源与实际 provider 能力 |
| `POST /v1/sources` | 创建/更新同一目标的来源标签 |
| `POST /v1/sources/:id/collect` | 提交有界采集，返回 202 与任务 |
| `GET /v1/source-jobs/:id` | 状态、计数、checkpoint、覆盖及错误 |
| `POST /v1/source-jobs/:id/retry`、`/continue` | 重试失败任务或从有界完成任务的 checkpoint 继续 |
| `GET /v1/content` | 按 platform/provider/sourceId/kind/query/from/to/limit/cursor 查询已落库内容 |
| `GET /v1/content/stats` | 相同过滤范围的总数、类型分布与 UTC 日计数 |

所有这些端点要求登录 session 或有效 bearer；写入要求 admin/owner，bearer 沿用 machine 权限。查询不会触发外部网络。`from` 含、`to` 不含，使用 ISO 时间；列表 cursor 绑定过滤条件，修改过滤后不能复用。查询量以已采集内容为分母，未知发布时间不进入日桶。详细请求/响应类型由 [共享契约](../packages/contracts/src/source-content.ts) 定义。

限流、暂时传输错误与部分 422 超时每页最多自动尝试三次；403 等授权错误直接失败。逐页提交后保留 checkpoint，进程异常退出后两分钟租约可回收。当前 worker 只消费手动提交的任务，尚未实现按小时自动创建新窗口或成熟指标自动刷新；不能据此承诺 12 小时新鲜度。

## 验证

```powershell
npm run docs:check
npm run typecheck
npm run lint:web
npm run verify:repo       # 文档、类型、API/Web 构建、compiled smoke
# 全量测试串行运行
npm test
```

先跑受影响测试；只有跨层里程碑或实际变更范围需要时才跑全量构建/回归。代码检查通过后，纯文档更新只跑 `docs:check` 与 diff 检查。外部数据解析、幂等/恢复、缺失指标与公共权限边界值得做回归测试；不为内部 getter、纯文字或每种假想状态增加测试矩阵。

`npm test` 是离线回归；数据库或网络验证另行执行并记录环境。compiled smoke 或 provider 的 `--config-only` 通过，只证明构建/配置，不能证明真实采集。存在已知失败时见 [当前状态](status.md)，比较基线与新增失败，不能将失败测试禁用后宣称完成。

新增的 PostgreSQL 集成测试默认跳过，必须提供独立 loopback `source_validation_*` 测试库的 `TEST_SOURCE_DATABASE_URL`，测试会执行迁移和写入合成记录，不得指向业务库：

```powershell
# 先创建隔离测试库，再配置它的 TEST_SOURCE_DATABASE_URL
node --import tsx --test tests/integration/source-content-postgres.test.ts
```

## 存储维护

旧维护入口仍为 `ops:prune:raw-events`、`ops:prune:metrics-snapshots` 与 scheduler 内的保留任务。`REDDIT_RETENTION_PRUNE_MAX_BATCHES` 默认 10，每张表每轮最多执行这么多批，剩余到下轮继续；HTTP 维护入口也受默认批数约束。CLI 返回的 deletedRows 只指本次删除量，不代表已清空全部过期数据。保留策略和新增表覆盖见 [架构](architecture.md)，不要直接对全部业务表运行无界删除。

## 部署边界

本轮以开发为重心，尚未公开上线。`deploy/` 是旧 Reddit 运行模板；部署前核对 Node 可执行路径、工作目录、环境、服务用户、数据库、真实 provider 与内存预算。不要把模板复制即视为可上线。

先构建不可变发布目录（含 `dist/`、`apps/web/dist/`、运行依赖和 SQL），备份数据库，再执行 `db:migrate:compiled`，新空库才运行 `auth:bootstrap-owner:compiled`。Nginx 应限制公开 `/readyz`，域名使用 HTTPS，启用安全 cookie 与明确的 CORS。真实 provider 验证和小规模采集通过后再启动调度；代码回滚不等于数据库回滚。

部署时可使用 `pg_dump --format=custom` 备份，并在隔离环境验证 `pg_restore --clean --if-exists --no-owner` 的恢复；这些操作需要真实数据库参数。公开服务配置完成后执行 `PUBLIC_BASE_URL=https://example.com npm run smoke:public-launch`，认证检查参数见 `scripts/smoke-public-launch.ts`。不在文档保存账号密码。
