# 当前状态与下一步

核对日期：2026-10-12。阶段 1–3 已交付约定的软件闭环，当前软件基线 e88ca2e / v0.4.0；这不代表最初 cd920c5 基线审计的 60 项目标全部完成。R2 逐项修订见 [交接](handoff.md)，后续顺序见 [产品计划](README.md)。真实接入验收按用户明确要求保留，过程见 [开发日志](development-log.md)，运行方式见 [开发说明](development.md)。

## 当前可交付

- Windows 本地独立工作区、个人功能分支 `codex/arctic-shift-content-query`。已保存阶段本地提交和标签，未 push、force push、修改 main、删分支或合并 PR。
- 阶段 1：17 项既有失败已归因修复；默认 new-listing 不隐式追加 discovery，显式 opt-in 保留能力，质量阈值恢复既有契约。旧目标关键词按已索引保留片段的完整同范围计数、独立限量样本，支持中文字面、英文边界/复数和排除词；旧 collector 写入维护索引，历史缺失/变化行通过有界 CLI 回填，查询不重建索引。新 Arctic/X 页提交尚未建立公共检索投影。
- 图表按日期并集合并、缺失保留 null，修复空→有→空生命周期、最新指标日期匹配；比较保存受控 UI URL并恢复系列/范围/隐藏 overlay，错误提示与移动端遮挡修复。增长 v2 使用实际相邻观测差分，单快照/缺指标不生成增长，历史 v1 保留但不进入实测 driver/增长异常。
- Windows `local:setup/start/stop/status/account` 创建独立 PostgreSQL、owner 与标记合成样本，复制完整运行库，不依赖旧项目路径；检查端口、进程身份、loopback API/DB、代理，重复启动复用进程，停止/重启保留数据。迁移 pinned transaction/advisory lock 保证 DDL 与 checksum 账本原子提交。
- 阶段 2：来源标签/分组/生命周期、周期增量窗口与持久化高水位、重叠去重、checkpoint 子任务、暂停/归档取消 token、任务历史/筛选/取消/重试/继续、成熟归档 ID 刷新、每日/月度预算与 worker 心跳已沿契约→仓储→API→UI接通。付费 provider 默认 disabled/0，保守 resources 预留与实际计费分开。
- 阶段 3：TwitterAPI.io 账号、搜索、ID adapter 与 X 注册迁移；大整数 ID 字符串、标题/作者/时间可空、媒体/引用/线程与六类指标、端点响应 schema、分页/限流/abort 有离线验证。新公共来源 runtime 的 demo 模式注册 Reddit/X 合成 provider 并禁用真实 provider；X live 要 key/network/独立预算均满足才可请求。这个闸门尚未覆盖旧 Run 接口。
- 统一内容查询、同过滤总数/日桶/平台/provider 分布、JSON/CSV 2000 条有界导出与 cursor 续页；保留指标单位、观测时间和来源证据。CSV 防公式与数字 ID 精度丢失。web 命名空间身份工具防止不同站点相同 GUID 碰撞，尚无真实 web/Instagram adapter。
- 所有规范公共字段按观测时间单调更新；旧 PostgreSQL upsert 不覆盖已有公共标题/正文/URL/发布时间。032 记录已登记 provider 调用与取页/解析耗时，取消/租约丢失可能拒绝晚到登记，不能当数据商账单。
- 前端保留整体结构，补来源设置、任务、预算、统计/导出和双语范围说明。旧市场榜单只在前 50 热度候选内排序，旧词项查询与公共字面检索语义分开；未发现必须大规模重设计的功能阻碍。

## 阶段 1–3 既有验证结果

| 验证 | 既有交付结果与范围，R2 没有重跑 |
| --- | --- |
| 接手基线 cd920c5 | 331 项：314 pass / 17 fail |
| 阶段 1 独立快照 | 365 项：362 pass / 0 fail / 3 个 SQL 默认 skip；typecheck/API/Web 构建通过 |
| 阶段 2 交付快照 0.3.1 | 386 项：382 pass / 0 fail / 4 个 SQL 默认 skip；构建通过。0.3.0 的漏项失败保留在日志 |
| 最终 0.4.0 全量离线 | 407 项：400 pass / 0 fail / 7 个 SQL 默认 skip |
| 七项隔离 PostgreSQL | 7 pass / 0 fail / 0 skip；含 2207 合成帖子的完整查询、原子页/幂等/异构字段、周期/预算/取消、迁移并发/回滚、X 多发现、旧写保护和计时 |
| 项目迁移 | 新隔离库全部 34 个 SQL 应用成功，重复运行无新增；未改已应用 SQL |
| UI 合成 API Chromium | 图表/保存恢复、来源/任务/预算/权限/导出、双语说明及 390px；外部请求 0、页面错误 0 |
| 真实本地合成闭环 | 实际前端登录→API→worker→独立 PostgreSQL→手动/周期/续采→归档→工作台→Reddit/X 查询与浏览器 JSON/CSV 下载；完整 stop/start 后数据保留；真实来源请求 0 |
| 静态与构建 | typecheck、Web lint、API/Web build、compiled smoke、docs:check（八份）、diff check 通过 |

证据位于忽略的 `output/validation/`、`output/playwright/`、`output/local-dev/`；不提交密钥、账号凭证、数据或报告。此前 Arctic Shift 两条真实样本属于更早的数据源研究，不属于阶段 1–3 验收或 R2 重测。R2 只做源码、文档和报告检查。

## R2 复核：下一轮先解决

- 调度候选在 SQL 中先取前 20 个，再在应用侧筛选刷新 eligible 内容。前 20 个为空刷新来源时，后面的到期来源可能持续得不到机会；这是静态推导，尚未运行复现。先以 21/100 个混合来源夹具证明并修复，同时明确近期采集/历史回填公平与迟到覆盖策略。
- 旧 TargetDetail 的零值 fallback 会在首次发现采样窗与最新单日发布时间桶之间取值；读取模型又默认缺失采样为 []。先定义 availability、分母和时间基础，再验证真实 0、未知与非 0，不能直接把所有 `||` 换成 `??`。
- 旧 Run 允许请求 mode 覆盖环境，旧 connector 工厂不读取 `SOURCE_NETWORK_ENABLED`，正式环境 mock 写入也缺入口限制。需统一新旧执行闸门；本轮只检查分支，没有触发旧 live 请求或写入。
- 公共内容尚无详情页面、URL/保存查询、共同检索投影与新分析桶；默认与登录入口仍为旧 markets。基础内容统计、有界即时导出不等于统一分析或冻结研究数据集；媒体/引用字段已有也不等于完整展示。
- 新来源心跳/队列没有并入旧 readiness；新表容量/保留、账号会话撤销与操作审计、完整 CI/恢复演练尚未闭合。现有迁移锁与 Windows 启动工具已经实现，不再重复列为缺失。

## 明确保留的边界

- 本轮没有真实 Arctic Shift/Reddit/X 采集、付费试跑、48–72 小时真实新鲜度验收、公网部署或生产迁移。72 小时模拟只证明逻辑；成功取回/最新已存发布时间不能证明上游实际延迟或达成 12 小时目标。
- 自动成熟刷新仅 archive 的 initial 观测；X snapshot 不套用成熟规则，ID refresh 为 adapter 能力，尚无自动快照指标刷新。旧热度/榜单仍用旧 Reddit 模型，没有迁移至公共观测。
- 列表与统计分母是已采集样本；provider 多发现计数可重叠，不相加；跨平台指标不合并热度。导出分页与统计不是冻结 SQL 快照，并发更新可能改变后续页/分母。
- 新表保留策略、代表规模负载/容量、公开上线与后续高级分析仍属下一阶段。当前不预设新增微服务、搜索集群或大型前端改造。
