# 主线数据与 API 契约

本文件定义系统领域边界、信源分级、状态机、混合批写入、双字词检索、事件聚簇、按题探索与安全契约。结构体与校验的唯一代码真源是 `packages/contracts/` 的 TypeBox Schema（由 `@fastify/type-provider-typebox` 编译派生 OpenAPI），所有扩展 Schema 必须经统一 `strictMerge` 显式保留 `additionalProperties: false`。

## 1. 领域模型、信源分级与事件读模型

| 领域概念 | 唯一语义（严禁混用） |
| :--- | :--- |
| **`Platform`** | 原内容平台（`reddit`、`x`、`bluesky`、`web`）；对应 `source` 表，`content.source_id` 指向它。 |
| **`Provider`** | 执行采集或推流的渠道实现（`kaix`、`red_crawler`、`twitterapis`、`scrapebadger`、`newsnow`、`feed`、`bluesky_appview`、`external_ingest`）。 |
| **`CollectionSource`** | 逻辑监测目标（`collection_source`）；所有 HTTP 路由中的 `:id` / `sourceId` **始终指逻辑来源 `collection_source.id`**；通过 `source_group` 与 `schedule` JSONB 承载频道归属（`vip` / `ai` / `tech` / `life`）、权威分级（`tier`: `'T1' \| 'T1_5' \| 'T2'`）与主体实体标识（`ownerEntityId`）。 |
| **`Project`** | 研究工作空间（`monitor_project`）；绑定逻辑来源集合、本地三段词过滤与按需水合选项，不复制正文文本。 |
| **`Content`** | 规范内容节点，全局业务身份 `(platform, kind, externalId)`；`externalId` 始终为字符串；物理主键值 `id` 在写入内核确定性派生；通过 `platform_details.extensions` 与 `content_references` 承载事件簇标识 `storyKey`、簇内角色 `storyRole` 与 64-bit SimHash。 |
| **`Discovery`** | 某内容被哪条逻辑来源发现的关联（`content_discovery`），非独立正文。 |
| **`Observation`** | 某逻辑来源经特定 `Provider` 采回的不可变快照指标（`content_observation`）。 |

### 双语信息流、事件聚簇、可插拔 AI 翻译/摘要与全景可视化读模型

1. **信源三级权威度（`tier`）与英文一手优先代表选举（`pickRepresentative`）**：
   - **`T1`（官方一手）**：AI 与科技巨头官方英文 Blog / Newsroom / GitHub Releases（如 OpenAI、Anthropic、Google DeepMind、Hugging Face、NVIDIA、Microsoft Research）及中资大模型官方一手发布（DeepSeek、Qwen、Kimi、MiniMax 官方 GitHub/Blog）；
   - **`T1_5`（认证主创与核心学者）**：绑定了 `ownerEntityId` 或人物标识的核心研究员、创始人与独立开发者账号（如 Karpathy、Simon Willison、Boris Cherny 等的 X / Reddit / 个人站 / YouTube 频道）；
   - **`T2`（精选媒体与社区热榜）**：Ars Technica、MIT Tech Review、The Decoder、TechMeme、Product Hunt、Hacker News、V2EX、IT之家、少数派、B站热门、知乎热榜、微博热搜、Reddit 热门社区。
   - **代表选举、原语种直出与可插拔 AI 双语增强规则**：同一事件簇（`storyKey`）下有多篇报道时，首页与日报卡片主标题严格按 **`T1` $>$ `T1_5`（机构先于个人）$>$ `T2`（有全文 $>$ 互动/热度高 $>$ 发布早）** 选举唯一代表报道（Representative），**默认直接展示原语种标题与确定性导语摘录（入库绝不阻塞等待翻译）**；当接入并启用 `ai_enrich`（通过环境变量 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 原生 `fetch` 调用或外部 Agent 调 `POST /v1/content/:id/enrich` 写回）时，按簇代表或按需触发生成中英对照标题与三点事件综述，幂等持久化于 `platform_details.extensions.ai = { titleZh, leadZh, summaryPoints, model, fingerprint, enrichedAt }`；其余同簇报道按 `storyRole` 归入“独立实测 (`benchmark_eval`)”、“社区讨论 (`community_discussion`)”或折叠进“$K$ 家同源报道 (`syndicated_repost`)”。
2. **48 小时事件热度（`heat`）与 6 小时趋势（`trend`）**：
   - 借鉴 `AIHOT` 事件热度模型，在 48 小时滑动窗口内，每个独立来源/参与者对同一 `storyKey` 只计一次最高权重（`T1=3.0`, `T1_5=2.0`, `T2=1.0`），按 `publishedAt` 施加 24 小时指数半衰期衰减：$\text{Heat}(E, t) = \sum_{p} w_{\text{tier}}(p) \cdot 0.5^{(t - t_p)/24\text{h}}$。
   - 对比当前热度与 6 小时前热度（剔除落后停采 `behind` 与新接入未满窗口 `late` 的来源）计算 `trend: 'up' | 'down' | 'flat' | 'new' | 'unknown'` 及徽章 `badges: ('surge' | 'rising' | 'new')[]`。
3. **“为你”可解释 RRF 排序与 `FeedReason`**：
   - 对近期可见事件簇融合四路名次：保存查询与兴趣词命中（$w_{\text{query}}=1.4$）、关注 VIP/一手源（$w_{\text{vip}}=1.3$）、多平台独立印证度（$w_{\text{corroboration}}=1.1$）、平台内对数互动率（$w_{\text{engagement}}=0.8$），计算 $\text{RRF}(d) = \sum_m \frac{w_m}{60 + r_m(d)}$，再乘以重力时间衰减 $(t_{\text{hours}}+2)^{-G}$ 与同发布者连续出现指数折损 $0.55^{\text{seen}(p)}$。
   - 每张返回卡片携带确定性 `reason: { kind: 'saved_query' | 'followed_vip' | 'corroborated_event' | 'fresh_discovery', label: string }`。
4. **统一 SQL 分面与全景可视化图表契约（`GET /v1/content/facets`、`GET /v1/projects/:id/overview`、`POST /v1/project-comparisons`）**：
   - 所有可视化图表共享 `compileContentFilter` 与单次 PostgreSQL `GROUPING SETS` 聚合，一次性返回四类可视化序列（耗时 `< 8ms`，零额外统计表）：
     1. **`timeline`（按日 / 6h 跨平台与权威级叠柱序列）**：包含 `bucket`、`count`（按根帖/事件去重）、`matchedContentCount`、`byPlatform`、`byTier`（`T1`/`T1_5`/`T2`）及 `coverageStatus: 'covered' | 'unknown'`；
     2. **`topStories`（48h 事件热度 × 6h 增速散点/排行序列）**：返回当前筛选范围内 Top 事件簇的 `{ storyKey, title, titleZh, leadTier, heat48h, surgeRatio6h, trend, sourceCount, platforms }`；
     3. **`distributions`（平台、信源权威级、体裁、三维主题实体与信号占比）**：返回 `platforms`、`tiers`、`kinds`、`entities`（`company`/`field`/`genre`）与 `signals`（`discussion`/`pain`/`surge`）计数；
     4. **`comparisons`（多专题/多主题对齐对比序列）**：对 2–5 个项目或主题返回同时间轴对齐的每日内容量、事件簇数、48h 热度与平台结构（跨平台直接比较原始点赞/评论数时按 `MET-04` 返回 `422` 并提示切回内容量或事件热度）。

### SRC-01–03：逻辑来源分离、六类采集目标与失效策略

| ID | 等级 | 逻辑来源与备源约束 | 验收出口 |
| --- | --- | --- | --- |
| SRC-01 | MUST | 逻辑来源身份由 `(platform, seedKind, canonicalTarget)`（`push` 另加客户端 namespace）唯一确定，创建后 `deliveryMode`（`pull` / `push`）不可变；`Target` 支持 `search`、`community`、`account`、`post`、`feed`（含 `rss`、选择器驱动的 `web_list` 与字段路径驱动的 `json_list` 配置）；同一来源允许绑定主备渠道、频道分组 `sourceGroup`、权威等级 `tier` 与自动排期 `schedule`。 | PG 约束与主备权属测试 |
| SRC-02 | MUST | 主备切换与备源 `ScrapeBadger` 批量 ID 刷新优先支持明确人工操作、任务重试与显式备用策略；严禁对正常空结果、`partial` 覆盖或结果 `unknown` 的付费调用自动切备或级联回切；Reddit `account` 目标在 `red_crawler` 不支持时不宣称自动切备。 | 停发与显式切备测试 |
| SRC-03 | MUST | 按真实接口能力声明 `operations` 与 `refreshByIds`：禁止在缺少批量接口时暗中拆成 N 次收费请求；追踪大批量 X / Reddit 关注人物（VIP）时，支持将 15–20 个账号编入同一 `source_group='vip'` 批次搜索源（`(from:u1 OR from:u2 ... -is:retweet)`），入库后按每条内容的真实 `author.handle` 还原人物归属。 | 能力边界与 VIP 批次归属单测 |

### DAT-01–04：内容身份、三元版本元组、三轴时间与事件聚簇

| ID | 等级 | 内容规范化、版本比较与幂等规则 | 验收出口 |
| --- | --- | --- | --- |
| DAT-01 | MUST | `externalId` 统一字符串防精度丢失：Reddit ID 统一小写 2–32 位 ASCII base36（含 `t3_` 主帖与 `t1_` 评论）；X 帖子与回复同属 `kind='post'`（用 `reply_to` 与 `thread_root` 建树，并完整保留图片/视频 `media`、外链与引用推文）；`web` 按去追踪参数后的规范 `canonical publisher URL` 或 `feed namespace + GUID` 去重，`NewsNow` 以 `sha256(boardId + ':' + externalId + ':' + snapshotBucket)`（UTC 5 分钟桶）生成 `evidenceKey`。 | ID、URL 与媒体归一化单测 |
| DAT-02 | MUST | 正文版本严格按 **`(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")`** 决胜：同批先做单轮确定性归约且不丢较新 `fetchedAt`；胜出 `available` 省略或传入 `null` 字段时用 `COALESCE` 保留已知文本（显式 `""` 除外），`deleted`/`removed` 立即清空正文与搜索投影且禁止落后 `available` 记录复活正文。 | 逆序/平局/防复活 PG 测试 |
| DAT-03 | MUST | 三轴时间彻底分离：`publishedAt`（`content.created_at_source`）、`sourceObservedAt`、`fetchedAt`；缺失值一律存 `null`；所有互动指标显式绑定平台 `metricKey`、真实 `provider` 与 `timeBasis`（缺值维持 `null` 不补 `0`），所有正文携带精确 `textState`（`full` / `summary` / `missing` / `truncated`，存于 `platform_details.textState` 并由 `contentFromRow` 还原）。 | 时间、指标口径与 `textState` 测试 |
| DAT-04 | MUST | 观测唯一键为 `(contentId, collectionSourceId, provider, evidenceKey)`，`evidenceKey` **严禁掺入读取时刻 `fetchedAt`**；同键同内容重放保持原行并返回 `updated = 0`，同键不同指标返回 `409`；入库时确定性计算 `storyKey`（规范实体链接优先，64-bit SimHash + 72h LSH 分桶次之）与 `storyRole`，未入库父帖标 `contextMissing = true`。 | 观测幂等、聚簇与 409 PG 测试 |

## 2. 在线采集（Radar / Hydrate / Preview）、按题探索与外部推流（Ingest）

| ID | 等级 | 采集执行、先预览后创建、防刷屏与探索推流契约 | 验收出口 |
| --- | --- | --- | --- |
| COL-01 | MUST | 逻辑来源复用 `source_collection_job` 承载 `radar`（发现窗与按题探索）、`hydrate`（指定根帖集合与每帖上限）与 `ingest`（推流回执）；`POST /v1/sources/:id/collect` 强制校验 `Idempotency-Key`（同源同键同体复用同 `job`，同键异体返 `409`）；支持 `POST /v1/sources/preview`（试抓解析前 20 条并返回标题、时间、摘要与嗅探到的 RSS，不写业务表）以落实“先预览，再创建”。 | 幂等、预览与任务操作 E2E |
| COL-02 | MUST | 无稳定上游游标来源（如 `kaix`、`NewsNow`）永远标 `coverage = 'partial'`；仅在当前窗正常取尽或安全游标提交成功时推进 `incrementalTo`；`feed` 遇 `304 Not Modified` 只更新 `lastCheckedAt` 不新增观测；新来源首次采集默认限制 `initialBackfillLimit = 8`，且发现时已发布超过 48 小时的存量条目按原 `publishedAt` 归档（标记不进入今日精选与日报，落实“旧文不刷屏”）；`Bluesky` 时间线翻页在整页早于 `from` 时立即停页（`exhausted = true`）。 | 游标、截断、停页与防刷屏测试 |
| COL-03 | MUST | 在线接受批上限设为 **`2,000 条 / 16 MiB`**；对声明 `automaticRequestReplay = false` 的付费来源落实 `starting -> running -> reading -> committed` 状态机；`twitterapis` 单页自动钳制 `Math.min(pageSize, 20)` 防止默认 `pageSize=25` 报错；结果未明转 `unknown` 永远停发并需人工确认 `acknowledgePotentialCharge: true` 才可重建任务，停机 `SIGTERM` 仅放回租约不触发 `unknown` 或源封禁。 | 故障与重启恢复 E2E |
| COL-04 | MUST | `hydrate` 由用户或高讨论度阈值勾选根帖集合触发（每批 `<= 30` 根、每帖 `<= 50` 评论，`commentSort="top"`），同时兼容 `kaix` 主源与 `red_crawler` 备源（`post_comments`）；按题动态探索（`POST /v1/discovery/query`）拆解 4 个正交槽，经 Tier-1 免费垂直 API（本地 PG、HN Algolia、GitHub、HF/arXiv、Reddit）与受预算门控的 Tier-2 网页搜索挑选最多 24–30 个去重站点，在系统内置 `delivery_mode='push'` 的 `radar` 源下分三波渐进提取入库，并输出 `candidateSubscriptions` 供一键转为长期 `pull` 源。 | 水合主备与动态探索三波测试 |
| ING-01 | MUST | `POST /v1/sources/:id/ingest` 仅接收规范化 `NormalizedContentItem[]`（服务端生成确定 UUID），强验证 `ingest` scope、非空允许来源与 `Idempotency-Key`；单批限 **1–100 项、解码体 <= 1 MiB、标题 <= 4 KiB、正文 <= 64 KiB**；首次写入返 `201`、同键同载重放返 `200`、异体返 `409`。 | 推流边界与 201/200/409 测试 |

### 供应商能力与双语三大支柱覆盖摘要

| `provider` | 支持操作与能力 | `refreshByIds` | 关键限制与双语支柱分工 |
| :--- | :--- | :--- | :--- |
| **`kaix`** | Reddit 搜索、社区、账号、批次 `author:` 搜索与 `postUrls` 评论树 | `true`（按帖批补） | 异步 run + 轮询（等待兼容 `65s`），`automaticRequestReplay = false`；主力承接英文 AI（`r/LocalLLaMA`）与全球大众娱乐社区评论水合 |
| **`red_crawler`** | Reddit 多社区/关键词搜索与 `post_comments` 单帖评论水合 | 按操作声明 | 共用 `APIFY_API_TOKEN`；走真实异步 Run API 轮询（流式 16 MiB 限读）；作为 `kaix` 搜索与单帖评论水合备源（不支持 `account` 目标） |
| **`twitterapis`** | X 搜索（含 15–20 人 `from:u1 OR from:u2` VIP 批次搜索）、时间线、回复/引用 | `false` | 20 条/页（调度器自动钳制 `pageSize <= 20`）；提取推文图片/视频 `media`、外链与 `quoted_tweet`；主力承接英文 AI 学者与主创一手动态 |
| **`scrapebadger`** | X 搜索（时间窗编入 `query`）、时间线、批量推文 ID 刷新（`count 1..100`） | **`true`**（批量查推文） | 兼容 `data` 或 `null`；记 `X-Credits-Used` 诊断头；作为 X 独立备源与高价值推文指标批量补全源 |
| **`newsnow`** | 内置主流高流量榜单 MIT getter（B站热门/热搜、知乎热榜、微博热搜、V2EX、IT之家、酷安、36氪、Hacker News、GitHub Trending、Product Hunt、HF Daily Papers） | `false` | 固定 UTC 5 分钟桶 `evidenceKey`；榜单名次只记 `web.rank`；零成本覆盖中文大众生活娱乐与全球科技/AI 每日热榜 |
| **`feed`** | RSS/Atom（官方英文一手 `T1` Blog、GitHub Releases `.atom`、Reddit `.rss`、YouTube 频道 Atom）及选择器 `web_list` / `json_list` | `false` | `ETag`/`304` 条件请求；完整提取 `<author>`、`<media:thumbnail>` 与分类；完整 IPv4+IPv6 `BlockList` + 最多 3 跳逐跳 DNS 重验与 IP 绑定；`linkedom` + `@mozilla/readability` 提取正文 |

## 3. 统一过滤、双字词 GIN 检索、讨论树与对比

`ContentFilter` 白名单字段：`platforms`、`kinds`、`sourceIds`、`sourceGroup`（`vip` / `ai` / `tech` / `life`）、`tier`（`T1` / `T1_5` / `T2`）、`topicSlug`、`storyKey`、`providers`、`deliveryModes`、`from` / `to`、`timeStatus`、`author`、`language`、`query`（`<= 200` 字符）、`searchMode`、`searchScope`、`anyTerms`（`<= 20`）、`allTerms`（`<= 20`）、`exclusions`（`<= 10`）、`threadAware`、`signal` 与同平台 `metricKey`/`min`/`max`；`limit` 默认 50、最大 100，非法额外字段一律 `400`。

| ID | 等级 | 过滤、双字词检索、信号与联动比较规则 | 验收出口 |
| --- | --- | --- | --- |
| QRY-01 | MUST | `compileContentFilter(scope, filter)` 为全系统唯一编译入口：有效范围 = `actor允许来源 ∩ 项目关联来源 ∩ 项目filter ∩ 请求filter`；项目与请求的三段词组间取 `AND`，词项按 NFKC/Unicode 小写/转义 `LIKE` 求值，**支持 $\ge 2$ 个连续 Unicode 字母/数字（如中文双字词 `算力`、`开源`、`评测`、`游戏` 及短代号 `AI`、`o3`、`R1`、`v4`）**：对 2 字符中文词与 1–2 字符短代号自动编译为带空格边界的 `doc.search_text LIKE '% 词 %'` 以激活 `gin_trgm_ops` 索引（严禁退回无索引全表扫）；时间窗为 UTC 半开区间 `[from, to)`。 | 双字词 GIN 索引命中与权限隔离测试 |
| QRY-02 | MUST | Keyset 游标编入指纹与 `projectRevision`，失效返 `409 cursor_scope_changed`；分页执行非空与空时间双分支 seek。确定性 `signal` 提供 **`discussion`**（Reddit `num_comments >= 10` / X `replies >= 5`）、**`pain`**（痛点词命中或 `num_comments >= max(score, 1)`）与 **`surge`**（事件簇 48h 独立来源数 $\ge 3$ 且 6h 热度上升）。 | 分页与信号判别测试 |
| QRY-03 | MUST | `threadAware = true` 下先匹配有效证据节点再映射至授权内可见 `anchor`；只读树接口 `GET /v1/content/:id/thread?view=top|matches|op` 采用有界递归/父链闭包查询（`LIMIT 200` 节点、32 跳环截断，确保不遗漏仅携带 `reply_to` 中间评论的多层回复）在内存组装三视图；`POST /v1/project-comparisons` 在跨平台互动比较时返回 `422`。 | 多层回复闭包、三视图与 422 测试 |

## 4. 权限矩阵、Agent 接入与流式导出

| ID | 等级 | 访问控制、Agent 安全与导出格式契约 | 验收出口 |
| --- | --- | --- | --- |
| SEC-01 | MUST | 主体分三类：`owner`/`admin`（全共享与账户/预算/运维权限，保留最后一位 `owner`）、`viewer`（只读共享 + 自己工作区）与 **`machine` API Key**（扩展 `app_session`、`client_kind='machine'`、SHA-256 `token_hash`、1–90 天过期、`allowed_source_ids` 贯穿全查询防枚举 404/403）；统一权限作用域 enum 锁定为 `read` / `projects:write` / `sources:write` / `collect` / `ingest` / `export`（`ingest` Key 禁空来源清单；机器 Key 严禁访问个人研究/账户管理或直接批准付费 Proposal）。 | 角色与越权 E2E |
| OP-01 | MUST | 鉴权后访问 `GET /v1/capabilities` 与同源 TypeBox 派生的 `GET /v1/openapi.json`（完整 `operationId`），并提供机器可读日报/精选订阅出口。**主线采用极简确定性微内核 + 可插拔 AI 翻译/摘要与开放 Agent 架构**：内置可选 AI 增强走零 SDK 原生 `fetch`（兼容任意 OpenAI 格式 `/v1/chat/completions` 端点）并复用 `source_provider_budget`（`provider='ai_enrich'`）额度门控与 `tools: []` 隔离读取态；外部 AI Agent 默认签发仅含 `read` + `export` 的只读 Key，第三方抓取正文一律作为不可信数据隔离，任何产生费用的采集或订阅操作必须由浏览器会话同源点击确认。 | Capabilities、AI 预算门控与权限边界测试 |
| EXP-01 | MUST | `GET /v1/content/export?format=csv|json` 默认上限 `10,000`、硬上限 `50,000`，强制**全局（`max=2`）与单用户（`concurrency=1`）信号量**（冲突返 `429 + Retry-After`）；采用 `pg-query-stream` + `stream.pipeline` 在 `REPEATABLE READ READ ONLY` + `SET LOCAL idle_in_transaction_session_timeout = '35s'` 内写出；JSON 在 `COMMIT` 后追加 `{result: {exportedCount, truncated, nextCursor, complete: true}}`；**CSV 严格遵守 RFC 4180，包含 `id,platform,kind,externalId,publishedAt,author,url,textState,title,text` 并做文本化 ID 与 OWASP 公式中和**。 | 并发导出、断流与 RFC 4180 测试 |

## 5. 标准化 HTTP 路由与运行时路径对齐表

> **说明**：为消除历史文档与运行时代码的路径命名漂移，下表同时标明**当前运行时已注册路径**与**Phase 1–3 增补端点**，所有前端与 Agent 统一以运行时 `/v1/openapi.json` 为准：

| 资源域 | 当前运行时已注册路径（保持向后兼容） | Phase 1–3 增补与对齐路径 |
| :--- | :--- | :--- |
| **账户与机器 Key** | `POST /v1/auth/login`、`GET /v1/auth/session`、`POST /v1/auth/logout`、`POST /v1/auth/register`、`GET/POST /v1/access/keys`、`DELETE /v1/access/keys/:id`、`POST /v1/access/invites`、`GET /v1/capabilities`、`GET /v1/openapi.json` | 前端 `Account.tsx` 完整接通 `GET/DELETE /v1/access/keys` 与 `POST /v1/access/invites` |
| **来源、预算与任务** | `GET/POST /v1/sources`、`PATCH /v1/sources/:id`、`GET /v1/sources/budgets`、`PUT /v1/sources/budgets/:provider`、`POST /v1/sources/:id/{collect,ingest,refresh,unblock}`、`GET /v1/sources/:id/jobs`、`GET /v1/source-jobs`、`GET /v1/source-jobs/:id`、`POST /v1/source-jobs/:id/{cancel,retry,continue}` | 新增 `POST /v1/sources/preview`（先预览前 20 条再保存）；`GET /v1/sources/budgets` 纳入 `ai_enrich` 可选翻译/摘要预算行；`GET /v1/sources` 完整返回 `schedule`、`sourceGroup`、`tier`、`lastCheckedAt`、`lastSuccessAt`、`automaticCollectionBlocked` |
| **内容、聚簇、图表、AI 翻译/摘要与导出** | `GET /v1/content`、`GET /v1/content/:id`、`GET /v1/content/:id/thread`、`GET /v1/content/export` | `GET /v1/content` 支持 `sourceGroup`、`tier`、`storyKey`、`view=feed\|events\|digest`；新增 `GET /v1/content/facets`（驱动全局探索与频道四类可视化图表）与 `POST /v1/content/:id/enrich`（按簇/按需触发或写回 AI 翻译与三点摘要，幂等缓存在 `platform_details.extensions.ai`） |
| **按题探索与 Agent 提案** | （待增补） | 新增 `POST /v1/discovery/query`、`GET /v1/discovery/jobs/:id`（三波渐进取证 + 一键转 `pull` 订阅）及 `POST /v1/agent/proposals`、`POST /v1/agent/proposals/:id/approve` |
| **项目可视化与个人工作区** | `GET/POST /v1/projects`、`GET/PATCH/DELETE /v1/projects/:id`、`GET /v1/projects/:id/overview`、`POST /v1/projects/:id/hydrate`、`GET/POST /v1/workspace/queries`、`DELETE /v1/workspace/queries/:id`、`GET /v1/workspace/annotations`、`GET/PUT /v1/workspace/annotations/:id` | 新增 `POST /v1/project-comparisons`（多专题/多主题并排图表对比）；前端 `Projects.tsx` 与探索页基于 `apps/web/src/charts.tsx` 原生 `<svg>` 完整渲染按日/6h 叠柱趋势、48h 热度 × 6h 增速矩阵、权威级分布与来源联动钻取 |
