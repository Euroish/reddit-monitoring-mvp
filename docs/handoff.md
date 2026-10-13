# 阶段交接与交付状态

用户原授权阶段 1、2、3 及后续 4A、4B、4C、5A、5B；2026-10-13 停止交接已保存，随后用户明确恢复并重新授权尽量并行。当前从 4B WIP 接续，三个子代理分别负责账户/审计、配置并发、前端，root 负责契约/集成/版本及独立 4C 准备；依然按阶段验收。本文件维护阶段版本、实际范围、验证边界与接续步骤；过程见 [开发日志](development-log.md)，操作见 [开发说明](development.md)。

## 版本与范围

| 版本 | 范围 | 当前交付状态 |
| --- | --- | --- |
| abd24f5 | 上一轮 Arctic Shift 内容采集/查询及共享接口快照 | 已保存本地；上一轮真实小样本验证不等于本轮真实来源测试 |
| 0.2.0（阶段 1） | 图表/保存/统计/增长与既有回归、原子迁移、本地开发入口 | 本地提交 52636a1；标签 local-phase1-v0.2.0；独立快照 365 项：362 pass / 3 skip / 0 fail，构建通过 |
| 0.3.0（阶段 2 中间快照） | 来源生命周期、周期任务、成熟归档刷新、任务中心/预算/心跳；提前交付统一统计/导出基础 | 0a05f41 构建通过，独立回归发现稳定 ID 前缀漏项；保留记录，不作为交付版本 |
| 0.3.1（阶段 2 交付） | 同上，补齐公共稳定身份前缀 | 提交 0496b1d / local-phase2-v0.3.1；独立快照 386 项：382 pass / 4 skip / 0 fail；构建通过 |
| 0.4.0（阶段 3 交付） | X 可配置 adapter 与 demo、共享身份/规范写保护、请求观测、双语入口和多平台查询/导出 | local-phase3-v0.4.0；最终离线 400 pass / 7 SQL skip / 0 fail，SQL 另跑 7/7；真实 X 按用户意见保留 |
| 0.5.0（阶段 4A 交付） | 公平调度/recheck/请求间隔、采样与发布时间口径、新旧执行政策、配置/CI/readiness | local-phase4a-v0.5.0；独立代码快照离线 425/425、隔离 SQL 15/15，零 skip；类型/构建/lint/compiled/docs 通过；复用依赖，云端 CI/真实来源未执行 |
| 4B WIP（历史停止检查点） | 账户/审计仓储服务与 UI、账号隔离、部分配置 CAS 和写安全红测 | local-phase4b-wip-single-agent-20261013；未完成 HTTP/契约整合，已有 typecheck 与安全测试失败，不作为交付版本 |
| 0.6.0（阶段 4B 交付） | 账户/权限/审计、配置与批量 CAS、缓存/草稿隔离 | local-phase4b-v0.6.0；455 离线、24 SQL 全通过零 skip，类型/构建/lint/compiled/docs 与实际本地账户闭环通过 |

| 0.7.0（阶段4C交付） | 容量/保留dry-run、备份恢复、发布产物与性能 | local-phase4c-v0.7.0；460离线、25 SQL零skip；580文件完整性、实际合成恢复和2万内容测量通过 |

## 当前分工与接续

个人分支保持 `codex/arctic-shift-content-query`，复工基线 `3db313e` 工作区干净；停止 WIP 与 4A、4B 交付版本分开保存。4B 已收口为 0.6.0 软件交付：账户 HTTP、角色权限、持久化脱敏审计、来源/预算/目标 revision CAS、批量原子冲突和账号缓存/草稿隔离已贯通。独立冻结版本通过 455/455 离线、24/24 隔离 SQL、类型/构建/lint/compiled/docs；实际 localhost 浏览器→API→新合成 PG 验证改密再认证、旧会话拒绝、A/B Saved 隔离和撤销全部会话，18 个 API 请求、外部请求/页面错误均为 0。复用已安装依赖，云端 CI、清洁安装、生产部署和真实 provider 未验。

三个子代理滚动分配：phase1_data 负责 Web 5A 工作流，phase2_sources 负责 5A 内容后台及 5B 公共索引，auth_api_4b 负责 5B 冻结研究导出，root 负责集成、4C 运维、独立验收与版本。4C 已交付；接续按 5A→5B 顺序，不把并行准备作为交付。033/034/035 仅隔离库验证，本机开发库和生产库未升级。

## 验收约束

- 本轮不调用 Arctic Shift、Reddit 或 X 真实采集 API，也不产生付费 provider 费用。localhost 服务、隔离 SQL 与合成 provider 可以用于冒烟/E2E。
- 离线测试、真实数据库测试、浏览器流程和真实来源/持续新鲜度验收分开记录。48–72 小时模拟时钟不代表 48–72 小时真实网络运行。
- 本地功能分支逐路径提交；不 push、force push、删分支或合并 PR。凭证、数据库与报告不进 Git。
- 前端保留现有工作台结构，补充来源配置、任务、查询/导出等功能。只有实际功能实现受到重大阻碍时，才另评估大规模前端改进；当前没有据此重设计。

## 与审计清单的对应（2026-10-12 修订 R2）

初始基线仍为 cd920c5，上一轮 Arctic Shift 保存快照为 abd24f5，R2 软件基线为 e88ca2e / v0.4.0。阶段版本记录的是实际交付范围，不代表原 60 项改进目标全部完成。旧报告将部分条目统一归为 Delivered/Future，分类过粗，本表保留编号并按本次 4A/4B 交付事实更新相关条目；历史报告及运行证据保持原样。

R2 当时统计为 9 项限定软件目标完成、32 项部分完成、1 项软件已实现待真实验收、2 项待真实验收、8 项目标尚未实现、8 项需求确认后推进；该历史数字不作为本次停止状态汇总，各目标宽度不同，不计算项目完成率。已完成包含基线保留能力或本次修复，不都是新建功能。当前以顶部阶段独立验收为准，后续工作树不混入先前快照。

阶段代号和依赖/出口以 [产品计划](README.md) 为准；下面逐项保留原编号与差距。4A/4B/4C 为可靠性与持续使用，5A 为内容使用，5B 为公共检索/研究复现，6 为分析迁移，G 为待授权真实验收。

| 原任务 | 修正状态 | 当前已实现 | 剩余目标/边界 | 下一进程 |
| --- | --- | --- | --- | --- |
| P0-01 测试正确性 | 已完成限定软件目标 | 原17失败已归因；0.4.0既有验证400离线通过，7项SQL另跑通过。 | 保留回归门禁；此轮未重新运行测试。 | 维持 |
| P0-02 图表正确性 | 已完成限定软件目标 | 曲线与overlay按日期并集对齐，缺值null。 | 维持不同起点/缺日/乱序回归。 | 维持 |
| P0-03 图表生命周期 | 已完成限定软件目标 | 空→有→空→有生命周期与移动遮挡已修并有合成浏览器证据。 | 新图表沿用相同生命周期回归。 | 维持 |
| P0-04 保存视图 | 已完成限定软件目标 | 目标/比较受控保存URL、恢复series/overlay/range和失败反馈已完成。 | 公共content保存属P2-09，不能把此项完成扩大成全部收藏完成。 | 维持 |
| P0-05 统计口径 | 部分完成 | 已索引范围的完整计数与独立样本；公共列表/统计同过滤；4A 独立 firstSeen 采样窗、发布时间桶及 availability。 | 公共索引覆盖/正文覆盖未量化，历史被覆盖的最新指标无法重建。 | 5B/6 |
| P0-06 增长语义 | 已完成限定软件目标 | 旧增长v2由相邻真实记录观测差分产生；单快照/缺指标不算增长，v1不进实测driver。 | 新公共平台分析仍待P1-10/P2-07；不把归档成熟刷新当近期增长。 | 维持 |
| P0-07 数据解释 | 已完成限定软件目标 | 4A 保留 null/0/未知、窗口两端及 20,000 截断下界，图表按发布时间桶；新旧范围/合成标识已有。 | 新公共分析仍未迁移，旧历史指标重建不支持。 | 6 |
| P0-08 环境隔离 | 已完成限定软件目标 | 4A 共用网络/mode 政策覆盖新旧 API、worker/use-case/CLI/factory，非法请求在写入前拒绝。 | production/部署及真实来源另验。 | G/发布门槛 |
| P0-09 公网安全 | 部分完成 | 角色写入、cookie HttpOnly/SameSite/production Secure与基本CORS已有。 | 登录/注册专用限流、邀请码随机性、写请求来源政策、PATCH/PUT CORS、两个readyz路径与TLS尚未闭合。 | 4B/发布门槛 |
| P0-10 迁移可靠性 | 部分完成 | 迁移事务锁、DDL/checksum原子性、并发/失败回滚测试已实现。 | 合成完整恢复已验；真实旧库副本升级、较大库锁时长与发布故障恢复尚未验收；不能再称缺迁移锁。 | 4C |
| P1-01 来源管理 | 已完成限定软件目标 | 来源标签/group/state/schedule/refresh、暂停取消、归档保留已完成。 | 目标身份固定，更换目标需新建；数据库乐观锁不在此已完成范围。 | 维持 |
| P1-02 周期采集 | 部分完成 | 周期/高水位/overlap/catch-up/checkpoint；4A eligible 先筛、公平机会、recheck 和用途运行互斥已验。 | 有界回查不保证窗口外迟到或上游全量；真实持续新鲜度未验。 | G |
| P1-03 新鲜度验收 | 待真实验收 | 72h模拟和本机合成闭环通过。 | 48–72h真实可用性、遗漏/迟到、源延迟与≤12h目标尚未验收。 | G |
| P1-04 成熟指标 | 已完成限定软件目标 | Arctic/archive initial按年龄/次数/间隔有界ID成熟刷新及单独观测完成。 | 真实AS刷新效果待授权验收；X snapshot自动刷新不属于已完成archive能力。 | 维持/G |
| P1-05 任务操作 | 已完成限定软件目标 | 任务历史筛选、cancel/retry/continue、冲突和页计数完成。 | 长历史cursor分页可作P2-11增强；当前最多100条不等于完整归档浏览。 | 维持 |
| P1-06 工作量与费用 | 部分完成 | 日/月请求/资源预留、有限重试、默认付费0、预算唤醒；4A 请求间隔与公平调度已验。 | 货币预算与实际账单对账未完成；预留不是费用。 | G |
| P1-07 内容更新策略 | 部分完成 | 公共字段时间守卫、未知时间/语言补齐、旧upsert保护、web namespace工具完成。 | 字段质量/缺失/删除冲突规则及真实web adapter应用未闭合。 | 5B |
| P1-08 研究导出 | 部分完成 | 公共CSV/JSON有界导出、同过滤总数、证据、CSV防注入与大ID保护完成。 | 研究级冻结成员/分母、完整指标定义/单位/版本manifest未实现；并发更新可改变续页。 | 5B |
| P1-09 X 最小接入 | 软件已实现，真实验收待授权 | TwitterAPI.io账号/搜索/ID adapter、平台注册、闸门与合成闭环完成。 | 无key/预算/真实账号与检索、媒体/遗漏/延迟/账单验收。 | G |
| P1-10 统一工作台 | 部分完成 | 公共唯一内容数/byKind/日桶/platform/provider分布完成。 | 默认主页及旧Markets/Target/Compare分析仍旧Reddit；公共质量/趋势/异常与主题统计尚未迁移。 | 5A/6 |
| P1-11 多语言查询 | 部分完成 | 中文连续字面、旧英文词界/复数/负向词与语义说明已有。 | 公共字面、旧OR/phrase与provider搜索未统一成带mode/scope版本的契约。 | 5B |
| P1-12 索引生成 | 部分完成 | 旧collector增量写索引、显式限批补建、查询不seed完成。 | AS/X公共页提交无公共检索投影；旧索引依赖target且只320字符；更新/删除/事务恢复一致性未闭合。 | 5B |
| P1-13 主入口与能力 UI | 部分完成 | Content动态平台/provider/目标/指标、禁用说明、管理入口和empty链接已实现。 | 默认/登录入口仍markets，导航旧新并列；来源→内容→分析主流程尚未完整建立。 | 5A |
| P1-14 Windows 启停 | 已完成限定软件目标 | Windows local:*完整PG复制、cluster/PID身份、端口、owner/代理与重复启动/停启已验证。 | 部分setup失败、配置损坏与优雅stop为后续增强；无需重做启动器。 | 维持/4C |
| P1-15 环境配置 | 部分完成 | local env/demo/loopback；4A 严格校验、端口与代理预检、config-only 命令已验。 | 历史零散 POSIX 工具跨平台整理与生产配置另验。 | 4C/发布门槛 |
| P1-16 API 维护 | 部分完成 | 新公共来源routes就近声明方法/权限已拆出。 | 认证/旧分析/ops大handler仍集中，约3787行；只在相应功能改动时按域拆。 | 伴随各阶段 |
| P1-17 持续集成 | 部分完成 | 4A workflow 和零 skip offline/native SQL runner 已写，compiled 覆盖 source worker；本机独立快照门禁通过。 | 清洁重装与云端 workflow 未执行；4B 红测和类型失败已收口。 | 4B/发布门槛 |
| P1-18 来源运维 | 部分完成 | 4A readyz 纳入来源队列与活跃 worker；近期失败摘要、登记平均耗时和旧运维入口已接。 | 完整耗时分布、覆盖可观测与保留/容量尚缺；最近100任务不代表长期全量。 | 4C/G |
| P1-19 真实验收测试 | 部分完成 | 离线API权限、原生SQL和合成UI、本机UI→API→worker→PG脚本完成。 | 完整邀请→pending→激活→账号切换→来源全流程尚未串联CI；真实源/部署另验。 | 4A/4B/G |
| P1-20 备份与发布 | 部分完成 | 有旧systemd/nginx/env和compiled入口及文档说明。 | source worker模板、无秘密manifest、合成dump/restore已验证；实际部署/切库/生产故障演练未执行。 | 4C/发布门槛 |
| P1-21 账号体验与权限 | 部分完成 | 既有基础；4B 服务/仓储已写改密/撤会话/version fence/owner 政策，专项通过。 | HTTP/旧写路径与实际本地账户闭环已验；邮件找回、公网独立验收待推进。 | 4B |
| P1-22 操作审计 | 部分完成 | 4B durable intent/结果仓储、脱敏分页、审计 UI 已写，专项通过。 | HTTP 与业务写入已接；审计与业务非单事务，4C保留预览保护未决intent。 | 4B/4C |
| P2-01 低成本补充来源 | 目标尚未实现 | web身份/字段准备与合成存储已有。 | RSS/feed/web真实adapter、URL/DNS/redirect约束与真实文章验收均无。 | 条件扩源 |
| P2-02 媒体 | 部分完成 | X媒体适配与公用media字段，AS外链已保存。 | 媒体预览/失效/可访问性与provider真实字段覆盖不全。 | 5A/G |
| P2-03 内容详情 | 目标尚未实现 | 引用ID与原链接可见。 | 无公共内容detail route/API、线程/评论有界展开与关联跳转。 | 5A |
| P2-04 高级筛选 | 部分完成 | 已有platform/provider/source/kind/text/time过滤与cursor。 | 作者/语言/指标筛选、稳定排序、URL恢复缺失。 | 5A |
| P2-05 榜单范围 | 目标尚未实现 | 旧榜单范围前50已有明确说明。 | 服务端按指定排序全范围分页尚未实现；加说明没有修复漏榜。 | 6 |
| P2-06 主题组织 | 部分完成 | 来源group与多发现内容去重已实现。 | 主题集合实体、用户收藏/注释、活跃发布者分析尚无。 | 5A/6 |
| P2-07 跨平台指标 | 部分完成 | 指标有单位/符号/方向，防止跨平台粗暴相加。 | platform/kind/provider/cohort统计与可解释评分未实现；真实校准留G。 | 6/G |
| P2-08 增量分析 | 目标尚未实现 | 旧Reddit派生jobs存在。 | 公共内容/日期dirty投影、迟到更新和有界增量分析未迁移。 | 6 |
| P2-09 保存与收藏 | 部分完成 | 旧target/compare series/overlay恢复已修。 | 公共content筛选保存、删除/管理Saved、内容收藏/注释未实现。 | 5A |
| P2-10 查询性能 | 目标尚未实现 | 2207条合成SQL正确性验证已有。 | 未做代表规模EXPLAIN/P95/RSS/DB/WAL预算；正确性样本不是性能验收。 | 4C |
| P2-11 接口与 Web 开销 | 部分完成 | 内容/导出有界；来源任务详情已按打开状态控制轮询。 | 来源/任务长历史分页、摘要详情分离、浏览器后台页poll控制、多次统计读取开销欠缺。 | 4C/5A |
| P2-12 保留与容量 | 部分完成 | 旧三类表有界prune已有。 | 新observation/job/usage/heartbeat保留与容量未闭环，当前月usage/活动checkpoint不可盲删。 | 4C |
| P2-13 界面与无障碍 | 部分完成 | 关键新流程错误/禁用/重试、role与390px已测。 | 全角色完整导航/键盘焦点/图表替代数据/旧页面仍未整体验收。 | 伴随4/5/6 |
| P2-14 国际化与时区 | 部分完成 | 新页面双语与UTC日桶已有。 | 旧硬编码文案、统一指标翻译/日期、跨零点DST边界系统验收未完成。 | 伴随4/5/6 |
| P2-15 管理草稿 | 部分完成 | 4B OpsTargets 草稿/取消/冲突与部分 CAS 仓储已写，合成 UI 专项通过。 | target/source/budget 全栈 CAS、bulk 原子冲突、SPA 提示与 035 并发已验。 | 4B/5A |
| P2-16 账号切换与缓存 | 部分完成 | 4B auth epoch/abort/401 清缓存、Saved 用户 key 和草稿重挂已写；合成专项通过。 | 实际账户 HTTP/PG 串联与最终独立构建已验。 | 4B |
| P2-17 契约与 schema 版本 | 部分完成 | SQL checksum、growth/planner/X/web identity标记已有。 | 公用API/capability/metric定义版本与旧观测解释/compat政策缺。 | 5B/6 |
| P2-18 算法校准 | 目标尚未实现 | 旧算法及解释字段存在，v2差分语义已修。 | 冻结代表样本、敏感性/误报漏报与真实校准未开展。 | 6/G |
| P2-19 provider 质量与成本 | 待真实验收 | 错误、reservation与登记耗时可离线查。 | provider覆盖/遗漏/实际延迟/空页重复费用需真实样本/合同账单。 | G |
| P2-20 数据治理与可移植配置 | 部分完成 | 内容export、来源证据、secret/output忽略已做。 | 来源配置无秘密导入导出、删除传播、政策与跨机恢复尚未闭合。 | 4C/5B |
| P3-01 Instagram 候选 | 需求确认后推进 | 未建立该产品能力；已有基础模块不等于该目标实现。 | 按原需求条件评估；不因路线图存在自动实施。 | 需求确认后 |
| P3-02 语义检索 | 需求确认后推进 | 未建立该产品能力；已有基础模块不等于该目标实现。 | 按原需求条件评估；不因路线图存在自动实施。 | 需求确认后 |
| P3-03 AI 摘要 | 需求确认后推进 | 未建立该产品能力；已有基础模块不等于该目标实现。 | 按原需求条件评估；不因路线图存在自动实施。 | 需求确认后 |
| P3-04 事件与去重 | 需求确认后推进 | 未建立该产品能力；已有基础模块不等于该目标实现。 | 按原需求条件评估；不因路线图存在自动实施。 | 需求确认后 |
| P3-05 通知与摘要订阅 | 需求确认后推进 | 未建立该产品能力；已有基础模块不等于该目标实现。 | 按原需求条件评估；不因路线图存在自动实施。 | 需求确认后 |
| P3-06 个性化推荐 | 需求确认后推进 | 未建立该产品能力；已有基础模块不等于该目标实现。 | 按原需求条件评估；不因路线图存在自动实施。 | 需求确认后 |
| P3-07 多人协作产品 | 需求确认后推进 | 未建立该产品能力；已有基础模块不等于该目标实现。 | 按原需求条件评估；不因路线图存在自动实施。 | 需求确认后 |
| P3-08 扩容与外部集成 | 需求确认后推进 | 未建立该产品能力；已有基础模块不等于该目标实现。 | 按原需求条件评估；不因路线图存在自动实施。 | 需求确认后 |

## 修改文件与证据

- 4A 完整路径以 `git diff --name-only 2eab855 local-phase4a-v0.5.0` 为准；核心变化包括 collection-execution-policy/environment-config/source-readiness、来源 service/repository/033、Target 读取模型与图表、CI/本机工具/门禁及对应回归。独立快照报告 `output/validation/phase-4a-snapshot-verification.json`，SQL 与构建原始日志为 `phase-4a-snapshot-*.txt`。
- 4B 完整路径以 `git diff --name-only local-phase4a-v0.5.0 local-phase4b-wip-single-agent-20261013` 为准；账户 service/实体/仓储/政策、auth use-cases/password hashing/034、App/AuthContext/client/Saved/Account/OpsAudit/OpsUsers/OpsTargets、source/target CAS 仓储/路由/035、HTTP 类型和专项测试历史 WIP 已保留；正式 4B 以 local-phase4b-v0.6.0 为准。公共文件已按 A/B 分开快照，不能把两阶段测试混用。
- 4B 证据：`output/validation/phase4b-account-security-unit.txt`、`phase4b-account-security-postgres.txt`、`4b-cas-typecheck-progress.txt`；合成账户 UI 为 `output/playwright/phase4b-account-security-evidence.json` 及 `phase4b-account-mobile.png`。红测在 `tests/integration/api-server-write-security.test.ts`；035 已在隔离库完成迁移与并发验证。

阶段 1–3 的文件与历史证据保留如下：

- 公共契约：[source-content.ts](../packages/contracts/src/source-content.ts)。后台主要为 source-content service/repository、provider interface、Arctic/X/demo connector、source worker、共享 web identity；旧关键词/增长/质量阈值路径同时修正。
- 数据库新增 030 来源生命周期、031 X 注册、032 请求观测；原迁移 checksum 保持。旧 PostgresContent upsert 保护公共规范字段，run-migrations 保证事务/并发锁。
- API 为 source-content-routes、create-api-server、saved-view-route 与环境加载入口；Web 为图表/URL/Saved/Compare/TargetDetail、Content 与四个管理/导出组件及旧分析范围说明。
- 本地工具为 scripts/local-dev.mjs、seed-local-demo.ts、backfill-post-search-index.ts、三套 smoke 脚本；相应离线/权限/native SQL 测试覆盖真实语义边界。正式文档八份按原职责更新。
- 完整阶段文件列表可用 `git diff --name-only abd24f5 local-phase3-v0.4.0`，最初基线完整对照用 `git diff --name-only cd920c5 local-phase3-v0.4.0`；原始证据只在忽略目录。final-stage3-offline-tests.txt、final-postgres-tests.txt、final-stage3-build.txt 与各专题报告在 output/validation/，合成 UI 与本机流程在 output/playwright/ 和 output/local-dev/smoke-evidence.json。

## 本地验证与接续

稳定入口为 `npm run local:start`，地址/进程看 `local:status`，owner 凭证看 `local:account`；进入 `/content` 可查询 Reddit/X 合成数据与管理来源。4B 已验，后续开发继续保留分阶段边界。首次其他机器需要完整 PostgreSQL bin 和 Node/npm 依赖，流程统一在 [开发说明](development.md)。`smoke:local` 写入有界合成 E2E 来源后归档，不运行真实 provider；所有本轮测试禁止真实数据源。

恢复后的顺序为并行准备、顺序验收 4C→5A→5B，4A 已有独立交付；依赖与验收出口见产品计划。用户已重新授权推进。G 中 AS 需用户另行授权真实请求，X 还需私有凭证/费用上限，目前均不执行。

前端目前存在旧/新分析入口并列和信息密度问题，但新增来源/任务/预算/导出流程均可运行且桌面/390px 已验收，没有必须开始大规模前端改造的功能阻碍。后续可以根据实际使用反馈评估默认入口与导航调整，当前不启动重设计计划。

4C 证据：phase-4c-snapshot-verification.json、phase4c-recovery-native.txt、phase4c-performance-20000.json、阶段4C冻结副本内580文件 release-manifest.json。保留只预览不删除；备份工具未切业务连接；发布文件未签名或上线。实际规则、备份频率、生产RPO/RTO和大规模冷/并发负载待确认。
