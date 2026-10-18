# 数据源研究与选型

整理日期：2026-10-18。来自 `d8b481b` 中的 `docs/数据源研究.md`（2026-10-16 至 18 日聊天导出），结合当前源码和已有 Linux 采集证据整理。价格表四家供应商本轮重新核对；其余名录保留为待验证线索，不承诺当前免费额度、版本、覆盖或稳定性。实施顺序见 [开发路线](../plans/source-expansion.md)。

## 证据与结论

| 证据 | 可得结论 | 不能推出 |
| --- | --- | --- |
| Linux `6bd18ad` 真实采集 | Arctic Shift 1 小时社区窗口帖子/评论各 5 条落库，API 读回与重放去重成功 | 24 小时窗口、关键词、全量分页或持续新鲜度正常 |
| 研究原文用户 curl | 2026-10-16 按 ID 和 Python 社区日期窗口返回 200；增加 title 条件返回 422 | 原文该次未展示错误正文，不能单凭 422 断定具体原因 |
| 研究原文沙箱 DNS 失败 | 当时执行环境无法联网 | Arctic Shift 服务故障 |
| 供应商文档/价格页 | 存在公开接口说明或报价，可进入候选试验 | 真实覆盖、独立上游、账单单价和 SLA 已验收 |

Arctic Shift 上游说明关键词组合可能触发查询超时，建议缩小 limit 或增加日期/社区/作者约束。本仓库已按错误正文区分可重试 timeout/slow down；自动缩窗与本地关键词筛选仍需设计和实现。一次 200 不能证明完整覆盖。[上游 API 说明](https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md)

当前 connector 对帖子关键词发送 `query`、对评论发送 `body`；用户原文的 `title=help` 请求与应用参数不同，因此该 curl 的 422 不能直接当成应用关键词采集失败的复现。后续测试须保留实际端点、参数和响应错误正文。

## 成本口径

目标为 **$0.07 / 1,000 条有效独立内容及以下**。有效内容必须通过 schema/身份校验并成功落库；分别记录帖子、评论、去重后内容和更新观测，不能将重复刷新当成新帖子降低单价。

`有效成本/千条 = 全部可归属实际费用 ÷ 窗口内去重后的有效内容数 × 1000`。

分母为 0 时报告不可计算，不能记 0 成本；还要报告请求成本和失败率。试用赠送额度单列，并用正常计费估算持续运行成本。预测、实际请求估算、供应商账单分别存证；服务器/存储成本另列。跨 provider 的新增边际覆盖也单独统计，避免用同一批重复内容证明备用价值。

### 低价商业候选（仅文档报价，未带凭证实测）

| 来源 / 端点 | 2026-10-18 可见标价 | 达标所需有效独立条数/次 | 下一验证点 |
| --- | --- | --- | --- |
| [TwitterAPIs 标准读取](https://www.twitterapis.com/pricing) | $0.0008/次 | ≥12 | 账号与关键词分别统计；20 条满页等效 $0.04/千条，不能假定总是满页 |
| [TwitterAPIs replies-complete](https://www.twitterapis.com/pricing) | $0.0024/次 | ≥35 | 继续游标、直接/嵌套回复边界、截断；不能套用标准端点价格 |
| [GetXAPI 标准读取](https://www.getxapi.com/pricing) | $0.001/次 | ≥15 | 搜索/时间线具体端点价、空页和重试计费 |
| [Redditapis 普通读取](https://www.redditapis.com/pricing) | $0.002/次 | ≥29 | 评论分页/树是否截断；深度搜索等特殊端点另价 |
| [CiteRocket 标准读取](https://www.citerocket.com/pricing) | 一次性 $10/10,000 credits，标准调用 1 credit，等效 $0.001/次 | ≥15 | 套餐/端点 credits、真实页大小及回复展开费用 |

阈值按 `ceil(1000 × 单次价格 / 0.07)` 计算，假设每次均按该价且不含额外费用。TwitterAPI.io 已有 adapter，保留作基线比较；原研究的 $0.15/千条报价高于目标，本轮未重新核价，不据此采购。X 官方、SocialData 等也不以旧报价作当前预算依据。

## 首批候选

下表表示待验证方向，除 Arctic Shift 已有小样本证据外，均未在本仓库完成真实接入验收。优先级是本项目的设计判断。

| 来源 | 目标与接入类型 | 验证重点 / 取舍 |
| --- | --- | --- |
| [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) | Reddit 帖子、评论、ID；现有 adapter | 保留主路径，先解决受限查询恢复；月度归档仅作历史补充，不能替代增量新鲜度 |
| [PullPush](https://pullpush.io/) | Reddit 搜索候选，REST | 先探测指定历史和近期窗口，再决定实现；与 AS 的延迟/缺失相关性未知 |
| TwitterAPIs / GetXAPI | X 账号、查询、回复；REST | 首批择一家实测，另一家作为对照；凭证、总预算和端点价格先明确 |
| Redditapis / CiteRocket | Reddit 商业补充；REST | 免费备用不达标时再试；公开报价不代表已证明稳定 |
| [Bluesky AppView](https://docs.bsky.app/) | 新平台搜索、账号、讨论候选 | 首个新平台试点；分页/身份/删除与线程覆盖逐项验，不直接承诺全网完整 |
| [Steam 评论](https://partner.steamgames.com/doc/store/getreviews)、[Forem](https://developers.forem.com/api/v1) | 评价/文章评论候选 | 第二批用于检验 cursor 与嵌套评论差异；核对目标类型与指标单位 |
| [HN Firebase](https://github.com/HackerNews/API)、[Algolia](https://hn.algolia.com/api) | 技术讨论与搜索候选 | 按节点读取的请求放大、父子关系和删除；两接口不算独立内容供应链 |
| [YouTube 评论](https://developers.google.com/youtube/v3/docs/commentThreads/list) | 大规模评论候选，需项目/key/配额 | 视频发现与评论预算分开，顶层列表不等于完整回复；配额以接入时控制台/官方文档为准 |
| [FxEmbed](https://github.com/FxEmbed/FxEmbed)、[vxTwitter](https://github.com/dylanpdx/BetterTwitFix) | X 已知 ID 补全线索 | 先验证具体公共实例和端点，不将 embed/镜像宣称为稳定搜索备份 |

## 后续候选池

保留研究的覆盖范围，暂不逐家实施；进入试验前重新核对官方端点、费用、权限和维护状态。

| 领域 | 线索 | 暂缓原因 / 所需证据 |
| --- | --- | --- |
| 连续流 | [Bluesky Jetstream](https://github.com/bluesky-social/jetstream)、[Nostr NIPs](https://github.com/nostr-protocol/nips) | 删除事件、断线回放和 checkpoint 语义不等同普通分页；不沿用原文未复核的 v2/回放承诺 |
| 联邦社区 | [Mastodon](https://docs.joinmastodon.org/methods/timelines/)、[Lemmy](https://join-lemmy.org/docs/)、[Misskey](https://api-doc.misskey.io/)、[PeerTube](https://docs.joinpeertube.org/api-rest-reference.html) | 按实例验证版本、匿名访问、覆盖和回复截断 |
| 专业讨论 | [GitHub](https://docs.github.com/en/rest)、[Stack Exchange](https://api.stackexchange.com/docs)、[V2EX](https://www.v2ex.com/help/api)、[Discourse](https://docs.discourse.org/) | 先选具体目标，核对鉴权、分页、配额与站点配置 |
| Farcaster | [Neynar](https://neynar.com/developer) | 原文赠送 credits 未复核；credits 不等于内容条数 |
| 授权社群 | [Telegram TDLib](https://core.telegram.org/tdlib/docs/)、[Discord](https://discord.com/developers/docs/resources/message) | 会话/机器人权限与可访问范围，不能当全平台搜索 |
| 网页与资讯 | [RSSHub](https://docs.rsshub.app/)、[GDELT](https://www.gdeltproject.org/)、[Common Crawl](https://commoncrawl.org/)、网站 RSS | RSS 逐路由验收；新闻/网页不替代原平台评论；自建与归档有资源成本 |
| 其他条件来源 | [Product Hunt](https://www.producthunt.com/v2/docs)、[4chan](https://github.com/4chan/4chan-API)、Threads、Instagram、TikTok Research | 用途、访问资格、数据保留与具体端点先核对 |
| 中文站点 | Bilibili、微博、知乎、小红书、抖音的授权接口或 RSSHub 路由 | 未确认满足成本/稳定/覆盖要求的通用接口，不能列为已可用平台 |

## 从原研究中修正的结论

- 原文的 Reddit API/RSS 关闭时间表、Nitter 归档日期、Jetstream v2 能力和部分平台配额没有在本轮取得足够一手证据，不作为设计前提或当前事实保留。接入决策需要时再查证。
- 不以服务商 SLA、免费额度、最大页大小推断实际稳定性或成本；不把两家归档服务或多个镜像域名算成独立原始来源。
- 不将“422 重试”写成待新增能力：当前已经有限重试；缺口是错误分类后的有界恢复和可观测性。
- 不直接建设支持任意 URL/脚本的通用平台。先以现有 ContentProvider 复用取页后的业务链路，在两种实际 REST 接口验证后才抽取适配套件。
- 原文聊天提示、UI 占位、整段原始响应和重复推荐已删除；原研究可在 Git `d8b481b` 查阅。具体许可不在此下结论，试验与生产用途分别记录核查状态。
