# 当前状态与下一步

核对日期：2026-10-19。从 `main` 的 `008f676` 在 `dev/root` 持续推进 E0 工程整理，应用版本仍为 0.9.1。PR #2 的功能交付已合入 main；本轮修复类型基线、迁移公共检索纯规则与来源错误，拆出内容读取和保存工作台视图路由、修正浏览器冒烟筛选同步，并将内容详情改为独立的批量读取用例；不新增 provider、不执行真实采集或更新部署。历史阶段验收见 [交接](history/handoff.md) 和 [开发日志](history/development-log.md)。

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

## 工程审查与下一步

E0 已建立可继续开发的类型与模块基线：公共检索纯规则和来源失败类别归 domain，SQL writer 留在 storage，HTTP 状态由 API 单点映射；内容读取和保存工作台视图路由已独立，共同认证、Origin、body 限额和审计保持。没有修改 API、数据身份、检索语义、checkpoint 或 SQL 迁移。

`d24d094` 云 CI [39259318466](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/39259318466)（Node24/PG16）离线、SQL、浏览器和 ci-demo **全部通过**。首批 `5da1ee9` 曾在 ci-demo 的 X 卡片等待失败；冒烟已改为等待目标筛选的 URL、列表与统计响应，不能再由旧筛选响应满足。此前本机 Node22/PG14 的 521 项离线、41 项 SQL、构建和合成闭环证据分别保存在忽略的 `output/validation/e0-boundaries/`、`e0-second/`；这些是指定快照结果，不表示每批重复全量验证。

当前内容详情用例在 `content-detail.service.ts`，不再属于采集服务。引用按 platform + kind + externalId 一次批量查询，用 Map 恢复原始顺序、重复关系与缺失 null；引用/children 仍各最多 20。来源按关联 ID 读取并保持原排序，不再全量读取配置后过滤。内存实现一次扫描、去重匹配；PostgreSQL 使用成对身份半连接和既有唯一索引，不新增索引、缓存或永久内存索引。通用 ID 校验迁到 domain，个人/研究模块不再为此导入采集服务。

本批本机 22 项受影响离线/API 回归、1 项原生 PG14 SQL 详情场景、类型、API 构建与 compiled smoke 通过；未新增测试文件，补强现有夹具中的异 kind、重复、缺失、顺序及 20 条边界。未重跑完整离线/SQL 集、Web 构建或浏览器，当前批云结果以提交记录为准。隔离合成对照：1,004 来源、1,029 内容、20 引用（含重复和缺失），暖缓存各 30 次，SQL 从 23 次降至 4 次、每次解码 JSON 从 901,752 降至 35,171 字节，中位耗时 121.4→38.9 ms、P95 179.3→51.6 ms；仅是本机指定数据量结果，不代表生产容量。EXPLAIN 确认批量身份与来源 ID 使用已有索引。证据在 `output/validation/e0-detail/`。没有真实 provider 请求或业务部署；前端原有 11 项依赖安全告警未在本批升级处理。

后续按 [全项目工程路线](plans/source-expansion.md) 推进。SourceContentService 仍包含配置、任务、页执行与查询规范化，其他旧 API 路由仍在组合根；后续按实际变更继续解耦，不把所有大类拆完作为 E1 的前置门槛。来源真实验证、项目模型与旧链路退役仍需分别交付。
