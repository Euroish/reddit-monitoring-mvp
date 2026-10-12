# 当前状态与下一步

核对日期：2026-10-12。当前按用户授权推进阶段 1–3；各阶段版本和交接见 [交接](handoff.md)，过程见 [开发日志](development-log.md)。本轮明确不执行真实数据源接入测试。

## 当前已实行

- Windows 本地独立工作区 `D:\Projects\reddit-monitoring-mvp`、个人功能分支 `codex/arctic-shift-content-query`。上一轮 Arctic Shift 变更已保存为本地快照 abd24f5；没有 push、main 修改、分支删除或 PR 合并。
- Arctic Shift 内容身份、发现、观测、逐页任务、PostgreSQL、认证 API 和 `/content` 已接通。真实 0、负 score、缺失 null 保留，内容发布时间、源观测时间、本平台取回时间分开。归档指标不解释成实时热度。此前真实小样本验收是上一轮记录，本轮只用合成数据和离线夹具。
- 阶段 1：旧默认 new-listing 不再隐式追加四类 discovery 请求，显式 opt-in 保留能力；质量阈值恢复既有契约，原 17 项失败路径专项通过。关键词同范围完整计数和独立样本、中文字面词/英文边界/排除词、写入侧索引维护及显式有界旧索引回填已实施；查询不重建索引。
- 新增长算法 `post_growth_v2_observation_delta` 使用相邻实际观测差分，单快照/缺指标不生成增长事实，保留负 score 变化与测量时间。历史 v1 留在库中，不显示为实测 driver 增长。现有热度/榜单仍用旧 Reddit 模型，不自动消费归档指标。
- 图表按日期并集合并系列/overlay，空值保留 null；空→有→空切换正常，最新卡片按日期取值。比较保存受控 UI URL，恢复范围/系列/隐藏 overlay，失败提示和移动端遮挡已修复。
- 正式 Windows 演示入口 `local:setup/start/stop/status/account` 创建独立 PostgreSQL 和 owner，使用明确标记的 demo provider，保留其他端口/进程/既有配置。迁移在 pinned transaction 内加 advisory 锁，DDL 与迁移记录原子提交，保持已应用 SQL 原 checksum。
- 阶段 2 后台已实施来源编辑、分组、active/paused/archived、周期窗口/checkpoint 子任务、成熟 ID 刷新、取消/重试/继续、任务计数、worker 心跳、每日/月度 provider 预算。付费 provider 默认 disabled/0，resources 是保守预留量，不是账单。前端与最终阶段快照在集成中。
- 阶段 3 的 X 可配置 adapter、统一内容工作台及有界导出正在实施；没有真实 X 凭证，不能记为真实接入验收。共享多平台契约已覆盖可空字段、作者、媒体、引用、平台扩展及独立指标单位。

## 验证与证据边界

- 开始接手基线 cd920c5：331 项，314 通过、17 失败。阶段 1 数据专项 65/65、新增前端单测 6/6 通过；全量集成正在确认，不用专项结果代替全量结果。
- 新隔离 `source_validation_keyword_*` 库验证 2207 条合成帖子的完整计数、中文/排除词/英文边界及分批回填；阶段 2 新隔离库验证字段/观测单调性、生命周期、取消 token、预算与调度。旧展示库未参与本轮写入。
- Chromium 阶段 1 合成 API 冒烟覆盖图表切换、保存失败后重试、比较/目标恢复与 390px 布局；外部请求 0、页面错误 0。证据在 `output/playwright/phase1-functional-evidence.json`。
- 72 小时可控时钟测试证明调度逻辑，不能代替持续 72 小时真实网络运行。来源成功时间/最新已保存内容年龄也不能证明上游真实延迟或达成 12 小时目标。
- 本轮没有真实 Arctic Shift/Reddit/X 请求、付费试跑、公网部署、生产迁移或真实持续新鲜度验收。完整离线/SQL/浏览器结果和版本在阶段交付后回写本页。

## 尚待交付与已知限制

先完成来源 UI、本地启动端到端、X 夹具与公共查询/导出，再保存阶段 2/3 版本。真实来源、费用与持续新鲜度验收按用户意见保留；Instagram/web 只有字段设计与合成存储验证，不扩展真实 adapter。归档覆盖未知/partial 必须保留；查询分母只含已采集样本。新表保留策略、公开上线、容量/负载以及旧热度向公共观测的迁移仍是后续任务。
