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

## root 与 dev-a 独立 worktree

此服务器保留一份 Git 历史，两个用户拥有独立代码目录、分支与暂存区。初始从同一 `origin/main` 建立；dev-owner/dev-b 未创建新 worktree。

| 用户 | 开发目录 | 初始分支 | GitHub 身份 |
| --- | --- | --- | --- |
| root | `/root/workspaces/reddit-monitoring-mvp` | `dev/root` | Euroish，已有 owner 凭证 |
| dev-a | `/home/dev-a/workspaces/reddit-monitoring-mvp` | `dev/dev-a` | HikariVerse，Git author 已配置；个人授权见状态 |

`/srv/team/project` 的 `shared-dev` 保留为集成目录，不再作为两人的共同编辑目录。自己的家目录保持私有，root 管理员仍可访问所有文件；worktree 是开发隔离，不是 Git 对象/代码历史的安全隔离。

```bash
cd ~/workspaces/reddit-monitoring-mvp
team-git status
team-git diff -- path/to/file
team-git add -- path/to/file
team-git commit -m "说明本次变更"
team-git push -u origin HEAD
```

检查已暂存的内容再提交；自己的新提交和未提交文件不会自动出现在另一人的目录。`team-git` 是服务器工具：在任一此仓库 worktree 中按当前目录操作，在仓库外 root/dev-a 默认使用各自 worktree；其他用户默认集成目录。单次 Git 命令加锁，普通 git 可以绕过。

每人从自己的分支向 `main` 提 PR。main 当前要求至少一次批准、新增提交使旧批准失效、解决审核讨论，禁止普通协作者强推和删除；owner 保留应急绕过，正常开发也走 PR。自己的功能分支可直接 push。根目录 Git common 配置和 refs/stash 仍共享：姓名、邮箱、凭证只写 `--global`，不要用 `--local` 配置自己的秘密；不要删除他人的分支或清理 worktree。

PR 合并后，在自己目录、确认工作树干净再取新 main 开始下一任务：

```bash
team-git fetch origin
team-git switch -c 自己的前缀/新功能 origin/main
team-git push -u origin HEAD
```

每个 worktree 当前只能检出一条分支；不要切到他人正在使用的分支，不要把所有人的改动重新汇总到 shared-dev 后再提 PR。部署源码和不可变发布另行更新，不从个人未完成目录自动上线。

依赖/构建产物不由 Git worktree 共享；尚未在两个新目录安装 node_modules，需要时在自己的目录串行执行前文 `npm ci`。不要用可写 node_modules 软链接互相影响安装，也不同时启动多套数据库/API。创建 worktree 本身不增加常驻服务内存。

## 开发身份与 GitHub 授权

Linux 用户权限、Codex 登录与 GitHub 权限是三个独立环节。每个人登录自己的 Linux 用户操作；不要通过 `sudo git` 提交，否则使用的是管理员身份。

1. 仓库 owner 在 [仓库 Settings / Collaborators](https://github.com/Euroish/reddit-monitoring-mvp/settings/access) 添加另两人的 GitHub 用户名，受邀账号接受邀请。个人仓库的 Collaborator 能直接 push 和管理 PR；若需要细分仓库管理职责，用 Organization 的 Write/Maintain，见 [GitHub 角色说明](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization)。
2. 每人执行 `cat ~/.ssh/id_ed25519_github.pub`，将自己的公钥加入自己 GitHub 的 Settings → SSH and GPG keys → New SSH key，选择 Authentication Key。私钥不复制给其他人；服务器已有各自独立 key。
3. 用以下命令配置作者并验证。邮箱使用自己 GitHub 已验证邮箱或该账号设置页提供的准确 noreply 地址；示例占位符不能照填。

```bash
git config --global user.name "你的提交姓名"
git config --global user.email "你账号的已验证或 noreply 邮箱"
ssh -T git@github.com
team-git push --dry-run origin HEAD
```

GitHub SSH 的成功问候应显示本人用户名；它不提供交互 shell，成功认证也可能返回退出码 1。push dry-run 验证当前授权，不创建测试提交。代码合入默认分支且作者邮箱匹配账号后，GitHub 可归属贡献；协作者权限、提交贡献显示和组织成员是不同概念。不能通过统一使用 owner token 把三人变成独立 GitHub 成员。

未登录 Codex 的用户执行 `codex login --device-auth` 并在自己的浏览器完成授权，再 `codex login status` 验证。官方说明见 [Codex 登录](https://learn.chatgpt.com/docs/auth)。登录资料、配置和历史留在自己的 `~/.codex`；CLI 能启动不代表账号已登录或模型额度可用。

## SSH 断线与资源

同一 Linux 用户重新连接后，用以下服务器命令恢复终端：

```bash
cd ~/workspaces/reddit-monitoring-mvp
tmux new-session -A -s codex -c "$PWD"
```

tmux 内 `Ctrl+B` 后按 `D` 脱离。长时间不用时退出 agent 进程；单纯脱离 tmux 仍消耗内存。服务器内存约 4 GiB，构建、全量测试和采集串行运行，避免三人同时跑重任务。`server-health` 是这台服务器的检查工具；生产服务使用构建产物和独立服务账号。

## 任务编排

按“接入/worker”“数据模型/仓储”“API/read model/UI”分配三条任务线，同一文件保持一个编辑负责人。改公共契约或迁移的负责人先同步字段、缺失值、时间与验收范围，其他人围绕这份契约实施。不要各线分别造平台枚举、数据 DTO 或热度定义。

每个功能按一个小闭环提交：契约与必要迁移 → provider/落库 → 分析/API → UI；需要跨人配合时分成可独立核对的提交，未接通的功能明确标为进行中。独立分支分别检查、推送并提 PR；有依赖的契约变更先合入 main 后其他人同步，避免复制冲突迁移。外部机器开发者也使用自己的功能分支。

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
