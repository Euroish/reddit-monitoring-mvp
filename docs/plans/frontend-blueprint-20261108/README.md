# 前端重构与研究功能扩展蓝本

基线日期 2026-11-08，整理/设计日期 2026-11-09。使用当前本地工作树 `codex/real-data-preparation@34b156c`，包含未提交的归档导入与采集故障策略成果；没有重新同步远端或合并 dev/root。版本仍为 0.9.1。本文与同目录资产共同作为后续前端重构、接口补充和研究工作流讨论的核心文件，不作为功能已上线的声明。

## 从哪里开始

- [设计包入口](index.html)：原型、图集、文档导航。
- [独立交互原型](prototype/index.html)：14 个工作区，深浅主题、中英文、身份和场景控制、请求响应检查。
- [总体运行架构](diagrams/system.html)：浏览器/API/worker/connector/数据库/CLI 的整体关系。
- [功能依赖图集](diagrams/index.html)：39 个功能组的 UI→权限→接口→服务→存储，支持检索与优先级筛选，逐项下载 SVG。
- [接口核对](INTERFACES.md)：111 项注册表记录、请求/返回契约与源码定位；[机器可读目录](data/catalog.json) 是图集、原型和接口目录的共同来源。
- [设计说明](DESIGN.md)：信息架构、状态、角色和具体演示流程。
- [验证与验收边界](ACCEPTANCE.md)：已经执行和待执行的检查，不混淆静态检查、浏览器验证与正式系统验收。

## 当前系统如何运作

当前应用是 React/Vite 前端、TypeScript 模块化单体 API 与独立 worker、PostgreSQL。浏览器只调用 HTTP，不持有数据库凭证；API 负责认证、解析、用例和读模型，worker 领取有租约的采集任务，connector 将上游记录规范化后复用共享写入流程。本地管理 CLI 使用独立操作员上下文，不能因网页 owner 身份自动获得文件系统/数据库权限。

内容身份由 `platform + kind + externalId` 决定。同一身份经 API 与归档重复发现，仍是一个 content；来源发现关系与指标/正文观测分开保留。内容、discovery、observation 与检索投影通过共享写入路径维护；采集页的提交、检查点和任务进度保持一致。幂等回放不应复制出新的独立内容。每来源最新观测不等于完整历史时间序列。

来源的配置、内容、采集任务和研究对象不能混为一张表或一个“搜索”动作。暂停/归档来源停止未来采集与活动任务，保留已有内容；检索已存数据无需上游在线。源观测时间、抓取时间、发布时间分别展示。部分窗口、超时、预算停止不能推进“已完整覆盖”的高水位。

研究资产分四层：保存查询只固定条件；个人注释/收藏保存判断；冻结导出固定成员与当时证据；拟新增数据集把样本成员、用途、选集/导入证据和版本显式管理。项目附件需要固定具体数据集版本，不能随新采集或新版本悄悄改变分母。

关键流程可单独查看：[检索与冻结](diagrams/search-freeze.svg)、[采集与合并](diagrams/collection-merge.svg)、[权限边界](diagrams/access-control.svg)、[任务生命周期](diagrams/job-lifecycle.svg)。四张流程图为代码事实与未来接口的讨论视图；具体既有行为以接口源码为准。

## 实现事实与设计边界

| 层次 | 依据与当前边界 | 对前端的影响 |
| --- | --- | --- |
| 当前代码 | 现有 `/v1/content`、个人查询/注释、冻结研究导出、来源/任务/预算、认证/账户、旧读模型 | 可以渐进重构；保留现有契约和业务语义 |
| 本地未提交成果 | 有界归档 CLI、只读 dump provider、041 回执与合并测试；详见状态文件 | 不伪装为已合并 main 或已部署功能 |
| 其他分支成果 | E0 详情性能优化、Bluesky 等最后远端核对为 2026-10-26 | 先核对并复用，不重复实现；本包未做远端新审计 |
| P0–P2 设计 | N01–N32 等新接口（含优质内容智能推荐 N30、跨品牌痛点证据矩阵 N31、Agent结构化简报 N32），以及主题/布局与新的研究信息架构 | 标明“设计”，需要 DTO、迁移、权限、性能和真实集成验收 |
| 本包模拟 | 60 条合成内容、10 来源、2 初始数据集，不读取真实数据库 | 只验证交互逻辑与设计口径，不能证明容量、上游完整性或生产安全性 |

此前本地真实样本最终 128,177 条、37,028 来源，最终规模详情/工作台延迟未达预设目标，最终规模 5/10 并发未验收。该历史证据解释 P0 的必要性，不是本次新执行的测试，也不能把原型快速响应当作这些问题已解决。

## 全功能依赖索引

下表由目录构建。`current` 为当前能力；`partial` 为部分具备；`branch-ready` 为其他分支已有成果但未整合；`proposed` 为候选设计。优先级与实现状态是两个维度，不把“P0”理解为已经完成。图集中每项包含具体接口、服务和存储对象。

<!-- FEATURE_MATRIX -->

| 功能 | 优先级 / 状态 | 工作区 | 接口 | 依赖 |
| --- | --- | --- | --- | --- |
| [F01 工作台外壳、主题与中英文](diagrams/features/F01.svg) | P0 / partial | overview | UI01 | — |
| [F02 登录、邀请注册与账户状态](diagrams/features/F02.svg) | current / implemented | account | A01, A02, A03, A04 | — |
| [F03 密码、会话与撤销](diagrams/features/F03.svg) | current / implemented | account | A10, A11, A12, A13 | F02 |
| [F04 已存内容检索、筛选与分页](diagrams/features/F04.svg) | current / implemented | explore | C01 | F02 |
| [F05 同口径统计、趋势与优质推荐](diagrams/features/F05.svg) | current / implemented | overview | C02, C03, N30 | F04 |
| [F06 详情、作者、正文与媒体](diagrams/features/F06.svg) | current / implemented | explore | C04 | F04 |
| [F07 已存父链与有界回复](diagrams/features/F07.svg) | current / implemented | explore | C04 | F06 |
| [F08 跨渠道身份合并与独立观测](diagrams/features/F08.svg) | current / implemented | observations | C04 | F06 |
| [F09 个人保存查询及版本冲突](diagrams/features/F09.svg) | current / implemented | research | P01, P02, P03, P04 | F02, F04 |
| [F10 个人收藏、注释与隔离](diagrams/features/F10.svg) | current / implemented | research | P05, P06, P07, P08 | F02, F06 |
| [F11 即时有界导出与续页](diagrams/features/F11.svg) | current / implemented | explore | C05 | F04 |
| [F12 冻结研究样本、manifest及分段](diagrams/features/F12.svg) | current / implemented | research | R01, R02, R03, R04, R05, R06 | F04, F02 |
| [F13 来源注册、配置与能力](diagrams/features/F13.svg) | current / implemented | sources | S01, S02, S03 | F02 |
| [F14 来源生命周期、计划与成熟刷新](diagrams/features/F14.svg) | current / implemented | sources | S03, S04, S05, S06 | F13 |
| [F15 有界采集、预算与租约](diagrams/features/F15.svg) | current / implemented | tasks | J01, J02, J03 | F13, F14 |
| [F16 任务取消、重试与继续](diagrams/features/F16.svg) | current / implemented | tasks | J04, J05, J06 | F15 |
| [F17 Worker、队列与独立provider预算](diagrams/features/F17.svg) | current / implemented | tasks | J07, J08 | F15 |
| [F18 离线抽样与归档导入回执](diagrams/features/F18.svg) | current / implemented | datasets | CLI01 | F08 |
| [F19 用户角色、启用与Owner保护](diagrams/features/F19.svg) | current / implemented | admin | A05, A07, A08, A09 | F02 |
| [F20 邀请码与待激活注册](diagrams/features/F20.svg) | current / implemented | admin | A06, A04 | F19 |
| [F21 操作审计](diagrams/features/F21.svg) | current / implemented | admin | O01 | F19 |
| [F22 健康、就绪与存储诊断](diagrams/features/F22.svg) | current / implemented | admin | O02, O03, O04, O05 | F19 |
| [F23 保留预览与有界清理](diagrams/features/F23.svg) | current / legacy | admin | L20, L21, L22, L23 | F22 |
| [F24 旧市场、榜单与目标详情](diagrams/features/F24.svg) | current / legacy | legacy | L01, L02, L03, L04, L24, L25, L26, L27 | F02 |
| [F25 旧关键词会话与Phase1运行](diagrams/features/F25.svg) | current / legacy | legacy | L09, L10, L11, L12 | F24 |
| [F26 旧对比与保存视图](diagrams/features/F26.svg) | current / legacy | legacy | L05, L06, L07 | F24 |
| [F27 旧目标批量管理与调度设置](diagrams/features/F27.svg) | current / legacy | legacy | L13, L14, L15, L16, L17, L18, L19 | F24 |
| [F28 来源分页检索及精简选项](diagrams/features/F28.svg) | P0 / proposed | sources | N01, N02 | F13 |
| [F29 详情关联来源批量读取](diagrams/features/F29.svg) | P0 / branch-ready | explore | C04 | F06 |
| [F30 明确刷新、错误、分母和交互层次](diagrams/features/F30.svg) | P0 / proposed | explore | C01, C03, UI01 | F04, F05 |
| [F31 数据集、批次、成员与导入预览](diagrams/features/F31.svg) | P1 / proposed | datasets | N03, N04, N05, N06, N07, N08, N09, N10, N11 | F18, F12 |
| [F32 社区日期聚合、品牌痛点与Agent简报](diagrams/features/F32.svg) | P1 / proposed | analysis | N12, N32 | F31, F05 |
| [F33 观测时间线、差异及冲突提示](diagrams/features/F33.svg) | P1 / proposed | observations | N13, N14 | F08 |
| [F34 研究标签与批量归类](diagrams/features/F34.svg) | P1 / proposed | labels | N15, N16, N17 | F10, F31 |
| [F35 长文阅读与移动高级筛选](diagrams/features/F35.svg) | P1 / proposed | explore | C04, UI01 | F06, F30 |
| [F36 多品牌维度对比矩阵与结果集A/B对比](diagrams/features/F36.svg) | P2 / proposed | compare | N18, N19, N31 | F12, F31, F32 |
| [F37 诊断、缩窗计划与有界恢复](diagrams/features/F37.svg) | P2 / proposed | tasks | N20, N21 | F15, F16, F17 |
| [F38 项目、数据集共享与权限](diagrams/features/F38.svg) | P2 / proposed | projects | N22, N23, N24, N25, N26 | F19, F31 |
| [F39 代码本、多人与复核分歧](diagrams/features/F39.svg) | P2 / proposed | projects | N27, N28, N29 | F34, F38 |

<!-- /FEATURE_MATRIX -->

## 实施顺序与切片

| 顺序 | 交付内容 | 接口与依赖 | 验收重点 |
| --- | --- | --- | --- |
| P0-1 | 明确检索/采集边界、统计分母、加载/错误/权限状态；高级筛选折叠；来源按需查询 | F01/F28/F30；C01–C04、N01/N02；不先加载无分页 S01 全目录 | 37k 来源场景的 DOM/首屏/保存重开；移动端首条结果位置；筛选列表统计一致 |
| P0-2 | 整合 E0 详情优化、最小字段列表和相关内容边界 | F29；复用现成分支成果，保持 C04 DTO | 最终样本详情/工作台 P95 回归，先单并发，达标后再 5/10 并发；不放宽门槛 |
| P1-1 | 数据集、导入回执可读、固定成员/版本 | F31；N03–N11；复用当前 CLI/041，不开放任意路径 | 预检与 apply 同文件摘要；幂等回放、新旧成员/缺失/拒绝统计对账；归属与版本隔离 |
| P1-2 | 有界聚合、历史观测、长文阅读和个人标签 | F32–F35；N12–N17；先明确观测选择、单位与未知处理 | 社区/UTC 日期可钻取；部分索引有警示；同快照非增长；批量冲突逐项返回 |
| P2-1 | A/B 范围比较和失败窗口恢复计划 | F36/F37；N18–N21，依赖固定样本与当前预算/租约 | 集合计数身份去重；时间/覆盖差异披露；恢复预算上界、过期/冲突计划、无无限重试 |
| P2-2 | 项目共享、标注手册与双人复核 | F38/F39；N22–N29，依赖数据集/标签版本 | 项目 ACL 与系统角色分离、最后 manager 保护、共享确认、审计；独立人工金标另行建设 |

不建议本阶段优先实现跨平台统一“热度分”、自动推断因果、全站无限抓取/完整评论树或先搭通用 connector 框架。不同平台指标单位与采集覆盖不可直接合并；这些方向成本高，且当前研究与前端瓶颈尚未解决。LLM 辅助主题解释可以后续验证，但要保留原文证据、模型/提示版本与人工检查，不能替代可复现聚合。

实施应沿 connector→共享写入→读模型→API→UI 做最小可验证切片。新增数据库对象使用新迁移，不修改已应用 SQL。先整合当前分支已有成果，再补研究模型；每个阶段有自己的离线、真实来源、部署验证，不能相互替代。

## 权限矩阵

| 能力 | owner | admin | viewer | machine |
| --- | --- | --- | --- | --- |
| 已存内容、来源/任务/预算只读（当前source路由） | 是 | 是 | 是 | 是 |
| 来源/任务/预算写 | 是 | 是 | 否 | 授权bearer可 |
| 自己的查询、注释、冻结导出 | 是 | 是 | 是 | 否，需用户会话 |
| 用户列表/邀请 | 是 | 是（邀请viewer） | 否 | 授权bearer可 |
| 更改全局角色 | 有目标保护 | 否 | 否 | 有目标保护 |
| 账户状态 | 有目标保护 | 仅viewer目标 | 否 | 有目标保护 |
| 审计/敏感运行诊断 | 会话可 | 会话可 | 否 | 否 |
| P2项目编辑/管理 | 由项目角色判断 | 由项目角色判断 | 由项目角色判断 | 否 |

pending/disabled 或过期会话不能继续访问受保护数据。不能停用/降低自己的访问，不能移除最后一名有效 owner。local-operator 单独授权，不列在人类角色里。前端隐藏/禁用只改善体验，真正权限必须由正式 API 再次强制检查。

## 交接与变更方式

编辑本目录的源文件后运行 `python docs/plans/frontend-blueprint-20261108/build.py` 和 `node docs/plans/frontend-blueprint-20261108/verify.cjs`，再执行 `npm run docs:check`。接口源码变化后先重新核对目录生成器与证据，不机械覆盖旧事实。`build_catalog.py` 保存源码定位与摘要；`package-manifest.json` 保存交付包文件摘要。生成 HTML/SVG 是用户明确要求的可版本化设计资产；运行截图/日志仍放 `output/`。

本次不提交或推送，不改变正式应用入口。讨论确认设计后再按 P0/P1/P2 切独立开发分支和小 PR；验收 API、迁移与前端同一纵向切片，避免先做一套无法落地的正式 UI。
