# 数据源研究与选型

整理日期：2026-10-18；2026-10-20 更新 E1 与 Reddit 吞吐探测，10 月 23 日复核用户评价与上游维护记录。来自 `d8b481b` 中的 `docs/数据源研究.md`（2026-10-16 至 18 日聊天导出），结合当前源码和已有 Linux 采集证据整理。价格表于 10 月 18 日初核，10 月 19 日复核 TwitterAPIs/GetXAPI，10 月 20 日复核 Redditapis/CiteRocket；其余名录保留为待验证线索，不承诺当前免费额度、版本、覆盖或稳定性。实施顺序见 [开发路线](../plans/source-expansion.md)。

## 证据与结论

| 证据 | 可得结论 | 不能推出 |
| --- | --- | --- |
| Linux `6bd18ad` 真实采集 | Arctic Shift 1 小时社区窗口帖子/评论各 5 条落库，API 读回与重放去重成功 | 24 小时窗口、关键词、全量分页或持续新鲜度正常 |
| 研究原文用户 curl | 2026-10-16 按 ID 和 Python 社区日期窗口返回 200；增加 title 条件返回 422 | 原文该次未展示错误正文，不能单凭 422 断定具体原因 |
| 研究原文沙箱 DNS 失败 | 当时执行环境无法联网 | Arctic Shift 服务故障 |
| 2026-10-20 / Arctic Shift 吞吐探测 | `technology` 5 次请求，帖子一小时窗口两次成功、各 7 条，约 1.26/2.80 秒；历史大窗口及评论一小时/100条、十分钟/25条共 3 次 422 Timeout | 不是 429 限流，也不是峰值压测结果；基线不稳定，未进行并发/auto 加压。仅该小样本约 2.5–5.6 条/秒，不能外推长期容量 |
| 2026-10-19 / PullPush 数据端点 | `technology` 历史帖子首次请求返回 429，JSON 明确表示不向 agents 提供免费抓取资源，随后停止 | 不是所有客户端均不可用或服务宕机的证明；本环境的免费 E1 候选不可据此通过 |
| 2026-10-19 / Bluesky AppView | 7 次免费公开账号请求均 200；首屏/续页各 5 条、无重叠，首屏重放身份一致；新 adapter 两页筛出并落库 6 条作者自发内容，重放新增 0，API/浏览器 JSON/CSV 通过 | 不是 Reddit 备用，不证明全账号历史、全线程、删除检测、持续稳定性或 12 小时新鲜度；任务仍 partial |
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

用户当前排除需充值或固定付费的来源，下一步只验证持续免费路径，不采购商业额度。10 月 20 日重新读取 [Redditapis 价格页](https://www.redditapis.com/pricing)，其中明确标注“1,000 reads every month, on every account”，与一次性 $0.50 注册赠送不同；付费充值起点 $10 不能被误写成免费使用的必要条件。仍需在实际账号核对开通条件、适用端点和超额阻断，不能把网页自述当成已验收。其页面另称免费提供一个全站关键词的新帖子监测、webhook 投递、约每 60 秒检查；免费监测不支持指定 subreddit 或评论，不等于全量数据 API，也不是 SLA。

按 30 天计算，5 个社区每 6 小时各读取一页约 600 次/月，余下 400 次才可用于续页、评论和重试；活跃社区可能超页漏采，须先量实际负载。免费档不要求自动充值，试验不充值、不绑定付费方案，额度不足即停；没有凭证或真实取数验收，本仓库尚未接入该 provider。

如果必须长期免费且不依赖第三方赠额，可申请 [Reddit 官方 Data API](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki) 的符合条件访问，审批和免费资格不保证，商业用途另行确认。历史研究可下载 [Arctic Shift dumps](https://github.com/ArthurHeitmann/arctic_shift) 后本地检索，避开公共查询端点，但仍有磁盘/处理成本，不能满足近期 12 小时目标。非 Reddit 研究可优先已接入的 Bluesky 或 [HN 官方 API](https://github.com/HackerNews/API)，不能把它们当作 Reddit 内容备用。没有核实到同时满足无审批、持续免费、大流量、完整 Reddit 覆盖的可靠服务。

### 评价、维护与运行证据（2026-10-23）

不把供应商榜单、品牌总评分或进程成功当作 Reddit 数据质量。独立评价样本小、搜索摘要过时以及页面缓存口径不同均单独标明；本轮未运行收费 Actor、未注册或充值供应商账号，也未采集业务目标内容。

- **Arctic Shift 的收录风险已有维护者证据。** [#82](https://github.com/ArthurHeitmann/arctic_shift/issues/82) 中用户 10 月 15 日报告接口可用但没有新数据；维护者承认 Reddit 改动引发中断，16 日表示已基本追上。[#53](https://github.com/ArthurHeitmann/arctic_shift/issues/53) 中维护者 10 月 17 日说明新评论 ID 上线后评论不会 100% 完整、采集可能延迟，21 日确认新 ID 已覆盖全部评论。此前 90%+、理想 95% 是维护者预期，不是本项目测得的覆盖率。这是独立于查询 422 的上游收录问题，不能推断所有 timeout 的原因，也不能继续把近期评论视为完整流。
- **Redditapis 仍缺少长期口碑。** [Uneed](https://www.uneed.best/tool/redditapis/reviews) 只有 4 条评价；其中可见“当日测试两个线程”和“刚注册约一小时后首次取回评论树”的短期成功反馈，也有关于删除内容覆盖和每次返回量/计费的疑问。本次未找到独立的月度免费额度续期或长期可用性报告；免费档保留为待验对照，不提升为可靠主源。搜到的旧 $0.002/一次性赠额摘要不覆盖当前官网另写的持续免费声明，但官网声明也不能替代账号验证。
- **较有实际使用量的新候选是 Apify 的 [fatihtahta/reddit-scraper-search-fast](https://apify.com/fatihtahta/reddit-scraper-search-fast/reviews)。** 页面约 4.1 分、二十余条评分、约 3,300 月活跃用户；[公开 Actor 元数据](https://api.apify.com/v2/acts/fatihtahta~reddit-scraper-search-fast) 显示 10 月 22 日仍有更新，近 30 天 228,795 次运行中 222,926 次成功，另有失败、超时和主动取消。页面成功率与全部运行比例口径不同；这些都是平台统计，不是独立覆盖/延迟验收，不能拿来承诺优于 Arctic Shift。
- **只允许用 Apify 持续免费额度小试，不把它包装成低价大流量来源。** [平台 Free 计划](https://apify.com/pricing) 每月 $5，无需信用卡，用尽后暂停到下周期；该 Actor 元数据的 FREE 档为 $0.00149/结果，页头“from $1.19/千条”属于更高付费档，不能套给免费用户。每月账面上限约 3,300 条，其他费用/重复结果须留余量；超额正常价 $1.49/千条高于项目目标，故不充值、不升级，不作为大规模长期付费方案。没有凭证或内容样本，尚未验证本账号可用性。
- **更便宜或更高分的 Actor 不自动入选。** [opportunity-biz](https://apify.com/opportunity-biz/reddit-scraper) 虽标 $0.05/千条，但只有 8 个累计用户、无评分，且同时收平台使用费；[automation-lab](https://apify.com/automation-lab/reddit-scraper) 明确将评论、深层树与投票指标列为 best-effort，部分未知指标会输出 0。因此不能仅按标题价、星级或“运行成功”替代有效独立内容/字段完整性比较。

结论：现有证据不足以证明存在既免费大流量、又更稳定完整的 Reddit 主源；较值得比较的是有持续免费额度且有实际使用量的 Actor 与 Redditapis 免费档，前提仍是同目标/窗口的有界内容验收。Arctic Shift 保留历史补充和抽样用途，不依赖它保证近期全量评论。来源实施顺序仍只在开发路线维护。

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

## 首批候选

下表表示后续验证方向；Arctic Shift、Bluesky 已有有界真实小样本闭环，其余候选未完成本仓库真实接入验收。优先级是本项目的设计判断。

| 来源 | 目标与接入类型 | 验证重点 / 取舍 |
| --- | --- | --- |
| [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) | Reddit 帖子、评论、ID；现有 adapter | 保留历史补充/抽样与受限查询恢复；维护者已说明新 ID 后近期评论不完整且可能延迟，不能保证增量新鲜度或全量覆盖 |
| [PullPush](https://pullpush.io/) | Reddit 搜索线索，REST；当前暂停免费接入 | 本环境首次数据请求 429 且明确拒绝免费 agent 抓取；未重试、未绕过、未开发 adapter。若需商业授权，重新核对正常费用后再决定 |
| TwitterAPIs / GetXAPI | X 账号、查询、回复；REST | 首批择一家实测，另一家作为对照；长期成本准入后再确定凭证与试验预算 |
| Redditapis / CiteRocket | Reddit 补充候选；REST，未接入 | Redditapis 先核对页面标称的持续免费档；CiteRocket 仅一次性赠额，不作为免费主源。付费方案当前排除，上游独立性与商业使用权限均未验 |
| [Apify / Fatih Reddit Actor](https://apify.com/fatihtahta/reddit-scraper-search-fast) | 搜索、社区、帖子/评论候选；未接入 | 仅比较每月 $5 免费额度内的小样本；FREE 档 $1.49/千结果，超额不符合单位成本目标，不充值、不按广告起步价外推 |
| [Bluesky AppView](https://docs.bsky.app/) | 首个新平台试点：公开账号帖子与作者回复已初步接入；搜索/讨论展开仍候选 | 原生 AT URI 身份、opaque cursor；排除 feed 中他人转发和置顶。两页真实闭环通过，未知指标时刻保持 null；未验持续运行与完整覆盖 |
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

- 原文的 Reddit API/RSS 关闭时间表、Nitter 归档日期、Jetstream v2 能力和部分平台配额没有在本轮取得足够一手证据，不作为设计前提或当前事实保留。接入决策需要时再查证。
- 不以服务商 SLA、免费额度、最大页大小推断实际稳定性或成本；不把两家归档服务或多个镜像域名算成独立原始来源。
- 不将“422 重试”写成待新增能力：当前已经有限重试；缺口是错误分类后的有界恢复和可观测性。
- 不直接建设支持任意 URL/脚本的通用平台。先以现有 ContentProvider 复用取页后的业务链路，在两种实际 REST 接口验证后才抽取适配套件。
- 原文聊天提示、UI 占位、整段原始响应和重复推荐已删除；原研究可在 Git `d8b481b` 查阅。具体许可不在此下结论，试验与生产用途分别记录核查状态。
