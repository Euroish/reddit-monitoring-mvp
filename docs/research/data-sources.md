# 来源选择与开源研究证据

核对日期：`2026-11-16`。结论基于本仓库源码、固定 GitHub 提交源码/开源许可、公开定价与 OpenAPI 资料及 2026-11-16 连通性验证；源码与公开页存在仅证明候选能力与许可边界，不代替本系统端到端持久运行验收。

## 1. 在线平台与开源聚合选型

**在线原平台：Reddit 采用 `kaix` 主源 + `red_crawler` 备源；X 采用 `TwitterAPIs` 主源 + `ScrapeBadger` 独立备源及批量 ID 补全；Bluesky 保留既有能力不扩展；资讯聚合采用 `NewsNow` 精选 MIT getter + 通用 RSS/Atom `feed`（可接自托管受控 `RSSHub`）；历史 `.zst` 原档归 `R4` 独立外挂，仅经鉴权 `POST /v1/sources/:id/ingest` 推流。**

| 候选开源 / 供应商 | 固定提交 / 依据与许可 | 结论与决定性证据 |
| :--- | :--- | :--- |
| [NewsNow](https://github.com/newsnext/newsnow/tree/5da836c49c327f2c352216c5cbb4dea1abd9fcd3) | `5da836c4`，MIT | **选用精选 getter**：TS 采集函数易裁剪，适合榜单与资讯快照；仅复用少量纯获取逻辑并保留 MIT 许可，不部署其前端、API 服务或存储系统。 |
| [RSSHub](https://github.com/DIYgod/RSSHub/tree/2340a032022c4382b2f5a165a2e3d3665ec06d89) | `2340a032`，AGPL-3.0 | **可选外部受控 feed 源**：为热榜之外补全垂直 RSS/Atom 订阅。主线只写通用 RSS/Atom `feed` adapter 配合管理员白名单与 `ETag`/`304`，不复制或嵌合 RSSHub 框架；自托管/修改须履约 AGPL-3.0。 |
| [DailyHotApi](https://github.com/imsyy/DailyHotApi/tree/36c77e3bd891c11642d314cfb229bf31646704de) | `36c77e3b`，MIT | **热榜备选参考**：与 NewsNow 高度重叠；已读缓存键仅含 URL 而未纳入 GET 参数或 POST body，不原样移植其缓存层。 |
| [TrendRadar](https://github.com/sansan0/TrendRadar/tree/8a316628215c53ad34b7200ecb0fba76de3ef6c7) | `8a316628`，GPL-3.0 | **吸收词组思维，不接作独立源**：参考其三段式词组筛选与降噪表达；其热榜 fetcher 请求 NewsNow `/api/s`，引入项目名不会增加真实上游独立性。 |
| [AIHOT](https://github.com/KKKKhazix/AIHOT/tree/76e3b6ea52ac45ed3e2f30272514c83f1845b989) | `76e3b6ea`，MIT | **不作独立聚合项目引入**：偏重 AI 精选整理流水线；如需读取其产出的 RSS，可作为普通白名单 feed 接入。 |

代码开源许可不等于上游站点再分发授权。移植 MIT getter 必须保留原版权声明与文件路径/提交来源注释。

## 2. NewsNow：裁剪 getter，不裁剪语义

已逐行审查：[榜单 API](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/api/s/index.ts)、[类型](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/shared/types.ts)、[HN getter](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/sources/hackernews.ts)、[IT之家 getter](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/sources/ithome.ts)、[AIHOT channel](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/sources/aihot.ts)。

- 单榜最多 30 条且无历史游标；公开接口在刷新间隔内即使读缓存仍可能返回 `status=success, updatedTime=now`，失败还可回退旧 cache，因此公开字段不可推定上游实际刷新时刻；
- HN getter 先抓 HTML，失败回退 `hnrss`，两条路径的字段与时间口径不同，禁止默默把回退当成同一完全快照；
- IT之家 getter 仅返回榜单标题、URL 与相对时间解析，不是正文全文；CSS 与相对时间解析须基于实际样本核验；
- `pubDate` 允许缺失；`extra.info` 为展示字段而非互动指标；列表索引仅在明确榜单场景记为 `web.rank`（名次，不作互动对比）。

**实现约束**：首批选取 2–3 个高价值 getter 改写接入 `src/connectors/web/newsnow.ts`，统一走本仓库 HTTP 限额、错误与观测契约（`canonical URL` 去重、`coverage = 'partial'`、基于任务固定 5 分钟桶的 `sha256` `evidenceKey`），禁止模拟 `defineSource/myFetch` 框架或把公共演示站当作 SLA 依赖。

## 3. RSSHub：受控白名单路由 → 通用 feed adapter

已审查：[cache middleware](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/lib/middleware/cache.ts)、[feed template](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/lib/middleware/template.tsx)、[HN 路由](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/lib/routes/hackernews/index.ts)、[GitHub trending](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/lib/routes/github/trending.tsx)、[package.json](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/package.json)。

- 严格区分 feed 级 `lastBuildDate`/`updated` 与单条内容发布时间；禁止拿构建时间冒充条目 `publishedAt`；
- 不同路由运行时门槛差异很大（如 GitHub trending 需要 `GITHUB_ACCESS_TOKEN` 与 GraphQL，部分站点需浏览器渲染），`package.json` 要求 Node engines `^24.15.0 || ^26.13.0`；自托管须单独隔离配置且不作为主线 Docker 三服务的启动强依赖；
- 仅读取管理员白名单端点，强制阻断 SSRF（非授权内网/云元数据 IP 与不可信跨源跳转），落实 `ETag`/`Last-Modified` 条件请求，`304 Not Modified` 只更新 `lastCheckedAt`，禁止自建外部全文二次补抓。

## 4. Reddit 与 X 在线路径最终比较与证据

| 平台 / 路径 | 实码与实测核验事实 | 重建产品取舍（具体映射见[来源替换规格](source_replacement_and_twitterapi_io_removal_spec.md)） |
| :--- | :--- | :--- |
| **Reddit / `Arctic Shift` API** | `2026-11-16` 实测：`r/MachineLearning` 7 天搜帖 `422 Timeout`（1.8s）、`r/LocalLLaMA` 搜评论 24h `422` / 耗时 4s、树接口强限流（`x-ratelimit-reset: 51`）；Reddit 官网匿名端点实测全返回 `HTTP 403`。 | **在线 API 全量退役实删**：不再修补其 13 位 ID 校验或强维持在线请求；历史 `.zst` 离线归档留作 R4 `plugins/zst-archive/`。 |
| **Reddit / `kaix/reddit-scraper`** | Apify build `0.2.25`，`$0.02/1k` 结果 + Compute；2026-11-16 用户授权真实直连成功取回 20 帖（1 run）；目前代码锁死 `includeComments=false`、100 条、`mode="post"` 丢主帖、`literal()` 误杀布尔式且同步等 60s 失败丢失 `runId`。 | **升级为 Reddit 主力源**：解除 4 项封印，改为异步 run 创建 + 持久化 `runId`/`datasetId` 轮询与安全恢复，支撑精准词伴随评论与批量 `postUrls` 水合。 |
| **Reddit / `red_crawler` (Apify)** | `reddit-search-v2` + `reddit-scrape-v2`，作者抽成 `FREE` 仅耗 Apify Compute，原生支持 `search_type="comments"` 与多社区并发搜索、评论树。 | **选为 Reddit 备源与评论补全**：与 `kaix` 共用 `APIFY_API_TOKEN`；明确属于同基础设施（Apify）下的 **Actor 级冗余**，非跨云容灾。 |
| **X / `TwitterAPI.io`** | 已有 X adapter；核对 `/pricing.json` 固定 `$0.15/1k`（空请求扣 15 credits，最高月付 `$1,499` 地板仍 `$0.0789/1k`），且与 `kaitoeasyapi` 同属 Prism Digital。 | **超预算与同源伪冗余，彻底淘汰实删**：迁移 X 集成测试为 `x-content-pipeline.test.ts`，通过迁移软归档旧来源保住历史观测。 |
| **X / `TwitterAPIs`** | 报价 `$0.0008/call`（满 20 条/页 $\approx \$0.04/1\text{k}$），`$10+` 永不过期；`2026-11-16` 真实授权直连 HTTP 200 取回 20 推文。无批量 ID 接口，`/tweet/thread` 贵 5 倍。 | **选为 X 主力低价源**：承接增量搜索、账号线与按需 `/tweet/replies` / `/quotes`；严格依赖空数组/重复游标停页，禁跑时间二分树。 |
| **X / `ScrapeBadger`** | `1 base + 1 credit/item`，PAYG `$10`/`$20` 起永不过期，`4xx/5xx` 不扣费，响应头带 `X-Credits-Used`；原生支持 `GET /v1/twitter/tweets/` 批量查推文，OpenAPI 扁平作者字段与 `5/60 req/min` 档位已核验。 | **选为 X 独立备源与批量 ID 补全源**：承接 `TwitterAPIs` 明确失败/限流时的单跳切备，并用批量 ID 接口补齐高价值推文二次刷新短板。 |
| **X / `TwexAPI`, `Xquik`, `Desearch`, `twscrape`, `OpenCLI`** | `TwexAPI` 缺单条按 ID 接口与顶层 string `conversation_id` 且低档位有过期/QPS 限制；`Xquik` `$0.119–$0.15/1k`；`PullPush.io` 拒绝代理；会话/云浏览器方案高脆性。 | **全部放弃，不入主线**：不为重构维护多个低质量或脆弱的爬取会话池。 |
| **Bluesky** | 已有 `bluesky_appview` 账号公开帖抓取与两页真实小样本闭环。 | **保留现有能力不扩展**：不作为 Reddit/X 的替代源。 |

首次上线前，每个新接通 provider 都须留存真实有界请求验收报告（目标、时间窗、耗时、去重独立内容数、`X-Credits-Used`/积分消耗、空结果与 PG→API→导出闭环）至 `output/`（不提交 Git）。

## 5. 归档离线研究降至 R4 独立外挂

只读参考历史分支提交 `723596e3` 中四份旧架构文稿（《分析能力与计算存储架构设计-v0.1》《在线平台技术栈与部署决策-v0.1》《服务端数据模型与查询方案-v0.1》《完整实现范围与验收契约-v0.1》）的唯一可行价值是：**顺序解压 `.zst` → 列式整理可检索中间层 → 挑选少量高相关内容通过标准 HTTP 推入主线**。

- 主线不恢复 `IMP-01..07` 离线发布包契约、7 张归档表、服务器本地 DuckDB 扫描或 `COPY/staging importer`；
- 根据固定提交 [`ArthurHeitmann/arctic_shift@11bbf2e6`](https://github.com/ArthurHeitmann/arctic_shift/tree/11bbf2e62db1dd1d699e1280724916a079815ec8) 格式说明：`2024-04` 起归档仅为 `.zst` 连续 UTF-8 JSON 对象流，`windowLogMax=31` 解压窗口下**不承诺任意字节偏移可跳读恢复**，且同对象内合并的 `retrieved_on` 与 `_meta.retrieved_2nd_on` 可能来自不同抓取时点，推送时必须保留真实 `timeBasis` 与 `sourceObservedAt`，严禁冒充 `publishedAt`；
- 未来在 `plugins/zst-archive/` 验证 DuckDB 转排序 Parquet（按 `(subreddit_lower, created_utc)` 排序、`ROW_GROUP_SIZE`、ZSTD 与可选 Bloom Filter）及主题分类器时，所有体积、内存与查询延迟数据均以真实样本实测为准，禁止未完成核对备份前删除原始 `.zst` 档案。

## 6. 研究停止线

- 新来源按“平台/渠道 → 身份/时间/指标能力 → `commitContentBatch` → 统一查询与导出 → 前端状态”逐项纵深打通，拒绝先搭动态插件市场、Provider Lab 或通用爬虫 DSL；
- 不在本仓库提交任何第三方整仓、原始响应、密钥、Cookie 或验证报告，统一存放于被忽略的 `output/`。
