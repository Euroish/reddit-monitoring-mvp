# 当前状态与下一步

核对日期：2026-11-10。本文区分 main、未合入开发分支与部署；本次只同步文档，不合并业务代码、不应用迁移、不部署或启用采集。main 的代码基线仍为 `008f676`（应用代码沿用 `6bd18ad`，版本 0.9.1）。`dev/root@eb2a80e` 含后续 E0、Bluesky 和研究工作，尚未合入 main。

## main 当前实现

| 范围 | 已有能力 | 未完成边界 |
| --- | --- | --- |
| Reddit / Arctic Shift | 社区/账号帖子与评论、帖子评论、范围内关键词、ID 成熟刷新；真实小样本落库通过 | 不支持无范围全站关键词；持续新鲜度、完整覆盖、自动缩窗未验或未实现；13 位评论 ID 刷新校验缺陷仍在 |
| X / TwitterAPI.io | 账号、搜索、ID adapter；媒体/引用/可空指标；默认禁用、独立预算 | 无真实凭证验收，不算稳定生产来源 |
| 调度与落库 | 来源生命周期、逐页事务、幂等、checkpoint、高水位、公平领取、有限重试、预算与心跳 | 无新商业 Reddit adapter、外部导入或跨 provider 自动路由；请求登记不是账单 |
| 内容使用 | 统一查询/统计、公共检索投影、详情、个人保存/注释、有界导出、冻结研究成员 | 只搜索已存内容；即时统计/分页不保证同一快照；旧榜单/热度仍用旧 Reddit 模型 |
| 扩展基础 | ContentProvider + capability、统一身份/独立观测；类型含 reddit/x/instagram/web | web/Instagram 无真实 adapter；Bluesky 仅在开发分支；OpenCLI 已独立安装但未接入项目；ego-lite 已排除 |
| 运维 | 41 个 SQL 迁移（至 039）、备份/恢复工具、发布 manifest、systemd/Nginx 模板 | 公网 HTTPS、持续负载、多用户容量、自动保留尚未验收 |

`965bff1` 已随 PR #2 合入：修复 Arctic Shift 小页重叠分页、未耗尽页缺 checkpoint、未知源时间覆盖已知正文、无变化投影重复写入及数据库暂态错误分类。同秒饱和停止并保留边界；422 只有正文含 timeout/slow down 才重试。自动分窗未实现。

main 仍有 `tests/integration/public-content-search-postgres.test.ts` 的动态 import TS2835 类型基线问题；服务/SQL 反向依赖、详情逐引用读取等尚未在 main 整理。不要根据开发分支的通过结果宣称 main 全绿。

## 开发分支成果：已验证，未合入 main

以下为 `dev/root@eb2a80e` 的交付，不要求重新实现。合入前核对实际差异、迁移与相应回归，合入后再更新上表。

| 工作 | 分支证据 | 合入/验收边界 |
| --- | --- | --- |
| E0 类型与模块边界 | `5da1ee9`、`d24d094` 修复静态导入，公共检索纯规则/失败类别归 domain，拆分内容读取和保存视图路由 | API/身份/checkpoint 语义保持；不要求继续做全库重构 |
| E0 详情性能 | `7f8fa37` 独立详情用例，批量读取有界引用及关联来源 | 本机 22 项受影响离线/API、1 项 PG14 SQL、类型/构建/compiled smoke 通过；隔离样本 SQL 23→4 次，中位耗时 121.4→38.9 ms，不代表生产容量 |
| E1 Bluesky 账号 | `c805ca1` 新增 AppView adapter、040 迁移；AT URI 身份、CID 版本，排除转发/置顶 | 两页保存 6 条作者内容，重放新增 0；worker→隔离 PG14→API/UI/导出通过；coverage=partial，未验搜索、线程或持续新鲜度 |
| E1 迁移升级预期 | `78ecebe` 补齐 040 的严格迁移断言，相关 7 项本机 PG14 回归通过 | 不修改已应用 SQL；分支共 42 个迁移，main 仍为 41 个 |
| 来源研究 | `f564ada`、`eb2a80e` 及本次文档同步 | PullPush 首次请求 429，拒绝免费 agent 访问后停止；Reddit 备用仍未落实；不将研究写成 adapter 已交付 |

E0 的 [7f8fa37 云 CI](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/39290246148) 为 success，2026-10-26 再次读取 GitHub 确认。Bluesky 的 [c805ca1 云 CI](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/39293319304) 为 failure：offline 通过，旧迁移预期漏 040，SQL 41/42，浏览器阶段未执行。后续本机定向修复不等于同一提交云 CI 已全绿。

分支 E1 共 8 次数据请求：PullPush 1 次，Bluesky 7 次，含探测及一次脚本中断；最终样本验证结束归档来源并停止临时服务。无付费调用、业务部署或常驻采集。原始证据位于忽略的 `output/validation/e0-detail/`、`e1-pullpush/`、`e1-bluesky/`，不随发布分发。

## Reddit 自采证据与缺口

| 类型 / 时间 | 可确认结果 | 不能推出 |
| --- | --- | --- |
| 真实联网 / 10-20 | Arctic Shift 5 次请求：帖子两次各 7 条成功，另三次 422 Timeout | 不是持续吞吐上限或真实联网落库容量；离线调度/SQL 测量不能替代它 |
| 真实联网 / 10-23 | Arctic Shift 三次只读社区请求各取 5 条；实际 adapter 解析近期 13 位评论 ID 成功 | 非全站搜索；无 worker→业务库或持续采集；最新一条距查询约五分钟不是延迟上界或覆盖率 |
| 离线 / 10-23 | 同一新 ID 的 refreshIds 在联网前被 2–12 位校验拒绝，retryable=false；独立复核再次复现 | 本地缺陷已确认，未修复；不能解释匿名 403，也未证明业务部署已受影响 |
| 真实联网 / 10-23 | 本服务器匿名列表 JSON、网站搜索各一次，均为网络安全 403 | 不代表本地登录浏览器同样失败；未执行真实登录搜索 |
| 离线 / 10-23 | OpenCLI 三个基础合成场景＋三个独立边界场景，外网请求为 0 | 未覆盖完整 CLI、扩展、账号、真实页面和持续负载 |
| 源码审查 / 10-26 | OpenCLI aeaff2b 的 Reddit 搜索存在数量上限不报告 capped、补全失败不返回已发现 ID 等边界；ego-lite 无 Linux 支持 | 当日未安装或运行；后续安装不等于修复这些边界 |
| 部署检查 / 10-28 | OpenCLI 2.0.2、扩展 1.0.26 与 Linux Chromium 安装；doctor、HTTPS/noVNC/Bridge 链路通过 | Reddit 登录出现 network-security 阻断及验证码失败，未取得已登录搜索数据；连通性不是采集成功 |
| 当前服务检查 / 11-10 | public-tunnel、desktop、chrome、bridge 四项 reddit-browser 服务均 inactive；保持关闭 | 不代表业务 API/worker 的当前部署状态 |
| 真实联网 / 11-10 | 临时独立 Chromium 匿名访问社区 HTML 与全站搜索 HTML 各一次，均 403，0 帖子；结束退出 | 非 Reddrix/Camoufox/Scrapling 运行验收；未恢复已关闭服务 |
| 公开文档复核 / 11-10 | 重读 Reddit/X 供应商价格、搜索文档及 X 开源方案；Nitter 原仓库已归档 | 无供应商带凭证数据请求、采购或 X 登录验收；不能给出已证实的质量冠军 |

原始证据目录：`output/research/reddit-access-20261023/`、`reddit-direct-20261023/`、`aggregation-projects-20261023/`、`reddit-audit-20261023/`。原 JSONL 与响应仅保存在研究机器，不要求开发者持有这些本地文件才能阅读文档；机制、版本、必要结果与上游链接见[来源研究](research/data-sources.md)。

## 已有部署证据

2026-10-16 / `6bd18ad` 的 Linux 部署：API/Web 构建、compiled smoke、638 文件清单与 515 离线测试通过；数据库 41 迁移，API/worker/Nginx 启动和回环健康检查通过。Arctic Shift 首次 24 小时窗口 422，缩至一小时后帖子/评论各 5 条落库、API 读取成功，帖子重放新增 0，覆盖 partial。全仓类型检查另有上述 TS2835，不能用生产构建替代。

当时发布目录 `/opt/reddit-monitoring-releases/6bd18ad816ad`、入口 `/opt/reddit-monitoring`；验证结束暂停测试来源，常驻配置 `SOURCE_NETWORK_ENABLED=false`。报告在当时服务器的 `/root/deployments/reddit-6bd18ad816ad/output/validation/live-source-20261016/result.json`。这不是 11 月 10 日业务运行状态、公网 HTTPS 或十二小时新鲜度验收；本次未重新部署。更早的 0.9.1 阶段结果见[历史交接](history/handoff.md)。

## 当前决定与开发入口

Reddit 付费来源须满足目标 $0.07/千条、硬上限 $0.10/千条；预期约 10 万条/月，采集月度总费用≤50元，两个上限同时执行。目前没有已证明达标的商业主源；opportunity-biz 公开元数据确认 $0.05/千结果另加启动事件，提升为赠额内优先候选；CiteRocket/Redditapis 保留对照，不采购月包或充值。Reddrix 11 月 6 日 v1.2.19 与 Scrapling 11 月 4 日 v0.5.1 已审查，均未运行；重新开放有界自采研究，不把当前匿名 HTML 403 推断为所有工具均失败。价格与准入依据见[来源研究](research/data-sources.md)。完整评论延后；官方申请与全站 dumps 不作为当前路径。Arctic Shift 留作定向/已知 ID 补充，13 位 ID 刷新缺陷仍需修复。

执行顺序见[工程路线](plans/source-expansion.md)：整合已有分支 → 赠额内真实取数与成本准入 → 预算合格 adapter 接入共享落库/API/UI → 48–72 小时延迟与费用验收。设计见[架构](architecture.md#付费-reddit-provider-接入设计待实现)，配置边界见[开发说明](development.md#付费-api-验证与配置边界)。若均未通过预算，停止商业接入，不以更贵来源自动替代；全站关键词目标继续标记未交付。本轮没有新增 adapter、配置项、数据库迁移或导入接口；网络开关不会自动注册候选供应商。

X 的 OpenCLI/twscrape 会话方法尚未实测；Twikit 作为后备研究，Nitter 归档后不选作主源，FxEmbed 仅为已知链接补全候选。已停止的云端 Reddit 浏览器服务保持关闭，ego-lite 继续排除。单账号容量和十二小时目标都没有新验收结果。

本轮更新文档、审查公开源码/报价并执行两次匿名 HTML 浏览器探测、docs:check 与差异检查；没有重跑应用全量类型、SQL 或浏览器检查，不覆盖上述失败记录。公开页面快照、源码与请求元数据位于忽略的 `output/research/paid-review-20261110/`、`output/research/reddit-crawlers-20261110/`；10 月 28 日工具部署记录位于当时工作区 `output/validation/opencli-linux-20261028/result.json`。它们不随发布分发，也不包含本轮付费数据验收。
