# 开发、协作与验证

## 安装与开发

使用 Node.js 22+ 与 npm，本轮 Windows 本地验证使用 Node.js 24.14.0、PowerShell 7。从仓库根目录执行：

2026-10-13 已恢复并行，4B 0.6.0 的独立版本已完成类型、构建、离线/SQL 与本地账户闭环验收。原 WIP 停止标签保留；后续工作不能用 reset/clean/stash 覆盖。当前全部40个SQL已在隔离库与管理info_workbench_dev应用；既有账号/数据保留，真实provider关闭。

```powershell
npm ci
npm --prefix apps/web ci
npm run docs:check
npm run typecheck
```

数据库流程需要 PostgreSQL 和本地 `DATABASE_URL`。连接池默认每进程 5，`PG_POOL_MAX` 调整池大小；构造参数 `max` 优先于环境变量。环境参考 `deploy/env/`，不把示例密码用于真实环境。API 与新来源 worker 在开发模式加载根目录 `.env.local`，已有 shell 变量优先；`LOCAL_ENV_FILE=none` 可关闭加载，生产只加载明确指定的私有文件。迁移/首次 owner CLI 的手动运行需由 shell 提供变量，本地管理工具会传入完整配置。

### Windows 一键本地演示

此入口将来源 worker 配置为合成 provider，`/content` 演示不请求真实 Reddit、Arctic Shift 或 X。4A 的共同政策将 `SOURCE_NETWORK_ENABLED=false` 覆盖到旧入队/同步 Run、worker/CLI 与 connector 工厂；live 还要求运行模式不是 demo，production 拒绝 mock/demo。合成验证中的 connector 或 fetch stub 可显式配置测试环境，不能用全局联网绕过门禁。需要完整 PostgreSQL 安装目录中的 `bin`（含 initdb/pg_ctl/postgres，父目录含 share），不自动下载安装。首次 setup 复制运行库到忽略的 `output/local-dev/pgsql`，创建全新 loopback 集群和 `info_workbench_dev`，不会连接旧展示库。已有 `.env.local` 会保留并拒绝自动覆盖。

```powershell
npm run local:setup -- --pg-bin 'C:\your-postgresql\bin'
npm run local:start
npm run local:status
npm run local:account     # 本机查看合成演示 owner 凭证
npm run local:stop
```

setup 自动迁移、创建首位 owner 和有界合成样本；重跑保留数据与账号，并应用新增迁移。start 启动 API、来源 worker、Vite；输出实际 URL。默认端口被占用或保留时选择可绑定端口，配置持久化，不停止其他应用占用的端口。stop 只结束已记录且命令行匹配本仓库的进程，保留数据库和配置。日志、账号和进程记录在 `output/local-dev/`；`.env.local` 已忽略，不提交凭证。正式接入时手动按下面的 provider 配置运行，不把演示指标当真实数据。

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

公共来源运行由 `SOURCE_RUN_MODE=demo|live` 决定。demo 注册 `demo_reddit/demo_x`，真实 provider 显示禁用，即使 shell 有 key/network=true 也不联网。live 默认网络关闭；只有明确配置 `SOURCE_NETWORK_ENABLED=true` 才启用真实 Arctic Shift（不需 key）；X 还要求私有 `TWITTERAPI_IO_API_KEY`，超时 `TWITTERAPI_IO_TIMEOUT_MS` 默认 20000（允许 100–120000）。旧 `REDDIT_RUN_MODE` 与 `REDDIT_LIVE_PROVIDER=http|scrapling` 只控制旧 Reddit 功能，不能用于选择 Arctic Shift 或 X。管理工具固定使用 demo；本轮不得改成 live 试跑。

公共入口和默认登录落点为 `/content`，筛选作者/语言/来源group、平台/provider/source/kind/正文/发布时间/指标和排序保存在URL；登录恢复原path+query，旧Markets/比较入口保留。已存详情 `/content/:id` 展示可空字段、独立指标时间/单位和来源，引用与children各≤20；媒体只在主动点击时读取HTTP(S)链接。个人保存查询在 `/saved` 管理、重开、重命名和删除；收藏/注释按user隔离，用revision冲突保持草稿再reload。公共内容导出使用 `/content` 的 JSON/CSV 下载（每文件最多 2000，支持 nextCursor 续导出），记录过滤范围、总分母、条数和截断；CSV 首行 export_metadata，随后字段表头/记录，数字内容 ID 作为文本、来源文本防公式执行。即时导出在并发采集时统计与续页可变化；研究需要固定成员时在同页展开冻结导出、指定名称和条数上限，创建后在 `/saved?research=ID` 查看manifest并按每页1–100条下载JSON/CSV。冻结成员/分母、来源配置、最新范围观测和单位/版本保存在同RR快照，live变更或删除不改变已冻结成员；所属用户显式删除snapshot会级联其成员。32MiB完整UTF8载荷、最多20,000条，超额整笔拒绝413不截断；数据库先计算读载荷预算，再取完整正文/JSON和范围内来源；最终规范manifest+items再精确校验。旧 `research:export:reddit` 与 `research:export:reddit-search` 仍依赖旧模型。所有生成结果归入 `output/`。

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

应用全部当前SQL迁移（目前40个，含030/035配置与038索引）后，登录工作台进入 `/content`（“来源内容”）。本轮管理工具固定demo，只创建 `demo_reddit/demo_x` 合成来源；下面Arctic Shift属于后续另获用户授权的live配置说明，当前不得尝试真实请求。live条件满足后管理员创建来源：平台为Reddit、provider为`arctic_shift`；社区或账号可采帖子/评论，帖子 ID 仅采评论。可保存范围内关键词；上游限制较活跃目标的关键词检索，不支持无范围全站搜索。查询页的关键词是已保存标题/正文的字面匹配，支持中文，与上游检索范围分开。

设置查询时间窗后点击对应来源的采集按钮；日期为空默认最近 24 小时。HTTP 只入队，worker 另行启动。每页 1–100 条、每任务 1–20 页，默认 25 条/5 页，当前 UI 使用默认值；`worker:sources:once` 只处理一页，不代表完整任务结束。达到预算但仍有 checkpoint 的任务可继续；失败任务可重试。仓储允许每purpose一条活动队列，单来源同时仅一个running。当前手动collect入口先检查任何active：相同manual参数复用，不同窗口/预算或非manual活动任务返回409；不能承诺任意入队顺序都可立即追加manual。后台scheduler可与已有manual按purpose排队，已验证公平机会与互斥。

| 方法与端点 | 用途 |
| --- | --- |
| `GET /v1/sources` | 已保存来源与实际 provider 能力 |
| `POST /v1/sources` | 创建/更新同一目标的来源标签 |
| `PATCH /v1/sources/:id`、`POST .../pause/resume/archive` | 标签、分组、周期/成熟刷新设置和来源生命周期；目标身份固定 |
| `POST /v1/sources/:id/collect` | 提交有界采集，返回 202 与任务 |
| `GET /v1/source-jobs/:id` | 状态、计数、checkpoint、覆盖及错误 |
| `GET /v1/source-jobs`、`POST /v1/source-jobs/:id/cancel` | 按来源/状态查看任务、取消并使旧租约 token 失效 |
| `POST /v1/source-jobs/:id/retry`、`/continue` | 重试失败任务或从有界完成任务的 checkpoint 继续 |
| `GET /v1/content` | 按 platform/provider/sourceId/kind/query/from/to/limit/cursor 查询已落库内容 |
| `GET /v1/content/stats` | 相同过滤范围的总数、类型分布与 UTC 日计数 |
| `GET /v1/content/workbench` | 同范围唯一总数/类型/日桶/平台/provider；provider 计数允许重叠，不相加 |
| `GET /v1/content/export?format=json\|csv&maxItems=2000` | 有界导出、完整元数据与续页；viewer 可以读取和导出 |
| `GET /v1/content/:id` | 已存规范内容详情、来源与引用/children各最多20，不联网上补 |
| `GET/POST /v1/content-saved-queries`、`PATCH/DELETE /:id` | 当前用户保存查询的分页、创建、重命名/筛选更新和删除 |
| `GET /v1/content-annotations`、`GET/PUT/DELETE /v1/content/:id/annotation` | 当前用户收藏/注释、分页和带revision编辑/删除 |
| `GET/POST /v1/research-exports`、`GET/DELETE /:id` | 当前用户完整冻结样本、分页列表、manifest和显式删除 |
| `GET /v1/research-exports/:id/content`、`GET .../export?format=json\|csv` | 冻结ordinal页（1–100）、固定total/manifest/nextCursor |
| `GET /v1/source-ops`、`PUT /v1/source-provider-budgets/:provider` | 队列/worker 心跳/独立时间年龄，以及每日/月度预算 |

公共内容/来源读取要求session或有效bearer，来源/任务/预算写入要求admin/owner或machine；个人query/annotation和research只允许拥有资源的用户session，viewer可管理自己的记录，machine401。个人创建必须expectedRevision=0，更新/删除必须当前revision（DELETE带JSON body），409保持稿后reload；来源/预算/target的expectedRevision兼容客户端可省略盲写，Web实际携带版本。查询不会触发外部网络。`from` 含、`to` 不含，使用 ISO 时间；列表 cursor 绑定过滤条件，修改过滤后不能复用。查询量以已采集内容为分母，未知发布时间不进入日桶。详细请求/响应类型由 [共享契约](../packages/contracts/src/source-content.ts) 定义。

0.9.1将失败分为transient/permanent。永久错误使来源automaticCollectionBlocked=true，拒绝自动领取/调度及新增/续采；修正配置后在任务历史或当前任务面板显式Retry，原子解除阻塞并保留checkpoint，resume不会解除。临时错误/429同一任务页最多三次保守请求启动尝试，预算/spacing拒绝、租约恢复不会重置。刷新maxAttempts为最多自动轮次：首次请求前持久记轮次/冷却，每轮最多三次启动尝试（含首请求），人工Retry明确授权额外一轮，仍受provider预算/间隔。前置记账后进程崩溃可能未实际发请求，不能当账单。默认36小时成熟、12小时间隔、3自动轮次；缺失ID不视为删除，X snapshot仍无自动刷新。

预算每日/月度以 UTC 计；requests 包含每次重试尝试，resources 为 pageSize/固定上游页界限或刷新 ID 数的保守预留，不是账单。未知请求结果保留预留。付费 provider 默认禁用且四个上限为 0；授权角色提高预算后会唤醒预算阻塞的任务。网络能力关闭时不会持续生成新的周期失败任务，已有手动任务保留明确错误。worker 心跳、最近成功年龄、最新已存发布时间年龄分开展示，不能承诺上游实际 12 小时新鲜度。

### X 配置与共享字段

迁移 031 注册 X 平台；运行时注册 `twitterapi_io`，账号/搜索只采 post，标题可为空、内容 ID 始终字符串，支持回复/线程/引用/转发、媒体、可空指标与 provider 白名单 metadata。账号/搜索一次上游页最多 20，缩小本地 pageSize 不降低固定页资源预留；账号历史有界过滤、搜索使用同窗口、checkpoint 绑定目标/窗口。真实 key 与 network 开关只开启能力，付费额度仍默认 disabled/0，需要 admin/owner 在预算页另设上限才允许请求。

当前没有 key、费用授权或真实验收；只验证两种官方账号响应 envelope、搜索/ID schema、错误/限流/abort 和离线闭环。不宣称覆盖全历史或实时指标；X 不提供源指标观测时刻时保持 sourceObservedAt=null、fetchedAt 为取回时刻。未来 web adapter 应用 `webContentIdentity` 对 namespace+kind+原 GUID 生成合格身份，保留三项白名单 provenance；不能用未限定站点的 GUID 落库，现有旧合成数据不自动改写。

032 增加已登记 provider 调用数和取页/解析累计耗时；预算拒绝与预先取消不计请求。正常/错误/刷新均登记，但取消/租约丢失会拒绝晚到登记，因此请求数可能低于实际尝试，不能作为账单；原预留不退。旧 PostgreSQL upsert 遇到已有公共规范内容时保留规范标题/正文/URL/发布时间，只维护旧目标关联与取回时间，不能绕过观测顺序保护。

## 验证

```powershell
npm run docs:check
npm run typecheck
npm run lint:web
npm run verify:repo       # 文档、类型、API/Web 构建、compiled smoke
# 全量测试串行运行
npm test
```

阶段 1 UI 冒烟使用浏览器合成 API 且拦截外网：先启动 Vite，再设置 `SMOKE_WEB_BASE_URL` 后运行 `npm run smoke:workbench`。如本机 Playwright 浏览器未在默认位置，设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已安装 Chromium；报告在 `output/playwright/`。旧内容搜索索引可显式运行 `npm run ops:backfill:post-search -- --config-only` 核对参数，移除 config-only 后才写库；默认每批 500、最多 10 批，只回填缺失/变化行，正常查询不触发回填。

先跑受影响测试；只有跨层里程碑或实际变更范围需要时才跑全量构建/回归。代码检查通过后，纯文档更新只跑 `docs:check` 与 diff 检查。外部数据解析、幂等/恢复、缺失指标与公共权限边界值得做回归测试；不为内部 getter、纯文字或每种假想状态增加测试矩阵。

`npm run config:check` 校验已加载环境，`npm run local:config` 只预检管理配置、不启动或写数据库。新旧正式采集入口的外部请求都要求明确 `SOURCE_NETWORK_ENABLED=true`，本次任务仍禁止开启真实请求。

`npm run test:offline` 明确排除 native SQL 文件，并要求零 fail/零 skip；`npm run test:postgres` 自动发现全部 `*-postgres.test.ts`，缺少合法独立 `TEST_SOURCE_DATABASE_URL` 时直接失败。`.github/workflows/verify.yml` 运行清洁依赖、docs/lint/typecheck/离线/build/compiled、独立 PostgreSQL 与合成 E2E；本机通过不等于云端已执行。`npm test` 保留原回归入口及 SQL 默认 skip 行为，不能作为 SQL 已通过证据；数据库或网络验证另行执行并记录环境。compiled smoke 或 provider 的 `--config-only` 通过，只证明构建/配置，不能证明真实采集。存在已知失败时见 [当前状态](status.md)，比较基线与新增失败，不能将失败测试禁用后宣称完成。

新增的 PostgreSQL 集成测试默认跳过，必须提供独立 loopback `source_validation_*` 测试库的 `TEST_SOURCE_DATABASE_URL`，测试会执行迁移和写入合成记录，不得指向业务库：

```powershell
# 先创建隔离测试库，再配置它的 TEST_SOURCE_DATABASE_URL
node --import tsx --test tests/integration/source-content-postgres.test.ts
```

提供独立 `TEST_SOURCE_DATABASE_URL` 后，可运行 `npm run test:sources:postgres` 验证最初七项 SQL 场景（4A 及后续新增场景统一用 test:postgres）（脚本仅接入合成 provider）。每项均检查 loopback 和 `source_validation_*`；未提供时明确跳过，不能当 SQL 验收。`npm run smoke:local` 使用当前管理工具的本机私有账号，走真实前端/API/worker/PostgreSQL，创建有界合成 E2E 来源后归档，并验证 Reddit/X 已存内容与浏览器 JSON/CSV 下载；要求先 local:setup/start，浏览器配置同 smoke:workbench。纯 UI 合成 API 管理冒烟为 `npm run smoke:sources`，需要 `SMOKE_WEB_BASE_URL`。

## 存储维护

`npm run storage:plan -- --out output/validation/storage-preview.json` 只读统计所有 public 表与候选，默认天数是操作预览，不批准删除。容量需要同时指定 `--daily-content 数值 --daily-observations 数值 --capacity-days 90`；未指定流量为未知null。使用私有 `DATABASE_URL`，限定 loopback，无URL额外参数。`estimatedContentAndObservationBytes` 仅估内容与观测，scope为content_and_observation_only；公共投影、discovery、冻结成员、个人数据及其它public表均在excludes列出，不能当全库预测。

备份需要完整且与服务器匹配的客户端 `PG_BIN`，含 pg_dump/pg_restore；当前本机17.11已补全。运行 `npm run db:backup -- --file output/backups/唯一名称.dump`，凭证只来自私有DATABASE_URL环境；不会覆盖已有文件。运行 `npm run db:restore -- --file output/backups/唯一名称.dump --target info_workbench_restore_唯一名称`，仅创建新库、拒绝原库或已有库。检查同快照manifest/SHA/行数/迁移后，在恢复库另验登录、来源、观测、checkpoint、预算和Saved；工具不自动切业务连接或删除备份。

`npm run release:pack` 构建/compiled smoke后产生 output/releases 的新目录；`npm run release:verify -- output/releases/目录` 检查精确库存和所有SHA。包含编译API/worker、Web、SQL、公开模板和原八份文档，排除私有环境、数据库、原始数据和node_modules。未签名、未部署，生产依赖需按manifest另安装，部署入口仍需核对实际宿主。

`npm run benchmark:sources -- --rows 20000 --repeats 20 --out output/validation/唯一报告.json` 需要TEST_SOURCE_DATABASE_URL为专用loopback source_validation_*，新建合成库，不使用业务库；报告包括repository P95/EXPLAIN/DB大小/WAL差量/客户端RSS。不要将本机暖缓存结果当真实provider或生产SLO。


旧维护入口仍为 `ops:prune:raw-events`、`ops:prune:metrics-snapshots` 与 scheduler 内的保留任务。`REDDIT_RETENTION_PRUNE_MAX_BATCHES` 默认 10，每张表每轮最多执行这么多批，剩余到下轮继续；HTTP 维护入口也受默认批数约束。CLI 返回的 deletedRows 只指本次删除量，不代表已清空全部过期数据。保留策略和新增表覆盖见 [架构](architecture.md)，不要直接对全部业务表运行无界删除。

## 部署边界

本轮以开发为重心，尚未公开上线。`deploy/` 是旧 Reddit 运行模板；部署前核对 Node 可执行路径、工作目录、环境、服务用户、数据库、真实 provider 与内存预算。不要把模板复制即视为可上线。

0.9.1模板同时限制/readyz与/api/readyz；公网smoke检查两条。Nginx登录/注册按$binary_remote_addr做20次/分钟、burst5边缘限流，不信任任意XFF；API仍有代理socket地址共用的默认认证总量桶，须按实际并发明确部署容量，不能把模板静态回归称为TLS/反代运行验收。注册/bootstrap/改密共用12–128字符新密码政策，旧短密码只保留登录兼容。

先构建不可变发布目录（含 `dist/`、`apps/web/dist/`、SQL和生产依赖lockfile，运行依赖另按manifest安装），备份数据库，再执行 `db:migrate:compiled`，新空库才运行 `auth:bootstrap-owner:compiled`。Nginx 应限制公开 `/readyz`，域名使用 HTTPS，启用安全 cookie 与明确的 CORS。真实 provider 验证和小规模采集通过后再启动调度；代码回滚不等于数据库回滚。

部署时可使用 `pg_dump --format=custom` 备份，并在隔离环境验证 `pg_restore --clean --if-exists --no-owner` 的恢复；这些操作需要真实数据库参数。公开服务配置完成后执行 `PUBLIC_BASE_URL=https://example.com npm run smoke:public-launch`，认证检查参数见 `scripts/smoke-public-launch.ts`。不在文档保存账号密码。

账户验证：`npm run smoke:accounts` 使用合成 API；`npm run smoke:accounts:local` 要求 `TEST_SOURCE_DATABASE_URL` 指向 loopback 的 `source_validation_*` 库，创建新合成库并启动自己的临时 API/Vite，实际验证改密、会话撤销、账号隔离和持久化审计。已有 Chromium 可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定。临时进程结束，合成数据库保留；凭证不打印，外部请求禁止。

5A 验证：`npm run smoke:content` 为合成API浏览器；`npm run smoke:content:local` 用新建专用loopback验证库，实际API、合成provider/worker与浏览器，检查保存/重开/详情/注释CAS/下载和账号隔离，私有凭证不打印，退出自己的临时服务，保留合成库。

公共检索：`/content` 或 `/v1/content` 的 `searchMode=literal|terms|phrase`，`searchScope=title|text|title_text`，默认literal/title_text；terms为空白分词后的全员AND字面子串，literal/phrase都匹配连续文字；不stemming、不OR、不把引号当DSL。NFKC、Unicode toLowerCase及空白归一由同一JS代码处理。`exclusions` URL重复参数最多10项、每项200字符，Web每行一项；仅对选定已存字段生效，不搜索外网或未采集内容。列表/stats/即时导出共享同filter/cursor与真实candidate/index/text覆盖；漏投影时文本查询返回503而非假0。

升级038后历史公共内容需要显式有界回填：`npm run ops:backfill:public-search -- --limit=100 --dry-run` 只预览，去掉dry-run后每批写缺失/变化行；用返回nextCursor作为 `--after=UUID` 续批直到remaining=0，requiresRescan时重新开始有界pass。它用当前私有DATABASE_URL，操作前核对开发库；读查询不会写索引。页提交维护投影，外部SQL更改title/body会使投影失效，再显式回填。

5B验证：`npm run smoke:research` 为合成API流程；`npm run smoke:research:local` 新建专用loopback合成库并启动自己的API/Vite/worker实例，验证104成员100+4分页、JSON/CSV/manifest、live修改独立、账号隔离和删除；不改业务库、不联网。CI模板已串入三个实际local脚本，云端尚未运行。

发布或已升级旧库存：应用038后、开启文本查询前，先用生产可运行的 `node dist/scripts/backfill-public-search-index.js --limit=100 --dry-run` 检查，移除dry-run后显式有界回填；按nextCursor加 `--after=UUID` 续批、remaining=0才算当前pass完整。omit-dev产物不含tsx/TS源，不能用开发命令替代。新页提交会维护投影，未回填的旧范围文本query明确503。

当前本机演示地址由local:status确认，本轮为 http://127.0.0.1:28061/content（API28060/PG25432），不要假定5173仍是本项目。已有配置可 `npm run local:setup` 追加迁移/合成种子后 `npm run local:start`；原账号见local:account，勿贴凭证。应用升级后若服务已在运行，应local:stop再start以加载新代码，保留数据；操作时确认进程是管理入口记录的本仓库服务。

## 版本收口与提交前准备

本次0.9.1本地提交基于ddf144f与既有0.9.0标签，package.json和根lockfile版本一起更新，历史标签/发布目录不覆盖。039使SQL文件总数为41；本轮仅新隔离库验收，不升级既有管理库或生产库。039对无失败类别的历史failed采用保守阻塞，升级后修正配置并显式Retry；不会自动丢弃checkpoint/history。

提交前依次核对git status/diff、旧SQL完整性、版本/lockfile、秘密与生成物排除，再运行docs:check、typecheck、lint:web、test:offline、独立test:postgres、build/compiled及合成浏览器。新增`npm run smoke:content:closeout`自行启动临时loopback Vite，拦截API/外网，验证空/缺正文、动态库存、阻塞后两处Retry缓存恢复和移动中文；结束只关闭自身服务。本轮固定候选与命令/哈希/报告放output/validation/closeout-v0.9.1，复用已安装依赖不冒充clean install。

版本摘要和范围见handoff，实际过程见development-log；待提交路径清单与提交说明在上述忽略目录。2026-10-14用户已授权一次本地提交：逐路径暂存后复核cached diff与docs，并核对提交父节点、分支与工作区状态。结果记录于output/validation/commit-v0.9.1-20261014；不创建新标签、不push或合并，不把检查报告、数据库、凭证或node_modules纳入Git。
