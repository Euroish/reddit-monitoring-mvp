# 当前状态与下一步

核对日期：2026-10-19。本轮从 `main` 的 `008f676` 在 `dev/root` 推进 E0 首批工程整理，应用版本仍为 0.9.1。PR #2 的功能交付已合入 main；本轮修复类型基线、迁移公共检索纯规则与来源错误，分两批拆出内容读取和保存工作台视图路由、收紧浏览器冒烟筛选同步；不新增 provider、不执行真实采集或更新部署。历史阶段验收见 [交接](history/handoff.md) 和 [开发日志](history/development-log.md)。

## 当前实现

| 范围 | 已有能力 | 未完成边界 |
| --- | --- | --- |
| Reddit / Arctic Shift | 社区/账号帖子与评论、帖子评论、范围内关键词、ID 成熟刷新；真实小样本落库通过 | 持续新鲜度、完整覆盖、自动缩窗/本地筛选降级未验或未实现 |
| X / TwitterAPI.io | 账号、搜索、ID adapter；媒体/引用/可空指标；默认禁用、独立预算 | 无真实凭证验收，不算稳定生产来源 |
| 调度与落库 | 来源生命周期、逐页事务、幂等、checkpoint、高水位、公平领取、有限重试、阻塞/人工 Retry、预算与心跳 | 无跨 provider 自动路由；requests/resources 不是货币账单 |
| 内容使用 | 统一查询/统计、公共检索投影、详情、个人保存/注释、有界导出、冻结研究成员 | 即时统计/分页不保证同一快照；旧榜单/热度仍用旧 Reddit 模型 |
| 扩展基础 | ContentProvider + capability、统一身份/独立观测；类型含 reddit/x/instagram/web | runtime 仍显式注册；web/Instagram 无真实 adapter；动态插件或独立测试台不作为当前目标 |
| 运维 | 41 个 SQL 迁移、备份/恢复工具、发布完整性清单、systemd/Nginx 模板 | 真实持续负载、公共 HTTPS、多用户容量、自动数据保留尚未验收 |

`965bff1` 已修复 Arctic Shift 小页重叠分页、无 checkpoint 的未耗尽页、未知源时间覆盖已知正文、无变化搜索投影重复写入及数据库暂态错误分类。遇到同秒饱和不会跳过边界；422 只有响应体含 timeout/slow down 才归为可重试，不是所有 422 都重试。自动分窗尚未实现。

## 验证与部署证据

以下是指定快照的历史结果，不表示本次重新执行全部测试，也不代表服务此刻持续运行。

| 时间 / 基线 | 已核实结果 | 结论边界 |
| --- | --- | --- |
| 0.9.1 收口快照 | 511 离线、41 原生 SQL 零失败零跳过；类型/构建、合成浏览器和账户/内容/研究闭环通过 | 详情保留在历史交接，不能覆盖后续提交的新检查结果 |
| 2026-10-16 / `6bd18ad` Linux 部署 | API/Web 构建、compiled smoke、638 文件发布清单、515 离线测试通过；数据库升级至 41 迁移；API/worker/Nginx 启动与健康检查通过 | 本机回环访问验收，非公网 HTTPS 或持续负载验收 |
| 同次部署类型检查 | `tests/integration/public-content-search-postgres.test.ts:25` 的动态 import 曾触发 TS2835 | 本轮改为静态导入 SQL writer 后全仓 typecheck 通过；历史部署产物未更新 |
| 2026-10-16 / Arctic Shift 真实请求 | `technology` 最近 24 小时首次请求 422 Timeout；缩至 1 小时后帖子/评论各取回并落库 5 条，正文、观测、检索投影均存在；API 读取成功；帖子重放新增 0 条 | 单页预算，覆盖为 partial、窗口未耗尽；没有证明全量、关键词能力或 12 小时新鲜度 |

该次部署为 `/opt/reddit-monitoring-releases/6bd18ad816ad`，入口 `/opt/reddit-monitoring`，旧版本和数据库备份保留。一次性验证仅在该进程启用网络，结束暂停两个测试来源；常驻配置保持 `SOURCE_NETWORK_ENABLED=false`。无需新增交互账号。报告位于该服务器 `/root/deployments/reddit-6bd18ad816ad/output/validation/live-source-20261016/result.json`，原始样本和报告不随仓库发布。

## 2026-10-18 首轮文档整理验证

10 份文档及本地链接检查通过；嵌套目录的未批准文件和失效链接拒绝检查通过；release-package 专项通过，覆盖新路径收录、未批准文件排除和完整性校验。复用部署工作区依赖后重跑 typecheck，仍仅报上述 TS2835，已列入工程路线 E0，不把本次检查写成全绿。

## 工程审查与下一步

E0 首批已将公共检索规范化、匹配、指纹与覆盖计算迁到 `src/domain/public-content-search.ts`，存储文件只保留 SQL writer。`SourceContentError` 改为领域失败类别，由 API 一处映射回既有 400/404/409/503；SQL/内存仓储和游标不再引用应用 service。`content-read-routes.ts` 独立处理内容列表、统计、详情与 JSON/CSV 导出，沿用共同认证、权限与错误入口。没有修改 SQL、检索语义、checkpoint、API 路径或响应契约，也没有保留旧入口转发。

首批本机 Node 22.23.3 / PostgreSQL 14.24：515 项既有离线及新增 4 项边界测试通过；41 项隔离 SQL 零失败零跳过；typecheck、API/Web 构建、compiled smoke、Web lint 与文档检查通过。首次 SQL 为 40/41，原因是临时集群使用 SQL_ASCII；明确 UTF8 重建后 41/41，未修改测试断言。证据在忽略的 `output/validation/e0-boundaries/`。首批 `5da1ee9` 云 CI（run 39256596412，Node24/PG16）离线、SQL、账户/内容/研究三条浏览器闭环通过，但最后 ci-demo 在 X 卡片等待处超时，整体失败，不能记作全绿。

第二批把保存工作台视图的列表/创建、字段校验和 DTO 映射迁至 `saved-workbench-view-routes.ts`；共用比较指标解析迁至 API validation，原组合根不保留重复实现。会话解析、Origin、请求体上限和审计仍共用原入口，viewer 权限、用户隔离、机器身份拒绝、501/400/404 及错误码保持。521 项完整离线、17 项最终定向回归、typecheck、API 构建、compiled smoke 与文档检查通过。存储/迁移未变化，第二批未重复完整 SQL 测试。

ci-demo 的冒烟脚本原先只等待任意成功 workbench 响应，可能被旧筛选的失效重取满足；现在同时等待目标 source/platform 的 URL、列表和统计响应，并检查返回成员，保留卡片、下载和零外部请求断言。独立源码副本、专用端口与临时 PG14 的真实浏览器→API/worker→SQL→JSON/CSV 闭环通过；不是业务部署。证据在 `output/validation/e0-second/`，首批云失败产物在 `output/validation/e0-cloud-5da1ee9/`；第二批云结果以对应提交运行记录为准。依赖复用，前端按锁文件安装时报告的 11 项安全告警未在本轮升级处理；没有真实 provider、生产部署或新的视觉设计验收。

后续仍按 [全项目工程路线](plans/source-expansion.md) 推进。API 组合根剩余旧业务路由和 SourceContentService 的管理/读取/执行职责尚未整体拆分；项目模型、新处理器、来源验证和旧链路退役仍是后续设计。本轮只交付 E0 首批，不宣称 E0–E4 全部完成。
