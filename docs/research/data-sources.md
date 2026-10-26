# 数据源研究与选型

2026-10-26 统一文档；原研究取数/价格证据日期保留在各段，未重新验证全部服务。来源为 `d8b481b` 的历史研究、10 月 19–23 日原始请求/源码及 JSONL 独立复核。本次仅重新读取 OpenCLI/ego-lite 关键源码，没有真实 Reddit 请求、付费调用或浏览器登录验收。main 实现和 dev/root 分支成果的区别见[状态](../status.md)。

**当前判断：** 优先在用户本地 Chrome + OpenCLI 验证全站范围关键词帖子搜索；Arctic Shift 保留为定向/已知 ID 补充。完整评论延后；官方申请和全站 dumps 不作为当前实施路径。按用户 2026-10-26 决定，ego-lite 因缺少 Linux 支持排除，不再作为执行环境候选；Agent Reach 与热点聚合项目不构成独立 Reddit 上游。设计统一在[架构](../architecture.md#浏览器采集部署与结果契约待实现)，执行顺序只在[工程路线](../plans/source-expansion.md)维护。

## 证据与结论

| 证据 | 可得结论 | 不能推出 |
| --- | --- | --- |
| Linux `6bd18ad` 真实采集 | Arctic Shift 1 小时社区窗口帖子/评论各 5 条落库，API 读回与重放去重成功 | 24 小时窗口、关键词、全量分页或持续新鲜度正常 |
| 研究原文用户 curl | 2026-10-16 按 ID 和 Python 社区日期窗口返回 200；增加 title 条件返回 422 | 原文该次未展示错误正文，不能单凭 422 断定具体原因 |
| 研究原文沙箱 DNS 失败 | 当时执行环境无法联网 | Arctic Shift 服务故障 |
| 2026-10-20 / Arctic Shift 吞吐探测 | `technology` 5 次请求，帖子一小时窗口两次成功、各 7 条，约 1.26/2.80 秒；历史大窗口及评论一小时/100条、十分钟/25条共 3 次 422 Timeout | 不是 429 限流，也不是峰值压测结果；基线不稳定，未进行并发/auto 加压。仅该小样本约 2.5–5.6 条/秒，不能外推长期容量 |
| 2026-10-19 / PullPush 数据端点 | `technology` 历史帖子首次请求返回 429，JSON 明确表示不向 agents 提供免费抓取资源，随后停止 | 不是所有客户端均不可用或服务宕机的证明；本环境的免费 E1 候选不可据此通过 |
| 2026-10-19 / Bluesky AppView | 7 次免费公开账号请求均 200；首屏/续页各 5 条、无重叠，首屏重放身份一致；dev/root 的新 adapter 两页筛出并落库 6 条作者自发内容，重放新增 0，API/浏览器 JSON/CSV 通过 | 不是 Reddit 备用，不证明全账号历史、全线程、删除检测、持续稳定性或 12 小时新鲜度；任务仍 partial |
| 供应商文档/价格页 | 存在公开接口说明或报价，可进入候选试验 | 真实覆盖、独立上游、账单单价和 SLA 已验收 |

Arctic Shift 上游说明关键词组合可能触发查询超时，建议缩小 limit 或增加日期/社区/作者约束。本仓库已按错误正文区分可重试 timeout/slow down；自动缩窗与本地关键词筛选仍需设计和实现。一次 200 不能证明完整覆盖。10 月 20 日核对：上游建议正常使用每秒几次请求、限流按负载/复杂度动态计算，大量数据用月度 dumps；搜索支持 `limit=auto` 自适应 100–1000 条，但本项目 adapter 仍固定最多 100 条/页，本轮未验证 auto，不能据此声称已支持千条分页。[上游 API 说明](https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md)

当前 connector 对帖子关键词发送 `query`、对评论发送 `body`；用户原文的 `title=help` 请求与应用参数不同，因此该 curl 的 422 不能直接当成应用关键词采集失败的复现。后续测试须保留实际端点、参数和响应错误正文。

## 长期成本准入

先筛价格，再花时间接入。赠送积分、限时免费和首月优惠不计入长期成本优势；按优惠结束后的正常单价、预计请求量、实际有效页大小和最低消费计算月度费用。免费额度须能持续覆盖目标负载，超额费用也纳入判断。

- **优先：** 可持续免费且配额适用的来源，或正常计费仍满足 $0.07/千条目标、预计月费在预算内的低价来源。
- **排除：** 试用后高价、强制高额订阅、必须大额预付才有低单价的方案；不作为默认备用接入。
- **暂不投入：** 正常价格、长期额度或预计月费不明确的服务，先补足成本依据，不为试用奖励开发 adapter。

下面的商业价格表只是正常按量报价线索，尚需按具体目标负载核算；不是已通过准入的来源清单。单位价达标也不能替代总月费判断。

### 无需预付的当前候选

用户当前排除需充值或固定付费的来源，当前优先浏览器自采；以下免费服务仅留作补充对照线索，不并行采购或接入。10 月 20 日重新读取 [Redditapis 价格页](https://www.redditapis.com/pricing)，其中明确标注“1,000 reads every month, on every account”，与一次性 $0.50 注册赠送不同；付费充值起点 $10 不能被误写成免费使用的必要条件。仍需在实际账号核对开通条件、适用端点和超额阻断，不能把网页自述当成已验收。其页面另称免费提供一个全站关键词的新帖子监测、webhook 投递、约每 60 秒检查；免费监测不支持指定 subreddit 或评论，不等于全量数据 API，也不是 SLA。

按 30 天计算，5 个社区每 6 小时各读取一页约 600 次/月，余下 400 次才可用于续页、评论和重试；活跃社区可能超页漏采，须先量实际负载。免费档不要求自动充值，试验不充值、不绑定付费方案，额度不足即停；没有凭证或真实取数验收，本仓库尚未接入该 provider。

不能再把申请传统免费 Data API 当作长期默认路线。[官方 10 月 8 日 changelog](https://support.reddithelp.com/hc/en-us/articles/54353370049684-Changelog-October-8-2026)（10 月 23 日通过公开 Help Center JSON API 读取全文）宣布：2026-10-31 停止接受新的 public API 访问申请，2027-01-12 开始移除未登记/未响应迁移联系者的访问，2027-03 结束剩余 public API 访问；Reddit RSS 于 2026-11-13 停止支持。这不等于所有商业授权数据服务一起关闭，也不能用旧 Data API Wiki 的免费额度推断未来可用性。Devvit、商业许可与学术项目分别核查，不能互换资格。

历史研究的另一种交付是下载 [Arctic Shift dumps](https://github.com/ArthurHeitmann/arctic_shift) 后本地检索，避开公共查询端点，但仍有磁盘/处理成本，不能满足近期 12 小时目标。[Reddit for Researchers](https://support.reddithelp.com/hc/en-us/articles/49381918834964-Reddit-for-Researchers-Program) 对获批非商业学术项目免费，经 BigQuery Analytics Hub 提供最近五年历史、**延迟六个月、按月更新**的数据；需要高校归属、机构担保与伦理审查/豁免，不能供本产品近期监测或转供原始数据。Bluesky 或 [HN 官方 API](https://github.com/HackerNews/API) 不是 Reddit 内容备用。没有核实到同时满足无审批、持续免费、大流量、完整 Reddit 覆盖的可靠服务。

### 评价、维护与运行证据（2026-10-23）

不把供应商榜单、品牌总评分或进程成功当作 Reddit 数据质量。独立评价样本小、搜索摘要过时以及页面缓存口径不同均单独标明；本轮未运行收费 Actor、未注册或充值供应商账号，也未采集业务目标内容。

- **Arctic Shift 的收录风险已有维护者证据。** [#82](https://github.com/ArthurHeitmann/arctic_shift/issues/82) 中用户 10 月 15 日报告接口可用但没有新数据；维护者承认 Reddit 改动引发中断，16 日表示已基本追上。[#53](https://github.com/ArthurHeitmann/arctic_shift/issues/53) 中维护者 10 月 17 日说明新评论 ID 上线后评论不会 100% 完整、采集可能延迟，21 日确认新 ID 已覆盖全部评论。此前 90%+、理想 95% 是维护者预期，不是本项目测得的覆盖率。这是独立于查询 422 的上游收录问题，不能推断所有 timeout 的原因，也不能继续把近期评论视为完整流。
- **Redditapis 仍缺少长期口碑。** [Uneed](https://www.uneed.best/tool/redditapis/reviews) 只有 4 条评价；其中可见“当日测试两个线程”和“刚注册约一小时后首次取回评论树”的短期成功反馈，也有关于删除内容覆盖和每次返回量/计费的疑问。本次未找到独立的月度免费额度续期或长期可用性报告；免费档保留为待验对照，不提升为可靠主源。搜到的旧 $0.002/一次性赠额摘要不覆盖当前官网另写的持续免费声明，但官网声明也不能替代账号验证。
- **较有实际使用量的新候选是 Apify 的 [fatihtahta/reddit-scraper-search-fast](https://apify.com/fatihtahta/reddit-scraper-search-fast/reviews)。** 页面约 4.1 分、二十余条评分、约 3,300 月活跃用户；[公开 Actor 元数据](https://api.apify.com/v2/acts/fatihtahta~reddit-scraper-search-fast) 显示 10 月 22 日仍有更新，近 30 天 228,795 次运行中 222,926 次成功，另有失败、超时和主动取消。页面成功率与全部运行比例口径不同；这些都是平台统计，不是独立覆盖/延迟验收，不能拿来承诺优于 Arctic Shift。
- **Apify 仅保留免费额度内的对照可能，不作为当前主线。** [平台 Free 计划](https://apify.com/pricing) 每月 $5，无需信用卡，用尽后暂停到下周期；该 Actor 元数据的 FREE 档为 $0.00149/结果，页头“from $1.19/千条”属于更高付费档，不能套给免费用户。每月账面上限约 3,300 条，其他费用/重复结果须留余量；超额正常价 $1.49/千条高于项目目标，故不充值、不升级，不作为大规模长期付费方案。没有凭证或内容样本，尚未验证本账号可用性。
- **更便宜或更高分的 Actor 不自动入选。** [opportunity-biz](https://apify.com/opportunity-biz/reddit-scraper) 虽标 $0.05/千条，但只有 8 个累计用户、无评分，且同时收平台使用费；[automation-lab](https://apify.com/automation-lab/reddit-scraper) 明确将评论、深层树与投票指标列为 best-effort，部分未知指标会输出 0。因此不能仅按标题价、星级或“运行成功”替代有效独立内容/字段完整性比较。

结论：现有证据不足以证明存在既免费大流量、又更稳定完整的 Reddit 主源。下节的小样本说明 Arctic Shift 仍能返回新 ID 的近期评论，并发现本仓库成熟刷新存在本地校验缺陷；因此先区分本地适配、查询失败和上游漏收，再决定换商。持续免费 Actor 与 Redditapis 仍只是有界对照，不能替代同目标/窗口的内容验收；Arctic Shift 也不能据此升级为近期全量主源。来源实施顺序仍只在开发路线维护。

### 从访问机制反推可行路线（2026-10-23）

本轮用户明确排除所有需要官方申请的访问路线；必须同时支持全站关键词持续监测和临时历史搜索，完整评论可延后。以下保留官方能力的事实核查，但不将其作为本轮可选实施路径。定向社区采集不能替代全站关键词发现，全站 dumps 也不是本轮方案的前置条件。

决定可行性的两个环节是 **发现未知内容 ID** 与 **读取已知 ID 的内容/更新**。新评论 ID 破坏的是原先顺序扫号的发现方式；关闭匿名入口限制的是读取权限。解决其中一个，不等于另一个也解决。维护者说有替代采集方式，证明仍有方法，不证明其方法公开、可复制、免费或无缺失。

| 路径 | 技术依据与可取价值 | 本项目判断 |
| --- | --- | --- |
| 限定社区/账号的列表 + 已知帖子评论树 | 在获准接口中由列表发现 ID，再按目标帖子展开；不依赖连续 ID。仅轮询新帖子会漏掉老帖新评论 | 比全站扫号更适合有界监测，但必须先取得实际可用的读取权限；不是发现新匿名端点 |
| Devvit 社区合作与事件推送 | [Reddit API](https://developers.reddit.com/docs/capabilities/server/reddit-api) 面向安装社区；[事件目录](https://developers.reddit.com/docs/capabilities/server/trigger-events) 有帖子/评论创建、更新、删除事件；[发布说明](https://developers.reddit.com/docs/guides/launch/launch-guide) 明确由社区 moderator 安装 | 当前官方申请路线排除；仅作能力背景，不能进入实施队列。事件异步、可重复、部分字段可缺失；没有全站 firehose 或完整交付 SLA |
| Devvit → 本项目数据库 | [HTTP Fetch](https://developers.reddit.com/docs/capabilities/http-fetch) 技术上支持服务端 POST | 外发须逐域名/逐应用审核；当前个人域名默认不批准，限定云服务需证明平台不支持的能力。[规则](https://developers.reddit.com/docs/devvit_rules) 限制数据使用/分享，外部分析或批量导出须明确获准；换云域名不自动获得转供权 |
| Arctic Shift 定向增量 + 历史 dumps | 已有 adapter；API 与 dumps 是不同交付方式 | 近期只作为待验证补充样本流；本轮不要求下载历史全量。两者共用上游采集，不是独立备源；缓存/本地库只能提高已存数据的可读性 |
| 正常浏览器会话读取可见页面 | 网页仍须给获准访问者呈现内容，DOM 在技术上是另一种交付格式 | 已进一步审查登录会话驱动站内搜索的开源实现（见下文），是本轮直接自采的主要待验证候选；没有用户会话，尚未真实验收。登录并不授予批量采集权，不把账号池、代理轮换、伪装官方客户端作为稳定性方案 |
| 搜索索引、embeds、Reddit Pro、研究库 | 搜索可发现链接；embeds 可展示已知内容；Pro 可人工监测主题；研究库可历史分析 | 不提供本项目所需的完整近期正文/评论流。各自的访问、导出权和新鲜度单独判断，不能拼成无损全站数据源 |

Devvit 的所谓“全局事件”目前是需要额外审批的 [app mention trigger](https://developers.reddit.com/docs/capabilities/server/global-triggers)，只在提及 app 用户名时触发，不是监听任意关键词/全站评论的出口。官方迁移方向使其值得研究，但不能先实现通用 Devvit 导出器再补权限。

其他常见建议的决定性限制：

- **Redlib/镜像不独立。** [README](https://github.com/redlib-org/redlib) 自述依赖模仿官方客户端的 token/headers；它仍回源 Reddit，而非独立生产内容的数据库。代码存在不等于当前可用、获准或稳定，本轮未部署或借用公共实例。
- **搜索结果不是全文库。** 可以在获准搜索服务内做主题/帖子发现，但索引延迟、排序截断、正文摘要及评论展开没有完整性保证。搜索/LLM 回答只能作为线索，不能将模型生成内容或摘要还原成原始评论。
- **oEmbed 只适合展示。** [Embeds Terms](https://redditinc.com/policies/embeds-terms) 将用途限定为显示用户内容，不能当作结构化采集授权或评论树枚举接口。
- **Reddit Pro 不是免费导出 API。** [Trends 官方说明](https://support.reddithelp.com/hc/en-us/articles/47619216411284-Reddit-Pro-Feature-Trends) 允许监测关键词，但明确禁止手动或自动下载其他用户的帖子/评论及 Pro 展示的其他信息；自有内容指标导出不能外推为别人的内容导出。
- [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) 要求 API 访问明确审批、如实说明用途、不绕过限额；[官方访问说明](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data) 对商业使用要求许可/合同，批量导出默认显著受限。技术可读与可持续使用权分开记录。

#### 当前环境的有界验证

基线 `eb2a80e`；2026-10-23 06:25–06:27 UTC；只对 `technology` 执行 **3 次** Arctic Shift 请求，无 key、代理、重试、并发、付费或数据库写入，结束不启动常驻采集。另通过公开 Help Center JSON API 读取 5 篇官方文章全文；网页正文抓取的 403 不作为文章不存在的证据。

| 检查 | 实际结果 | 结论边界 |
| --- | --- | --- |
| 最新帖子，desc/limit=5，仅投影 ID/时间/社区 | 200，1.68 秒，5 条；最新发布时间距查询约 43.5 分钟 | 只证明当时可读到近期帖子，不是帖子覆盖率或上游延迟上界 |
| 最新评论，相同轻量参数 | 200，1.49 秒，5 条；最新发布时间距查询约 5.1 分钟，ID 均为 13 位 base36 字符串 | 新 ID 不等于归档彻底停摆；不能外推全社区/全站收录 |
| 实际 adapter，最近一小时/desc/limit=5，完整记录、无关键词 | 200，1.45 秒，5 条规范评论，checkpoint 存在、coverage=partial | 新 ID 首次采集解析可用；未做 worker→SQL 闭环或持续验收。样本 `retrieved_on-created_utc` 为 63–486 秒，是来源自报归档间隔，不是独立实测全链路延迟 |
| 相同新 ID 的成熟刷新，离线 fetch stub | `t1_19riqx8r047lt` 被 `refreshIds()` 拒绝，`retryable=false`，fetch 调用 0 次 | [adapter](../../src/connectors/reddit/arctic-shift-content.connector.ts) 第 89 行仍限制 ID 为 2–12 位；初次 normalize 无该限制。服务将该错误归 permanent，启用成熟刷新后可能阻塞来源自动采集；本轮没有证明业务部署已发生此故障，也没有修改代码 |

复现脚本、参数、响应与结果保存在忽略的 `output/research/reddit-access-20261023/`。投影探测不含正文；实际 adapter 结果只记录身份/时间摘要。首次采集支持新 ID，**不代表成熟刷新支持**；这项本地兼容问题应先修复并做定向回归，不能靠增加上游重试处理。

此前建议的固定社区增量试验仅适合已知目标集合，不能满足用户后来明确的全站关键词要求。当前先验证下面的直接站内搜索路径；Arctic Shift 降为按目标/ID 的补充候选。未来若仍需其增量采集，应在预算内拆窗、保留分页边界，并按实测迟到情况回查；这些恢复措施不补回上游从未收录的内容。

可证伪的验收方式：固定少量目标、连续 72 小时、明确总请求上限与结束时间；用另一个获准读取面/人工可见样本建立同窗口 ID 基准，分别记录帖子/评论的基准命中、首次落库延迟、失败/空页、重复、晚到和各来源的新增边际覆盖。缺少独立基准时只能报告样本新鲜度，不能报告绝对覆盖率；两个归档服务的并集也不是真值。12 小时目标须报告超过 12 小时的比例和截止时仍缺失的基准内容，不能只报 P95 或最近一条的年龄。当前没有执行该持续试验、自动拆窗或新的来源接入。

#### 直接自采复核：登录会话与站内搜索

2026-10-23 进一步读取本仓库原 HTTP connector、Scrapling bridge 及三个外部项目的源码，不把 README 中的“免费”“无速率问题”当成运行证据。站内搜索由 Reddit 的索引做筛选，本地只接收命中帖；这是直接从 Reddit 获取数据，不是本地建全站索引，也不是第三方归档转供。能否满足使用许可仍独立判断。

- 本仓库 [HTTP connector](../../src/connectors/reddit/reddit-http.connector.ts) 默认读取 `www.reddit.com` 的社区列表/about/帖子评论 `.json`；配置 accessToken 后改为 OAuth。没有浏览器 cookie 会话管理，也没有全站 search 方法，不能简单重启旧 worker 就宣称支持当前需求。
- [Scrapling bridge](../../scripts/scrapling_reddit_bridge.py) 的 dynamic/stealth 仍请求传入的同一 URL；当前 `sessionKey` 只是返回头标记，没有持久登录 profile 的实现。更换 fetch 库不等于补上读取权限或站内搜索，未运行 stealth、挑战解算或代理切换。
- 本环境仅发 **2 次**无 cookie、无代理、无伪装/重试的只读请求：旧 `technology/new.json?limit=2` 和网站搜索 `search/?q=postgresql&type=posts&sort=new` 均返回 HTTP 403 HTML，含 “blocked by network security” 和登录提示。说明本环境的匿名直连被拒绝；不是 JSON schema 变化或请求太快的证据，也不能外推到用户自己的正常登录浏览器。

| 源码候选 | 实际机制/缺口 | 可得结论 |
| --- | --- | --- |
| [jeffweisbein/redd](https://github.com/jeffweisbein/redd/blob/main/lib/api.js) | cookie 驱动 `old.reddit.com/search.json`，支持全站帖子 query/sort/time；search 只返回当前页数组，没有 after 入参/游标返回；最后 push 为 2026-02-19 | 是“会话 + HTTP”的代码实例，不是当前可用证明；不直接安装作为生产采集器 |
| [agents-io/reddit-unofficial-api](https://github.com/agents-io/reddit-unofficial-api/blob/main/src/index.ts) | 在已登录 Chrome tab 中通过 CDP 执行带会话 fetch；全站 search 仍调用 `.json`，搜索工具没有 after 入参；最后 push 为 2026-09-13 | 不是新的无认证接口；README 的无限额/不可识别等说法无验收依据，且默认还暴露写入工具，不原样接入 |
| [preaverage/reddit-mcp](https://github.com/preaverage/reddit-mcp/blob/main/internal/reddit/api.go) | 有 search/sort/time/after 实现；其 [HTTP client](https://github.com/preaverage/reddit-mcp/blob/main/internal/reddit/client.go) 依赖浏览器会话的 web token、额外 TLS/headers 模拟与刷新；最后 push 为 2026-09-11 | 比前两者更完整，但不能等同普通 fetch 或纯浏览器 DOM 采集；未运行、未复用伪装组件，也无本环境当前登录成功证据 |

几个候选都没有证明“仅添加 cookie 即可在所有环境恢复”。Redlib 的 [#582](https://github.com/redlib-org/redlib/issues/582)、[#597](https://github.com/redlib-org/redlib/issues/597)、[#598](https://github.com/redlib-org/redlib/issues/598) 分别记录 10 月认证、限流、帖子 JSON 解析失败，是反对“有开源工具就稳定”的近期证据，不证明所有实例均失败。

下一项能改变结论的检查是在用户本人可正常访问的浏览器中：全站搜一个词，确认正文/日期和下一页，再检查普通页面驱动读取能否保留分页与结果身份；若测试会话内结构化读取，单独记录其实际状态，不从 UI 可用推断 `.json` 必然可用。仅做只读、有界验证，遇到限流/挑战停止，不公开 cookie/token。验证持续监测时用最新排序并重叠去重；临时历史搜索继承站内索引与分页边界，不承诺任意词的历史全部命中或无限回填。获得一次结果之后仍须验证会话失效、分页和持续负载，才能判断“够用”的实际边界。

本轮没有可用的用户登录会话，未完成上述关键检查，没有安装第三方代码、修改业务代码或部署。匿名响应及 GitHub 元数据在忽略的 `output/research/reddit-direct-20261023/`。

#### 热点站、信息雷达与采集助手的源码复核

以下固定项目快照于 2026-10-23 核查；不以未复查的后续版本推断当前能力。核查 GitHub 原仓库、固定提交与采集代码，而不是把搜索命中的 fork 或宣传中的“全网搜索”当作原始平台访问能力。结论：**优先验证 OpenCLI 的 Reddit 浏览器 adapter；Agent Reach 是可选的多平台会话/工具层；AIHOT、TrendRadar、BettaFish 不能直接替代 Reddit 获取入口。**

| 项目 / 核查提交 | 实际数据入口 | 对当前项目的价值与限制 |
| --- | --- | --- |
| [AIHOT](https://github.com/KKKKhazix/AIHOT/tree/b3998dc6fc138eb9659f33f55eb38c1c716f0d57)，MIT | [collect.ts](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/sources/collect.ts) 分派 RSS/网页列表/JSON；X 经 SocialData，公众号经 Dajiala，部分网页经 Jina；也接受外部脚本推送 | 本快照没有专用 Reddit 搜索采集器。公开仓库只含示范信源，生产信源名单/运营数据未公开。适合借鉴筛选、事件归组、信源调度，不把它整体再部署成第二套本项目 |
| [TrendRadar](https://github.com/SANSAN0/TrendRadar/tree/68c8916c450f8c8dd36cb88a189f7c2e46681ab5)，GPL-3.0 | [fetcher.py](https://github.com/SANSAN0/TrendRadar/blob/68c8916c450f8c8dd36cb88a189f7c2e46681ab5/trendradar/crawler/fetcher.py) 默认请求 NewsNow `/api/s`，另读 RSS；MCP search 搜已积累的热榜/RSS | 热榜样本的关键词过滤不是 Reddit 全站历史搜索。可借鉴提醒/分析；要新增热榜来源时直接评估 NewsNow，避免多绕一层 |
| [NewsNow](https://github.com/newsnext/newsnow/tree/0560c993b226cd2fd07d8a79875d50551f52c584)，MIT | 各站专用 HTTP/RSS adapter；[AIHOT adapter](https://github.com/newsnext/newsnow/blob/0560c993b226cd2fd07d8a79875d50551f52c584/server/sources/aihot.ts) 本身也是读 AIHOT RSS | 是上游聚合器，不是每站的完整搜索接口。本快照 `server/sources` 未见 Reddit adapter；NewsNow→AIHOT→原信源不能重复算独立来源 |
| [BettaFish](https://github.com/666ghj/BettaFish/tree/b67928ff1ce515dd7672408221fb1e9500d0972d)，GPL-2.0 | [QueryEngine](https://github.com/666ghj/BettaFish/blob/b67928ff1ce515dd7672408221fb1e9500d0972d/QueryEngine/tools/search.py) 用 Tavily，MediaEngine 用 Bocha，InsightEngine 读数据库；MindSpider 调 MediaCrawler | 本快照爬虫支持 xhs/dy/ks/bili/wb/tieba/zhihu，不含 Reddit。多 Agent 报告不能证明自采解决，搜索服务和模型也可能产生费用 |
| [Agent Reach](https://github.com/Panniantong/Agent-Reach/tree/beabda7486e9a666360b18cdb5c0e759c2c4d20f)，MIT | [reddit.py](https://github.com/Panniantong/Agent-Reach/blob/beabda7486e9a666360b18cdb5c0e759c2c4d20f/agent_reach/channels/reddit.py) 的站内动作实际调用 OpenCLI，共享管理浏览器会话，统一 JSON/错误输出；另可走公开网页搜索 | 是有用的工具/会话层，不是独立 Reddit 数据库。当前 search 包装只暴露 query/limit，没有 sort/time/续页参数；正文映射不读取 OpenCLI 的 selftext，不能直接当完整采集契约 |
| [OpenCLI](https://github.com/jackwener/OpenCLI/tree/fe5f1d96aff01c32fd84f86b52af922bfe6ca93f)，Apache-2.0 | [search.js](https://github.com/jackwener/OpenCLI/blob/fe5f1d96aff01c32fd84f86b52af922bfe6ca93f/clis/reddit/search.js) 在浏览器会话内执行；[web-search.js](https://github.com/jackwener/OpenCLI/blob/fe5f1d96aff01c32fd84f86b52af922bfe6ca93f/clis/reddit/web-search.js) 取网站搜索排序/ID、跟随网页 cursor，再经 by_id 批量补帖子字段 | 是最贴近全站帖子搜索与定时监测的候选。支持 query/subreddit/sort/time，命令上限 1,000 条、内部最多 10 页，不代表能取满或完整；CLI 不暴露可持久化的下一页 checkpoint。读取阶段仍有 JSON 依赖，没有消除访问限制 |

另核查 RSSHub 的 `a630023ed0c0398f9610f7aeea36ec2dea7e126e` 完整树：未找到以 Reddit 命名的专用路由，不作为已验证的 Reddit 接入路径；它作为其他平台 RSS 转换器的价值，仍需逐路由验收。

OpenCLI 的 [#2604](https://github.com/jackwener/OpenCLI/issues/2604) 有用户报告：同一登录会话中传统 search.json 多词排序差，网站搜索结果更相关，局部补丁曾取得 25 条唯一且字段齐全的结果；维护者 10 月 17 日确认合入网页排序/补全实现，同时明确没有独立重新验收真实登录排序。它比“README 写支持 Reddit”更有证据，但仍不是本环境或持续负载验收。[#2697](https://github.com/jackwener/OpenCLI/issues/2697) 还记录可读初始评论但可选展开返回 403 的差异，不把读帖成功外推为全部接口可用。

Agent Reach 的 [#642](https://github.com/Panniantong/Agent-Reach/issues/642) 则针对旧 rdt-cli 后端，用户对不同 HTTP 客户端的成功/失败报告并不一致；不能套给当前 OpenCLI 后端，也不能得出只换 urllib/requests 就必定恢复。固定源码/安装版本与实际选中的 backend，才能比较实验结果。

本轮对固定 OpenCLI `web-search.js` 做了 **3 个离线浏览器合成场景**：两页去重并按网页排序恢复乱序补全、429 单次终止、403 单次终止，均通过；仅复用现有 Playwright/Chromium，未安装第三方包，浏览器外网请求为 0。只验证纯搜索函数和最小响应 reader，不覆盖完整 CLI/扩展/账号/真实页面。源码、提交信息和结果在忽略的 `output/research/aggregation-projects-20261023/`。

取舍：OpenCLI 提供最接近需求的获取代码，真实会话和分页/完整性契约仍需验收；Agent Reach 的会话层留到多平台明确需要时评估。其他项目优先借鉴过滤、事件归组、提醒与报告，不重复部署数据库/调度。不同许可证的复制、修改和发布义务在选定复用方式时核查；独立进程调用不自动豁免。具体实现与验收见[工程路线 E1](../plans/source-expansion.md#e1打通本地浏览器到现有工作台)。

#### JSONL 独立复核与 ego-lite 的位置

2026-10-23 复核原 JSONL 会话、保存的请求/响应及关键源码，而非采信会话总结。直接运行证据是：Arctic Shift 三次真实数据请求成功（社区小样本，非全站搜索），匿名 Reddit 两次请求被网络安全 403 拒绝，以及 OpenCLI 三个离线合成场景；GitHub 文件获取、维护者报告与官方公告属于源码/文档证据，不属于这些采集器的真实运行验收。最新内容距查询约五分钟不等于索引延迟或召回率。13 位评论 ID 刷新缺陷本次再次离线复现，网络调用为 0；它不解释匿名 403，也不决定当前优先的帖子搜索是否可用。

对固定 OpenCLI 搜索函数另做三个离线边界复现，外网请求为 0，证据在忽略的 `output/research/reddit-audit-20261023/`：

- 页面有后续 cursor、已达到 `limit` 时，函数先清空 `next`，返回 `capped=false`。没有截断警告也不能判定完整；原三个场景没有断言这个边界。
- 补全只返回部分帖子时，函数有 `missing`，但 CLI 只输出剩余行并把缺失写成日志；`capped` 同样未进入结果数组。接入需要结构化保留这些状态，不能只读取 stdout JSON 数组。
- 搜索页成功但 `by_id` 返回 403 时，函数直接返回登录墙结果，不返回已发现 ID。页面读取和 JSON 补全是两个独立访问条件，应分别验收。补全不可用时可另验收从可见结果/详情 DOM 提取必要字段；这是待开发替代，不是 OpenCLI 现有成功能力。

Agent Reach 还把空列表归为上游失败，且统一 `text` 不读取 `selftext`（原字段仍留在 raw）；用于后台监测前须区分正常零命中，并明确正文映射。当前 worker 在提交前拒绝 `exhausted=false && nextCheckpoint=null`，所以“CLI 返回数组→薄 adapter”尚缺可恢复分页契约，伪造 exhausted 会误推进高水位。一次 CLI 命令内部包含多次搜索/补全 HTTP，命令次数不能当实际请求次数。

10 月 23 日从 GitHub 复核时，六个项目的最新提交与当时固定快照一致；OpenCLI 后续变化另见下文 10 月 26 日核查。NewsNow 已迁到 [newsnext/newsnow](https://github.com/newsnext/newsnow)，旧 GitHub 页面重定向，原提交仍可读。依赖判断不变：TrendRadar 默认依赖 NewsNow，NewsNow 的 AIHOT adapter 读取 AIHOT RSS，Agent Reach 的 Reddit 后端依赖 OpenCLI，不能按项目数量计算独立上游。

[ego-lite 固定提交 `d392204`](https://github.com/citrolabs/ego-lite/tree/d392204d1ea1a8027a591ab2b0129c2e11d85f26) 的 README、Node helper 源码与原生绑定文档表明：它提供本机已登录浏览器、TaskSpace 和 `page.evaluate`/`page.fetch` 等执行能力；当前 README 支持 macOS/Windows，Linux 仍在路线图。公开仓库是 helper/skill 等，浏览器原生绑定由单独下载的应用提供，不能因仓库 MIT 就推断可在 Linux 编译完整浏览器。本环境未发现 `ego-browser` 命令，未安装、未真实运行；宣传中的速度、低验证码率和免费不构成 Reddit 稳定性证据。

OpenCLI 当前通过 daemon + Browser Bridge 扩展调用 Page，ego-lite 使用自己的原生桥；页面执行能力相近不证明完整 CLI 可直接切换。Agent Reach 也绑定自己的浏览器 profile。当前采用 Chrome + OpenCLI；用户已因 Linux 支持要求排除 ego-lite，不再安排其执行环境试验或适配。模型生成查询和分析不提供新的原始数据权限。

2026-10-26 重新读取 [OpenCLI aeaff2b](https://github.com/jackwener/OpenCLI/tree/aeaff2b796efabb7fd46654112418ab61fcae917) 的 package.json、search.js、web-search.js 与安装说明：版本仍写 2.0.2，上述 capped、补全和输出元数据缺口仍见于源码；这是源码审查，没有重新运行真实搜索或新增离线验收。固定 npm 版本之外还应记录实际 adapter/覆盖配置及扩展版本。ego-lite 默认分支仍为 d392204，平台与原生绑定结论未变。单账号吞吐、账号池增益和长期十二小时新鲜度均没有本项目可采信的实测结果。

部署、规范页/导入回执、预算与恢复设计只维护在[架构](../architecture.md#浏览器采集部署与结果契约待实现)；起步命令在[开发说明](../development.md#本地-reddit-浏览器验证)。当前未实现有界导入、自动上传或远程任务领取，研究结论不等于开发交付。

## 成本口径

目标为 **$0.07 / 1,000 条有效独立内容及以下**。有效内容必须通过 schema/身份校验并成功落库；分别记录帖子、评论、去重后内容和更新观测，不能将重复刷新当成新帖子降低单价。

`有效成本/千条 = 全部可归属实际费用 ÷ 窗口内去重后的有效内容数 × 1000`。

分母为 0 时报告不可计算，不能记 0 成本；还要报告请求成本和失败率。赠送额度不抵扣用于选型的正常费用，试用后费用超标直接排除。预测、实际请求估算、供应商账单分别存证；服务器/存储成本另列。跨 provider 的新增边际覆盖也单独统计，避免用同一批重复内容证明备用价值。

### 低价商业候选（仅文档报价，未带凭证实测）

| 来源 / 端点 | 核对的正常标价 | 达标所需有效独立条数/次 | 下一验证点 |
| --- | --- | --- | --- |
| [TwitterAPIs 标准读取](https://www.twitterapis.com/pricing) | $0.0008/次 | ≥12 | 账号与关键词分别统计；20 条满页等效 $0.04/千条，不能假定总是满页 |
| [TwitterAPIs replies-complete](https://www.twitterapis.com/pricing) | $0.0024/次 | ≥35 | 继续游标、直接/嵌套回复边界、截断；不能套用标准端点价格 |
| [GetXAPI 标准读取](https://www.getxapi.com/pricing) | $0.001/次 | ≥15 | 搜索/时间线具体端点价、空页和重试计费 |
| [Redditapis 普通读取](https://www.redditapis.com/pricing) | 10 月 20 日：$0.0015/次，付费充值从 $10 起；另有页面标称每月 1,000 次免费读取 | ≥22（付费部分） | 先核对持续免费档，不充值；评论分页/树截断、实际页收益与特殊端点另价仍需验证 |
| [CiteRocket 标准读取](https://www.citerocket.com/pricing) | 10 月 20 日：公开订阅从 $19/月、25,000 credits 起；标准读取 1 credit | 按整月实际使用量算，不套满额单价 | 当前页面未复核到旧 $10/10,000 包价，不沿用；一次性免费 1,000 credits 不算持续免费来源，本轮不采购 |

10 月 19 日补充：TwitterAPIs 价格页自述整体平均约 13 条/次、搜索约 8 条/次。搜索按正常价折算约 **$0.10/千条**，尚未计失败、重复与无效记录，不能按 20 条满页报价认定达标；下一步仅优先考察账号读取。TwitterAPIs/GetXAPI 的购买充值起点均为 $10，不等于少量调用费或采购授权。

阈值按 `ceil(1000 × 单次价格 / 0.07)` 计算，假设每次均按该价且不含额外费用。TwitterAPI.io 已有 adapter，仅保留实现作回归基线；原研究的 $0.15/千条报价高于目标，不列入计划采购或付费备用。X 官方、SocialData 同样不列入本轮低成本接入计划；后续仅在正常价格满足准入条件时重新评估。

## 来源清单与当前处置

下表保留已有实现与候选的处置依据，不另排实施顺序。Arctic Shift 在 main、Bluesky 在 dev/root 已有有界真实小样本闭环，其余候选未完成本仓库真实接入验收。

| 来源 | 目标与接入类型 | 验证重点 / 取舍 |
| --- | --- | --- |
| [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) | Reddit 帖子、评论、ID；现有 adapter | 保留历史补充/抽样与受限查询恢复；维护者已说明新 ID 后近期评论不完整且可能延迟，不能保证增量新鲜度或全量覆盖 |
| [PullPush](https://pullpush.io/) | Reddit 搜索线索，REST；当前暂停免费接入 | 本环境首次数据请求 429 且明确拒绝免费 agent 抓取；未重试、未绕过、未开发 adapter。若需商业授权，重新核对正常费用后再决定 |
| TwitterAPIs / GetXAPI | X 账号、查询、回复；REST | Reddit 主线之后按正常长期成本择一；当前未授权凭证/付费，不并行实施 |
| Redditapis / CiteRocket | Reddit 补充候选；REST，未接入 | Redditapis 先核对页面标称的持续免费档；CiteRocket 仅一次性赠额，不作为免费主源。付费方案当前排除，上游独立性与商业使用权限均未验 |
| [Apify / Fatih Reddit Actor](https://apify.com/fatihtahta/reddit-scraper-search-fast) | 搜索、社区、帖子/评论候选；未接入 | 仅比较每月 $5 免费额度内的小样本；FREE 档 $1.49/千结果，超额不符合单位成本目标，不充值、不按广告起步价外推 |
| [Bluesky AppView](https://docs.bsky.app/) | dev/root 首个新平台试点，未合入 main；公开账号帖子与作者回复已有有界闭环 | 原生 AT URI 身份、opaque cursor；排除 feed 中他人转发和置顶。两页真实闭环通过，未知指标时刻保持 null；未验持续运行与完整覆盖 |
| [Steam 评论](https://partner.steamgames.com/doc/store/getreviews)、[Forem](https://developers.forem.com/api/v1) | 评价/文章评论候选 | 第二批用于检验 cursor 与嵌套评论差异；核对目标类型与指标单位 |
| [HN Firebase](https://github.com/HackerNews/API)、[Algolia](https://hn.algolia.com/api) | 技术讨论与搜索候选 | 按节点读取的请求放大、父子关系和删除；两接口不算独立内容供应链 |
| [YouTube 评论](https://developers.google.com/youtube/v3/docs/commentThreads/list) | 大规模评论候选，需项目/key/配额 | 视频发现与评论预算分开，顶层列表不等于完整回复；配额以接入时控制台/官方文档为准 |
| [FxEmbed](https://github.com/FxEmbed/FxEmbed)、[vxTwitter](https://github.com/dylanpdx/BetterTwitFix) | X 已知 ID 补全线索 | 先验证具体公共实例和端点，不将 embed/镜像宣称为稳定搜索备份 |

Bluesky 字段依据官方 [getAuthorFeed lexicon](https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/feed/getAuthorFeed.json) 与 [postView/feedViewPost](https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/feed/defs.json)，并以真实小样本核对。接口无需鉴权，不等于无限配额或 SLA。证据放忽略的 `output/validation/e1-pullpush/`、`e1-bluesky/`，不提交原始内容。

## 后续候选池

保留研究的覆盖范围，暂不逐家实施；进入试验前重新核对官方端点、费用、权限和维护状态。

| 领域 | 线索 | 暂缓原因 / 所需证据 |
| --- | --- | --- |
| 连续流 | [Bluesky Jetstream](https://github.com/bluesky-social/jetstream)、[Nostr NIPs](https://github.com/nostr-protocol/nips) | 删除事件、断线回放和 checkpoint 语义不等同普通分页；不沿用原文未复核的 v2/回放承诺 |
| 联邦社区 | [Mastodon](https://docs.joinmastodon.org/methods/timelines/)、[Lemmy](https://join-lemmy.org/docs/)、[Misskey](https://api-doc.misskey.io/)、[PeerTube](https://docs.joinpeertube.org/api-rest-reference.html) | 按实例验证版本、匿名访问、覆盖和回复截断 |
| 专业讨论 | [GitHub](https://docs.github.com/en/rest)、[Stack Exchange](https://api.stackexchange.com/docs)、[V2EX](https://www.v2ex.com/help/api)、[Discourse](https://docs.discourse.org/) | 先选具体目标，核对鉴权、分页、配额与站点配置 |
| 授权社群 | [Telegram TDLib](https://core.telegram.org/tdlib/docs/)、[Discord](https://discord.com/developers/docs/resources/message) | 会话/机器人权限与可访问范围，不能当全平台搜索 |
| 网页与资讯 | [RSSHub](https://docs.rsshub.app/)、[GDELT](https://www.gdeltproject.org/)、[Common Crawl](https://commoncrawl.org/)、网站 RSS | RSS 逐路由验收；新闻/网页不替代原平台评论；自建与归档有资源成本 |
| 其他条件来源 | [Product Hunt](https://www.producthunt.com/v2/docs)、[4chan](https://github.com/4chan/4chan-API)、Threads、Instagram、TikTok Research | 用途、访问资格、数据保留与具体端点先核对 |
| 中文站点 | Bilibili、微博、知乎、小红书、抖音的授权接口或 RSSHub 路由 | 未确认满足成本/稳定/覆盖要求的通用接口，不能列为已可用平台 |

Neynar 原研究主要依据赠送 credits，尚无本项目负载下的长期低成本依据，移出候选池；其他仅有试用优势的来源同样处理。

## 从原研究中修正的结论

- 历史原文的 API/RSS 时间表最初未获证实；10 月 23 日已通过官方 Help Center JSON 全文核对并在上文替换。Nitter 归档日期、Jetstream v2 能力和未复核的平台配额仍不作为设计前提，不能把这两类证据混写。
- 不以服务商 SLA、免费额度、最大页大小推断实际稳定性或成本；不把两家归档服务或多个镜像域名算成独立原始来源。
- 不将“422 重试”写成待新增能力：当前已经有限重试；缺口是错误分类后的有界恢复和可观测性。
- 不建设支持任意 URL/脚本的通用平台。浏览器读取先验证实际能力，再以共享身份、观测与写入规则接入；REST 和浏览器各保留自己的分页限制，不强套缺少结束语义的接口。
- 原文聊天提示、UI 占位、整段原始响应和重复推荐已删除；原研究可在 Git `d8b481b` 查阅。具体许可不在此下结论，试验与生产用途分别记录核查状态。
