# 开发、协作与验证

## 安装与开发

使用 Node.js 22 与 npm。从仓库根目录执行：

```bash
npm ci
npm --prefix apps/web ci
npm run docs:check
npm run typecheck
```

数据库流程需要 PostgreSQL 和本地 `DATABASE_URL`。连接池默认每进程 5，`PG_POOL_MAX` 调整池大小；构造参数 `max` 优先于环境变量。环境参考 `deploy/env/`，不把示例密码用于真实环境。现有 API 入口还要求 `API_BEARER_TOKEN`；配置以 `apps/api/src/server.ts` 和 runtime 为准。运行命令不会自动加载 `.env`，需由当前 shell 或进程管理器提供环境变量。

```bash
npm run db:migrate
npm run auth:bootstrap-owner   # 仅新空库，需 BOOTSTRAP_OWNER_* 环境变量
npm run app:api
# 另一个终端启动前端
npm --prefix apps/web run dev
```

开发使用 `NODE_ENV=development`，本地 HTTP 配置 `API_SESSION_COOKIE_SECURE=false`；不同端口直连时按需设置 `API_CORS_ALLOW_ORIGINS`。检查启动参数后再运行，API 的监听行为以入口代码为准。所有写入、迁移、导出先确认连接的是开发数据库。

目前 `REDDIT_RUN_MODE` 只有 `mock` / `live`，live provider 只有 `http` / `scrapling`。**设置 `arctic_shift` 不会接入新源；未实现的 provider 现在明确报错，避免静默使用旧 HTTP。** 在迁移完成前不要按旧示例开启 live 调度。

`research:export:reddit` 与 `research:export:reddit-search` 等现有导出工具仍依赖旧路径，真实采集可用性待恢复。所有生成结果归入 `output/`；旧 provider 对比和 promotion 工具的报告放 `output/provider-reports/`，没有新报告时无法生成 promotion 计划。

## 三人共用工作树

这台服务器的共享目录是 `/srv/team/project`，开发用户通过 `project-devs` 组访问。大家共享同一个分支和 index；文件权限不会隔离各自修改。每次开始先看 `team-git status`，同一文件由一人编辑或明确交接。

```bash
cd /srv/team/project
team-git status
team-git diff -- path/to/file
team-git add -- path/to/file
team-git commit --only -m "说明本次变更" -- path/to/file
team-git push -u origin shared-dev
```

`team-git` 是服务器工具，仓库外环境用 `git`。它对单次 Git 操作加锁，但不锁编辑过程或整个提交周期。`commit --only` 排除其他路径的暂存变更，无法分开同一文件里不同人的修改；提交前逐项检查。不要 `git add .` 或在有人开发时切分支、pull/reset/clean/stash。

每人独立配置 Git 姓名、邮箱及凭证。dev-owner/root 的已有凭证不代表 dev-a/dev-b 自动具备推送身份；后两者需分别配置 Git 姓名邮箱和 GitHub 授权。Git author 和实际推送账号不同；token 不应写进仓库或 remote URL。当前共享开发分支为 `shared-dev`，`main` 的合并在一次共同确认的集成窗口完成；PR 描述清楚相对于 main 的整批变更。

## SSH 断线与资源

同一 Linux 用户重新连接后，用以下服务器命令恢复终端：

```bash
tmux new-session -A -s codex -c /srv/team/project
```

tmux 内 `Ctrl+B` 后按 `D` 脱离。长时间不用时退出 agent 进程；单纯脱离 tmux 仍消耗内存。服务器内存约 4 GiB，构建、全量测试和采集串行运行，避免三人同时跑重任务。`server-health` 是这台服务器的检查工具；生产服务使用构建产物和独立服务账号。

## 任务编排

按“接入/worker”“数据模型/仓储”“API/read model/UI”分配三条任务线，同一文件保持一个编辑负责人。改公共契约或迁移的负责人先同步字段、缺失值、时间与验收范围，其他人围绕这份契约实施。不要各线分别造平台枚举、数据 DTO 或热度定义。

每个功能按一个小闭环提交：契约与必要迁移 → provider/落库 → 分析/API → UI；需要跨人配合时分成可独立核对的提交，未接通的功能明确标为进行中。集成窗口串行检查和推送；共用分支上创建 PR 是整批审阅，不能隔离三个人的未提交修改。外部机器开发者应在自己的分支上提交再集成。

## 验证

```bash
npm run docs:check
npm run typecheck
npm run lint:web
npm run verify:repo       # 文档、类型、API/Web 构建、compiled smoke
# 小内存服务器全量测试串行运行
npm test
```

先跑受影响测试；只有跨层里程碑或实际变更范围需要时才跑全量构建/回归。代码检查通过后，纯文档更新只跑 `docs:check` 与 diff 检查。外部数据解析、幂等/恢复、缺失指标与公共权限边界值得做回归测试；不为内部 getter、纯文字或每种假想状态增加测试矩阵。

`npm test` 是离线回归；数据库或网络验证另行执行并记录环境。compiled smoke 或 provider 的 `--config-only` 通过，只证明构建/配置，不能证明真实采集。存在已知失败时见 [当前状态](status.md)，比较基线与新增失败，不能将失败测试禁用后宣称完成。

## 存储维护

旧维护入口仍为 `ops:prune:raw-events`、`ops:prune:metrics-snapshots` 与 scheduler 内的保留任务。`REDDIT_RETENTION_PRUNE_MAX_BATCHES` 默认 10，每张表每轮最多执行这么多批，剩余到下轮继续；HTTP 维护入口也受默认批数约束。CLI 返回的 deletedRows 只指本次删除量，不代表已清空全部过期数据。保留策略和新增表覆盖见 [架构](architecture.md)，不要直接对全部业务表运行无界删除。

## 部署边界

本轮以开发为重心，尚未公开上线。`deploy/` 是旧 Reddit 运行模板；部署前核对 Node 可执行路径、工作目录、环境、服务用户、数据库、真实 provider 与内存预算。不要把模板复制即视为可上线。

先构建不可变发布目录（含 `dist/`、`apps/web/dist/`、运行依赖和 SQL），备份数据库，再执行 `db:migrate:compiled`，新空库才运行 `auth:bootstrap-owner:compiled`。Nginx 应限制公开 `/readyz`，域名使用 HTTPS，启用安全 cookie 与明确的 CORS。真实 provider 验证和小规模采集通过后再启动调度；代码回滚不等于数据库回滚。

部署时可使用 `pg_dump --format=custom` 备份，并在隔离环境验证 `pg_restore --clean --if-exists --no-owner` 的恢复；这些操作需要真实数据库参数。公开服务配置完成后执行 `PUBLIC_BASE_URL=https://example.com npm run smoke:public-launch`，认证检查参数见 `scripts/smoke-public-launch.ts`。不在文档保存账号密码。
