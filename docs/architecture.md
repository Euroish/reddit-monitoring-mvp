# 架构与数据边界

## 当前代码结构

当前是 TypeScript 模块化单体，前端为独立 React / Vite 应用。

| 路径 | 职责 |
| --- | --- |
| `apps/api/src/` | HTTP、认证、请求解析与响应 |
| `apps/web/src/` | 工作台、图表、查询、管理页面 |
| `packages/contracts/src/http.ts` | HTTP 契约 |
| `src/application/` | 用例编排、读取模型、应用服务 |
| `src/domain/` | 实体、仓储接口、评分与业务语义 |
| `src/connectors/` | 来源请求、响应适配与原始记录 |
| `src/runtime/` | 环境解析、依赖组装与 provider 路由 |
| `src/storage/` | PostgreSQL 仓储与 SQL 迁移 |
| `src/workers/`、`workers/` | 采集任务、调度与派生数据构建 |
| `scripts/`、`tests/` | 运维、导出、验证与自动测试 |
| `deploy/` | 环境、Nginx、systemd 模板，部署前需核对 |

现有写路径为采集任务 → connector → 原始记录/映射 → 内容、指标及覆盖信息 → 派生读模型。读路径为仓储 → application → API → 前端。

代码仍有 Reddit 专属类型：`src/shared/types/common.ts` 的 `SourceCode`、共享 connector 的 `sourceCode` 仅允许 `reddit`，目标、provider、数据库约束和 HTTP 契约也需逐项检查。不能宣称已经支持多平台。

## Arctic Shift 迁移边界

Arctic Shift 属于 Reddit 的 **provider**，不是另一个社交平台。平台标识与内容去重保持 Reddit 身份，归档来源单独记录；现有存量数据不可因换源重复入库或误合并。

官方资料：[项目 API 文档](https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md)。截至 2026-10-11 的文档核对确认它提供帖子与评论搜索、ID 查询等接口；服务没有可用性保证，搜索能力也需实测。实施时重新核对接口并限定请求范围，不能假设全站任意关键词搜索或完整实时覆盖。

接入前必须解决：

- 旧 connector/worker 依赖 Reddit listing、`about`、热门排序与实时指标；新 provider 要明确支持能力及不支持时的行为。
- 分页边界、相同时间戳内容、重试、429、超时、去重和恢复须有验证；大批量数据走受控离线导入，限制单次窗口、数量与内存。
- 保存内容发布时间、归档观测时间（若提供）、本平台采集时间和来源证据。归档的 score/comment count 不等于实时观测值。
- 缺失的 active users、upvote ratio 等指标不得填零或伪造。数据缺口与真实零值区分；先审计现有 mapper、评分、read model 和 UI 的非空假设。
- `http` / `scrapling` 保留为待评估旧实现，不再作为后续默认采集策略。迁移完成且调用已清除后，才能删除相应代码。

## 后续多平台边界

第二来源确定时，再扩展来源枚举、目标类型、归一化内容、来源能力、数据库约束和 API 契约。保留来源、外部 ID、原链接、观测时间与覆盖证据；跨平台指标未经语义定义不能直接相加。原始响应、平台适配与产品评分分层维护。

数据库真实结构以 `src/storage/schema/*.sql` 及仓储代码为准；已有迁移以文件名和校验和管理，新增迁移不能修改已应用文件或重复完整文件名。`raw_reddit_event`、内容、采集任务、覆盖、指标、关键词与认证等表保留，不在文档复制易过时的完整字段清单。
