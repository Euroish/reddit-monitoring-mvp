# 当前状态与下一步

核对日期：2026-11-13。本次将 main 的最新研究文档与 `dev/root@78f030c` 的功能、部署记录整合，应用版本仍为 0.9.1。PR #2 的功能交付已合入 main；E0 已修复类型/模块基线并优化详情读取；E1 已完成 Bluesky 账号读取的首个真实小样本闭环，已接入 kaix 付费 Reddit adapter。此前独立 kaix 测试与业务接入分开核算；既有 HTTP/IP 部署与路由恢复记录保留原提交。本次仅整合仓库，不新增收费请求、迁移或部署。历史阶段验收见 [交接](history/handoff.md) 和 [开发日志](history/development-log.md)。

前端蓝图 `c6439b1` 作为历史设计包保留；其基线含当时未提交的归档 CLI/041，当前源码没有该入口或迁移，不能按蓝图认定已实现。原型源码证据摘要与当前路由存在漂移，重新审计前不宣称该快照验证可在当前树通过。

## 当前实现

| 范围 | 已有能力 | 未完成边界 |
| --- | --- | --- |
| Reddit / Arctic Shift | 社区/账号帖子与评论、帖子评论、范围内关键词、ID 成熟刷新；真实小样本落库通过 | 10 月 23 日核对：新 ID 后近期评论可能不完整/延迟；3 次只读小样本仍取回近期数据，但发现成熟刷新拒绝 13 位评论 ID 的本地缺陷（[研究证据](research/data-sources.md)），未修复；持续新鲜度、自动缩窗/本地筛选降级未验或未实现 |
| Reddit / kaix | 全站/社区/账号帖子、账号/帖子评论；本地字面/日期过滤、独立 snapshot 观测、现有预算/API/内容页/导出；中断后不自动重发收费任务 | 默认无凭证且预算禁用；无可续 cursor，始终 partial；接入后的真实联网、持续采集与并发容量未验，不承诺历史全覆盖 |
| Bluesky / AppView | 公开账号帖子与作者回复、AT URI 身份、opaque cursor；两页真实样本落库、重放、API/UI/导出通过 | 仅账号读取，排除转发/置顶；无搜索、线程展开、删除检测与持续新鲜度验收 |
| X / TwitterAPI.io | 账号、搜索、ID adapter；媒体/引用/可空指标；默认禁用、独立预算 | 无真实凭证验收，不算稳定生产来源 |
| 调度与落库 | 来源生命周期、逐页事务、幂等、checkpoint、高水位、公平领取、有限重试、阻塞/人工 Retry、预算与心跳 | 无跨 provider 自动路由；requests/resources 不是货币账单 |
| 内容使用 | 统一查询/统计、公共检索投影、详情、个人保存/注释、有界导出、冻结研究成员 | 即时统计/分页不保证同一快照；旧榜单/热度仍用旧 Reddit 模型 |
| 扩展基础 | ContentProvider + capability、统一身份/独立观测；类型含 reddit/x/instagram/web/bluesky | runtime 仍显式注册；web/Instagram 无真实 adapter；动态插件或独立测试台不作为当前目标 |
| 运维 | 42 个 SQL 迁移、备份/恢复工具、发布完整性清单、systemd/Nginx 模板 | 真实持续负载、公共 HTTPS、多用户容量、自动数据保留尚未验收 |

`965bff1` 已修复 Arctic Shift 小页重叠分页、无 checkpoint 的未耗尽页、未知源时间覆盖已知正文、无变化搜索投影重复写入及数据库暂态错误分类。遇到同秒饱和不会跳过边界；422 只有响应体含 timeout/slow down 才归为可重试，不是所有 422 都重试。自动分窗尚未实现。

## 验证与部署证据

以下是指定快照的历史结果，不表示本次重新执行全部测试，也不代表服务此刻持续运行。

| 时间 / 基线 | 已核实结果 | 结论边界 |
| --- | --- | --- |
| 2026-11-13 / `bdada7b` Web 静态资源修复 | 登录页改为入口静态导入，根路由补重新加载入口；页面 no-cache、哈希资源追加保留且 immutable、缺失资源 404。Web 构建/lint、两项 Nginx 回归、文档检查通过；线上浏览器模拟阻断 Register 模块后重新加载恢复，登录不请求独立 Login 模块；真实账号列表/详情/导出复验通过 | 用户报告的 Login 文件当时服务端仍为 200，不能据此确定客户端失败的具体网络原因；修复已部署，旧 Login 哈希仍可读取，页面错误 0，数据库与收费配置未改。证据在忽略的 `output/validation/http-preview-413bb75/` |
| 2026-11-13 / `413bb75` HTTP 验收部署 | 不可变产物 661 文件校验通过；原库备份及 manifest 已保存，只新增应用 040；API/Nginx 自启动、`http://23.251.32.165:8080/content` 可达；浏览器登录、10 条已存内容、详情及 CSV 通过，页面错误 0 | 按用户要求使用 HTTP；公网仅开放 Nginx 8080，API 3000/PG5432 仅本机；两个 readiness 路径公网 403、未登录内容 API 401。新建首个 owner，凭证只在服务器私有配置中；所有真实 provider 禁用，无新增收费或自动采集 |
| 2026-11-13 / kaix 接入工作区 | 530 项完整离线回归、补跑 kaix 专项 7 项、1 项独立 PG14 落库/API/CSV 场景通过；typecheck、API/Web 构建、compiled smoke、docs:check 通过；历史真实样本离线回放接受 100 条长 ID 评论，随机词样本过滤为 0 | 本次外部收费请求 0；有效 token 未配置、预算未启用；未部署或验证持续/并发采集。临时 PG 已停止，报告在忽略的 `output/validation/kaix-integration/` |
| 0.9.1 收口快照 | 511 离线、41 原生 SQL 零失败零跳过；类型/构建、合成浏览器和账户/内容/研究闭环通过 | 详情保留在历史交接，不能覆盖后续提交的新检查结果 |
| 2026-10-16 / `6bd18ad` Linux 部署 | API/Web 构建、compiled smoke、638 文件发布清单、515 离线测试通过；数据库升级至 41 迁移；API/worker/Nginx 启动与健康检查通过 | 本机回环访问验收，非公网 HTTPS 或持续负载验收 |
| 同次部署类型检查 | `tests/integration/public-content-search-postgres.test.ts:25` 的动态 import 曾触发 TS2835 | 本轮改为静态导入 SQL writer 后全仓 typecheck 通过；历史部署产物未更新 |
| 2026-10-20 / `c805ca1` Arctic Shift 吞吐探测 | 5 次真实请求：2 次帖子成功，各返回 7 条，约 1.26/2.80 秒；另 3 次查询返回 422 Timeout | 仅成功小样本约 2.5–5.6 条/秒，不是 API 上限；评论缩至 25 条/10 分钟仍超时，未进入并发/auto 加压，也未完成真实联网入库吞吐验收 |
| 同次 / 隔离 PG14、Node22、4 CPU、约 3.8GiB | 合成 100 条/页：纯应用用例落库 1,000 条用时 7.83 秒（约 128 条/秒）；复现单 worker 调度，单来源连续页间隔约 5.18 秒（约 19.3 条/秒），8 来源页间隔约 2.14 秒（约 46.7 条/秒） | 均不含上游网络；后两项按页启动间隔换算，避免首屏突发夸大吞吐。内容/观测/检索投影计数一致；是本机短测参考，不是持续容量或峰值保证 |
| 2026-10-16 / Arctic Shift 真实请求 | `technology` 最近 24 小时首次请求 422 Timeout；缩至 1 小时后帖子/评论各取回并落库 5 条，正文、观测、检索投影均存在；API 读取成功；帖子重放新增 0 条 | 单页预算，覆盖为 partial、窗口未耗尽；没有证明全量、关键词能力或 12 小时新鲜度 |

2026-10-16 那次部署为 `/opt/reddit-monitoring-releases/6bd18ad816ad`，入口 `/opt/reddit-monitoring`，旧版本和数据库备份保留。一次性验证仅在该进程启用网络，结束暂停两个测试来源；常驻配置保持 `SOURCE_NETWORK_ENABLED=false`。无需新增交互账号。报告位于该服务器 `/root/deployments/reddit-6bd18ad816ad/output/validation/live-source-20261016/result.json`，原始样本和报告不随仓库发布。

2026-10-23 / `eb2a80e` 的后续来源研究只做 3 次 Arctic Shift 请求：`technology` 最新帖子/评论各取 5 条、实际 adapter 最近一小时完整评论取 5 条，均 200、约 1.45–1.68 秒；最新评论距轻量查询约 5.1 分钟。另离线复现 `refreshIds()` 对真实新 ID `t1_19riqx8r047lt` 在联网前抛不可重试错误（现有限制为 2–12 位，新样本为 13 位）。首次解析通过不等于刷新兼容；没有修复、落业务库或启用持续采集，也没有证明部署已受影响。证据在 `output/research/reddit-access-20261023/`。同期读取的官方公告已宣布传统 public API/RSS 退场安排；Devvit 的安装社区、外发审核与用途限制，以及学术数据六个月延迟等见[来源研究](research/data-sources.md)，不能再将申请传统免费 API 作为长期默认备源。

吞吐探测证据在忽略的 `output/validation/reddit-throughput/`。当前单来源逐页提交后有 5 秒 nextRunAt，worker 成功处理后睡眠 1.5 秒、空领后 3 秒；多来源可以交错，不能把单来源约 20 条/秒当作全系统上限。页内仍逐条执行 content、检索投影、discovery、observation SQL；若优化，先分别测调度等待与批量写入，不盲目增加上游并发。上游动态限流，官方建议大量历史数据使用月度 dumps；本轮零付费、业务库未改，临时来源归档/集群停止。首次大窗口失败后缩窗验证，探测期限到后禁止继续联网；后续本地性能测量仅重用已保存样本构造合成内容。

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

## 工程审查与下一步

E0 已建立可继续开发的类型与模块基线：公共检索纯规则和来源失败类别归 domain，SQL writer 留在 storage，HTTP 状态由 API 单点映射；内容读取和保存工作台视图路由已独立，共同认证、Origin、body 限额和审计保持。没有修改 API、数据身份、检索语义、checkpoint 或 SQL 迁移。

E0 最新 `7f8fa37` 云 CI [39290246148](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/39290246148)（Node24/PG16）离线、SQL、浏览器和 ci-demo **全部通过**。首批 `5da1ee9` 曾在 ci-demo 的 X 卡片等待失败；冒烟已改为等待目标筛选的 URL、列表与统计响应，不能再由旧筛选响应满足。此前本机 Node22/PG14 的 521 项离线、41 项 SQL、构建和合成闭环证据分别保存在忽略的 `output/validation/e0-boundaries/`、`e0-second/`；这些是指定快照结果，不表示每批重复全量验证。

当前内容详情用例在 `content-detail.service.ts`，不再属于采集服务。引用按 platform + kind + externalId 一次批量查询，用 Map 恢复原始顺序、重复关系与缺失 null；引用/children 仍各最多 20。来源按关联 ID 读取并保持原排序，不再全量读取配置后过滤。内存实现一次扫描、去重匹配；PostgreSQL 使用成对身份半连接和既有唯一索引，不新增索引、缓存或永久内存索引。通用 ID 校验迁到 domain，个人/研究模块不再为此导入采集服务。

本批本机 22 项受影响离线/API 回归、1 项原生 PG14 SQL 详情场景、类型、API 构建与 compiled smoke 通过；未新增测试文件，补强现有夹具中的异 kind、重复、缺失、顺序及 20 条边界。未重跑完整离线/SQL 集、Web 构建或浏览器，当前批云结果以提交记录为准。隔离合成对照：1,004 来源、1,029 内容、20 引用（含重复和缺失），暖缓存各 30 次，SQL 从 23 次降至 4 次、每次解码 JSON 从 901,752 降至 35,171 字节，中位耗时 121.4→38.9 ms、P95 179.3→51.6 ms；仅是本机指定数据量结果，不代表生产容量。EXPLAIN 确认批量身份与来源 ID 使用已有索引。证据在 `output/validation/e0-detail/`。上述 E0 阶段没有真实 provider 请求或业务部署；前端原有 11 项依赖安全告警未在本批升级处理。

## E1 当前交付与缺口

10 月 23 日 JSONL 独立复核补充：新增三个 OpenCLI 离线边界场景（外网请求为 0），复现达到数量上限但 `capped=false`、部分补全和补全 403 不返回已发现 ID；CLI 数组缺少可持久化续页与完整性状态，尚不能直接作为现有 provider 页提交。当时 ego-lite 仅支持 macOS/Windows；后续已排除，云端浏览器服务保持关闭。桌面执行后导入未实现或真实验收，详见[研究复核](research/data-sources.md#jsonl-独立复核与-ego-lite-的位置)。

PullPush 首次历史帖子请求返回 429，正文明确拒绝免费 agent 抓取，立即停止；没有为不可用候选开发 adapter 或改走代理。随后对 Bluesky AppView 进行免费小样本验证，新增账号专用 adapter 与 040 平台注册迁移。AT URI 是内容身份，CID 是版本信息；按 DID/handle 选择账号，仅保存作者帖子和作者回复（kind=post），排除 feed 中的转发与置顶。opaque cursor 绑定来源/目标/窗口；不按最旧发布时间提前耗尽，因为 feed 有转发和非发布时间排序。未知指标观察时刻保持 null，不用 indexedAt 或 fetchedAt 伪造；搜索、线程展开、ID 成熟刷新与删除检测未实现。平台枚举与指标命名空间校验已共用一份平台列表，研究冻结保留 Bluesky CID/指标。

E1 账号验证共 8 次数据请求：PullPush 1 次，Bluesky 7 次（均 200，含探测、一次验证脚本中断及最终闭环）。最终两页读取保存 6 条作者自发内容，首屏重放新增 0；真实 worker 用例→隔离 PG14→API→浏览器 6 张卡片和 JSON/CSV 下载通过，浏览器额外外网请求为 0。任务耗尽=false、coverage=partial，不代表全账号历史或 12 小时新鲜度。首次本地脚本误把页间 5 秒 nextRunAt 当成立即可领，改为等待已有领取时间后通过，生产调度未改、断言未降低。来源结束后归档，临时服务/集群停止，没有启用持续采集。

定向 adapter/runtime/workbench/research 回归通过；新增 3 项离线行为场景及 1 项原生 SQL 闭环（含迁移重跑、API、研究冻结），类型、API/Web 构建、compiled smoke、Web lint 与文档检查通过。未重复全量离线/SQL及三条旧浏览器闭环；`c805ca1` 云 CI [39293319304](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/39293319304) 的 offline 通过，原生 SQL 为 41/42：旧升级用例仍仅预期 039，新增 040 后严格迁移列表断言失败，浏览器阶段未执行。本次补齐 040 预期，保留原断言与失败策略检查，7 项相关原生 PG14 回归通过；后续云结果以新提交为准。证据在忽略的 `output/validation/e1-pullpush/`、`e1-bluesky/`。新 provider 的预算仍默认 disabled/0，运行时网络默认关闭；本轮没有收费请求、充值或生产部署。

用户后续明确需要全站关键词持续监测和临时历史搜索、完整评论可延后，且排除所有官方申请路线。直接自采复核已检查旧 HTTP/Scrapling 和三个登录会话搜索项目的源码；本环境对旧列表 JSON、网站搜索各 1 次匿名请求均为网络安全 403，没有用户登录会话，尚未证明会话读取成功。随后复核 AIHOT、TrendRadar、NewsNow、BettaFish、Agent Reach 与 OpenCLI：前四者未提供可直接替代的 Reddit 全站入口；当前 Agent Reach 的 Reddit 站内后端是 OpenCLI。OpenCLI 已实现浏览器内网页搜索排序/有界翻页＋by_id 补全，3 个离线浏览器合成场景通过、外网请求为 0，但未执行真实登录采集或业务接入。既有云端浏览器保持关闭，其他自采候选按最新研究另行验证；当前按用户选择接入 kaix，不能把 OpenCLI 内部翻页当作已有可持久化 checkpoint，或把 1,000 条/10 页上限当成完整覆盖。不先下载全站 dumps，也不把定向社区采集当作该需求已满足。详情见[来源研究](research/data-sources.md)。kaix 已接入为独立付费 Reddit 来源，默认关闭；仍未落实自动备源切换。X 先考察账号读取的正常有效成本，凭证/付费预算另行授权。其余候选不并行实施；SourceContentService 剩余职责和旧路由按实际修改整理，不作为全部来源验证的前置门槛。
