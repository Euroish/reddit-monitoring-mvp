# 当前开发与交付

当前工作树为 `1.0.0-dev` 新内核。旧 node:http / Phase1 / 独立 worker / 本机演示与维护脚本已经删除，不能继续使用历史交接中的启动命令。过去部署均是内部测试，本轮不更新任何既有测试服务。目标规则见[主线架构](architecture.md)，实际完成范围见[当前状态](status.md)。

## 1. 环境与私有配置

开发与 CI 使用 **Node 24 / PostgreSQL 16**；根目录与 Web 分别安装依赖。配置模板为 `deploy/env/app.env.example`。真实密码与第三方 Token 只存仓库外私有文件，或当前 shell；不写入 Git、对话日志或 VITE_*。

应用读取进程环境，不隐式装载本地 env 文件。例如在可信 shell 中加载自己维护的私有文件后运行命令。必需配置：

- DATABASE_URL：独立开发库，严禁指向仍运行旧 writer 的库。
- SESSION_SECRET：至少 32 字符的随机秘密。
- 首次空库可设置 ADMIN_BOOTSTRAP_PASSWORD（12–128 字符）与 ADMIN_BOOTSTRAP_EMAIL（默认 owner@localhost）；已有用户不重新引导，完成后移除引导口令。
- APP_ORIGIN：浏览器实际访问地址。Vite 本地开发通常为 http://localhost:5173，同时显式 ALLOW_HTTP_DEV=true；production 拒绝 HTTP 降级。
- SOURCE_NETWORK_ENABLED=false 为默认；只有显式启用、提供 APIFY_API_TOKEN 并在来源预算中授权额度后才会采集。Bluesky 同样受网络开关与预算约束。当前新链不读取 Arctic Shift / TwitterAPI.io 凭证。

## 2. 唯一启动链

```sh
npm ci
npm --prefix apps/web ci
npm run db:migrate
npm run app:api
# 另开终端：
npm --prefix apps/web run dev
```

API 默认监听 127.0.0.1:3000；Vite 的 /api 代理默认指向该端口，变更用 VITE_API_PROXY_TARGET。APP_ORIGIN 必须与浏览器地址完全相同，写操作必须携带同源 Origin。API 自带两个有界采集槽，**不再另起 worker**。新 API 不导入任何旧 runtime 或 Repository。

迁移 runner 对 001..040 核验原 checksum；后续新迁移与 ledger 同事务提交。043 遇到旧在途任务会拒绝切换：应先停止对应内部测试 worker 并核实供应商回执，不能通过修改 SQL 或清空状态绕过。

## 3. 当前可用 HTTP 表面

- 登录、会话、邀请码注册；创建/撤销机器 Key；管理员签发邀请。
- 来源列表/创建/状态 revision、额度读取/更新、单次 collect 与任务读取。
- 标准 POST /v1/sources/:id/ingest（push、Idempotency-Key、100 条/1MiB）。
- 内容列表、详情、JSON/CSV 流式下载；统一来源授权与词组过滤。
- 基础项目创建、概览与三组词；当前按内容节点计数，尚未开启 threadAware。
- 个人查询、收藏与批注；机器 Key 不访问个人工作区。
- 鉴权 GET /v1/capabilities 与 /v1/openapi.json。

未接入渠道、持续调度与完整项目漏斗不能当作现有功能；具体差距以[状态表](status.md#2-已编码行为与剩余差距)为准。

## 4. 自动检查

```sh
npm run lint
npm run typecheck
npm run test:unit
TEST_SOURCE_DATABASE_URL=postgres://user:password@127.0.0.1:5432/source_validation_dev npm run test:postgres
TEST_SOURCE_DATABASE_URL=postgres://user:password@127.0.0.1:5432/source_validation_dev npm run test:browser
npm run build
git diff --check
```

PG/浏览器测试必须提供 loopback 的 source_validation_* PG16 管理连接，测试会创建并清理各自独立库。缺配置直接失败，不允许 skip 冒充验收。浏览器需 Playwright Chromium；可设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指向已有浏览器，或执行 npx playwright install chromium。所有第三方请求均为有界外部协议夹具，不连接收费渠道。

`docs:check` 检查正式文档白名单、链接与唯一规则、五模块文件清单、反类封装/旧层依赖，并禁止已实删旧架构目录和连接器回流。新增模块文件或正式文档必须同步登记对应唯一清单。

## 5. 数据保全与发布包

```sh
npm run assets:export -- output/legacy-assets-唯一名称
npm run db:backup -- --file output/backups/唯一名称.dump
npm run db:restore -- --file output/backups/唯一名称.dump --target info_workbench_restore_唯一名称
npm run release:pack
npm run release:verify -- output/releases/目录
```

这些命令是手动工具说明，不代表本轮已执行用户库导出、恢复或部署。assets:export 按原 owner 流式迁出冻结成员与个人资产并校验行数/摘要，只读、不覆盖；manifest 的 delivered=false 明确表示尚待交付核对。现有旧表保留到实际资产迁出交付后，才另加 DROP 迁移。

build:api 先清空仅含生成物的 dist，再仅编译 API、内核、契约与资产导出工具；不编译 Vite 开发配置或文档检查器，也不再接受已退役原型/旧文档位置的发布清单。发布包不包含原始数据、密钥、output、R4 外挂或已退役旧 runtime。打包、Git 推送都不触发服务更新；Compose/TLS/性能和恢复演练尚未验收，暂不公开部署。

### 来源退役顺序

043 先拒绝未决在途任务，取消安全的旧内部测试队列，再将 Arctic Shift / TwitterAPI.io 预算设为禁用零额度并按当前主渠道软归档旧来源，保留全部正文、发现、观测与真实历史 provider。新渠道预算用 ON CONFLICT DO NOTHING 默认关闭，不覆盖已有 kaix 授权。未来对实际内部测试库切换前仍须先备份、核对云端回执与个人资产，不把本地取消等同于外部付费结果已终结。
