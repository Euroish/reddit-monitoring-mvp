# 数据源研究与选型

复核日期：**2026-11-10**。重读供应商公开价格/接口文档、X 开源项目 README、提交元数据及 OpenCLI X 搜索源码；没有供应商带凭证数据请求、充值、购买或真实 X 会话验收。历史运行结果保留原日期。公开页面快照、获取状态在忽略的 `output/research/paid-review-20261110/`；本机直接读取 CiteRocket 价格/搜索说明网页得到 403，相关页面本轮由联网检索工具读取；这不证明带凭证 API 同样被拒绝，首测必须核对 Linux 出口。页面内容不证明取数质量。当前实现与历史验证见[状态](../status.md)。

2026-11-13 实现补充：kaix 已接入现有工作台，默认关闭，覆盖始终 partial，无持久化续页；此前独立收费试验与后续业务接入分别记录。配置与重放保护见[开发说明](../development.md#reddit-kaix--apify)，接入和部署证据见[状态](../status.md)。其余候选仍按下述研究与成本准入判断。

**当前选择：并列研究低价 API 与新的自采实现，只有真实取数和预算验收通过才接入，暂不采购。** 用户明确目标 $0.07/千条、硬上限 $0.10/千条，预期约 10 万条/月且总费用≤50元；同时约束，不能以数据收益豁免。低价 API 优先核验 opportunity-biz Actor 的可用性与完整账单，CiteRocket/Redditapis 保留赠额内页收益对照；自采优先研究 Reddrix，Scrapling 为通用工具候选。目前都未证明满足此负载与预算。Arctic Shift 保留定向/已知 ID 补充，完整评论延后。X 的免付费 API 路径先验证正常账号会话，不依赖 Nitter 公共实例。官方申请、全站 dumps 前置和 ego-lite 继续排除。唯一实施顺序见[工程路线](../plans/source-expansion.md)，设计见[架构](../architecture.md#付费-reddit-provider-接入设计待实现)。

## Reddit 付费候选与正常价格

以下均为供应商自报报价，美元、未含税/支付费用；不是本项目真实账单、覆盖或稳定性验收。按相同端点、相同负载和真实有效页收益比较，免费赠额只降低试验现金支出。

| 候选 / 一手价格来源 | 普通读取正常费用与入门支出 | 当前取舍 |
| --- | --- | --- |
| [CiteRocket](https://www.citerocket.com/pricing) | $10/10,000 credits 一次包；普通读取 1 credit，即 $0.001/次。另有 $19/月、25,000 credits；注册赠 1,000 credits 是一次性 | **仅赠额内验证**；至少平均 10 条有效独立内容/全部收费尝试才到 $0.10，15 条才到 $0.07；月费还须≤50元 |
| [Redditapis](https://www.redditapis.com/pricing) | 按量 $0.0015/普通读取，最小充值 $10；每月 1,000 免费读取与注册 $0.50 分开。月包 $19/30,000、$49/100,000 次读取，未用额度滚存一个月 | **暂不采购**；其自报搜索收益对应单价超硬上限。赠额可对照，$19 月包不进入当前预算方案 |
| [ScrapeCreators](https://scrapecreators.com/) | $47/25,000 credits，折合 $0.00188/credit；$497/500,000 为 $0.000994/credit。[Reddit 搜索](https://docs.scrapecreators.com/v1/reddit/search/) 为 1 credit/请求；缺 upvote_ratio，按需详情补全另计 | 不采购；仅当另有可用免费样本时比较页收益，不为低价大包预购 |
| [SociaVault](https://sociavault.com/pricing) | $29/6,000 credits，约 $0.00483/credit；$399/200,000 约 $0.001995/credit；端点消耗另核 | 当前价格不占优，不采购/接入 |
| [Apify / Fatih Actor](https://apify.com/fatihtahta/reddit-scraper-search-fast) | 店面 from $1.19/千结果；11 月 10 日公开元数据再次确认 FREE 档为 $1.49/千结果、GOLD 及以上 $1.19，不能用起步价替代所选档位；平台/附加操作费用按实际计划核对 | 正常价超过 $0.10 硬上限，排除当前付费接入；免费样本不改变长期成本 |
| [Bright Data 社交采集](https://brightdata.com/products/web-scraper/social-media-scrape) | 正常按量 $1.50/千条交付记录，$499/月含 384,000；页面列 Reddit 关键词发现/帖子/评论，并标称每月 5,000 免费记录 | 正常价超过硬上限，排除当前付费接入；不以免费档或品牌替代成本准入 |

CiteRocket [搜索文档](https://www.citerocket.com/docs/listings/search) 公开全站/限定社区 q、new 等排序、time 档、limit 1–100 和 after cursor。它证明接口形状，**不证明 100 条页收益或任意 [from,to) 历史完整召回**。Redditapis [文档](https://www.redditapis.com/docs) 的普通搜索和高级深搜/评论展开不能混价：价格页把深度评论搜索和扩展评论列为 $0.02/次。首期不用高级评论端点。

### 页收益、质量与套餐比较

Redditapis 价格页公布的 14 天样本截至 10 月 29 日：成功读取的帖子搜索中位返回约 **9 条/次**、社区帖子约 25 条/次。按量折算分别约 $0.167 / $0.06 每千条返回内容，尚未扣无效/重复。样本排除失败且由供应商自行选择/统计，中位数也不等于项目平均页收益；不能据此计算我们的月度账单或认定它比 CiteRocket 完整。CiteRocket 尚无可比的本项目页收益证据。

下列切换点仅保留价格研究，$19 月包不属于当前≤50元/月的计划。按无赠额正常价，CiteRocket $19 月包相对本家 $0.001 按量在约 19,000 次/月持平；Redditapis $19 月包相对本家 $0.0015 在约 12,667 次持平。**跨商比较**时，若质量/页收益相同，Redditapis $19 月包要超过约 19,000 次/月才比 CiteRocket 小包按量有利；满用 30,000 次相当于 $0.000633/次。实际用量不足就按固定月费除以实际有效内容，不能套满额单价。免费档、滚存和更大档位在账号确认后单列计算。

Redditapis 的监测订阅与读取月包是不同产品：免费一个全站关键词，$19/月 Starter 标称 15 个 monitors 但仅 **1 个全站关键词**，$49 Growth 仅 3 个全站关键词。不能把“15 monitors”写成 15 个全站词，也不能假设读取月包附送监测。少量词低频轮询先用 API，webhook 不作开发前置。

当前方案没有证明既满足 10 万条/月与预算、又满足数据质量的商业主源。没有新的独立长期数据质量证据足以授予“最稳定”结论。旧研究 10 月 23 日的 Redditapis 少量短评、Apify 平台运行成功率不证明覆盖/新鲜度。本次 Fatih 店面仍有二十余评分与数千月用户，仅作历史运行规模参考，不能绕过成本准入；[opportunity-biz Actor](https://apify.com/opportunity-biz/reddit-scraper) 已核对公开计费元数据，提升为低价待测候选，细节见下节；低使用量不证明不可用，也不证明质量。域名或公司页面不同不证明上游独立；商业用途、留存/删除与可导出权限仍未核实，真实试验和生产分别记录。

## Reddit 新增低价与开源路径复核

11 月 10 日按用户要求重新寻找自采路径。以下区分真实联网、源码审查和供应商自报；没有安装/运行 Reddrix、Scrapling 或新增浏览器扩展，也没有运行付费 Actor。当前服务器测试不代表正常个人设备的访问结果。

### 低价 API：opportunity-biz 值得先试，但尚未通过准入

[店面](https://apify.com/opportunity-biz/reddit-scraper) 标价 $0.05/千结果；本服务器直接读取的[公开元数据](https://api.apify.com/v2/acts/opportunity-biz~reddit-scraper) 为 200，最新已生效 pricingInfos（2026-06-10 起）确认 `apify-default-dataset-item=$0.00005`、`apify-actor-start=$0.0001`。旧 $0.01/千条是历史促销，不能使用。启动事件按每 GB、至少一次；默认内存 1GB。10 万条结果的结果费为 **$5**；若每轮 1GB、共 1,800 次启动，再加约 $0.18，合计 $5.18 **仅为这两个事件费用**。去重后有效收益、数据集读取/留存、另收平台用量、支付费用与现金门槛尚未确认，不能当作总账单。

[Apify 官方计费说明](https://docs.apify.com/actors/running/actors-in-store) 指出多数 PPE 已包含运行平台用量，部分单独计费，结束后数据集操作另计；不能像先前那样无条件认定必须叠加一套 compute/proxy 费，须核对具体运行账单。正常批次与常驻 Standby/MCP 不能混价。此处只研究普通批次，不部署常驻 MCP。

公开元数据的修改日期为 7 月 7 日，8 个累计用户、近 30 日用户数 0、无评分、lastRunStartedAt 为 10 月 6 日；同时滚动运行统计有 1 次 succeeded，字段时间口径存在不一致。这些统计不证明当前搜索/续页可用。README 自称新鲜、可靠、无需登录均未独立验证。**当前 API 首测候选**：有可用赠额时先检验跨社区关键词首/续页、已知帖子正文、近期发布时间、重复与收费事件；若返回空集、旧归档或仅社区搜索，不继续集成。没有账号凭证/赠额，本轮未执行。

新查的 [FetchLayer](https://fetchlayer.dev/pricing) 正常按量 $1.99/千页（每页一 credit，多页分别扣），至少平均 20 条有效独立内容/收费页才到 $0.10/千条、29 条才到 $0.07；正常页收益未验，价格不优于既有按次候选。[ChatterAPI](https://chatterapi.com/pricing) 最小 $19/月、25,000 credits，普通 Reddit 读取 2 credits/页，固定月费超过当前预算，不入选。

### GitHub 项目按实际获取机制比较

| 项目 / 核查版本 | 已读到的实现或限制 | 当前取舍 |
| --- | --- | --- |
| [Reddrix / 55815c5](https://github.com/Coding-Doctor-Omar/reddrix/tree/55815c54c6c9c8a0cbe7bd0239342cb5f5af9297)，11 月 6 日 v1.2.19 | [源码](https://github.com/Coding-Doctor-Omar/reddrix/blob/55815c54c6c9c8a0cbe7bd0239342cb5f5af9297/reddrix/reddrix.py) 以 Camoufox 初始化匿名会话，读取新 Reddit HTML/internal endpoints，解析 shreddit/faceplate 续页；不是只包一层 `.json`。Linux 有平台分支。关键词模式固定 relevance，忽略传入 new；每个搜索命中另取详情，首屏不是正文终态。内部默认并发 10、初始化最多 5 次，无应用级持久 checkpoint/费用上限 | **最值得继续验证的新自采候选**，不是已跑通方案。先固定版本、限定 1 并发/总请求/时长/5 条，禁评论展开；拒绝/挑战即结束，不沿默认反复刷新、代理轮换或共享账号继续。relevance 不能直接用于 new 增量水位 |
| [Scrapling v0.5.1 / 3a4bb5b](https://github.com/D4Vinci/Scrapling/releases/tag/v0.5.1)，11 月 4 日 | 更新新增 RemoteSession/AsyncRemoteSession，可选复用已登录 Chromium context；远程连接有破坏性 API 变更。是通用获取/解析框架，未提供已验收的 Reddit 搜索 provider。维护者在 [#402](https://github.com/D4Vinci/Scrapling/issues/402#issuecomment-5232610398) 说明匿名 JSON 被 Reddit 拒绝；issue 报告 HTML 可读是他人的环境结果 | 通用工具备选。旧 bridge 的 sessionKey 不是持久登录；升级库或远程 CDP 不会凭空产生可用登录会话。本次没有 Scrapling runtime 验收 |
| [reddit-universal-scraper / 6ff956b](https://github.com/ksanjeev284/reddit-universal-scraper/tree/6ff956bb009f769204c31b9978ee9c6bee28114b) | Python 主路径明确依赖 approved OAuth；另有开源 Browser Collector Companion，捕获本人浏览器已加载的帖子/评论并导出 JSON/CSV，cookies 留浏览器。不自动获取全部历史或展开未加载评论 | 正常个人设备可访问时的低费用备选；云端登录仍被拒绝时不能解决。现有仓库没有该导入能力，不照搬对方后台 |
| [BigIdeasDB reddit-mcp-server](https://github.com/bigideas-db/reddit-mcp-server) | README 明示仓库只放文档，服务闭源托管，需 Pro、Clipper 扩展和本人已登录 Chrome；作者自报 11 月 2 日 185/185 页成功，单账号/单浏览器/单次测试 | 说明“个人浏览器取数、服务器存储”机制有实际报告；不是免费开源服务端替代，不采纳“唯一可用”的自我宣传，未独立复验 |
| [eliasbiondo/reddit-mcp-server](https://github.com/eliasbiondo/reddit-mcp-server) → [redd / 57fc9f2](https://github.com/eliasbiondo/redd/tree/57fc9f2acdeeda3d446ba48c1b0fe6ebb4931643) | MCP 依赖 redd，后者 `_client.py` 与 requests HTTP adapter 仍走 reddit.com JSON listing；MCP 包装不提供新的获取通道 | 当前服务器的匿名 JSON 路径已受阻，不优先再部署包装层 |
| [logiover/reddit-search-scraper](https://github.com/logiover/reddit-search-scraper) | 仓库仅说明托管 Actor；README 明示必须限定社区，每搜索约 25 条、无续页、score/numComments 等为 null，读取 public feed | 不满足跨社区关键词与持久续采需求；不能因为标题 no-login 就视为全站搜索 |

Redlib 的新 [#612](https://github.com/redlib-org/redlib/issues/612)（11 月 3 日）报告直接被阻断，与旧认证/解析问题一并说明仍依赖 Reddit 上游；不是所有实例不可用的证明。不部署镜像集群来替代来源验收。Crawlee、Crawl4AI、Playwright 等通用框架也不能单凭更换框架证明 Reddit 可读。

### 本服务器真实 HTML 探测与下一步

11 月 10 日 06:34 UTC，使用现有 Chromium、全新临时 context，无登录、代理或 stealth，串行访问 `https://www.reddit.com/r/technology/new/` 与 `https://www.reddit.com/search/?q=postgresql&type=posts&sort=new` 各一次。每次仅观察到 1 个浏览器网络请求，均 **403**，正文为 network-security 阻断，shreddit-post 和帖子链接均 0；浏览器已退出，没有启动或恢复先前关闭的 systemd/noVNC 服务。报告在忽略的 `output/research/reddit-crawlers-20261110/html-probe.json`。这证明当前普通匿名浏览器 HTML 路径失败，**不等于已实际运行 Reddrix、Camoufox 或 Scrapling**，也不证明拒绝原因仅由 IP 决定。

执行优先级：①可用赠额内验证 opportunity-biz 的真实数据和账单；②Reddrix 作为一次有界、独立试验，先解决初始化与五条真实命中，再决定是否值得补 new 排序/页契约；③若服务器仍拒绝，而用户正常个人设备可访问，才考虑本地浏览器采集后上传到 Linux。第三条需要可用设备会话和新增导入用例，尚未实现。不会自动恢复 OpenCLI 登录服务、购买代理或搭账号池。预算/质量均通过才进入业务开发，没有来源通过则全站关键词目标仍未交付。

## X 不购买 API 的可行路径

这里的“不用 API”解释为不购买官方/第三方 API。OpenCLI、twscrape、Twikit 实际仍调用 X 网页内部接口，不是完全不接触 API；开发者承担登录和接口维护。以下只有文档/源码核查，没有本环境 X 数据验收。

| 方法 / 固定一手依据 | 能做什么、仍依赖什么 | 当前选择 |
| --- | --- | --- |
| [OpenCLI X search / 9bc5f5c](https://github.com/jackwener/OpenCLI/blob/9bc5f5ca132ec4d4e48d7ee517d4303bf159e8e8/clis/twitter/search.js)；11 月 7 日提交 | 读已登录 x.com cookie，在页面内请求 SearchTimeline；支持词、from、Latest/Top 与 cursor 内部翻页。需要正常浏览器/Bridge 会话 | **先试正常设备上的少量搜索**。源码在已有结果后遇错误可 break 并返回数组；最终 cursor/结束原因不外显，部分未知指标补零，不能直接当完整采集页 |
| [twscrape / d26aac0](https://github.com/vladkens/twscrape/tree/d26aac09325b7873a62c3a6ec92e7dea3c277051)；11 月 6 日提交 | 搜索、账号时间线、详情/回复；自持已授权账号会话，SQLite 保存 session，支持 cookie。默认缺账号时可能等待，limit 是目标条数而非请求硬上限 | 需要脚本化时的候选；单会话先试，设置运行时限/实际请求上限。README 的账号池功能不作为扩容依据，未知用户占位字段不能当真实指标 |
| [Twikit / c3b7220](https://github.com/d60/twikit/tree/c3b7220866f8582009fe2d1155b6fe92192a2711)；最新提交 3 月 10 日 | 无开发者 API key，文档示例仍需用户登录与 cookies；支持 Latest 搜索/时间线 | 后备研究；当前最新提交距今约八个月，未验登录可用性，不先同时维护第二套客户端 |
| [Nitter / 145ca9e](https://github.com/zedeus/nitter/tree/145ca9eb68d195a74598ae39a4d6da002b252c38) | GitHub 明示 **10 月 9 日归档**；README 记载下架要求，RSS 由实例决定且常关闭。匿名读实例只是将上游获取交给实例运营者 | **不作主源、不部署新实例**。修正旧文档“Nitter 归档日期未核实”；本轮未试公共 RSS，不能宣称所有 fork/实例均不可用 |
| [FxEmbed 官方文档](https://docs.fxembed.com/) / 已知链接预览 | 公开服务可补已知 post 链接的正文/媒体等；仍是依赖第三方上游的公共接口 | 仅为已知 ID 补全候选，缺少未知关键词发现，不作为全站搜索替代；本轮未请求内容端点 |

如果严格不调用接口，只从可见 DOM 读取，仍需要先有正常登录网页，且必须另实现/验证滚动、字段和结束语义；当前 OpenCLI X 搜索不是这条 DOM 路径。搜索引擎已索引链接只能作线索，不能证明完整正文、近期召回或评论树。本项目没有证明单账号可支撑大规模 X 采集，也没有免账号、免费且持续完整的全站方案。

### X 付费备选与成本转折点

下表保留报价研究，不代表通过当前成本准入或有独立采购预算；TwitterAPI.io 的正常帖子价已超过 $0.10/千条，只保留已有实现，不安排付费启用。其他 X 服务同样须先证明有效成本并纳入总预算。

| 来源 / 一手报价 | 正常价格与门槛 | 适用判断 |
| --- | --- | --- |
| [TwitterAPI.io](https://twitterapi.io/pricing)；已有 adapter | $0.15/千条**返回**帖子；每请求最低 $0.00015，空页也收费，充值额度不失效 | 稀疏词和小负载优先验现有实现；不是每请求固定 $0.00015。重复内容仍计费 |
| [TwitterAPIs](https://www.twitterapis.com/pricing)；不同服务 | 标准 $0.0008/次，页面充值选项从 $10；完整历史 $0.0024/次、完整线程 $0.004/次 | 密集有效页可能更便宜；其 10 月 22–28 日自报搜索均值 11.44 条/次、29.6% 搜索为空，约 $0.070/千返回条，未计去重/失败。修正旧 8 条均值与 replies-complete 混价 |
| [GetXAPI](https://www.getxapi.com/pricing) | 标准扣余额 $0.001/次；Starter $5 仅一次、4,500 次/30 天；Pro $15/月，卡付 $30 额度即 30,000 次，额外 $10 为 crypto 奖励 | 稳定高量再比；不把带 crypto 赠额的 40,000 次标题套给卡付，不沿用旧“统一 $10 起充” |

稀疏页比较必须逐请求计算：TwitterAPI.io 的帖子读取为 `max(返回条数, 1) × $0.00015`，TwitterAPIs 标准为每次 $0.0008。单次返回约 5 条以内前者更便宜；混合负载按全部请求求和，不能仅拿全局平均条数套 minimum。GetXAPI Pro 与 TwitterAPIs 标准按量在约 18,750 次/月持平（同等页收益、忽略赠额、仅普通端点），更低调用量月包可能浪费。两家未接入，不能只替换 TwitterAPI.io base URL。

## 成本与验收口径

用户明确：目标 **$0.07/千条有效独立内容**，硬上限 **$0.10/千条**，预期约 **100,000 条/月**，采集月度总费用 **≤50元人民币**。这取代此前“超目标按收益决定”的取舍规则；超过 $0.10 或月度上限即不采购。单价在 $0.07–$0.10 之间仍须满足月度总额，不自动放行。

10 万条按目标单价需 $7，按硬上限需 $10；人民币预算按实际结算汇率与支付费用再收紧，不能将两者同时视为可花满。设实际汇率 r 元/美元、当月其他采集支付费用 F 元，10 万条时可接受的美元单位价为 `min(0.10, (50-F)/(100*r))`；r/F 用实际报价或账单，不硬编码过期汇率。这里是来源采集费用，既有服务器/存储开销另列；不得为 X 或第二个 provider 各重复分配 50 元。

最低充值是现金门槛，月消耗是使用成本，分别列账；当前不采购 $10 充值或 $19 月包，不以余额未来可用替代预算检查。先用已有免费/赠额做无付费的小样本，赠额用尽即停；没有凭证时不运行。未来收费准入必须按不含赠额的正常价格核算，并验证真实扣费；没有预算合格来源时保留 Arctic Shift 定向/历史补充，全站持续关键词目标保持未交付。

`有效成本/千条 = 窗口内全部可归属费用 ÷ 去重且成功落库的有效内容数 × 1000`。

帖子/评论分开，新增内容与更新观测分开；空页、失败、重试、重复、补全和高级端点计入分子。分母为零报告不可计算。预测、请求估算与账单对账分别存证，服务器/存储/会话维护费用另列；跨 provider 新增边际覆盖另算。按全部收费尝试计算平均有效独立收益：CiteRocket 达 $0.10 需≥10条/次、达 $0.07 需≥15条/次；Redditapis 分别需≥15、≥22条/次。还须通过人民币月度上限，不能用最大 limit 或单页中位数推定达标。免费试用不抵扣用于长期选型的正常费用。

初始场景按 30 天、5 词、每两小时一轮一页约 1,800 次/月：正常按量消耗 CiteRocket $1.80、Redditapis $2.70，尚未含续页/失败/历史任务，也不是首次最低支出；该示例不证明能得到 10 万条，预算准入必须按实际需要的全部页数核算。详细实验、落库和持续验收只在[工程路线 E1](../plans/source-expansion.md#e1付费-reddit-搜索接入与持续验收)维护，不为每个候选同步开发 adapter。

## 历史采集证据与机制复核

以下取数/离线结果来自 10 月 16–26 日保存的原始响应、源码与 JSONL 独立复核；本轮未重新运行。10 月 28 日新增的真实事实是 OpenCLI/Chromium/noVNC 安装连通通过，随后 Reddit 登录被 network-security 阻断、验证码尝试失败，没有成功的登录搜索样本。浏览器服务已按用户要求关闭，11 月 10 日四项服务检查均 inactive。历史“未安装”只适用于其注明日期，不再表示当前机器没有 OpenCLI。

### 已保存的直接证据

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

### 官方路线背景（10 月 23 日核对，非本轮重验）

原 JSONL 通过公开 Help Center JSON API 读取的[官方 10 月 8 日 changelog](https://support.reddithelp.com/hc/en-us/articles/54353370049684-Changelog-October-8-2026)记载 public API 迁移及 RSS 停止支持的日期；本轮没有重新核对公告变更，不能用供应商转载代替官方复核。官方申请当前按用户要求排除，不把历史免费 Data API 配额作为可用性前提。Arctic Shift dumps 适合历史离线检索但有磁盘/处理成本，也不满足近期十二小时目标，当前不要求下载全站数据。

### 从访问机制反推可行路线（2026-10-23）

本轮用户明确排除所有需要官方申请的访问路线；必须同时支持全站关键词持续监测和临时历史搜索，完整评论可延后。以下保留官方能力的事实核查，但不将其作为本轮可选实施路径。定向社区采集不能替代全站关键词发现，全站 dumps 也不是本轮方案的前置条件。

决定可行性的两个环节是 **发现未知内容 ID** 与 **读取已知 ID 的内容/更新**。新评论 ID 破坏的是原先顺序扫号的发现方式；关闭匿名入口限制的是读取权限。解决其中一个，不等于另一个也解决。维护者说有替代采集方式，证明仍有方法，不证明其方法公开、可复制、免费或无缺失。

| 路径 | 技术依据与可取价值 | 本项目判断 |
| --- | --- | --- |
| 限定社区/账号的列表 + 已知帖子评论树 | 在获准接口中由列表发现 ID，再按目标帖子展开；不依赖连续 ID。仅轮询新帖子会漏掉老帖新评论 | 比全站扫号更适合有界监测，但必须先取得实际可用的读取权限；不是发现新匿名端点 |
| Devvit 社区合作与事件推送 | [Reddit API](https://developers.reddit.com/docs/capabilities/server/reddit-api) 面向安装社区；[事件目录](https://developers.reddit.com/docs/capabilities/server/trigger-events) 有帖子/评论创建、更新、删除事件；[发布说明](https://developers.reddit.com/docs/guides/launch/launch-guide) 明确由社区 moderator 安装 | 当前官方申请路线排除；仅作能力背景，不能进入实施队列。事件异步、可重复、部分字段可缺失；没有全站 firehose 或完整交付 SLA |
| Devvit → 本项目数据库 | [HTTP Fetch](https://developers.reddit.com/docs/capabilities/http-fetch) 技术上支持服务端 POST | 外发须逐域名/逐应用审核；当前个人域名默认不批准，限定云服务需证明平台不支持的能力。[规则](https://developers.reddit.com/docs/devvit_rules) 限制数据使用/分享，外部分析或批量导出须明确获准；换云域名不自动获得转供权 |
| Arctic Shift 定向增量 + 历史 dumps | 已有 adapter；API 与 dumps 是不同交付方式 | 近期只作为待验证补充样本流；本轮不要求下载历史全量。两者共用上游采集，不是独立备源；缓存/本地库只能提高已存数据的可读性 |
| 正常浏览器会话读取可见页面 | 网页仍须给获准访问者呈现内容，DOM 在技术上是另一种交付格式 | 已进一步审查登录会话驱动站内搜索的开源实现（见下文），是当时的自采待验证候选；10 月 28 日云端登录失败，当前不作为主路径。登录并不授予批量采集权，不把账号池、代理轮换、伪装官方客户端作为稳定性方案 |
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

当时提出的浏览器验证条件为：全站搜一个词，确认正文/日期和下一页，再检查普通页面驱动读取能否保留分页与结果身份；若测试会话内结构化读取，单独记录其实际状态，不从 UI 可用推断 `.json` 必然可用。仅做只读、有界验证，遇到限流/挑战停止，不公开 cookie/token。验证持续监测时用最新排序并重叠去重；临时历史搜索继承站内索引与分页边界，不承诺任意词的历史全部命中或无限回填。获得一次结果之后仍须验证会话失效、分页和持续负载，才能判断“够用”的实际边界。

本轮没有可用的用户登录会话，未完成上述关键检查，没有安装第三方代码、修改业务代码或部署。匿名响应及 GitHub 元数据在忽略的 `output/research/reddit-direct-20261023/`。

#### 热点站、信息雷达与采集助手的源码复核

以下固定项目快照于 2026-10-23 核查；不以未复查的后续版本推断当前能力。核查 GitHub 原仓库、固定提交与采集代码，而不是把搜索命中的 fork 或宣传中的“全网搜索”当作原始平台访问能力。当时优先验证 OpenCLI；10 月 28 日部署后的登录阻断使当前主线转为付费 API。项目依赖关系仍有参考价值：Agent Reach 是工具/会话层，AIHOT、TrendRadar、BettaFish 不能直接替代 Reddit 获取入口。

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

10 月 23 日对固定 OpenCLI `web-search.js` 做了 **3 个离线浏览器合成场景**：两页去重并按网页排序恢复乱序补全、429 单次终止、403 单次终止，均通过；仅复用现有 Playwright/Chromium，未安装第三方包，浏览器外网请求为 0。只验证纯搜索函数和最小响应 reader，不覆盖完整 CLI/扩展/账号/真实页面。源码、提交信息和结果在忽略的 `output/research/aggregation-projects-20261023/`。

历史取舍：OpenCLI 提供接近需求的获取代码，真实会话和分页/完整性契约仍需验收；Agent Reach 的会话层留到多平台明确需要时评估。其他项目优先借鉴过滤、事件归组、提醒与报告，不重复部署数据库/调度。不同许可证的复制、修改和发布义务在选定复用方式时核查；独立进程调用不自动豁免。当前付费主线及可选 X 试验见[工程路线](../plans/source-expansion.md)。

#### JSONL 独立复核与 ego-lite 的位置

2026-10-23 复核原 JSONL 会话、保存的请求/响应及关键源码，而非采信会话总结。直接运行证据是：Arctic Shift 三次真实数据请求成功（社区小样本，非全站搜索），匿名 Reddit 两次请求被网络安全 403 拒绝，以及 OpenCLI 三个离线合成场景；GitHub 文件获取、维护者报告与官方公告属于源码/文档证据，不属于这些采集器的真实运行验收。最新内容距查询约五分钟不等于索引延迟或召回率。13 位评论 ID 刷新缺陷在 10 月 23 日再次离线复现，网络调用为 0；它不解释匿名 403，也不决定当前优先的帖子搜索是否可用。

对固定 OpenCLI 搜索函数另做三个离线边界复现，外网请求为 0，证据在忽略的 `output/research/reddit-audit-20261023/`：

- 页面有后续 cursor、已达到 `limit` 时，函数先清空 `next`，返回 `capped=false`。没有截断警告也不能判定完整；原三个场景没有断言这个边界。
- 补全只返回部分帖子时，函数有 `missing`，但 CLI 只输出剩余行并把缺失写成日志；`capped` 同样未进入结果数组。接入需要结构化保留这些状态，不能只读取 stdout JSON 数组。
- 搜索页成功但 `by_id` 返回 403 时，函数直接返回登录墙结果，不返回已发现 ID。页面读取和 JSON 补全是两个独立访问条件，应分别验收。补全不可用时可另验收从可见结果/详情 DOM 提取必要字段；这是待开发替代，不是 OpenCLI 现有成功能力。

Agent Reach 还把空列表归为上游失败，且统一 `text` 不读取 `selftext`（原字段仍留在 raw）；用于后台监测前须区分正常零命中，并明确正文映射。当前 worker 在提交前拒绝 `exhausted=false && nextCheckpoint=null`，所以“CLI 返回数组→薄 adapter”尚缺可恢复分页契约，伪造 exhausted 会误推进高水位。一次 CLI 命令内部包含多次搜索/补全 HTTP，命令次数不能当实际请求次数。

10 月 23 日从 GitHub 复核时，六个项目的最新提交与当时固定快照一致；OpenCLI 后续变化另见下文 10 月 26 日核查。NewsNow 已迁到 [newsnext/newsnow](https://github.com/newsnext/newsnow)，旧 GitHub 页面重定向，原提交仍可读。依赖判断不变：TrendRadar 默认依赖 NewsNow，NewsNow 的 AIHOT adapter 读取 AIHOT RSS，Agent Reach 的 Reddit 后端依赖 OpenCLI，不能按项目数量计算独立上游。

[ego-lite 固定提交 `d392204`](https://github.com/citrolabs/ego-lite/tree/d392204d1ea1a8027a591ab2b0129c2e11d85f26) 的 README、Node helper 源码与原生绑定文档表明：它提供本机已登录浏览器、TaskSpace 和 `page.evaluate`/`page.fetch` 等执行能力；该快照 README 支持 macOS/Windows，Linux 当时仍在路线图。公开仓库是 helper/skill 等，浏览器原生绑定由单独下载的应用提供，不能因仓库 MIT 就推断可在 Linux 编译完整浏览器。本环境未发现 `ego-browser` 命令，未安装、未真实运行；宣传中的速度、低验证码率和免费不构成 Reddit 稳定性证据。

OpenCLI 当前通过 daemon + Browser Bridge 扩展调用 Page，ego-lite 使用自己的原生桥；页面执行能力相近不证明完整 CLI 可直接切换。Agent Reach 也绑定自己的浏览器 profile。当时拟采用 Chrome + OpenCLI；用户已因 Linux 支持要求排除 ego-lite，不再安排其执行环境试验或适配。模型生成查询和分析不提供新的原始数据权限。

2026-10-26 重新读取 [OpenCLI aeaff2b](https://github.com/jackwener/OpenCLI/tree/aeaff2b796efabb7fd46654112418ab61fcae917) 的 package.json、search.js、web-search.js 与安装说明：版本仍写 2.0.2，上述 capped、补全和输出元数据缺口仍见于源码；这是源码审查，没有重新运行真实搜索或新增离线验收。固定 npm 版本之外还应记录实际 adapter/覆盖配置及扩展版本。ego-lite 默认分支仍为 d392204，平台与原生绑定结论未变。单账号吞吐、账号池增益和长期十二小时新鲜度均没有本项目可采信的实测结果。

当前设计见[架构](../architecture.md#付费-reddit-provider-接入设计待实现)。上述快照不代表 11 月 10 日最新 Reddit adapter 已重新审查；本轮新审查的是 X 搜索代码。当前没有外部导入或远程任务领取接口。

## 其他来源的当前处置

Arctic Shift 已在 main，仅支持受限范围查询/已知 ID 补充；PullPush 首次请求明确拒绝本环境免费 agent 访问，保持暂停。Bluesky 公开账号 adapter 在 dev/root 已做两页真实闭环、尚未合入 main，不替代 Reddit 关键词目标。Steam/Forem/HN/YouTube 等仍为候选，具体实现与证据见[状态](../status.md)，不因本轮改为付费就全部实施。

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

## 复核约束

- 真实数据请求、离线验证、源码/文档与推测分别标记。供应商健康页、星级、成功率、SLA 和最大页大小不证明我们的新鲜度或有效成本。
- 不把多个聚合项目当独立数据来源；TrendRadar→NewsNow、NewsNow→AIHOT、Agent Reach→OpenCLI 的依赖关系按固定源码判断。
- 已有 422 有限重试不是待新增功能；本地 13 位评论 ID 刷新缺陷与上游漏收/网络 403 是不同问题。
- 不建设任意 URL/脚本通用采集平台。不同来源保留各自分页/费用限制，共用内容身份、观测与写入；实际需要才扩展。
- 原始聊天、数据、凭证与运行报告不提交；历史研究可在 Git `d8b481b` 查阅。许可与留存/删除要求不因页面能读或购买套餐自动通过。
