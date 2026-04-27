# GitHub 项目升级前端

**User:** Anonymous  
**Created:** 4/27/2026 19:29:40  
**Updated:** 4/27/2026 19:31:34  
**Exported:** 4/27/2026 19:36:06  
**Link:** [https://chatgpt.com/c/69ef4896-ca38-8398-9a89-c71493669050](https://chatgpt.com/c/69ef4896-ca38-8398-9a89-c71493669050)  

## Prompt:
2026/4/27 19:29:33

分析我的项目，我现在部署在linux云服务器上，用codex开发，上传到github的不是完整文件，我打算用本地的antigravity给它升级前端，我要怎么做 pushed 1 commit • 442ac64…40b14af • 9 hours ago  https://github.com/Euroish/reddit-monitoring-mvp

## Response:
2026/4/27 19:29:40

我会先检查 GitHub 仓库里实际提交了什么、最近 commit 改了哪些文件，再给你一套“云服务器现状 ↔ GitHub ↔ 本地 Antigravity”可执行升级流程。

已看到最近 commit 实际上传的是两份路线/方案 Markdown，而不是完整源码。下一步需要确认仓库当前目录结构和是否还有前端代码。

仓库是 Vite + React 前端，API 通过 `/api` 前缀转发；本地开发默认把 `/api` 代理到 `http://localhost:3000`，可用 `VITE_API_PROXY_TARGET` 指向云服务器。

你的当前情况不适合直接让本地 Antigravity 基于 GitHub 开工。原因：GitHub 上虽然已有完整项目结构迹象，但你也明确说“上传到 GitHub 的不是完整文件”；而最近提交主要是在清理路线/Apify/runtime 方向，当前执行真相写在 `obsidian-reddit专用/Projects/project.md`，项目下一步仍是 collector/storage truth：live-window、stale metrics、prune、8 小时 favorite 采集、coverage 语义等。`project.md`

## 结论

你应该先把“云服务器上的真实完整工程”同步到一个私有 GitHub 分支，再用本地 Antigravity clone 这个分支升级前端。

不要让 Antigravity 基于不完整 GitHub 仓库改前端。否则它看不到真实 API、contracts、样式、路由、构建脚本，很容易重写已有结构或生成接不上后端的 UI。

## 我看到的项目现状

这是一个 Node/TypeScript + Vite React 项目。根目录 `package.json` 已有 `build:api`、`build:web`、`start:api`、`start:worker:phase1:scheduler`、数据库迁移、prune 脚本等命令，说明它不是单纯前端项目。`package.json`

前端在 `apps/web`，技术栈是 Vite + React + React Query + ECharts + React Router。`package.json`

前端 API 调用统一走 `/api/...`，本地 Vite 代理默认转到 `http://localhost:3000`，也可以用 `VITE_API_PROXY_TARGET` 指向云服务器 API。`client.ts` `vite.config.ts`

现有前端已经有这些页面：`/dashboard`、`/queries`、`/target/:targetId`、`/ops`，不是空白前端。`App.tsx` `Dashboard` 当前仍把榜单 slice 到 8 个目标；这与你文档里的“展示所有有记录 subreddit，而不是固定 8 个”缺口一致。`Dashboard.tsx`

最近提交 `40b14af` 已把 Apify 从当前主运行路径移除，runtime provider 收敛到 `http | scrapling`。所以升级前端时不要再围绕 Apify 做功能入口。`Trim drift and remove legacy apify runtime path`

## 推荐工作流

### 1. 在云服务器上先确认真实工程目录

```bash
cd /path/to/reddit-monitoring-mvp

pwd
git status
git branch -vv
git remote -v
find . -maxdepth 2 -type f | sort | head -100
```

确认这个目录就是当前线上运行的完整项目，而不是你之前上传到 GitHub 的残缺副本。

### 2. 先补 `.gitignore`，防止把敏感文件推上去

在云服务器项目根目录检查或创建 `.gitignore`：

```bash
cat > .gitignore <<'EOF'
node_modules/
dist/
apps/web/dist/
coverage/
.playwright/
.env
.env.*
!.env.example
*.log
logs/
*.sqlite
*.db
*.dump
*.sql
*.backup
.DS_Store
EOF
```

然后检查会提交什么：

```bash
git status --short
git add .
git status --short
```

重点确认不要提交：

```text
.env
.env.production
数据库 dump
日志
node_modules
dist
API token
Reddit token
Cookie/session secret
服务器私钥
```

### 3. 把完整工程推到新分支，不要直接污染 main

```bash
git checkout -b sync/full-source-from-server

git add .
git commit -m "Sync full source from server"

git push -u origin sync/full-source-from-server
```

然后在 GitHub 上开 PR，对比 `main`。不要急着 merge。先确认 diff 里没有敏感信息。

### 4. 本地用 Antigravity clone 这个分支

```bash
git clone https://github.com/Euroish/reddit-monitoring-mvp.git
cd reddit-monitoring-mvp
git checkout sync/full-source-from-server

npm install
npm run typecheck
npm run build:web
```

如果本地不跑 API，只让本地前端连接云服务器 API：

```bash
cd apps/web
echo "VITE_API_PROXY_TARGET=https://你的服务器域名" > .env.local
npm run dev
```

由于现有 Vite 配置会把 `/api` 转发到 `VITE_API_PROXY_TARGET`，本地 Antigravity 可以直接改 UI、调用云服务器 API。`vite.config.ts`

## 给 Antigravity 的前端升级边界

不要让它“重做前端”。让它做小切片。

你可以把下面这段直接放进 Antigravity：

```text
Inspect first, then modify the smallest necessary frontend slice.

Project context:
- This is a Vite React app under apps/web.
- API calls use apps/web/src/api/client.ts and go through /api.
- Existing routes are /dashboard, /queries, /target/:targetId, /ops.
- Do not rewrite routing, auth, API client, or contracts unless required.
- Do not create global-Reddit wording. Product scope is observed monitored Reddit corpus only.
- Do not reintroduce Apify UI/provider assumptions. Runtime is http primary + scrapling fallback.
- Preserve existing workbench, keyword overlay, comparison, and driver posts behavior.
- Prefer improving UI clarity, catalog/listing, empty states, loading states, and coverage/source-limited display.

First frontend target:
1. Improve Dashboard so it no longer feels limited to only 8 items.
2. If a catalog API exists, consume it.
3. If no catalog API exists, do not fake catalog data; keep current market endpoint and improve the board UI around available ranked targets.
4. Make all wording say Observed / Monitored / Source-limited where relevant.
5. Run:
   npm --prefix apps/web run build
   npm run typecheck
```

## 最适合你现在做的前端升级顺序

### 第一阶段：只改前端体验，不改数据语义

适合 Antigravity 本地做：

```text
Dashboard 信息架构
TargetDetail 布局
loading / error / empty states
响应式样式
coverage/source-limited 文案展示
driver posts 卡片
keyword overlay 输入体验
```

不要做：

```text
伪造全量 subreddit catalog
伪造 15 天完整趋势
伪造全 Reddit keyword trend
把 missing day 画成 0
```

### 第二阶段：补 catalog API 后再做“所有 subreddit 列表页”

你项目文档里明确还有一个缺口：需要 `GET /v1/subreddits/catalog?...` 这类接口。现在 `Dashboard` 仍从 `/v1/trends/market` 取榜单，并在 UI 内 slice 到 8 个。`Dashboard.tsx`

所以正确顺序是：

```text
后端 catalog summary / API
→ contracts 类型
→ apps/web 新 Catalog 页面
→ Dashboard 链接到 Catalog
→ favorite / sort / status filter
```

否则前端只能做“假列表”。

### 第三阶段：TargetDetail 图表交互增强

现有 `TargetDetail` 已经有 workbench chart、keyword overlay、comparison、saved view、driver posts、reliability、anomalies。`TargetDetail.tsx`

Antigravity 应该优先增强：

```text
点击图表某天 → 过滤 driver posts
keyword overlay → driver posts 联动
source_limited/missing tooltip
driver post 卡片可读性
```

但前提是后端 API 已支持 day/from/to/keyword 参数。

## 云服务器部署建议

本地 Antigravity 完成后：

```bash
npm run typecheck
npm run build
git checkout -b frontend/upgrade-shell
git add apps/web packages/contracts
git commit -m "Improve frontend observed-corpus workbench UI"
git push -u origin frontend/upgrade-shell
```

在 GitHub 开 PR。合并后，在云服务器：

```bash
cd /path/to/reddit-monitoring-mvp
git fetch origin
git checkout main
git pull

npm ci
npm run build
npm run db:migrate
```

然后重启服务，具体取决于你用的是 systemd、pm2、docker 还是手动 node。你仓库搜索里没有明显 deployment 文件，所以这部分要以服务器实际进程为准。

## 关键注意事项

你的项目当前最大风险不是“前端不好看”，而是“前端展示的数据语义不能骗人”。项目自己的 guardrail 也写了：不要把本地 sampled data 说成 global；加新图表前先证明 collection/materialization/read-model 能支撑 range，并暴露 empty、partial、degraded、complete 状态。`AGENTS.md`

所以最稳路线是：

```text
先同步完整源码
→ 本地 Antigravity 只基于完整仓库改
→ 前端先改善现有页面
→ catalog/API 不存在就先补后端
→ 所有 UI 文案坚持 observed monitored corpus
→ PR 合并
→ 云服务器 pull/build/restart
```

你现在可以先做第 1 件事：从云服务器把完整工程推到 `sync/full-source-from-server` 分支。



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)