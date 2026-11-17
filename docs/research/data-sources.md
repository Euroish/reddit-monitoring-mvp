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
