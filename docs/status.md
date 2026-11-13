# 当前实现与重构状态

核对日期：2026-11-13。源码基线 **`main@3551900`**，应用版本 0.9.1。本轮重新梳理产品、审查源码、重写架构和三人开发计划；**没有修改业务代码/SQL，没有启用来源、产生收费请求或部署**。目标技术栈和里程碑不能当成当前实现。

## 1. 现在已经有什么

| 范围 | 已实现 | 尚未交付 |
| --- | --- | --- |
| API/前端 | TypeScript、手写 `node:http` API、React/Vite；账户/邀请/审计、Content/Saved/旧工作台 | Fastify、项目实体/项目导航、统一跨平台产品概览 |
| Reddit / Arctic Shift | 社区/账号帖子与评论、帖子评论、范围内关键词、ID成熟刷新；真实小样本落库 | 非全站关键词；13位评论ID刷新校验缺陷未修；持续覆盖/12小时新鲜度未验 |
| Reddit / kaix | 跨社区 search、社区/账号帖子、账号/帖子评论；公共内容/独立观测/预算/导出；收费未知结果不自动重放 | 默认关闭/零预算，无可续cursor、始终partial；业务接入后的真实持续与正常有效成本未验 |
| X / TwitterAPI.io | 账号/搜索/ID adapter、媒体/引用/可空指标、独立预算 | 默认关闭，无真实凭证验收；当前报价未通过单位价上限 |
| Bluesky / AppView | 公开账号及作者回复、AT URI/CID、opaque cursor；两页真实闭环 | 无搜索/线程展开/删除检测/持续运行；保留现状，不占首版扩展排期 |
| 公共来源任务 | 生命周期、逐页事务/checkpoint、租约、高水位、公平领取、有限重试/永久阻塞/人工Retry、预算、心跳 | 无自动主备；requests/resources不是货币账单；无可靠全站完整性承诺 |
| 内容/工作区 | 统一查询/统计、公共全文字面投影、详情、保存/注释、JSON/CSV、RR冻结研究成员 | 即时列表/统计非冻结快照；旧热榜/增长模型尚未迁到公共观测 |
| 聚合项目 | 本轮审查 AIHOT/NewsNow/TrendRadar 源码 | **无 NewsNow/AIHOT/RSS 正式 adapter**；web/Instagram 只有类型/合成验证 |
| 数据库/运维 | PostgreSQL、42个SQL迁移（最后编号040）、备份/恢复、发布manifest、systemd/Nginx模板 | 项目表、集合批量页写入、自动保留执行器、PG版本收敛、代表负载验收 |

`main` 已包含 E0 边界修复、详情批量读取、Bluesky/040、kaix、静态资源恢复与登录初始会话竞态修复，不再把这些列为待整合分支。

## 2. 本轮源码审查确认的复杂度

- `apps/api/src/create-api-server.ts` **3,606行**；API启动仍依赖 `createPostgresPhase1Runtime()`，新公共能力与旧Reddit装配耦合。
- `source-content.service.ts` 约 **20.7KB/157行**，PG来源仓储约 **50.9KB/305行**，包含压缩长行；文件短不代表职责简单。
- `commitPage()` 虽按页事务提交，页内仍逐条执行正文、投影、discovery与observation SQL。原架构文档“已批量写入”表述不准确，现已改为待优化项。
- 公共来源 worker 与旧 phase1/keyword scheduler 并存；旧Markets/Compare/Queries/Run/Target依赖旧数据模型。首版改以项目/内容为主，旧主链进入明确退役清单。
- 11-08前端蓝本是冻结原型；其归档CLI/041不在当前源码。它不是本轮39项功能需求，也不代表现行接口。

技术决定：目标为 Fastify5 + pg + PostgreSQL，保留现有来源任务和React/Vite；先解除旧装配、批量写入和项目闭环，再删旧链路。具体边界见[架构](architecture.md)，三人排期见[开发安排](plans/source-expansion.md)。

## 3. 检查证据

下面区分本轮检查与历史快照，不推断服务此刻持续运行。

| 基线/时间 | 证据 | 结论边界 |
| --- | --- | --- |
| 本轮文档分支 / 11-13 | 读取本仓库关键入口/SQL/契约及AIHOT/NewsNow/TrendRadar/Fastify相关源码与许可；重写需求、架构、状态、研究和计划 | docs:check（14份文档）、本地链接/锚点检查、diff检查通过；未运行全量业务测试，不是框架迁移或来源可用性验收 |
| `3551900` / 本轮读取GitHub状态 | [云CI 43358775922](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/43358775922) completed/success | 证明该整合快照workflow成功，不是新计划已实现或已部署 |
| 11-13整合 / `cf05c12`系列 | 本机531项离线、43项PG14 SQL、账号/内容/研究浏览器闭环通过；初始会话响应曾清空登录输入，修复等待会话检查并加入延迟响应场景；修复提交云CI成功 | 历史快照，非本轮重新执行 |
| kaix接入 / `413bb75`系列 | 530离线、补跑kaix7项、1项PG14落库/API/CSV；类型、API/Web、compiled、docs通过；历史样本离线重放支持长ID评论 | 接入阶段外部收费请求0，持续与并发未验 |
| E0详情优化 | 1,004来源/1,029内容/20引用，暖缓存30次：SQL23→4，P95约179.3→51.6ms，解码JSON约901,752→35,171字节 | 指定小数据量、隔离PG，不能当100万内容容量 |
| 10-20吞吐 / `c805ca1` | 合成100条/页纯应用落库约128条/秒；单来源调度约19.3、多来源交错约46.7条/秒 | 不含上游网络，旧页等待5秒/worker睡眠构成限制；非生产容量 |
| E1真实Bluesky | 两页保存6条作者内容，重放新增0，PG→API→浏览器/导出通过 | 窗口未耗尽/partial，无持续新鲜度证据 |

本轮外部源码固定提交和选型依据在[来源研究](research/data-sources.md)。Fastify默认分支为6 alpha，已另外核对5.12.8稳定tag；计划不采用alpha。没有运行第三方项目测试或采集器。

## 4. 已知部署边界

11-13曾按用户要求提供HTTP/IP验收入口，API/Nginx部署与已存内容/CSV验证通过，部署基线含 `413bb75`、`bdada7b`；数据库已新增应用040。真实provider当时全部禁用，没有新增自动采集。既有发布产物/备份与哈希静态资源保留规则见[开发说明](development.md)。

本轮未检查服务器实时状态、未部署最新main/文档分支。10-28为研究搭建的public-tunnel/desktop/chrome/bridge四项浏览器服务在11-10检查均inactive，本轮保持不动。服务健康、真实来源连续可用、数据新鲜度三者不互相替代。

原始报告仍在相应机器忽略的 `output/validation/`、`output/research/`，不进Git；更早过程见[开发日志](history/development-log.md)、[历史交接](history/handoff.md)，更长来源证据可查Git `3551900`版研究文档。

## 5. 当前待办

| 状态 | 下一步 | 主责占位 |
| --- | --- | --- |
| 待确认 M0 | 3个项目/关键词、实际姓名、来源凭证和预算分配、留存政策 | A+B+C |
| 未开始 M1 | 解除phase1 runtime依赖，Fastify首批路由，修长ID与集合写入 | A+B |
| 未开始 M2 | 项目/来源关联迁移、概览→明细→导出闭环 | A+B+C |
| 来源条件未满足 M3 | Reddit/X各一条路径的正常成本与持续验收 | B，C核对样本 |
| 未开始 M4 | NewsNow少量榜单；AIHOT RSS可选 | B+C |
| 未开始 M5 | 删除旧主链与页面、代表负载/恢复验证、发布 | A+B+C |

本轮不继续采购/候选试跑，也不实施代码删改；下一开发批次从M0/M1开始。
