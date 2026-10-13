# 分阶段开发日志

本文件按用户明确要求记录阶段 1–3 及 4A–5B 的开发过程、已实行内容、测试与本地版本；不是另一份产品计划。当前实现总览仍见 [状态](status.md)，操作与交接见 [交接](handoff.md)。秘密、合成样本和运行报告只在忽略的 output/。

## 2026-10-12：任务启动与版本基线

- 初始审计基线为 cd920c5。上一轮 Arctic Shift 的 34 个路径已逐个核对并保存本地快照 abd24f5，仍在个人分支 codex/arctic-shift-content-query；没有 push、main 修改或 PR 合并。
- 用户授权按阶段保存本地版本及日志/交接文档，前端以功能补充为主。正式文档增加本日志和交接两份，docs:check 同步为八份。
- 用户确认暂时无 X 凭证，并明确禁止本轮真实来源接入测试。全部新增验收采用离线 provider、可控时钟、隔离 PostgreSQL 和 localhost 浏览器流程；真实 Arctic Shift/X 与持续网络新鲜度验收待后续安排。
- 并行职责：旧数据语义/回归、图表/保存恢复、新来源生命周期分别独立处理；root 负责公共 API 集成、本地启动、阶段提交、来源功能 UI、X 配置和统一工作台/导出。修改边界已协调。

## 阶段 1：结果可信度与本地开发入口（0.2.0 本地快照已交付）

- 已定位 17 项既有失败：15 项与旧 new-listing 默认隐式追加 discovery 请求有关，2 项为 tier 质量阈值与既有契约不一致。专项 65 项通过；随后集成发现调度夹具缺上一观测，补齐真实 prior window 并保留原断言，两项通过。允许 loopback 的当前全量 392 项：388 通过、0 失败、4 个隔离 SQL 默认跳过；阶段快照另单独验证。
- 图表日期合并、空/有数据生命周期、比较保存和目标视图 URL 恢复已实施，6 项离线回归通过；真实 Chromium 合成 API 覆盖空/有图、保存失败与恢复、比较/目标恢复、390px，外部请求 0、错误 0。
- root 已补受控 UI 保存路径校验和 source 路由 PATCH/PUT JSON 解析；增加 .env.local 加载入口，显式 shell 环境优先，生产不隐式加载开发文件。
- 正式 Windows local:* 工具与独立数据库/owner/合成数据已运行；连续 start 复用 PID，stop --keep-db/start 已验证。关键词 2207 条 SQL 验收通过；迁移并发/回滚 SQL 验收通过。增长用 v2 相邻观测差分，历史 v1 不呈现实测 driver；普通查询不隐式重建索引。API 编译和 compiled smoke 通过，秘密与证据均留 output/。
- 阶段 1 的暂存树单独导出后，typecheck、API/Web 构建及 365 项回归通过（362 pass、3 个 SQL 默认 skip、0 fail），确认不依赖阶段 2/3 的未提交源码。启动器最后补 loopback API_HOST 与进程身份检查，避免占用端口上的其他服务被误当成启动成功。

## 阶段 2：持续采集与任务管理（已实现，修正快照 0.3.1）

- 030 来源生命周期迁移、active/paused/archived、标签/分组与 schedule/refresh、任务 purpose/取消/新增更新计数、provider 预算、sourceOps/worker 心跳已沿契约/仓储/API/worker/UI 打通，029 未修改。
- 新增 demo_reddit/demo_x 离线演示 provider，与真实 provider 身份分开，正文明确标记合成，不发外部网络请求。演示只证明流程，不证明真实平台数据质量。
- 后台离线/本机 API 初始 31/31 通过，隔离来源 SQL 2/2；72 小时模拟覆盖增量重叠、暂停恢复、租约中断、checkpoint 子任务、预算与成熟刷新。复核补 worker 顶部导入初始化、disabled provider 不生成失败周期任务、自动成熟刷新仅 archive 的明确 guard。
- 来源管理 Chromium 合成 API 验证设置/状态/任务/预算/权限、桌面和 390px、统一统计和 CSV/JSON 续导出全部通过，外部请求 0、页面错误 0。工作台/导出基础提前纳入阶段 2，API/service 离线 4/4 通过；不承诺冻结 SQL 快照或跨平台统一热度。
- 正式 local:start 的真实 localhost UI→认证/API→合成 worker→新 PostgreSQL→查询/续采/周期→归档→工作台/分段导出闭环通过，截图与结果在 output/local-dev/smoke-evidence.json 和 output/playwright/local-demo-real-pipeline-*。这证明本地流程，真实数据源请求为 0。
- 0a05f41 / local-phase2-v0.3.0 独立快照构建通过，但漏入 X 合成页使用的稳定 ID 前缀；386 项回归中 1 项固定页预算用例失败。root 在结果返回时未阻止提交，保留该快照作为已知失败记录，补齐公共身份前缀后重验并用 0.3.1 交付，不移动原标签、不降低断言。
- 0.3.1 修正快照独立全量 386 项：382 pass、4 个隔离 SQL 默认 skip、0 fail；阶段 2 构建已通过。交付用 local-phase2-v0.3.1，已知失败的 0.3.0 只用于追溯。

## 阶段 3：X 配置、统一查询与导出（0.4.0 软件开发交付）

- X provider 只做可配置实现和离线契约验证；没有密钥和真实请求授权，不能标为真实 X 接入已验收。
- TwitterAPI.io adapter 支持账号/搜索与 ID 获取，官方文档账号 flat/nested envelope 差异已处理，分页绑定目标/窗口，固定页上限 20、X snowflake 为字符串，sourceObservedAt 未提供时保持 null，媒体/引用/指标和白名单 metadata 归一化。默认无 key/network，付费预算独立 disabled/0；离线 8 项与本机 API 闭环 1 项通过，无真实 provider API 请求。
- 031 只注册 X，032 增加已登记请求数/取页解析耗时；正常、重试、刷新与取消 fence 有单测和 native SQL。取消/丢租可能阻止登记但保留预算预留，不能把计数当账单。未来 web adapter 通过共享命名空间 helper 派生身份，4 项测试验证同 GUID 不跨站碰撞、URL 语义与旧 ID 不变。
- 复核修复旧 PostgreSQL upsert 绕过新规范内容守卫的问题；native regression 验证公共规范字段保持、后续合法归档更新及旧 legacy-only 更新。新隔离库全部 34 项 SQL 单事务应用成功，重复执行无新迁移。
- 统一工作台/导出基础已在阶段 2 提前交付，本阶段完成 X 注册和双平台实际本机演示。JSON/CSV 2000 条上限、同分母、cursor 续页、CSV 安全/数字 ID与 null/0 保留均验证；并发更新时不是冻结快照，各平台指标不合并热度。
- 前端补双语旧/新分析范围说明和来源入口，明确前 50 榜单候选、旧词项 OR/排除与公共连续字面/emoji/标点；成熟自动刷新仅 archive，任务数/耗时缺失显示 —。现有结构可容纳新增功能，未发现应启动大规模重设计的功能阻碍。
- 最终全量离线 407 项：400 pass、7 个 SQL 默认 skip、0 fail；七项 SQL 单独执行 7/7，无 skip。typecheck、API/Web build、Web lint、compiled smoke、八份 docs 检查均通过。两套 UI 合成冒烟和真实 localhost 前端/API/worker/PostgreSQL 的 Reddit/X 合成查询/浏览器导出通过；完整 stop/start 保留数据，外部源请求 0、浏览器错误 0。

## 2026-10-12：开发功能对照修订 R2

- 按用户最新要求只修订计划与文档，开始时个人分支工作区干净；保留 cd920c5 为最初基线、e88ca2e / v0.4.0 为软件基线与全部阶段标签，没有修改业务源码或重新运行业务测试。
- 原 60 项任务编号、目标、验收标准和 20 个模块初始状态完整保留；重新核对为 9 项限定软件目标完成、32 项部分完成、1 项软件实现待真实验收、2 项待真实验收、8 项尚未实现、8 项需求确认后推进。目标宽度不等，不据此计算项目完成率。
- 源码复核指出候选前 20 个再筛 eligible 的调度饥饿风险、旧卡片 availability/首次发现采样与发布时间桶混用、旧同步 Run/旧 worker 网络闸门缺口。均未触发真实请求或运行缺陷复现；安排 4A 用离线夹具先证明再修复。公共索引、详情/保存、分析迁移、冻结导出也不再泛称已完成。
- 产品计划、架构、状态、开发说明及交接原段落同步纠正；4A 优先、4B 可并行、4C 持续使用，5A 内容闭环/5B 检索与研究复现支撑 6 分析。个人保存验收依赖账号隔离；G 的 AS 授权与 X 凭证/费用条件分别记录，Instagram 和 RSS/web 不共用同一验收出口。前端继续以功能补充为主。
- R2 HTML/JSON、生成脚本与浏览器证据留在忽略的 output/validation，不覆盖历史报告。报告 9 项检查通过，保留原 60/20 项及源码位置、筛选/证据展开/完整 JSON 下载、桌面/390px 布局；页面错误与外部请求均为 0。首次 Chromium 沙箱启动失败，允许本机启动后完成同一检查，结果不算项目业务验收。
- 文档检查继续覆盖八份，diff 检查通过；软件版本保持 0.4.0，本次作为本地文档修订保存。没有真实来源验收、付费试跑、部署、远端 Git 操作或前端整体改造。

## 阶段 4A：正确性、调度与执行入口（0.5.0 软件交付）

- 开始时个人分支 `codex/arctic-shift-content-query` 工作区干净，基线为 `2eab855`；未切换 main/shared-dev。用户授权 4A→4B→4C→5A→5B 和阶段版本管理，随后允许并行，三个子代理分别处理数据/配置、前端、来源调度，root 集成执行政策、readiness、API 与阶段快照。
- 调度先筛 eligible 再限批，复现并修复 21 个来源中前 20 个空候选造成的饥饿；不同 purpose 可并存排队，同来源运行互斥，持久化每四次为 manual/refresh 留一次优先机会。新增有界 recheck（默认 12 小时/6 小时）与 provider 最小间隔，不推进增量高水位，不把预算预留当账单。
- Target 的首次发现采样与发布时间图表分开；未取样为 null，已取样为空为 0，未知互动不归 quiet/普通。日桶不被部分 firstSeen 采样覆盖，20,000 条截断明示下界；最新存储行不能重建已覆盖的历史指标，明确保留该限制。
- 共用执行政策覆盖新旧 runtime、同步/异步 API、use-case、worker/CLI 和 connector 工厂。网络关闭禁止 live，production 禁止 mock/demo，非法请求在写目标/入队前拒绝。严格配置、localhost 端口/代理校验、source worker 编译 smoke、离线与 SQL 独立 runner、CI workflow 已写；readiness 纳入来源队列/活跃 worker/近期失败与登记耗时。
- 033 新增迁移，未修改原 SQL；隔离库应用完整 35 个 SQL，重复执行无新增，未升级 `info_workbench_dev` 或生产库。033 校验值为 `3E26D15B27D7BF23CAA67C35581BA909DFB776B4072B2DD18D983D0AD3D0D1E7`。
- 首次沙箱全量因 loopback EACCES 失败；允许本机执行后定位环境错误文案及执行环境 overlay 两项实际回归，修复后再次验收，没有降低断言。初次临时 UI 端口失效后由 root 新建 41975，仅用合成 API 重验。
- 为避免并行 4B 混入，冻结暂存树并导出独立快照 `output/validation/phase-4a-snapshot-b873eef7`。最终报告 `phase-4a-snapshot-verification.json`：425 项离线全部通过、15 项隔离 SQL 全部通过，均 0 fail/0 skip；typecheck、API/Web/Vite 构建、Web lint、compiled smoke、八份 docs 检查通过。依赖复用既有安装，不声称重新清洁安装；云端 CI 未运行。
- 两套 Chromium 合成 UI 覆盖采样语义、来源设置/状态/任务/预算/导出及 390px；外部请求 0、页面错误 0。证据分别为 `output/playwright/phase1-functional-evidence.json`、`output/validation/phase-4a-sources-ui.txt` 与对应截图。4A 阶段保存本地标签 `local-phase4a-v0.5.0`，不包含后续 4B 代码。

## 2026-10-13：停止并行、单 agent 交接与 4B 未完成检查点

- 用户最新要求为：不再开子代理，完成已有子代理交接、写当前日志后停止。三个子代理均已停止，root 收齐文件、接口、专项结果、未完成项和进程状态；后续全部分配给单 agent，不自动继续实施 4B/4C/5A/5B，不再启动业务测试。
- 数据/配置代理留下账户安全与审计服务、PG/memory 仓储、权限政策和 034；包括凭证版本 fencing、原子改密/撤会话、最后 active owner 锁、加密随机邀请码。损坏 scrypt hex 可误认证的问题已离线复现并在收到停止消息前保存修复，9 项专项通过；账户隔离 SQL 1/1（在最后 hash 修复前执行），不等于全项目验收。审计 intent 与结果分开持久化，`attempted` 代表中断结果未知，不声称与业务变更原子提交。
- 前端代理留下 auth epoch/abort/账号缓存与草稿隔离、账户/审计页面、用户角色和目标 dirty/CAS UI。auth epoch 2/2，合成 Chromium 66 个 API 请求、外部请求 0、错误 0，最终 Web lint 通过；此前核心 build 在追加 target CAS 之前，不能视为最终构建。账户 API 实接、公共 revoke/target revision 类型、来源 CAS UI、邀请角色选项和 SPA 后退提醒仍待接续。
- 来源代理留下 source/budget CAS、target 仓储条件更新及 035。035 未应用，CAS 单测/API/原生 SQL/worker 暂停并发尚未执行；旧 target API、bulk policy 与前端来源接线未完成，pause/commit 锁序存在待复核的静态风险。
- root 留下 3 项有意失败的写安全回归：登录专用限流/伪造 forwarded 地址、跨来源写入拒绝、默认 PATCH/PUT/DELETE CORS 与 header 白名单。相应功能尚未实现；账户新路由和业务审计接线尚未写。既有 typecheck 记录含 PublicContent 合成夹具缺字段、`authRateLimit` 配置不存在及并行接口未整合；停止后不靠新的业务修改消除这些失败。
- 4B 作为 `local-phase4b-wip-single-agent-20261013` 保存未完成本地检查点，不赋予新的交付版本。4C 的保留/恢复/发布/性能、5A 的公共内容使用闭环、5B 的检索/冻结研究导出均尚未开始；详细单 agent 接续顺序维护在 [交接](handoff.md)，不新建另一套交接文件。
- root 的临时 Vite 41975 与 PostgreSQL 启动 helper 已关闭；PostgreSQL 25432 保留运行及数据，用户其他服务未动，临时/隔离数据库未删除。所有改动保留在个人分支，没有真实来源、付费、部署、push、force push、分支删除或 PR 合并。收尾仅更新原有文档、运行 docs/diff 检查及保存本地版本，然后停止。

## 2026-10-13：恢复并行开发

- 用户明确恢复任务，并重新授权最大化子代理并行。复工读取原八份文档及暂停交接，核对个人分支与 Git 状态：HEAD 为 `3db313e`，工作区干净；`a9f5403 / local-phase4a-v0.5.0` 与 4B WIP 标签保持。
- 三个子代理按账户 HTTP/权限/审计、来源/目标 CAS、前端功能接线恢复；root 负责公共契约、集成、阶段版本与独立 4C 的容量/恢复/发布准备。当前四个可用并发槽全部使用，后续空出后滚动分配 5A/5B。
- 复工 typecheck 确认两项既有失败：PublicContent 冒烟夹具缺 url/language/author、专用 authRateLimit 尚未定义；不降低断言。root 已补会话撤销、目标 revision/update/bulk expectedRevisions 共同类型，跨层实现由相应代理继续。
- 原验收约束继续有效：仅离线、隔离 PostgreSQL、localhost 合成闭环；不真实采集、不收费、不部署、不 push/删分支/合并。4C 的保留策略先给可检查 dry-run，不自动删除用户数据；前端保留结构做功能补充。

## 阶段 4B：账户、权限、审计与配置并发（0.6.0 软件交付）

- 从 3db313e 的停止点恢复，三个代理滚动推进。补齐账户 HTTP/公共契约、机器与角色边界、专用 socket IP 限流、Origin/CORS、写入前 intent 与脱敏结果审计；既有类型和安全红测修复并保持断言。
- source/budget/target revision CAS 贯通客户端；bulk 全员锁定校验后才写，任一冲突零部分提交；worker 用量/时间不增加配置版本。暂停与 commitPage 锁序统一。409 保稿、SPA 后退/关闭提示、admin 邀请 viewer 限制、auth epoch 和账户隔离完成。
- 034/035 仅新隔离库应用，原 SQL 校验未改、开发业务库未升级。035 SHA256 608705B7C2FCCBE529E584767C0AADEE0B5A3DE0300F4B72EE16BEA5680AA619。
- 冻结暂存导出 phase-4b-snapshot-a40734d1 排除并行4C/5A/5B，455/455 offline、24/24 native 全通过零 skip，typecheck/API/Web/Vite/lint/compiled/docs 通过。新实际账户 smoke 加入该快照后 typecheck 通过，真实浏览器→API→独立 PG 检查改密/旧会话401/A-B Saved 隔离/撤全/持久审计；18 API 请求，外部请求0、page errors0、390px截图。复制脚本首次路径错误后按绝对路径重跑成功。
- 合成 Web 另验来源/预算/target/bulk CAS 和离开草稿，93 请求零外部零错误。证据 phase-4b-snapshot-verification.json、phase4b-real-account-local.json、phase4b-account-security-evidence.json；复用依赖，未清洁重装/云CI/真实来源/部署。保存本地 local-phase4b-v0.6.0，保留历史WIP；后续按4C→5A→5B独立交付。

## 阶段 4B：账户、权限、审计与配置并发（0.6.0 软件交付）

- 从 3db313e 的停止点恢复，三个代理滚动推进。补齐账户 HTTP/公共契约、机器与角色边界、专用 socket IP 限流、Origin/CORS、写入前 intent 与脱敏结果审计；既有类型和安全红测修复并保持断言。
- source/budget/target revision CAS 贯通客户端；bulk 全员锁定校验后才写，任一冲突零部分提交；worker 用量/时间不增加配置版本。暂停与 commitPage 锁序统一。409 保稿、SPA 后退/关闭提示、admin 邀请 viewer 限制、auth epoch 和账户隔离完成。
- 034/035 仅新隔离库应用，原 SQL 校验未改、开发业务库未升级。035 SHA256 608705B7C2FCCBE529E584767C0AADEE0B5A3DE0300F4B72EE16BEA5680AA619。
- 冻结暂存导出 phase-4b-snapshot-a40734d1 排除并行4C/5A/5B，455/455 offline、24/24 native 全通过零 skip，typecheck/API/Web/Vite/lint/compiled/docs 通过。新实际账户 smoke 加入该快照后 typecheck 通过，真实浏览器→API→独立 PG 检查改密/旧会话401/A-B Saved 隔离/撤全/持久审计；18 API 请求，外部请求0、page errors0、390px截图。复制脚本首次路径错误后按绝对路径重跑成功。
- 合成 Web 另验来源/预算/target/bulk CAS 和离开草稿，93 请求零外部零错误。证据 phase-4b-snapshot-verification.json、phase4b-real-account-local.json、phase4b-account-security-evidence.json；复用依赖，未清洁重装/云CI/真实来源/部署。保存本地 local-phase4b-v0.6.0，保留历史WIP；后续按4C→5A→5B独立交付。
