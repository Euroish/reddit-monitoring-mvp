# 开发、协作与部署

本文只写**当前源码可执行入口**。Fastify、项目表、聚合adapter、Node24/PG16环境收敛仍是[开发安排](plans/source-expansion.md)中的待实施工作；不得把目标架构的命令提前当成已有功能。

## 1. 安装与启动

当前开发验证基线Node22，CI使用Node24；数据库当前兼容PG14，CI用PG16。目标统一Node24/PG16，版本升级单独演练，不在改文档时升级业务库。

```sh
npm ci
npm --prefix apps/web ci
npm run docs:check
npm run typecheck
```

数据库与运行配置从私有环境提供，参考 `deploy/env/`。API/公共来源worker开发时加载根 `.env.local`，shell变量优先；`LOCAL_ENV_FILE=none`关闭自动加载。迁移/首次owner CLI需由shell明确提供配置。连接池默认每进程5，`PG_POOL_MAX`调整；统计API、worker、CLI总连接数，不按单进程预算推全系统。

先确认 `DATABASE_URL` 指向开发库，配置 `API_BEARER_TOKEN`、`NODE_ENV=development`、明确的origin。所有真实采集默认保持 `SOURCE_NETWORK_ENABLED=false`。本地HTTP需要 `API_SESSION_COOKIE_SECURE=false`。

```sh
npm run db:migrate
npm run auth:bootstrap-owner    # 仅新空库；BOOTSTRAP_OWNER_*来自私有环境
npm run app:api
# 另两个终端：使用同一开发库与各自环境
npm run worker:sources
npm --prefix apps/web run dev
```

API当前仍是手写HTTP实现且装配旧runtime；启动API不等于应启动旧scheduler。公共内容开发默认只运行 `worker:sources`。前端默认Vite代理；API非默认端口设置 `VITE_API_PROXY_TARGET`，跨origin才配 `API_CORS_ALLOW_ORIGINS`。

### Windows合成演示

需要完整PostgreSQL bin/share，不自动下载。setup创建独立loopback演示库与合成provider，不访问Reddit/X；已有 `.env.local` 不覆盖。

```powershell
npm run local:setup -- --pg-bin 'C:\your-postgresql\bin'
npm run local:start
npm run local:status
npm run local:account     # 仅本机查看演示凭证，不复制到文档/日志
npm run local:stop
```

工具只管理本项目记录的进程；数据、凭证、日志在忽略的 `output/local-dev/`。Linux正式配置不沿用Windows管理记录。

## 2. 三人协作

从最新main建任务分支或独立worktree，先检查status、分支、远端和diff；不动别人的worktree、身份、凭证或未提交文件。共享对象库的fetch/建分支/提交串行执行；逐路径暂存，不用reset/clean/stash覆盖已有工作。

A负责后端整合，B负责来源与数据，C负责产品与Web；实际姓名、阶段依赖、删改表只在[开发安排](plans/source-expansion.md)维护。共享契约/迁移先协调；一个任务分支完成一条可验收流程，非作者复核后合入。不要三人同时重写组合根或各建一套DTO。

目录/命名迁移与功能变化尽量分开提交。迁移编号按完整文件名分配，历史42个SQL文件不修改。原root成果已整合到main，不再从旧分支重新复制；封存tag/历史蓝本仅供查证。

远端推送/合并按当前用户授权执行，不强推；main有新提交时整合后重新检查。交付优先推任务分支并给PR，不自动部署。文档是唯一当前说明：功能变更更新原段落，不追加日报/第二份交接规则。

## 3. 公共来源配置

`SOURCE_RUN_MODE=demo|live`：demo只注册合成provider，即使存在key和network=true也不启真实请求；production拒绝demo/mock。live仍需 `SOURCE_NETWORK_ENABLED=true`，付费provider还需私有凭证和管理员设置预算，默认disabled/0。开全局网络不是批准所有来源采集。

| provider | 当前可配置能力 | 配置与边界 |
| --- | --- | --- |
| `arctic_shift` | Reddit社区/账号帖子评论、帖子评论、范围内关键词/ID刷新 | 不需key；不支持无范围全站关键词；13位评论刷新缺陷未修，暂勿启成熟刷新 |
| `kaix` | Reddit跨社区search/社区/账号帖子，账号/帖子评论 | `APIFY_API_TOKEN`；单次有界样本、无cursor、partial，详见下节 |
| `twitterapi_io` | X账号/关键词/ID、post | `TWITTERAPI_IO_API_KEY`；请求超时 `TWITTERAPI_IO_TIMEOUT_MS` 默认20000，允许100–120000；无真实验收，现成本不准入 |
| `bluesky_appview` | 公开账号作者帖子/回复，排除转发/置顶 | 无key，handle或DID；不接受query，非高效持续增量/全历史能力 |
| `demo_reddit` / `demo_x` | 合成数据 | 仅演示/离线验证，不算真实来源 |

当前没有NewsNow/AIHOT/RSS、opportunity-biz、CiteRocket/Redditapis、Reddrix或X会话provider；不向现有provider的key填别家的token，也不能只改base URL。

### 任务与预算语义

- 每页1–100条、每任务1–20页，默认25/5；`worker:sources:once`只处理一页，不代表窗口完成。
- 单来源一个running、每purpose一个活动任务；手动相同参数复用，不同活动窗口可能409。暂停/归档取消旧租约；永久失败必须修正后显式Retry，resume/保存配置不解除阻塞。
- `continue`仅适用于有可续checkpoint的有界完成任务；页/内容/checkpoint同事务提交。未知覆盖不标全量。
- 临时错误/429每页最多三次保守请求启动尝试，预算/spacing拒绝不增加次数；重启不清空计数。配置revision不因后台进度而变化。
- requests/resources按UTC日/月保守预留，包含重试与未知结果；是调用预算，不是货币账单。每日/月度总额由真实账单对照，收费来源需额外数据商限额。
- 同来源页后当前有5秒nextRunAt，worker成功后睡1.5秒/空领3秒；性能测量要区分调度等待与SQL耗时。

### Reddit kaix / Apify

沿用现有迁移，无专用数据库/页面。live/network、私有token与provider预算都满足才可请求；token只发送到固定Apify API的Authorization header，不进入target/UI/URL/日志。

支持search、community、account帖子及account/post评论，不支持全站/社区评论搜索。上游召回后按标题/正文做NFKC、大小写/空白归一字面过滤，发布时间按 `[from,to)`；`new`可能回退relevance。每次最多100条目标内容，帖子评论可额外含根帖，没有持久cursor，即使maxPages更大也只启动一次Actor，不提供Continue。周期运行只是重复抽样，始终partial；任务exhausted只指本次操作结束。

固定Actor `kaix/reddit-scraper` build `0.2.25`、512MiB、45秒、关闭代理/平台自动重启；启动POST等待最多60秒（HTTP超时65秒），dataset GET为20秒/8MiB。每操作保守预留101 resources、1 adapter request，但实际含POST+GET，不能当HTTP数或账单。一次有界验证可设日/月requests各1、resources各101、间隔5000ms、schedule关闭；这只是请求上限，需另有费用授权。

Actor事件费上限每操作$0.01，另有平台计算/读写等可能费用，不是总美元硬上限。旧$0.50独立试验不等于批准长期收费调度，正常单位成本和月总额仍须准入。

`automaticRequestReplay=false`：已登记启动后，网络/解析/落库失败或租约恢复均不自动重发收费POST；先查Apify console，再显式Retry。Retry可能再次收费，未知结果不能保证可找回run ID。与Arctic Shift共享`t3_/t1_`身份、保留独立provider snapshot；`sourceObservedAt=null`，scrapedAt不伪装为指标源观测时间。

### Bluesky与会话试验

Bluesky用AT URI作身份，CID作版本；作者回复仍为post。cursor绑定来源/账号/窗口，不按feed最旧发布时间提前耗尽；indexedAt不冒充指标时刻。默认预算仍禁用/0。真实小样本授权后可设请求/资源硬上限，结束暂停/归档。

OpenCLI/twscrape等X会话只是[待验研究](research/data-sources.md#4-x先证明一条路径可用)，没有本仓库可运行的自动导入/远程领取接口。不要为对齐文档自动升级扩展、上传cookie或重启已关闭的Linux浏览器服务。

## 4. 当前HTTP与内容使用

默认入口 `/content`，详情 `/content/:id`，个人工作区 `/saved`、账户 `/account`。项目页面尚未实现；旧Markets/Queries/Compare/Run/Target仍可访问，但不继续扩展。

| API族 | 用途 |
| --- | --- |
| `GET/POST /v1/sources`、`PATCH /:id`、`POST /:id/pause\|resume\|archive\|collect` | 来源配置/生命周期、有界入队（202） |
| `GET /v1/source-jobs`、`GET /:id`、`POST /:id/cancel\|retry\|continue` | 任务状态与恢复 |
| `GET /v1/source-ops`、`PUT /v1/source-provider-budgets/:provider` | 心跳/任务/费用单位与预算 |
| `GET /v1/content`、`/stats`、`/workbench`、`/:id`、`/export` | 已存内容、同范围统计、详情、JSON/CSV |
| `/v1/content-saved-queries`、`/v1/content-annotations`、`/v1/content/:id/annotation` | 个人保存与收藏/注释 |
| `/v1/research-exports`、`/:id`、`/:id/content`、`/:id/export` | 同RR冻结样本、manifest、分页导出/显式删除 |

表中`|`表示多个独立路径，不是实际URL。方法和精确请求/响应以[公共契约](../packages/contracts/src/source-content.ts)、[研究契约](../packages/contracts/src/research-export.ts)与路由源码为准。

读取需session/bearer；来源/任务/预算写入限admin/owner/machine。个人空间/研究仅资源所属session，machine无个人空间。个人创建expectedRevision=0、修改/删除用当前revision，409保留草稿再reload；来源配置Web同样携带revision。

内容查询只有已落库范围；支持platform/provider/source/kind、作者/语言/group、发布时间、正文与同平台指标。`from`含、`to`不含，cursor绑定全部筛选。文本模式literal/phrase连续字面匹配，terms为空白分词全AND；NFKC、Unicode小写/空白归一，中文/%不是SQL通配或英文stemming。exclusions最多10项、每项200字符。缺失检索投影时文本查询503，不假装0命中；普通列表仍返回覆盖缺口。

即时导出每文件≤2000条、可用nextCursor续导；统计/续页可随采集变化。CSV含元数据、文本ID与公式防护。研究冻结同一RR事务固定成员/分母/必要载荷，最多20,000条/32MiB，超额整笔413；每页1–100。live修改/删除不改变已冻结成员，资源所属用户可显式删除；自动保留未实现。媒体仅主动点击读取HTTP(S)链接。

## 5. 按改动选择验证

```sh
npm run docs:check
npm run typecheck
npm run lint:web
npm run verify:repo       # docs/typecheck/API+Web构建/compiled smoke
npm run test:offline
npm run test:postgres     # 需独立TEST_SOURCE_DATABASE_URL
```

纯文档只跑docs与diff；受影响接口/adapter先跑相关测试；HTTP迁移/删除旧主链等跨层里程碑再跑完整门禁。`npm test`保留SQL缺配置时skip的旧行为，不能作SQL验收；`test:offline`要求零fail/skip，`test:postgres`缺合法测试库直接失败。

原生SQL使用UTF8的独立loopback `source_validation_*` 测试库，绝不指向业务库。新集群initdb显式UTF8，SQL_ASCII不支持Unicode normalize。

| 检查 | 当前入口与范围 |
| --- | --- |
| 配置 | `npm run config:check`、`npm run local:config`，不证明真实采集成功 |
| 内容/账户/研究E2E | `smoke:accounts:local`、`smoke:content:local`、`smoke:research:local`，独立PG/合成provider/临时API+Vite，禁止外网 |
| Windows演示闭环 | local:setup/start后 `npm run smoke:local` |
| 合成API浏览器 | `smoke:accounts`、`smoke:content`、`smoke:research`，需明确SMOKE_WEB_BASE_URL |
| 性能 | `npm run benchmark:sources -- --rows 20000 --repeats 20 --out output/validation/唯一报告.json`，专用测试库；现有脚本不是百万内容负载验收 |

浏览器可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已有Chromium；结果在忽略的output。CI门禁在 `.github/workflows/verify.yml`；以同一提交结果为准，不以本机或历史成功替代。真实来源验证另设目标/时限/费用授权，不放进日常CI。

## 6. 迁移、维护与发布

只新增SQL迁移，不修改已应用文件；按“扩展结构→兼容应用→有界回填→校验切读→后续移除”推进。大回填不放长迁移事务，删除旧代码不等于删除旧表。

- 公共搜索回填：`npm run ops:backfill:public-search -- --limit=100 --dry-run`；确认后去dry-run，按nextCursor加 `--after=UUID`，remaining=0才算该pass完成。生产omit-dev用 `node dist/scripts/backfill-public-search-index.js`，不假设有tsx。查询不自动回填。
- 存储预览：`npm run storage:plan -- --out output/validation/storage-preview.json`，只读盘点、不批准删除。容量模型只估content/observation，不能当全库预测。
- 旧 `ops:prune:raw-events` / `ops:prune:metrics-snapshots` 和scheduler维护只覆盖旧表；默认每表每轮最多10批，不是新增公共数据的自动留存。目标保留期需先确认，再实现有界执行器。
- 备份：`npm run db:backup -- --file output/backups/唯一名称.dump`；恢复：`npm run db:restore -- --file output/backups/唯一名称.dump --target info_workbench_restore_唯一名称`。需要匹配服务器的完整PG_BIN，仅恢复到新库，验证SHA/库存/迁移后再验业务，工具不自动切业务连接。
- 打包：`npm run release:pack`；检查：`npm run release:verify -- output/releases/目录`。产物不可覆盖、精确库存/SHA，不含凭证/数据库/node_modules；生产依赖按manifest安装。它提供完整性而非签名。

部署顺序：同一提交构建→确认备份/恢复→停领不兼容worker→迁移/显式回填→切API/Web/worker→健康+关键读取+本次任务验证。代码回退不撤销SQL；不可兼容数据变化需前向修复或按验证方案恢复。PG14→16和Node22→24分别演练后才更改业务默认版本。

Linux当前模板在 `deploy/`，包含API、公共来源worker与待退役旧服务；只启动当前所需服务。已知HTTP/IP验收用Nginx8080→本机API3000、`/opt/reddit-monitoring`指向不可变产物，私有环境在 `/etc/reddit-monitoring/`。当前实时部署未在本轮复验，历史边界见[状态](status.md)。

正式公网用HTTPS、安全cookie、精确origin，限制 `/readyz` 与 `/api/readyz`；旧HTTP验收例外不推广。Nginx登录边缘限流与API总量桶都保留。不要信任任意XFF，不把模板回归当实际TLS/容量验收。

发布Web时将哈希assets追加到共享静态目录，同名必须字节一致；保留旧哈希供旧标签使用，哈希文件immutable，缺失404，入口HTML no-cache。切symlink后不立即清空旧资源。私有配置/备份不包含静态目录，可从已校验产物重建。

已关闭的public-tunnel/desktop/chrome/bridge研究服务保持关闭；来源健康、数据新鲜度和服务ready分开验证。日常运维起步只需任务积压/失败、来源年龄/覆盖、API/DB延迟、磁盘/内存与版本，不另搭可观测性平台。

## 7. 提交检查

逐路径核对status/diff，运行 `npm run docs:check` 和 `git diff --check`；不提交token、原始数据、运行报告或output中的上游源码。文档路径变更同步 `scripts/check-docs.ts`、`scripts/release-package-lib.mjs` 和内部链接，再跑release-package专项测试。本轮不移动历史蓝本/文档路径，不修改发布允许清单。
