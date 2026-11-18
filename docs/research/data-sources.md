# 来源选择与开源研究证据

核对日期：`2026-11-16`。结论基于仓库实码、固定 GitHub 提交源码与开源许可、公开定价与 OpenAPI 文档及 2026-11-16 授权连通性实测。开源仓能力不代替本系统端到端运行验收。

## 1. 在线平台选型与开源复用边界

| 候选开源 / 渠道 | 固定依据与许可 | 核验事实与采用边界 |
| :--- | :--- | :--- |
| [NewsNow](https://github.com/newsnext/newsnow/tree/5da836c49c327f2c352216c5cbb4dea1abd9fcd3) | `5da836c4`，MIT | **选用精选 getter 与 `fast-xml-parser` 选型**：仅裁剪高价值榜单 getter（保留原版权注释）并对接本仓 HTTP 限额与观测模型，不引入其前端、存储或 `h3` 运行时。 |
| [RSSHub](https://github.com/DIYgod/RSSHub/tree/2340a032022c4382b2f5a165a2e3d3665ec06d89) | `2340a032`，AGPL-3.0 | **作为可选外部受控订阅源，并借鉴工程选型**：主线使用 `rss-parser`/`fast-xml-parser` + `sanitize-html` + `etag` 实现通用 `feed` adapter（含管理员白名单与 IP 绑定 SSRF 护栏），不把 RSSHub 本体合入主线镜像；并借鉴其 ESLint AST anti-slop 思维守住测试真实性。 |
| [DailyHotApi](https://github.com/imsyy/DailyHotApi/tree/36c77e3bd891c11642d314cfb229bf31646704de) | `36c77e3b`，MIT | 与 NewsNow 重叠度高且已读缓存键缺少 POST body / 查询参数隔离，不移植。 |
| [TrendRadar](https://github.com/sansan0/TrendRadar/tree/8a316628215c53ad34b7200ecb0fba76de3ef6c7) | `8a316628`，GPL-3.0 | **只吸收三段词表达与降噪思路**：其热榜 fetcher 请求 NewsNow `/api/s`，不作独立上游引入，也不把 Python 进程带入主线服务。 |
| [AIHOT](https://github.com/KKKKhazix/AIHOT/tree/76e3b6ea52ac45ed3e2f30272514c83f1845b989) | `76e3b6ea`，MIT | 偏重 AI 精选流水线；仅在需要时把其产出 RSS 当作普通白名单 `feed` 接入。 |

## 2. NewsNow 与 Feed 语义要点

- `NewsNow` 单榜至多 30 条且无历史翻页游标；公开响应中 `updatedTime=now` 可能来自缓存，禁止借此推定上游实际刷新时刻。`hackernews` getter 在 HTML 失败时会退回 `hnrss`，两条路径字段不同，需诚实标注来源语义。榜单序号只记入 `web.rank`，不得冒充互动数；同任务固定 UTC 5 分钟桶 `sha256(boardId + ':' + externalId + ':' + snapshotBucket)` 保证重放幂等。
- 通用 `feed` 严格区分 feed 级 `lastBuildDate`/`updated` 与单条内容 `publishedAt`；严格走 `ETag`/`Last-Modified` 条件请求（`304 Not Modified` 只刷 `lastCheckedAt`）；禁止仅靠“请求前 DNS 校验一次”防御 SSRF（必须绑定解析 IP 并禁止盲目跨源重定向以堵住 DNS 重绑定窗口）。

## 3. Reddit 与 X 在线选型核验结果

| 平台 / 渠道 | 核验事实（`2026-11-16`） | 主线处置与[来源替换规格](./source_replacement_and_twitterapi_io_removal_spec.md)指引 |
| :--- | :--- | :--- |
| **Reddit / `Arctic Shift` API** | `r/MachineLearning` 7 天检索 `1.8s` 返 `422 Timeout`，评论树强限流 `x-ratelimit-reset: 51`；Reddit 官网匿名接口返 `HTTP 403`。 | **在线 API 全量退役实删**；仅 `.zst` 离线归档留归 R4 `plugins/zst-archive/`。 |
| **Reddit / `kaix/reddit-scraper`** | Apify build `0.2.25`，`$0.02/1k` 结果 + Compute；授权直连 1 run 成功取 20 帖。 | **主力源**：R1 解除 4 项硬封印（删 `ArcticShift` 指标依赖、`includeComments`、100 条上限、`mode="post"` 丢主帖与 `literal()` 误杀）并落库 `runId`/`datasetId` 恢复。 |
| **Reddit / `red_crawler` (Apify)** | `reddit-search-v2` + `reddit-scrape-v2`（作者费 FREE，仅耗 Compute），支持多社区与 `search_type="comments"`。 | **Actor 级备源与评论补全**：与 `kaix` 共用 `APIFY_API_TOKEN`（同云故障域）；必须走异步 Actor Run API 轮询，严禁调用不存在的同步端点。 |
| **X / `TwitterAPI.io`** | `/pricing.json` 固定 `$0.15/1k`（空页保底 15 credits），`$1,499/月` 满返仍 `$0.0789/1k`，且与 `kaitoeasyapi` 同属 Prism Digital。 | **超预算与伪独立冗余，物理实删**（平滑软归档历史来源与保留 PG 观测）。 |
| **X / `TwitterAPIs`** | `$0.0008/call`（满 20 条页 $\approx \$0.04/1\text{k}$），`$10+` 永不过期；授权实测 `HTTP 200` 采 20 推文；无批量 ID 接口。 | **主力低价源**：搜索/时间线/按需回复引用；禁用高价 `/tweet/thread` 与时间二分树。 |
| **X / `ScrapeBadger`** | `1 base + 1 credit/item`，PAYG 永不过期，`4xx/5xx` 零扣费，带 `X-Credits-Used` 响应头，支持原生 `GET /v1/twitter/tweets/` 批量 ID。 | **独立供应商备源与批量 ID 补全源**：补齐高价值推文按 ID 批量刷新能力。 |
| **落选 X 渠道** | `TwexAPI` 缺单推批量接口与顶层 string `conversation_id`、`Xquik` `$0.119–$0.15/1k`、`PullPush.io` 拒答代理，会话/浏览器池脆弱。 | **全部放弃，不入主线**。 |
| **Bluesky** | 已有 `bluesky_appview` 公开帖与回复小样本实现。 | **保留现有能力不扩展**。 |

---

## 4. R4 `.zst` 离线归档依据

参考固定提交 [`ArthurHeitmann/arctic_shift@11bbf2e6`](https://github.com/ArthurHeitmann/arctic_shift/tree/11bbf2e62db1dd1d699e1280724916a079815ec8)：`2024-04` 起归档仅为 `.zst` 连续 JSON 流，不承诺任意偏移随机恢复，且 `retrieved_on` 与 `_meta.retrieved_2nd_on` 可能来自不同时点。未来仅在独立环境 `plugins/zst-archive/` 中做顺序解压转排序 Parquet，经 `POST /v1/sources/:id/ingest` 推流并诚实标记 `timeBasis` 与“导入样本”。

## 2026-11-18 · 可直接试取的订阅入口

从开发环境用 HTTPS GET 探测 48 个端点，每次最多 12 秒、2 MiB，不跟随跳转，以项目安装的 rss-parser 解析响应并计数带标题和绝对 HTTPS 链接的条目。33 个端点本次满足条件。数量为单次快照；生产 IPv4 固定地址连接、窗口、来源授权、摘要展示权和端到端写入仍需在选入批次时核实。

| Feed（可复制链接地址） | 本次符合字段条件的条数 |
| --- | ---: |
| [blog.cloudflare.com/rss/](https://blog.cloudflare.com/rss/) | 20 |
| [blog.rust-lang.org/feed.xml](https://blog.rust-lang.org/feed.xml) | 10 |
| [earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom) | 2 |
| [feeds.bbci.co.uk/news/world/rss.xml](https://feeds.bbci.co.uk/news/world/rss.xml) | 26 |
| [github.blog/feed/](https://github.blog/feed/) | 10 |
| [go.dev/blog/feed.atom](https://go.dev/blog/feed.atom) | 10 |
| [huggingface.co/blog/feed.xml](https://huggingface.co/blog/feed.xml) | 908 |
| [kubernetes.io/feed.xml](https://kubernetes.io/feed.xml) | 50 |
| [pansci.asia/feed](https://pansci.asia/feed) | 10 |
| [planetpython.org/rss20.xml](https://planetpython.org/rss20.xml) | 22 |
| [rss.arxiv.org/rss/cs.AI](https://rss.arxiv.org/rss/cs.AI) | 401 |
| [technews.tw/feed/](https://technews.tw/feed/) | 40 |
| [theinitium.com/rss/](https://theinitium.com/rss/) | 15 |
| [www.changhai.org/feed.xml](https://www.changhai.org/feed.xml) | 33 |
| [www.cnbeta.com.tw/backend.php](https://www.cnbeta.com.tw/backend.php) | 150 |
| [www.debian.org/News/news](https://www.debian.org/News/news) | 6 |
| [www.djangoproject.com/rss/weblog/](https://www.djangoproject.com/rss/weblog/) | 10 |
| [www.ecb.europa.eu/rss/press.html](https://www.ecb.europa.eu/rss/press.html) | 15 |
| [www.eff.org/rss/updates.xml](https://www.eff.org/rss/updates.xml) | 50 |
| [www.federalreserve.gov/feeds/press_all.xml](https://www.federalreserve.gov/feeds/press_all.xml) | 20 |
| [www.ifanr.com/feed](https://www.ifanr.com/feed) | 20 |
| [www.ithome.com/rss/](https://www.ithome.com/rss/) | 60 |
| [www.nasa.gov/feed/](https://www.nasa.gov/feed/) | 10 |
| [www.nature.com/nature.rss](https://www.nature.com/nature.rss) | 75 |
| [www.postgresql.org/news.rss](https://www.postgresql.org/news.rss) | 10 |
| [www.quantamagazine.org/feed/](https://www.quantamagazine.org/feed/) | 5 |
| [www.schneier.com/feed/atom/](https://www.schneier.com/feed/atom/) | 10 |
| [www.science.org/rss/news_current.xml](https://www.science.org/rss/news_current.xml) | 10 |
| [www.smithsonianmag.com/rss/latest_articles/](https://www.smithsonianmag.com/rss/latest_articles/) | 10 |
| [www.theguardian.com/world/rss](https://www.theguardian.com/world/rss) | 45 |
| [www.v2ex.com/index.xml](https://www.v2ex.com/index.xml) | 50 |
| [www.w3.org/blog/feed/](https://www.w3.org/blog/feed/) | 25 |
| [www.who.int/rss-feeds/news-english.xml](https://www.who.int/rss-feeds/news-english.xml) | 83 |

其余探测结果：

- [feeds.appinn.com/appinns/](https://feeds.appinn.com/appinns/)：HTTP 301。
- [sspai.com/feed](https://sspai.com/feed)：请求超时。
- [www.36kr.com/feed](https://www.36kr.com/feed)：请求超时。
- [www.esa.int/rssfeed/Our_Activities/Space_Science](https://www.esa.int/rssfeed/Our_Activities/Space_Science)：HTTP 404。
- [www.gcores.com/rss](https://www.gcores.com/rss)：请求超时。
- [www.geekpark.net/rss](https://www.geekpark.net/rss)：请求超时。
- [www.huxiu.com/rss/0.xml](https://www.huxiu.com/rss/0.xml)：请求超时。
- [www.infoq.cn/feed](https://www.infoq.cn/feed)：请求超时。
- [www.infoq.com/feed/](https://www.infoq.com/feed/)：HTTP 301。
- [www.metmuseum.org/rss/now-at-the-met](https://www.metmuseum.org/rss/now-at-the-met)：HTTP 429。
- [www.mozilla.org/en-US/security/advisories/feed/](https://www.mozilla.org/en-US/security/advisories/feed/)：HTTP 404。
- [www.oschina.net/news/rss](https://www.oschina.net/news/rss)：请求超时。
- [www.ruanyifeng.com/blog/atom.xml](https://www.ruanyifeng.com/blog/atom.xml)：HTTP 403。
- [www.rust-lang.org/feed.xml](https://www.rust-lang.org/feed.xml)：HTTP 301。
- [www.solidot.org/index.rss](https://www.solidot.org/index.rss)：请求超时。

### 扩源批次与结构化网站

早期格式试取样本包括爱范儿、泛科学、端传媒、BBC World、Quanta、NASA、美联储、PostgreSQL，各选一个入口，观察中文覆盖、国际新闻、科学、经济公告与工程发布。展示先用标题、来源和原文链接。第二批针对阅读缺口补 V2EX、IT之家、科技新报、EFF、USGS、央行公告与语言社区。arXiv 和 Hugging Face 的单次文档很长，先看窗口内新增量与截断，再决定检查频率；历史条数不能直接当成更新率。转载聚合源单列发布者，避免一条转载算成一个新主题。

| 有明确接口的扩展对象 | 最小取数与身份 | 成本与接入判据 |
| --- | --- | --- |
| [Hacker News 官方 API](https://github.com/HackerNews/API) | 拉榜单 id，仅补尚未读过且入选的 item；保留讨论页和外链两种语义 | 榜单加逐项获取会放大请求量，先比较相对现有 HTML 榜单多出的字段与覆盖 |
| [Crossref REST](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | 限定出版者或主题、时间窗与字段，按 DOI 识别作品 | 增量抓元数据并跟踪游标；与 arXiv 有关联时保留版本，不按近似标题合并 |
| [Stack Exchange](https://api.stackexchange.com/docs/throttle) | 限站点、标签和活动时间读取问题；站点加 question_id 定位 | 遵守 backoff 与剩余额度，保留作者和许可信息 |
| [GitHub REST](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) | 指定仓库的 release，保存仓库与 release id | Feed 能覆盖则优先 Feed；需要稳定 id 或结构化版本信息时才使用 API |

这些 JSON 接口要经适配器字段映射、预算与能力声明后才能复用统一写入。每次只为能填补可描述内容缺口的平台排期。普通网站采用管理员批准的固定列表页；开放式链接递归、登录墙及浏览器渲染不计入本轮可用容量。


### 从读者日常入口选源

| 频道 | 读者常用入口候选 | 产品应带回什么 |
| --- | --- | --- |
| 大众社媒 | YouTube、Reddit、X；中文试用观察 B 站、微博、知乎、小红书、抖音 | 同一话题的原帖、代表性讨论和视频原链。先选有授权入口的一项实测。美国调查只支持美国样本，中文候选需用目标读者的打开与关注行为验证。[Pew 平台使用调查](https://www.pewresearch.org/internet/fact-sheet/social-media/) |
| AI 开发与测评 | X 作者、GitHub 发布与 issue、Hugging Face 模型卡、Hacker News、r/LocalLLaMA、YouTube 开发者频道、Artificial Analysis | 从热门讨论追到版本、复现材料和独立试用。基准卡保存评测集、模型版本和日期；计分口径不同则并列展示 |
| 金融 | Yahoo Finance、TradingView、财经媒体、东方财富、雪球作为注意力入口；公司投资者关系、SEC、交易所、央行作一手材料 | 依公司、市场与事件时间聚合财报、宏观变化和社区解读，分清公告、报价和观点；行情再分发单独核权。[SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) |
| 综合热点 | 新闻首页、视频热门、社区热帖、搜索趋势，按地区和语言维护各自榜 | 记录上榜时间、名次及入口；同一通讯社的多站转载只算一个独立证据。领先上榜与持续升温分别展示 |

人物库以公开署名发现和明示身份为准。可从 OpenAI Codex 工程文章署名、Anthropic Claude Code 的 Boris Cherny、xAI 的 Grok Code 发布与模型卡、独立开发者 Simon Willison 的个人站开始。用本人主页或官方作者页交叉确认公开平台账号，保留证据链接和核验日期；同名 Reddit 用户不自动绑定。账号改名后按可验证的平台身份续接。一家公司可维护一个关注列表，多个读者关注同一账号共享一次采集。组织名单是滚动维护的公开样本。[OpenAI 工程文章](https://openai.com/index/harness-engineering/) · [Anthropic 开发者活动](https://resources.anthropic.com/webinar/claude-code-live) · [xAI 发布](https://x.ai/news/grok-code-fast-1) · [独立作者主页](https://simonwillison.net/about/)
