# 阶段交接与交付状态

用户原授权阶段 1、2、3 及后续 4A、4B、4C、5A、5B；2026-10-13 停止交接已保存，随后用户明确恢复并重新授权尽量并行。4B/4C/5A已分阶段交付，5B最终独立495离线/30 SQL与实际本地34请求闭环通过；原WIP历史与初始cd920c5基线保留。本文件维护阶段版本、实际范围、验证边界与接续步骤；过程见 [开发日志](development-log.md)，操作见 [开发说明](development.md)。

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

| 0.8.0（阶段5A交付） | 内容详情/高级与URL筛选、保存查询、收藏注释与媒体预览 | local-phase5a-v0.8.0；471离线/27 SQL零skip；80请求合成UI与35请求实际PG内容闭环通过 |

| 0.9.0（阶段5B交付） | 公共检索/索引、覆盖、冻结研究/manifest/有界下载 | local-phase5b-v0.9.0；495离线/30SQL零skip；205并发与32MiB预检、91请求合成UI及34请求实际PG冻结104成员通过 |

## 当前分工与接续

个人分支保持 `codex/arctic-shift-content-query`，复工基线 `3db313e` 工作区干净；停止 WIP 与 4A、4B 交付版本分开保存。4B 已收口为 0.6.0 软件交付：账户 HTTP、角色权限、持久化脱敏审计、来源/预算/目标 revision CAS、批量原子冲突和账号缓存/草稿隔离已贯通。独立冻结版本通过 455/455 离线、24/24 隔离 SQL、类型/构建/lint/compiled/docs；实际 localhost 浏览器→API→新合成 PG 验证改密再认证、旧会话拒绝、A/B Saved 隔离和撤销全部会话，18 个 API 请求、外部请求/页面错误均为 0。复用已安装依赖，云端 CI、清洁安装、生产部署和真实 provider 未验。

三个子代理滚动分配：phase1_data 负责 Web 5A 工作流，phase2_sources 负责 5A 内容后台及 5B 公共索引，auth_api_4b 负责 5B 冻结研究导出，root 负责集成、4C 运维、独立验收与版本。4C/5A已交付，5B已完成最终独立软件验收，当前收尾发布产物与本机效果验证，不把并行准备作为交付。033/034/035 仅隔离库验证，本机开发库和生产库未升级。

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
| P0-01 测试正确性 | 已完成限定软件目标 | 原17失败修复，1–3与4A–5A各版本独立测试已验；5B495离线/30SQL全通过。 | 清洁安装与云CI不冒充已执行；真实来源另验。 | 维持 |
| P0-02 图表正确性 | 已完成限定软件目标 | 曲线与overlay按日期并集对齐，缺值null。 | 维持不同起点/缺日/乱序回归。 | 维持 |
| P0-03 图表生命周期 | 已完成限定软件目标 | 空→有→空→有生命周期与移动遮挡已修并有合成浏览器证据。 | 新图表沿用相同生命周期回归。 | 维持 |
| P0-04 保存视图 | 已完成限定软件目标 | 目标/比较受控保存URL、恢复series/overlay/range和失败反馈已完成。 | 公共content保存属P2-09，不能把此项完成扩大成全部收藏完成。 | 维持 |
| P0-05 统计口径 | 部分完成 | 公共列表/stats/导出同filter，4A采样窗/发布时间分开；5B实测候选/索引/正文覆盖。 | 旧被覆盖指标不能重建；公共分析迁移待6。 | 6 |
| P0-06 增长语义 | 已完成限定软件目标 | 旧增长v2由相邻真实记录观测差分产生；单快照/缺指标不算增长，v1不进实测driver。 | 新公共平台分析仍待P1-10/P2-07；不把归档成熟刷新当近期增长。 | 维持 |
| P0-07 数据解释 | 已完成限定软件目标 | 4A 保留 null/0/未知、窗口两端及 20,000 截断下界，图表按发布时间桶；新旧范围/合成标识已有。 | 新公共分析仍未迁移，旧历史指标重建不支持。 | 6 |
| P0-08 环境隔离 | 已完成限定软件目标 | 4A 共用网络/mode 政策覆盖新旧 API、worker/use-case/CLI/factory，非法请求在写入前拒绝。 | production/部署及真实来源另验。 | G/发布门槛 |
| P0-09 公网安全 | 部分完成 | 4B已完成专用socket IP限流、随机邀请码、Origin/CORS/header白名单、角色与会话；readyz代码已有。 | 真实公网TLS、反代和部署环境独立验收。 | 发布门槛 |
| P0-10 迁移可靠性 | 部分完成 | 迁移事务锁、DDL/checksum原子性、并发/失败回滚测试已实现。 | 合成完整恢复已验；真实旧库副本升级、较大库锁时长与发布故障恢复尚未验收；不能再称缺迁移锁。 | 4C |
| P1-01 来源管理 | 已完成限定软件目标 | 来源标签/group/state/schedule/refresh、暂停取消/归档与4B全栈CAS已完成。 | 目标身份固定，更换目标需新建。 | 维持 |
| P1-02 周期采集 | 部分完成 | 周期/高水位/overlap/catch-up/checkpoint；4A eligible 先筛、公平机会、recheck 和用途运行互斥已验。 | 有界回查不保证窗口外迟到或上游全量；真实持续新鲜度未验。 | G |
| P1-03 新鲜度验收 | 待真实验收 | 72h模拟和本机合成闭环通过。 | 48–72h真实可用性、遗漏/迟到、源延迟与≤12h目标尚未验收。 | G |
| P1-04 成熟指标 | 已完成限定软件目标 | Arctic/archive initial按年龄/次数/间隔有界ID成熟刷新及单独观测完成。 | 真实AS刷新效果待授权验收；X snapshot自动刷新不属于已完成archive能力。 | 维持/G |
| P1-05 任务操作 | 已完成限定软件目标 | 任务历史筛选、cancel/retry/continue、冲突和页计数完成。 | 长历史cursor分页可作P2-11增强；当前最多100条不等于完整归档浏览。 | 维持 |
| P1-06 工作量与费用 | 部分完成 | 日/月请求/资源预留、有限重试、默认付费0、预算唤醒；4A 请求间隔与公平调度已验。 | 货币预算与实际账单对账未完成；预留不是费用。 | G |
| P1-07 内容更新策略 | 部分完成 | 规范字段单调、旧写保护；5B索引按canonical RETURNING写、外部写失效/删除级联/重放验证。 | 真实provider删除信号与治理传播政策尚待确认。 | G/治理 |
| P1-08 研究导出 | 已完成限定软件目标 | 037 RR冻结全部匹配成员、固定total、来源/观测/单位版本manifest，20k/32MiB前置预算及原子保存。 | 范围是已存样本；不自动清理，用户删除snapshot会级联成员。 | 维持/治理 |
| P1-09 X 最小接入 | 软件已实现，真实验收待授权 | TwitterAPI.io账号/搜索/ID adapter、平台注册、闸门与合成闭环完成。 | 无key/预算/真实账号与检索、媒体/遗漏/延迟/账单验收。 | G |
| P1-10 统一工作台 | 部分完成 | 公共计数/分布及Content默认入口、查询→详情→保存/导出已通。 | 旧Markets/Target/Compare分析仍旧Reddit，质量/趋势/异常迁移待6。 | 6 |
| P1-11 多语言查询 | 已完成限定软件目标 | 公共v2 literal/terms/phrase/exclusions、scope、Unicode规范与真实覆盖已通。 | 旧OR/词界与provider搜索保留各自语义，不等同同契约。 | 维持 |
| P1-12 索引生成 | 已完成限定软件目标 | AS/X公共页提交同事务投影完整已存正文，更新/删除/重放、历史显式有界回填已验。 | 不补未采集正文、不运行全站搜索；失效返回partial/503。 | 维持 |
| P1-13 主入口与能力 UI | 已完成限定软件目标 | 默认/登录Content，保留Markets/比较；能力筛选、来源→内容→详情→保存/导出已通。 | 公共分析可视化另属6；目前不需整体重设计。 | 6 |
| P1-14 Windows 启停 | 已完成限定软件目标 | Windows local:*完整PG复制、cluster/PID身份、端口、owner/代理与重复启动/停启已验证。 | 部分setup失败、配置损坏与优雅stop为后续增强；无需重做启动器。 | 维持/4C |
| P1-15 环境配置 | 部分完成 | local env/demo/loopback；4A 严格校验、端口与代理预检、config-only 命令已验。 | 历史零散 POSIX 工具跨平台整理与生产配置另验。 | 4C/发布门槛 |
| P1-16 API 维护 | 部分完成 | 公共来源、账户、个人内容和研究路由独立handler，composition统一认证与审计。 | 旧分析/ops大handler尚集中，仅按功能改动迁移。 | 伴随各阶段 |
| P1-17 持续集成 | 部分完成 | 4A workflow 和零 skip offline/native SQL runner 已写，compiled 覆盖 source worker；本机独立快照门禁通过。 | 清洁重装与云端 workflow 未执行；4B 红测和类型失败已收口。 | 4B/发布门槛 |
| P1-18 来源运维 | 部分完成 | readyz队列/worker/近期失败与登记耗时；4C全public库存与保留只读预览。 | 完整延迟分布/长期覆盖与真实provider可用性待G。 | G |
| P1-19 真实验收测试 | 部分完成 | 离线API权限、原生SQL和合成UI、本机UI→API→worker→PG脚本完成。 | 完整邀请→pending→激活→账号切换→来源全流程尚未串联CI；真实源/部署另验。 | 4A/4B/G |
| P1-20 备份与发布 | 部分完成 | source worker模板、无秘密manifest/精确库存、合成dump/restore，5B恢复新个人/索引/冻结数据已验。 | 未实际部署/切库，生产旧库副本与故障恢复待验。 | 发布门槛 |
| P1-21 账号体验与权限 | 部分完成 | 4B改密/撤会话/角色/邀请/最后owner政策，实际HTTP/PG/浏览器通过。 | 邮件找回服务、公网与异常运营流程待需求。 | 需求/发布门槛 |
| P1-22 操作审计 | 已完成限定软件目标 | 持久intent、脱敏结果/分页/权限/UI与业务写贯通；不记录密码/query/note。 | 业务与审计非单事务，attempted/outcomeUnknown明确；保留仅预览。 | 维持 |
| P2-01 低成本补充来源 | 目标尚未实现 | web身份/字段准备与合成存储已有。 | RSS/feed/web真实adapter、URL/DNS/redirect约束与真实文章验收均无。 | 条件扩源 |
| P2-02 媒体 | 部分完成 | X媒体适配与公用media字段，AS外链已保存。 | 主动安全链接媒体预览/加载失败状态已验，真实provider媒体字段覆盖待G。 | 5A/G |
| P2-03 内容详情 | 已完成限定软件目标 | 详情API/UI、已存引用与children各20、关联跳转、缺失/未知字段解释。 | 不联网补线程，不保证全讨论或真实媒体。 | G |
| P2-04 高级筛选 | 已完成限定软件目标 | 作者/语言/来源group/指标/稳定发布时间排序/URL与登录恢复已验。 | 新业务筛选按需求。 | 维持 |
| P2-05 榜单范围 | 目标尚未实现 | 旧榜单范围前50已有明确说明。 | 服务端按指定排序全范围分页尚未实现；加说明没有修复漏榜。 | 6 |
| P2-06 主题组织 | 部分完成 | 来源group集合与多发现去重、个人收藏/注释已完成。 | 独立主题实体和活跃发布者分析尚无。 | 6/需求 |
| P2-07 跨平台指标 | 部分完成 | 指标有单位/符号/方向，防止跨平台粗暴相加。 | platform/kind/provider/cohort统计与可解释评分未实现；真实校准留G。 | 6/G |
| P2-08 增量分析 | 目标尚未实现 | 旧Reddit派生jobs存在。 | 公共内容/日期dirty投影、迟到更新和有界增量分析未迁移。 | 6 |
| P2-09 保存与收藏 | 已完成限定软件目标 | 公共query创建/重命名/删除/URL重开，个人收藏注释/冲突保稿与缓存隔离。 | 旧Saved视图的额外管理需求另确认。 | 维持 |
| P2-10 查询性能 | 部分完成 | 4C与5B分别有2万内容/4万观测EXPLAIN/P95/DB/WAL/客户端RSS证据。 | 本机暖缓存不是生产负载；繁忙窗口30s超时已保留；无并发PG窗口独跑通过，当前字面list/stats P95 138.580/625.340ms，生产SLO另验。 | 性能/部署 |
| P2-11 接口与 Web 开销 | 部分完成 | 内容/导出有界；来源任务详情已按打开状态控制轮询。 | 来源/任务长历史分页、摘要详情分离、浏览器后台页poll控制、多次统计读取开销欠缺。 | 4C/5A |
| P2-12 保留与容量 | 部分完成 | 全public表精确库存/大小，dry-run保护活动checkpoint/最新证据/UTC当月预算/未决审计；流量未知为null。 | 没有自动删除；预测只覆盖内容/观测，其余现有表显式排除，实际政策待确认。 | 运营政策 |
| P2-13 界面与无障碍 | 部分完成 | 关键新流程错误/禁用/重试、role与390px已测。 | 全角色完整导航/键盘焦点/图表替代数据/旧页面仍未整体验收。 | 伴随4/5/6 |
| P2-14 国际化与时区 | 部分完成 | 新页面双语与UTC日桶已有。 | 旧硬编码文案、统一指标翻译/日期、跨零点DST边界系统验收未完成。 | 伴随4/5/6 |
| P2-15 管理草稿 | 已完成限定软件目标 | source/budget/target revision、bulk全员原子CAS、409保稿、SPA后退与关闭提示。 | 未提供revision的兼容客户端仍可盲写；Web已携带版本。 | 维持 |
| P2-16 账号切换与缓存 | 已完成限定软件目标 | auth epoch/abort/401、个人缓存与草稿按user隔离、二进制下载账号切换闸门；实际账户PG/UI已验。 | 维持晚到响应与用户切换回归。 | 维持 |
| P2-17 契约与 schema 版本 | 部分完成 | SQL checksum、身份/growth/planner与研究manifest内容/查询/身份/指标选择版本已有。 | 所有旧API/capability的兼容迁移策略仍未统一。 | 6 |
| P2-18 算法校准 | 目标尚未实现 | 旧算法及解释字段存在，v2差分语义已修。 | 冻结代表样本、敏感性/误报漏报与真实校准未开展。 | 6/G |
| P2-19 provider 质量与成本 | 待真实验收 | 错误、reservation与登记耗时可离线查。 | provider覆盖/遗漏/实际延迟/空页重复费用需真实样本/合同账单。 | G |
| P2-20 数据治理与可移植配置 | 部分完成 | 规范导出/来源证据/秘密忽略，个人与冻结用户作用域、全库合成恢复。 | 跨机真实恢复、无秘密配置导入导出、provider删除治理政策待确认。 | 治理/发布 |
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

4A/4B/4C/5A已有独立交付，当前收口5B，4A 已有独立交付；依赖与验收出口见产品计划。用户已重新授权推进。G 中 AS 需用户另行授权真实请求，X 还需私有凭证/费用上限，目前均不执行。

前端目前存在旧/新分析入口并列和信息密度问题，但新增来源/任务/预算/导出流程均可运行且桌面/390px 已验收，没有必须开始大规模前端改造的功能阻碍。后续可以根据实际使用反馈评估默认入口与导航调整，当前不启动重设计计划。

4C 证据：phase-4c-snapshot-verification.json、phase4c-recovery-native.txt、phase4c-performance-20000.json、阶段4C冻结副本内580文件 release-manifest.json。保留只预览不删除；备份工具未切业务连接；发布文件未签名或上线。实际规则、备份频率、生产RPO/RTO和大规模冷/并发负载待确认。

5A证据 phase-5a-snapshot-verification.json、phase5a-real-content-local.json、phase5a-content-workflow-evidence.json/桌面与中文390px截图。036 SHA256 45AE4B5CDAA4D305A35BE1A88AED599D9E29F7F561877E9F328E79DA47FA5BFC，仅新隔离库验证，不改应用SQL。5A代码冻结后5B同路径变更保留工作树，通过Git blob分别保存版本。

5B完整文件列表：`git diff --name-only local-phase5a-v0.8.0 local-phase5b-v0.9.0`；本轮4A–5B路径：`git diff --name-only local-phase3-v0.4.0 local-phase5b-v0.9.0`。阶段文件/测试/版本汇总另放忽略的output/validation交付报告，不新增正式文档。5B证据phase-5b-snapshot-verification.json、phase5b-real-research-local-final.json、phase5b-expanded-recovery-native-final.txt、phase5b-research-export-native.txt及合成UI91请求/205成员报告。038 SHA256 BB465D92270490C17E90EACAFB9A496B86A80F3779560AFAFC8BCD7EFF7207D5；相对0.4.0原SQL无修改，只增033–038。

后续按原基线继续6（公共日期桶、平台内可比观测、完整范围榜单）与待授权G；当前没有X key/预算，真实provider仍不运行。治理需要明确保留时长/备份频率/RPO/RTO、provider删除与snapshot政策；公网部署、清洁安装、云CI、实际旧库副本升级独立验收。没有自动数据清理，不启动整体前端重设计。

最终0.9.0性能使用phase5b-performance-20000-final.json（原30s超时不放宽复跑成功），前版P95只作历史证据。当前管理演示已升级40个SQL并保留既有账号/业务数据，API28060/Web28061/worker运行，入口看local:status。管理员初次升级需显式公共回填，否则旧范围文本query503；这次开发库已执行有界回填，真实provider默认禁用。
