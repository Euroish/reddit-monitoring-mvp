# 开发、协作与验证

## 安装与开发

使用 Node.js 22 与 npm。从仓库根目录执行：

```bash
npm ci
npm --prefix apps/web ci
npm run docs:check
npm run typecheck
```

数据库流程需要 PostgreSQL 和本地 `DATABASE_URL`。环境参考 `deploy/env/`，不把示例密码用于真实环境。现有 API 入口还要求 `API_BEARER_TOKEN`；配置以 `apps/api/src/server.ts` 和 runtime 为准。运行命令不会自动加载 `.env`，需由当前 shell 或进程管理器提供环境变量。

```bash
npm run db:migrate
npm run auth:bootstrap-owner   # 仅新空库，需 BOOTSTRAP_OWNER_* 环境变量
npm run app:api
# 另一个终端启动前端
npm --prefix apps/web run dev
```

开发使用 `NODE_ENV=development`，本地 HTTP 配置 `API_SESSION_COOKIE_SECURE=false`；不同端口直连时按需设置 `API_CORS_ALLOW_ORIGINS`。检查启动参数后再运行，API 的监听行为以入口代码为准。所有写入、迁移、导出先确认连接的是开发数据库。

目前 `REDDIT_RUN_MODE` 只有 `mock` / `live`，live provider 只有 `http` / `scrapling`。**设置 `arctic_shift` 不会接入新源，现有解析器会回退到旧 HTTP。** 在迁移完成前不要按旧示例开启 live 调度。

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

每人独立配置 Git 姓名、邮箱及凭证。Git author 和实际推送账号不同；token 不应写进仓库或 remote URL。当前共享开发分支为 `shared-dev`，`main` 的合并在一次共同确认的集成窗口完成；PR 描述清楚相对于 main 的整批变更。

## SSH 断线与资源

同一 Linux 用户重新连接后，用以下服务器命令恢复终端：

```bash
tmux new-session -A -s codex -c /srv/team/project
```

tmux 内 `Ctrl+B` 后按 `D` 脱离。长时间不用时退出 agent 进程；单纯脱离 tmux 仍消耗内存。服务器内存约 4 GiB，构建、全量测试和采集串行运行，避免三人同时跑重任务。`server-health` 是这台服务器的检查工具；生产服务使用构建产物和独立服务账号。

## 验证

```bash
npm run docs:check
npm run typecheck
npm run lint:web
npm run verify:repo       # 文档、类型、API/Web 构建、compiled smoke
# 小内存服务器全量测试串行运行
npm test
```

`npm test` 是离线回归；数据库或网络验证另行执行并记录环境。compiled smoke 或 provider 的 `--config-only` 通过，只证明构建/配置，不能证明真实采集。存在已知失败时见 [当前状态](status.md)，比较基线与新增失败，不能将失败测试禁用后宣称完成。

## 部署边界

本轮以开发为重心，尚未公开上线。`deploy/` 是旧 Reddit 运行模板；部署前核对 Node 可执行路径、工作目录、环境、服务用户、数据库、真实 provider 与内存预算。不要把模板复制即视为可上线。

先构建不可变发布目录（含 `dist/`、`apps/web/dist/`、运行依赖和 SQL），备份数据库，再执行 `db:migrate:compiled`，新空库才运行 `auth:bootstrap-owner:compiled`。Nginx 应限制公开 `/readyz`，域名使用 HTTPS，启用安全 cookie 与明确的 CORS。真实 provider 验证和小规模采集通过后再启动调度；代码回滚不等于数据库回滚。

部署时可使用 `pg_dump --format=custom` 备份，并在隔离环境验证 `pg_restore --clean --if-exists --no-owner` 的恢复；这些操作需要真实数据库参数。公开服务配置完成后执行 `PUBLIC_BASE_URL=https://example.com npm run smoke:public-launch`，认证检查参数见 `scripts/smoke-public-launch.ts`。不在文档保存账号密码。
