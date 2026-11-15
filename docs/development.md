# 当前开发与部署说明

本文只记录**当前源码已有入口**。Fastify、项目、NewsNow/RSSHub、归档生产/导入/release 和新目录均未实现，不能按目标规范猜测命令。设计见[架构](architecture.md)，实施见[重建计划](plans/source-expansion.md)。

## 1. 安装与启动

当前开发基线 Node22、CI Node24；数据库当前兼容 PG14，CI PG16。重建目标 Node24/PG16，升级须单独验证。第三方 RSSHub 的运行时要求单独锁定，不与主产品混为一谈。

```sh
npm ci
npm --prefix apps/web ci
npm run docs:check
npm run typecheck
```

先确认 `DATABASE_URL` 指向开发库，配置 `API_BEARER_TOKEN`、`NODE_ENV=development`、明确 origin。配置模板在 `deploy/env/`，私有值不进 Git。

API/公共来源 worker 开发时读取根 `.env.local`；shell 优先，`LOCAL_ENV_FILE=none` 禁用。迁移/首次 owner CLI 由 shell 明确提供配置。本地 HTTP 用 `API_SESSION_COOKIE_SECURE=false`，真实来源默认 `SOURCE_NETWORK_ENABLED=false`。

```sh
npm run db:migrate
npm run auth:bootstrap-owner    # 仅新空库，BOOTSTRAP_OWNER_* 由私有环境提供
npm run app:api
# 分别在其他终端启动
npm run worker:sources
npm --prefix apps/web run dev
```

API 仍装配 `createPostgresPhase1Runtime()`，不意味着还应启动旧 scheduler。公共内容开发只启动所需 `worker:sources`。Vite 使用代理；API 端口变动设 `VITE_API_PROXY_TARGET`，跨 origin 才配 `API_CORS_ALLOW_ORIGINS`。

当前连接池默认每进程 5，可用 `PG_POOL_MAX` 调整；统计 API、worker、CLI 合计连接，不把单进程值当整机预算。

### Windows 合成演示（现有工具）

需完整 PostgreSQL bin/share；不自动下载，不覆盖已有 `.env.local`。仅独立 loopback 库与合成 provider，不访问 Reddit/X。

```powershell
npm run local:setup -- --pg-bin 'C:\your-postgresql\bin'
npm run local:start
npm run local:status
npm run local:account     # 仅本机查看凭证，不复制到文档/日志
npm run local:stop
```

生成记录位于忽略的 `output/local-dev/`；工具只管理其记录的本项目进程，Linux 正式配置不复用 Windows PID/路径。

## 2. 当前来源配置

`SOURCE_RUN_MODE=demo|live`。demo 只注册合成来源；production 拒绝 demo/mock。live 仍需 `SOURCE_NETWORK_ENABLED=true`、相应私有凭证与管理员启用 provider 限额。开启全局网络不是批准全部来源调用。

| provider | 已有能力 | 配置/当前边界 |
| --- | --- | --- |
| arctic_shift | Reddit 社区/账号帖子评论、帖子评论、范围内关键词/已知 ID | 无 key；非全站关键词；13 位评论刷新校验缺陷待修 |
| kaix | Reddit 跨社区 search、社区/账号帖子、账号/帖子评论 | `APIFY_API_TOKEN`；无 cursor，始终 partial；未知收费启动不自动重发 |
| twitterapi_io | X 账号/关键词/ID 帖子 | `TWITTERAPI_IO_API_KEY`；未真实验收；timeout 默认 20000ms，允许100–120000 |
| bluesky_appview | 公开账号作者帖子/回复 | 无 key；handle/DID；无关键词/完整历史/删除检测 |
| demo_reddit / demo_x | 明确标记的合成数据 | 只验证流程，不算真实来源 |

没有正式 NewsNow/RSSHub/RSS/归档 provider 或导入 CLI，也没有 X 会话自动上传/远程领取接口。Instagram/web 类型不代表接入。真实调用仍需本次范围内授权，旧试验授权不自动延续。

### 当前任务语义

- 页大小 1–100、任务 1–20 页，默认 25/5。`worker:sources:once` 只处理一页，不保证窗口完成。
- 单来源一个 running，每 purpose 一个活动任务；相同手动参数复用，不同活动窗口可能 409。
- 暂停/归档取消租约；永久失败需修正后显式 Retry，保存配置/resume 不解除阻塞。
- Continue 只适用于有可续 checkpoint 的已结束有界任务。页/checkpoint 同事务，覆盖未知不标全量。
- 临时错误/429 每页最多三次请求启动尝试，跨重启持久化；spacing/限额拒绝不计请求尝试。
- requests/resources 按 UTC 日/月保守预留，包含重试/未知结果；不是货币账单。旧产品固定费用约束已移除，运行限额机制仍存在。
- 当前同源页后有 5 秒 nextRunAt，worker 成功睡 1.5 秒、空领 3 秒；性能测量区分调度等待与 SQL。目标设计将清理非必要固定等待。

### kaix 特有行为

固定 Actor `kaix/reddit-scraper` build `0.2.25`，512MiB、45秒，禁代理/平台自动重启；POST 等待最多60秒（HTTP timeout65秒），dataset GET20秒/8MiB。每次最多100条目标内容，帖子评论可能附根帖。

每操作保守预留101 resources、1 adapter request，但实际含 POST+GET；不能当 HTTP 数或账单。Actor 事件费上限每操作 $0.01 不含全部平台费用，不能当总支出保证。无持久 cursor，不提供 Continue，周期任务也是重复抽样。

`automaticRequestReplay=false`：登记启动后网络/解析/落库/租约恢复失败都不自动重发收费 POST；先查供应商 console，再显式 Retry，可能重复收费。与 Arctic Shift 共用 Reddit 内容身份，独立观测；scrapedAt 不冒充 sourceObservedAt。

## 3. 当前 API 与产品入口

默认 `/content`，详情 `/content/:id`，个人工作区 `/saved`、账户 `/account`。项目/数据集新页面未实现；旧 Markets/Queries/Compare/Run/Target 尚可访问，按重建计划退役，不继续扩展。

| API 族 | 当前用途 |
| --- | --- |
| `/v1/sources`、来源 pause/resume/archive/collect | 配置、生命周期与有界入队 |
| `/v1/source-jobs`、cancel/retry/continue | 任务状态与显式恢复 |
| `/v1/source-ops`、`/v1/source-provider-budgets/:provider` | worker/来源状态、调用与资源限额 |
| `/v1/content`、stats/workbench/detail/export | 已存内容、统计、详情与 JSON/CSV |
| `/v1/content-saved-queries`、`/v1/content-annotations` | 个人查询/收藏/注释 |
| `/v1/research-exports` 及成员/导出 | 同 RR 事务冻结样本/载荷，分页读取与删除 |

精确方法与字段以 `packages/contracts/src/source-content.ts`、`research-export.ts` 及路由为准。目标路由见[契约](contracts.md#6-目标-http-表面)，不能认为当前已有项目/导入接口。

读取需 session/bearer；来源/任务写限 admin/owner/machine；个人/研究只限所属 session，machine 无个人空间。个人创建 expectedRevision=0，更新/删除带当前 revision；409 保留草稿。

当前检索只有已存完整 title/text 投影，支持 literal/phrase/terms、平台/时间/作者/语言/来源及同平台指标。文本查询缺投影返回503，不假装0条；日期 `[from,to)`，cursor 绑定过滤。

即时导出每文件最多2000条，可 nextCursor；实时统计/续页可变化。研究冻结最多20,000条/32MiB，超限整笔413，不截断成功；冻结载荷不随 live 更新改变。CSV 有文本 ID 与公式防护；媒体只在主动操作时读取 HTTP(S)。

## 4. 验证入口

```sh
npm run docs:check
npm run typecheck
npm run lint:web
npm run verify:repo       # docs、类型、API/Web构建、compiled smoke
npm run test:offline
npm run test:postgres     # 必须有独立 TEST_SOURCE_DATABASE_URL
```

纯文档跑 docs 与 diff；发布清单变更再跑 `tests/unit/release-package.test.ts`。业务改动跑相关风险场景，跨层里程碑再跑完整门禁；不为每个文档字句重跑全套业务。

`npm test` 有 SQL 无配置 skip 的历史行为，不能作为数据库验收。offline 要求零 fail/skip，postgres 缺合法库即失败；使用 UTF8、loopback、`source_validation_*` 独立库，绝不指向业务库。

| 类型 | 已有入口 |
| --- | --- |
| 配置 | `config:check`、`local:config`；不证明采集成功 |
| 合成 PG + API + 浏览器 | `smoke:accounts:local`、`smoke:content:local`、`smoke:research:local` |
| 合成浏览器指定站点 | `smoke:accounts`、`smoke:content`、`smoke:research`，需 SMOKE_WEB_BASE_URL |
| Windows 演示 | local:setup/start 后 `smoke:local` |
| 当前性能脚本 | `benchmark:sources -- --rows 20000 --repeats 20 --out output/validation/唯一报告.json`；不是百万负载验收 |

Playwright 可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已有 Chromium。CI 在 `.github/workflows/verify.yml`，以同一提交为准；真实来源检查不进入日常离线 CI，报告放 output。

## 5. 数据维护与发布

当前工具，不是授权自动执行：

```sh
npm run ops:backfill:public-search -- --limit=100 --dry-run
npm run storage:plan -- --out output/validation/storage-preview.json
npm run db:backup -- --file output/backups/唯一名称.dump
npm run db:restore -- --file output/backups/唯一名称.dump --target info_workbench_restore_唯一名称
npm run release:pack
npm run release:verify -- output/releases/目录
```

搜索回填确认后去 dry-run，按 nextCursor 加 `--after=UUID`；remaining=0 才完成该 pass。生产 omit-dev 用 `node dist/scripts/backfill-public-search-index.js`，不假定 tsx 可用。storage:plan 只预览，未批准删除。

备份恢复需要匹配版本的完整 PG_BIN，只恢复到新库，验证摘要/迁移/关键资产后再验业务；工具不自动切连接。旧 raw-events/metrics-snapshots prune 只覆盖旧表，不是公共内容保留执行器。当前没有新公共数据自动留存。

发布：同一提交干净构建→确认备份/恢复→停领不兼容 worker→新增迁移/显式搬迁→切 API/Web/worker→健康与关键流程验证。代码回退不撤销 SQL；数据库破坏性变化需已验证恢复或前向修复。

当前 Linux 使用 `deploy/` systemd/Nginx；已知 HTTP/IP 验收是 Nginx8080→API3000，`/opt/reddit-monitoring` 指不可变发布目录，私有配置在 `/etc/reddit-monitoring/`。导入的既有部署记录见[状态](status.md#3-既有部署记录)，不是本轮实时探测。

公网需 HTTPS、安全 cookie、精确 origin 与可信代理配置；限制 readyz，保留登录边缘限流。旧 HTTP 验收例外不推广。Web 哈希 assets 追加到共享目录，同名字节一致，保留旧哈希、immutable；入口 HTML no-cache，缺失 asset 返回404而非 SPA。

public-tunnel/desktop/chrome/bridge 四项研究服务保持关闭；不为重构恢复它们。来源覆盖、内容新鲜度与系统 ready 是不同信号。

## 6. 修改与交付纪律

修改前检查分支/远端/status/diff，保留他人工作；独立任务目录/分支，逐路径暂存。不要 reset/clean/stash 覆盖未提交修改；共享对象库的 ref 修改串行进行。推送/合并/部署按当前授权执行，不强推。

功能变化更新对应原段落，历史日志不追加当前规则。路径/文档新增或删除同步 `scripts/check-docs.ts`、发布清单与本地链接。提交前 `npm run docs:check`、`git diff --check`；原始数据、凭证、运行报告与第三方源码留在忽略的 output/。
