# 数据源研究与选型

整理日期：2026-10-18；2026-10-20 更新 E1 与 Reddit 吞吐探测。来自 `d8b481b` 中的 `docs/数据源研究.md`（2026-10-16 至 18 日聊天导出），结合当前源码和已有 Linux 采集证据整理。价格表四家供应商于 10 月 18 日核对，10 月 19 日再次核对 TwitterAPIs/GetXAPI；其余名录保留为待验证线索，不承诺当前免费额度、版本、覆盖或稳定性。实施顺序见 [开发路线](../plans/source-expansion.md)。

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

## 成本口径

目标为 **$0.07 / 1,000 条有效独立内容及以下**。有效内容必须通过 schema/身份校验并成功落库；分别记录帖子、评论、去重后内容和更新观测，不能将重复刷新当成新帖子降低单价。

`有效成本/千条 = 全部可归属实际费用 ÷ 窗口内去重后的有效内容数 × 1000`。

分母为 0 时报告不可计算，不能记 0 成本；还要报告请求成本和失败率。赠送额度不抵扣用于选型的正常费用，试用后费用超标直接排除。预测、实际请求估算、供应商账单分别存证；服务器/存储成本另列。跨 provider 的新增边际覆盖也单独统计，避免用同一批重复内容证明备用价值。

### 低价商业候选（仅文档报价，未带凭证实测）

| 来源 / 端点 | 2026-10-18 可见标价 | 达标所需有效独立条数/次 | 下一验证点 |
| --- | --- | --- | --- |
| [TwitterAPIs 标准读取](https://www.twitterapis.com/pricing) | $0.0008/次 | ≥12 | 账号与关键词分别统计；20 条满页等效 $0.04/千条，不能假定总是满页 |
| [TwitterAPIs replies-complete](https://www.twitterapis.com/pricing) | $0.0024/次 | ≥35 | 继续游标、直接/嵌套回复边界、截断；不能套用标准端点价格 |
| [GetXAPI 标准读取](https://www.getxapi.com/pricing) | $0.001/次 | ≥15 | 搜索/时间线具体端点价、空页和重试计费 |
| [Redditapis 普通读取](https://www.redditapis.com/pricing) | $0.002/次 | ≥29 | 评论分页/树是否截断；深度搜索等特殊端点另价 |
| [CiteRocket 标准读取](https://www.citerocket.com/pricing) | 一次性 $10/10,000 credits，标准调用 1 credit，等效 $0.001/次 | ≥15 | 套餐/端点 credits、真实页大小及回复展开费用 |

10 月 19 日补充：TwitterAPIs 价格页自述整体平均约 13 条/次、搜索约 8 条/次。搜索按正常价折算约 **$0.10/千条**，尚未计失败、重复与无效记录，不能按 20 条满页报价认定达标；下一步仅优先考察账号读取。TwitterAPIs/GetXAPI 的购买充值起点均为 $10，不等于少量调用费或采购授权。

阈值按 `ceil(1000 × 单次价格 / 0.07)` 计算，假设每次均按该价且不含额外费用。TwitterAPI.io 已有 adapter，仅保留实现作回归基线；原研究的 $0.15/千条报价高于目标，不列入计划采购或付费备用。X 官方、SocialData 同样不列入本轮低成本接入计划；后续仅在正常价格满足准入条件时重新评估。

## 首批候选

下表表示后续验证方向；Arctic Shift、Bluesky 已有有界真实小样本闭环，其余候选未完成本仓库真实接入验收。优先级是本项目的设计判断。

| 来源 | 目标与接入类型 | 验证重点 / 取舍 |
| --- | --- | --- |
| [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) | Reddit 帖子、评论、ID；现有 adapter | 保留主路径，先解决受限查询恢复；月度归档仅作历史补充，不能替代增量新鲜度 |
| [PullPush](https://pullpush.io/) | Reddit 搜索线索，REST；当前暂停免费接入 | 本环境首次数据请求 429 且明确拒绝免费 agent 抓取；未重试、未绕过、未开发 adapter。若需商业授权，重新核对正常费用后再决定 |
| TwitterAPIs / GetXAPI | X 账号、查询、回复；REST | 首批择一家实测，另一家作为对照；长期成本准入后再确定凭证与试验预算 |
| Redditapis / CiteRocket | Reddit 商业补充；REST | 仅在正常月费与单位价均达标后试验，不因免费积分优先接入 |
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
