# 分阶段开发日志

本文件按用户明确要求记录阶段 1–3 的开发过程、已实行内容、测试与本地版本；不是另一份产品计划。当前实现总览仍见 [状态](status.md)，操作与交接见 [交接](handoff.md)。秘密、合成样本和运行报告只在忽略的 output/。

## 2026-10-12：任务启动与版本基线

- 初始审计基线为 cd920c5。上一轮 Arctic Shift 的 34 个路径已逐个核对并保存本地快照 abd24f5，仍在个人分支 codex/arctic-shift-content-query；没有 push、main 修改或 PR 合并。
- 用户授权按阶段保存本地版本及日志/交接文档，前端以功能补充为主。正式文档增加本日志和交接两份，docs:check 同步为八份。
- 用户确认暂时无 X 凭证，并明确禁止本轮真实来源接入测试。全部新增验收采用离线 provider、可控时钟、隔离 PostgreSQL 和 localhost 浏览器流程；真实 Arctic Shift/X 与持续网络新鲜度验收待后续安排。
- 并行职责：旧数据语义/回归、图表/保存恢复、新来源生命周期分别独立处理；root 负责公共 API 集成、本地启动、阶段提交、来源功能 UI、X 配置和统一工作台/导出。修改边界已协调。

## 阶段 1：结果可信度与本地开发入口（已实现，准备 0.2.0 本地快照）

- 已定位 17 项既有失败：15 项与旧 new-listing 默认隐式追加 discovery 请求有关，2 项为 tier 质量阈值与既有契约不一致。专项 65 项通过；随后集成发现调度夹具缺上一观测，补齐真实 prior window 并保留原断言，两项通过。允许 loopback 的当前全量 392 项：388 通过、0 失败、4 个隔离 SQL 默认跳过；阶段快照另单独验证。
- 图表日期合并、空/有数据生命周期、比较保存和目标视图 URL 恢复已实施，6 项离线回归通过；真实 Chromium 合成 API 覆盖空/有图、保存失败与恢复、比较/目标恢复、390px，外部请求 0、错误 0。
- root 已补受控 UI 保存路径校验和 source 路由 PATCH/PUT JSON 解析；增加 .env.local 加载入口，显式 shell 环境优先，生产不隐式加载开发文件。
- 正式 Windows local:* 工具与独立数据库/owner/合成数据已运行；连续 start 复用 PID，stop --keep-db/start 已验证。关键词 2207 条 SQL 验收通过；迁移并发/回滚 SQL 验收通过。增长用 v2 相邻观测差分，历史 v1 不呈现实测 driver；普通查询不隐式重建索引。API 编译和 compiled smoke 通过，秘密与证据均留 output/。
- 阶段 1 的暂存树单独导出后，typecheck、API/Web 构建及 365 项回归通过（362 pass、3 个 SQL 默认 skip、0 fail），确认不依赖阶段 2/3 的未提交源码。启动器最后补 loopback API_HOST 与进程身份检查，避免占用端口上的其他服务被误当成启动成功。

## 阶段 2：持续采集与任务管理（已实现，准备 0.3.0 本地快照）

- 030 来源生命周期迁移、active/paused/archived、标签/分组与 schedule/refresh、任务 purpose/取消/新增更新计数、provider 预算、sourceOps/worker 心跳已沿契约/仓储/API/worker/UI 打通，029 未修改。
- 新增 demo_reddit/demo_x 离线演示 provider，与真实 provider 身份分开，正文明确标记合成，不发外部网络请求。演示只证明流程，不证明真实平台数据质量。
- 后台离线/本机 API 初始 31/31 通过，隔离来源 SQL 2/2；72 小时模拟覆盖增量重叠、暂停恢复、租约中断、checkpoint 子任务、预算与成熟刷新。复核补 worker 顶部导入初始化、disabled provider 不生成失败周期任务、自动成熟刷新仅 archive 的明确 guard。
- 来源管理 Chromium 合成 API 验证设置/状态/任务/预算/权限、桌面和 390px、统一统计和 CSV/JSON 续导出全部通过，外部请求 0、页面错误 0。工作台/导出基础提前纳入阶段 2，API/service 离线 4/4 通过；不承诺冻结 SQL 快照或跨平台统一热度。
- 正式 local:start 的真实 localhost UI→认证/API→合成 worker→新 PostgreSQL→查询/续采/周期→归档→工作台/分段导出闭环通过，截图与结果在 output/local-dev/smoke-evidence.json 和 output/playwright/local-demo-real-pipeline-*。这证明本地流程，真实数据源请求为 0。

## 阶段 3：X 配置、统一查询与导出（待实施）

- X provider 只做可配置实现和离线契约验证；没有密钥和真实请求授权，不能标为真实 X 接入已验收。
- 工作台基础内容统计与公共导出将复用新内容/发现/观测契约，不将归档快照写成实时热度。阶段结果按实际测试更新本节。
