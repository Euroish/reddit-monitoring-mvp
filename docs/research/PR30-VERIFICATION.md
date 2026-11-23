# PR30 本地验收与 CI 记录

基线为 PR31 合入后的主干 `4b05369`。本地工作树使用 Node 24、Docker PostgreSQL 16 和 Chromium。线上数据库与生产部署未参与。外部采集由固定响应代替，真实 API、鉴权、配额计数、任务、事务及入库路径仍参与测试。

| 检查 | 项目或可复现命令 | 结果 |
| --- | --- | --- |
| 仓库、API、模块、Web 策略 | `npm run lint` | 通过四个子门禁，受检查的读写表均为 47 |
| 类型 | `npm run typecheck` | API 和 Web 通过 |
| OpenAPI 与声明式鉴权 | `npm run check:openapi` | 107 条路径，120 项操作，均显式声明策略 |
| 单元 | `npm run test:unit` | 60 项通过 |
| PostgreSQL | `npm run test:postgres` | 39 项通过，含批次去重与私有隔离、已应用 058 至 060、重跑、失败回滚 |
| Chromium | `TEST_COMPILED=true npm run test:browser` | 9 项通过，覆盖工作台与公开页面 |
| 发布构建与入口 | `npm run build`、`npm run check:web-bundle` | 构建与懒加载边界通过；ECharts 保持独立的延迟加载 chunk |
| SQL 迁移 lint 和工作流 | Squawk 2.9.0、Actionlint 1.7.12 | 059 按精确 SHA 限定一条规则，060 全规则通过；工作流通过 |
| Docker 与 API | 两阶段镜像、Compose config、编译冒烟及代理启动 | 两份镜像和隔离 Compose 通过；编译态应用完成 62 个迁移，登录、readiness、鉴权来源和 SIGTERM 通过 |
| GitHub Actions | PR #30 的 Checks 及 Core verification | 以远端对应提交的 CI Gate 为验收结果 |

| 角色或状态 | 关键验收 |
| --- | --- |
| Owner | 来源创建、资讯预览与任务、调度和渠道诊断、共享项目、批次管理 |
| Admin | 来源运维、管理员采集上限、合法调度及系统配置 |
| Viewer Free | 自建项目、项目数限制、手动采集阻断、授权批次、跨主体隔离 |
| Viewer Pro | 预检、预算变更拒绝、同一请求重试、执行、自动入库及复用 |
| Machine Key | 过期、scopes、来源边界、浏览器会话隔离、安全写入及导出 |
| 失败与空数据 | 会话过期、无权限、无项目或样本、预算关闭、预检过期、重复提交、低额度、未知计费和失败迁移 |
| 页面与响应式 | 1440、1280、768、390；项目选择器的键盘、目标确认、双来源面板、项目分析和公共页 |

## 阶段交付

| 阶段 | 主要文件与变更 | 证据 |
| --- | --- | --- |
| 0 | 审计 PR30 的文件、冲突、契约和现有界面 | [整合审计](PR30-MAIN31-INTEGRATION-AUDIT.md)、[业务矩阵](FRONTEND-BACKEND-BUSINESS-MATRIX.md)、[组件盘点](UI-COMPONENT-INVENTORY.md) |
| 1 | API 装配、采集与项目门面、声明式鉴权、批次统计和 SQL 兼容 | API 门禁、表所有权、PG16 及迁移检查 |
| 2 | Web 组件配置、Base UI 源码和 Token 桥接 | Web 构建、公开站与工作台浏览器验证 |
| 3 | 来源标签及健康状态、项目切换和采集预检 | Owner/Admin/Free/Pro 浏览器旅程，批次复用零上游请求 |
| 4 | 项目 KPI、证据样本、六小时 UTC 趋势和探索页状态 | 空趋势、筛选同步、CSV 和跨平台下钻浏览器断言 |
| 5 | 隔离 Linux 运行时、角色和响应式验收 | 本地检查表、截图、GitHub CI Gate |

## 截图

在已配置 `TEST_SOURCE_DATABASE_URL` 的隔离环境中，以 `CAPTURE_SOURCE_OPS=1 CAPTURE_PROJECT_INTAKE=1 CAPTURE_VISUAL_AFTER=1 TEST_COMPILED=true npm run test:browser` 生成截图。工作台主要证据位于 `output/validation/source-operations/` 和 `output/validation/project-intake/`，包括两类来源正常或受限时的布局，项目切换、预检、有无结果的分析和主题 Portal。CI 的编译态浏览器任务随 `core-browser-evidence` 制品提供对应截图。

## 验收边界

付费渠道使用隔离响应，线上余额、真实账单和生产 provider 延迟留待受控环境验收。已有 060 的 Docker 台账只读核对了 059 和 060 的哈希，迁移操作与恢复验证均在独立数据库执行。浏览器覆盖默认配色与切换后的冰川钴蓝配色；其余预设与自定义配色沿用同一根变量实现，本轮未逐套截图。
