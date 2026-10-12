# 当前状态与下一步

核对日期：2026-10-12。本文件记录当前实现、本地验证与未完成边界；后续更新原有段落，不新增交接稿。

## 已实现与已知限制

- 当前为 Windows 本地独立 Git 工作区 `D:\Projects\reddit-monitoring-mvp`，功能分支 `codex/arctic-shift-content-query`。开始时 main 工作区干净，已转到功能分支开发；本轮没有提交、push、删除分支或合并 PR，不使用旧 team-git/shared-dev 流程。
- Node.js / TypeScript API、PostgreSQL、React 工作台与认证保留。新增 `/content`（来源内容）页面，可保存社区/账号/帖子评论来源，提交有界采集，查看任务和已落库帖子/评论，支持来源、类型、关键词、时间窗、分页及同范围统计。
- Arctic Shift 已完成 connector → PostgreSQL → 内容统计/API → UI 闭环。API 只入队，独立来源 worker 消费；网络失败不伪装成空结果，不回退旧 HTTP/Scrapling/mock。手动窗口采集已实现，自动小时调度与成熟指标定期刷新未实现。
- 共享接口明确 platform/provider/target、字符串内容身份、可空字段、作者、引用、媒体、平台详情、独立观测与能力。X、Instagram、web 有类型设计和合成 PostgreSQL 字段验证，真实 provider 尚未实现。
- 新路径复用 content 表，以 discovery 保留多来源匹配，observations 保留独立来源证据。新增 029 迁移及四张来源/关联/观测/任务表；旧 content 仓储 upsert 已适配新唯一键并验证兼容。
- 内容发布时间、源归档观测时间和本平台取回时间分开；真实 0、负 score、缺失 null 各自保留。归档成熟状态依据 retrieved_on / retrieved_2nd_on，不按 score=1 猜测。缺失标题/作者/发布时间、删除正文和异构平台字段不伪造。
- 内容列表与统计范围为已采集样本，不能代表全平台覆盖。Arctic Shift 同秒时间分页拥挤无法推进时停止并标 partial；达到页预算可继续 checkpoint。最新帖子年龄与最近成功取回都不能证明真实来源延迟，12 小时目标尚未持续验收。
- 旧趋势/榜单/增长、关键词及研究导出仍依赖旧 Reddit 模型，不自动消费 Arctic Shift 归档指标。完整媒体提取、新表保留策略、查询负载与部署仍需后续验收。旧服务器 HTTP/Scrapling 曾返回 403，不据此判断当前 Windows 可用性或全球访问政策。

## 本轮代码与文档

- ContentProvider 与唯一共享契约贯穿服务、仓储、API、UI；未来来源需实现目标归一化/单页获取、注册能力与平台，不能只改枚举宣称接入。
- 任务每页 1–100 条、每任务 1–20 页；活动任务去重、两分钟租约、旧 worker token 防护、逐页事务/checkpoint、每页最多三次暂时错误重试与人工 retry/continue 已实现。授权错误直接失败。
- `/v1/sources`、`/v1/source-jobs`、`/v1/content` 与 stats 使用现有认证：读取也要求 session/bearer，写入限管理员/owner/machine。路由及权限就近定义，读取不发外部网络请求。
- 关键词查询为标题/正文的字面匹配，中文可查；分页 cursor 绑定过滤条件，日期 `[from,to)`；总数和 UTC 日桶采用相同已落库范围，不使用旧搜索上限作分母。
- UI 支持中文/英文、采集错误/部分覆盖提示、归档成熟状态、三个时间字段和可空指标；刷新后恢复当前用户的最近任务。已做桌面与 390px 移动端实际浏览器验证。
- 正式文档仍为根目录两个、docs 四个 Markdown；本轮替换过时的共享服务器流程和“Arctic Shift 未实现”描述，报告、样本及截图位于忽略的 output/。

## 验证记录

- Windows PowerShell 7、Node.js 24.14.0。`typecheck`、`lint:web`、API/Web 构建、`smoke:compiled`、`docs:check` 与 diff 检查通过；编译后的来源 worker 在隔离库完成一次 tick。compiled smoke 仅证明构建/入口，不证明部署。
- 未修改 HEAD 在允许 loopback 的相同本地权限下：331 项，314 通过、17 失败。当前全量：349 项，331 通过、17 失败、1 跳过；失败名称逐项一致，无新增失败。新增 connector/service/API 离线测试共 17 项通过；PostgreSQL 测试默认跳过，另行真实执行通过。
- 初次受限环境运行出现本机监听 EACCES，不作为业务回归结论；上面的比较来自相同允许 loopback 的环境。17 项既有失败涉及旧采集分页/计数/provider 路由、phase1 调度、日事实覆盖与质量阈值，未修改断言或禁用来掩盖失败。
- 独立临时 PostgreSQL 17.11 验证全部迁移、页写入失败整体回滚、幂等身份、多来源关联、旧观测不覆盖新指标、旧仓储 upsert 兼容、UTC 日桶，以及合成 X/Instagram/web 大整数 ID、可空字段、媒体与平台详情往返。只在新建 source_validation_* 库写入，业务库未启动或修改。
- 实际 Node 客户端请求 Arctic Shift 历史帖子与评论各一次，均 HTTP 200；两条真实内容已落库，通过 HTTP API 和浏览器查询。帖子 t3_1qsi4bq：score 214 / comments 37，评论 t1_o32hgco：score 1，均按上游 metadata 标为已二次归档，不按数值猜成熟状态。单条采样不证明覆盖、持续可用性或实时热度。
- 浏览器另验证创建 technology 范围的 Moltbook 关键词来源，提交历史一分钟窗口、真实采集一页、刷新恢复任务；帖子/评论查询、空结果、UTC 日期、中英文与 390px 移动端均通过，无页面错误或横向溢出。截图在 output/playwright/，证据与基线比较在 output/validation/。
- 本轮无公开部署、生产库迁移或连续 48–72 小时新鲜度测试。隔离测试数据库、样本和截图不能当生产数据交付。

## 下一步

先验收小量代表目标的持续采集/新鲜度、页边界与负载，再按实际需求安排小时调度、成熟指标刷新和保留策略。X/Instagram/web 真实接入、跨平台指标对比及旧热度读模型迁移仍分别实施。更远产品待定项见 [产品计划](README.md)，具体本地命令和接口用法见 [开发说明](development.md)。
