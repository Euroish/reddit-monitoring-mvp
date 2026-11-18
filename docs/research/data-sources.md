# 来源选择、开源研究证据与双语高流量信源矩阵

核对日期：`2026-11-18`。结论基于仓库实码、`KKKKhazix/AIHOT@4c6e9e1`、`newsnext/newsnow@5da836c4`、`miniflux/v2@b31f786`、`ItzCrazyKns/Vane@348feca`、`jina-ai/node-DeepResearch@5ece300` 源码核验、公开定价与 OpenAPI 文档及连通性实测。

## 1. 核心开源项目深度拆解与架构取舍（吸收精华，剔除重型冗余）

| 开源项目与固定依据 | 核心亮点（我们直接吸收的产品与算法机制） | 原项目局限 / 复杂度缺陷（我们刻意规避并降维重构的部分） |
| :--- | :--- | :--- |
| **[KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT/tree/4c6e9e1)**<br>（`4c6e9e1`，10.9k★，MIT） | 1. **三级信源分级（`T1` 官方一手 / `T1_5` 认证主创与官方账号 / `T2` 媒体与社区）**与代表报道选举（`pickRepresentative`：英文一手官方永远压过二手转述）；<br>2. **六类信源配置**（含无需写代码即可抓无 RSS 列表页的 `web_list` CSS 选择器与 `json_list` 字段路径）、**“先预览前 20 条再保存”**与**“旧文不刷屏”**（首次导入限 `initialBackfillLimit: 8`，超 48 小时旧文按原时间归档不进今日流）；<br>3. **48 小时独立参与者事件热度（`events/hot.ts`）**：同源重复抓取不虚增热度、24h 指数半衰期、与 6h 前对比标出 `surge`/`rising`/`new`（且严格剔除落后停采 `behind` 与新接入 `late` 来源防假飙升）；<br>4. **08:00 零模型成本规则日报**与**三维主题目录**（公司与模型 `company` / 技术方向 `field` / 内容体裁 `genre` + `IDENTITY_LEXICON` 确定性实体词典）。 | 1. **687 个文件、105+ 碎迁移与 3 个独立 Node 容器（`api` + `worker` + `web` SSR）**：在 4 GB 内存 VPS 上仅多出的容器基线开销就吃掉 $>1\text{ GB}$ RAM；我们保持 **单 Fastify 容器 + Caddy 静态 SPA + PG16**；<br>2. **入库强依赖 5–6 次串行大模型调用**（预筛 $\rightarrow$ 独立打两次分 $\rightarrow$ 结构化 $\rightarrow$ 写作 $\rightarrow$ 改词 $\rightarrow$ 归组）：模型限流或无额度时整条流水线停摆（`docs/selection.md:14`），且日采万条时 Token 成本极高。我们改为**入库、实体打标、SimHash 聚簇、48h/6h 热度与 08:00 日报 100% 确定性零模型运行**，可选轻量模型**仅对聚簇胜出的代表事件异步生成 1 次中文“答案先行”摘要（减少 95% 模型调用）**；<br>3. **缺乏深层评论树与主动按题全网探索**：我们保留三视图评论树水合，并叠加 `Vane`/`DeepResearch` 的按题 20–30 站动态探索。 |
| **[newsnext/newsnow](https://github.com/newsnext/newsnow/tree/5da836c49c327f2c352216c5cbb4dea1abd9fcd3)**<br>（`5da836c4`，22.5k★，MIT） | **`server/sources/` 下成熟的轻量 JSON/HTML 榜单 getter**：直连 B站热门视频与热搜、知乎热榜、微博实时热搜、V2EX、IT之家、酷安、36氪、Hacker News、GitHub Trending、Product Hunt 等高流量大众与科技入口。 | 不引入其前端、`h3` 服务端或 SQLite 缓存；仅将高流量 getter 纯函数移植进本仓 `src/connectors/web/sources.ts`（走本仓 IP 绑定 SSRF 护栏与 5 分钟桶 `evidenceKey`）。 |
| **[miniflux/v2](https://github.com/miniflux/v2/tree/b31f786)**<br>（`b31f786`，10.0k★，Apache-2.0） | **`internal/model/feed.go` (`ScheduleNextCheck`) 与 `internal/storage/batch.go` (`WithLimitPerHost`)**：按产出频率与 HTTP `ETag`/`304`/`Retry-After` 自适应调整轮询间隔，并在到期批次中限制同域名并发（`limitPerHost = 1`）。 | 用单条 PostgreSQL 窗口函数（`ROW_NUMBER() OVER (PARTITION BY provider, host)`）与 `collection_source.schedule` JSONB 在现有 `worker.ts` 内原位实现。 |
| **[ItzCrazyKns/Vane](https://github.com/ItzCrazyKns/Vane/tree/348feca)** (38.2k★) & **[jina-ai/node-DeepResearch](https://github.com/jina-ai/node-DeepResearch/tree/5ece300)** (5.2k★) | **多方向正交查询拆解 + URL 规范化 + `keepKPerHostname` 单域名占槽上限 + 标题 3-gram 去重 + 分波渐进流式提交**：解决“问一个问题动态抓取 20–30 个合适网站并提取证据”的编排难题。 | 摒弃重型向量库与高内存 `jsdom`/Headless 浏览器；采用 **Tier-1 免费垂直 API 联邦 + Tier-2 可插拔搜索索引 + `linkedom` + `@mozilla/readability`（单页 `<15ms`、峰值 `<65MB`）**，并复用 `delivery_mode='push'` 零新增表落库。 |
| **[DIYgod/RSSHub](https://github.com/DIYgod/RSSHub/tree/2340a032022c4382b2f5a165a2e3d3665ec06d89)**<br>（`2340a032`，AGPL-3.0） | 路由提取规则与反爬签名参考（不把 AGPL 容器并入主线镜像；支持管理员按需在外部配置受控 RSS 源）。 | 主线内置 `rss`、`web_list`（选择器列表）与 `json_list` 三种零代码配置能力，覆盖 90% 无原生 RSS 的官网 Changelog 与资讯页。 |

---

## 2. 双语高流量三大内容支柱与信源分级矩阵（暂缓重度金融，聚焦 AI + 科技数码 + 大众生活娱乐）

> **核心选源原则**：
> 1. **AI 与前沿技术以英文一手（`T1`/`T1_5`）为绝对主力（占 85%+）**：大模型、Coding Agent、开源权重、架构论文与核心工程师讨论 100% 首发于英文（官方 Blog、GitHub Releases、Hugging Face、arXiv、X、`r/LocalLLaMA`、Hacker News）。中文 AI 资讯仅收录 **DeepSeek、Qwen（千问）、Kimi（月之暗面）、MiniMax、智谱、字节 Seed** 等中资头部实验室的**官方一手发布**，剔除滞后且失真的二手搬运号。
> 2. **大众生活、娱乐文化、游戏与数码兼顾中文国民级热榜与英文全球流行社区**：确保每天打开网站既有最硬核的一手 AI/技术突破，也有人们日常真正在刷的 B站热门、知乎热榜、微博热搜、游戏影视口碑、YouTube 顶流创作者与 Reddit 全球热帖。

### 2.1 支柱一：AI、LLM、Agent 与 Vibe Coding（英文一手 `T1`/`T1_5` 优先 + 中资大模型一手）

| 权威分级 | 信源类别与代表清单（对标 `AIHOT` `industry/sources.json` 并扩充） | 采集渠道 (`provider` / `kind`) | 推荐频率与防噪策略 |
| :--- | :--- | :--- | :--- |
| **`T1` 官方一手**<br>（代表选举最高优先级） | • **核心实验室官方 RSS/Blog**：OpenAI News (`openai.com/news/rss.xml`)、Google DeepMind (`deepmind.google/blog/rss.xml`)、Google Research (`research.google/blog/rss/`)、Hugging Face Blog (`huggingface.co/blog/feed.xml`)、Microsoft Research、NVIDIA Blog、AWS ML Blog、GitHub Blog AI & ML (`github.blog/ai-and-ml/feed/`)、Mistral AI (`mistral.ai/news/rss`)、BAIR (`bair.berkeley.edu/blog/feed.xml`)<br>• **无原生 RSS 的官方新闻页（`web_list` 选择器直取）**：Anthropic Newsroom (`anthropic.com/news`)、xAI News (`x.ai/news`)、Cursor Changelog (`cursor.com/changelog`)<br>• **核心开源仓库与 CLI Releases（GitHub 原生免 Key `.atom`）**：`anthropics/claude-code`、`openai/codex`、`ggml-org/llama.cpp`、`vllm-project/vllm`、`ollama/ollama`、`deepseek-ai/DeepSeek-V3`、`QwenLM/Qwen3` (`/releases.atom`) | `feed` (`rss` / `web_list`) | `30m–60m`；支持 `ETag`/`304`；首次入库 `initialBackfillLimit: 8` |
| **`T1_5` 认证主创与学者**<br>（绑定 `ownerEntityId` / `personId`） | • **独立技术博客与深度周刊（英文一手）**：Simon Willison (`simonwillison.net/atom/everything/`)、Latent Space (`latent.space/feed`)、Import AI (`importai.substack.com/feed`)、Chip Huyen、Lilian Weng、Sebastian Raschka (`Ahead of AI`)、Nathan Lambert (`Interconnects`)<br>• **200 位核心 AI 学者与构建者 X 批次追踪（`source_group='vip'`）**：按 15–20 人/组编为 10 个批次搜索源（`@karpathy`, `@simonw`, `@sama`, `@darioamodei`, `@borischerny`, `@alexalbert__`, `@ggerganov`, `@drjimfan`, `@swyx`, `@ylecun`, `@rauchg`, `@clementdelangue`, `@tri_dao`, `@noamshazeer`, `@amanrsanger`, `@mitchellh` 等）<br>• **YouTube 顶流 AI/开发频道（原生免 Key Atom）**：Andrej Karpathy、Two Minute Papers、Yannic Kilcher、Fireship、AI Explained (`youtube.com/feeds/videos.xml?channel_id=...`) | `feed` (`rss`) + `twitterapis` / `scrapebadger`（批次 `advanced_search`） | 博客 `60m–120m`；X 批次 `30m`（较单号轮询省 **95%** 费用） |
| **`T2` 论文、评测与硬核社区** | • **每日高赞论文与模型榜**：HuggingFace Daily Papers 官方免费 JSON (`huggingface.co/api/daily_papers`)、arXiv `cs.AI+cs.CL+cs.LG` RSS<br>• **一手开发者实战与踩坑社区**：Reddit `r/LocalLLaMA`、`r/ClaudeAI`、`r/MachineLearning`、`r/ChatGPTCoding`、`r/cursor`（走 `.rss` 免费雷达 + 高互动贴 `kaix` 评论树水合）<br>• **精选英文 AI 垂直媒体**：Ars Technica AI (`arstechnica.com/ai/feed/`)、MIT Tech Review AI、The Decoder (`the-decoder.com/feed/`) | `newsnow` / `feed` + `kaix` / `red_crawler` | 社区雷达 `15m–30m`；论文榜 `30m` |

### 2.2 支柱二：全球科技、独立开发与数码产品（中英双语高流量科技入口）

| 语种与分级 | 信源/榜单名称 | 采集实现（`newsnow` getter 或 `feed`） | 读者日常查看价值 |
| :--- | :--- | :--- | :--- |
| **英文一手 (`T1_5`/`T2`)** | **Hacker News 实时热榜** (`hackernews`) + **Algolia 高分榜** | `newsnow` (`news.ycombinator.com`) + `hn.algolia.com/api/v1/search` | 全球程序员、硅谷创业者与硬核极客每日第一信息源 |
| **英文一手 (`T1_5`/`T2`)** | **GitHub Trending 今日/本周飙升榜** (`github-trending-today`) | `newsnow` (`github.com/trending` HTML 解析星标增量与仓库简介) | 每天最早发现全球爆款开源项目与新工具 |
| **英文一手 (`T2`)** | **TechMeme 硅谷头条榜** & **Product Hunt 每日新品榜** | `feed` (`techmeme.com/feed.xml`、`producthunt.com/feed`) | TechMeme 是全球科技高管必看的事件聚合标杆；Product Hunt 是新产品首发阵地 |
| **英文精选 (`T2`)** | **The Verge / Ars Technica / Wired** | `feed` (`theverge.com/rss/index.xml`、`feeds.arstechnica.com/arstechnica/index`) | 全球消费电子、苹果/谷歌/硬件评测与科技文化一手深度报道 |
| **中文高流量 (`T2`)** | **V2EX 最新分享与热议** (`v2ex-share`) | `newsnow` (`v2ex.com/feed/create.json` / `index.xml`) | 中文开发者、独立创客与数码玩家活跃度最高的技术与生活社区 |
| **中文高流量 (`T2`)** | **IT之家热榜/快讯** (`ithome`)、**少数派** (`sspai`)、**酷安今日最热** (`coolapk`)、**爱范儿** (`ifanr`) | `newsnow` (`ithome.ts`, `coolapk.ts`) + `feed` (`ifanr.com/feed`) | 国内手机、PC、汽车数码、新奇 App 与数字生活最高频入口（内置广告词过滤） |

### 2.3 支柱三：大众生活、文化娱乐与全网热议（中英双语国民级注意力入口）

| 语种与领域 | 信源/榜单名称 | 采集实现（`newsnow` getter / `feed` / `reddit`） | 覆盖的大众日常兴趣场景 |
| :--- | :--- | :--- | :--- |
| **中文大众视频与ACGN** | **B站（Bilibili）全站热门视频 & 实时热搜榜** (`bilibili-hot-video`, `bilibili-hot-search`) | `newsnow` (`api.bilibili.com/x/web-interface/popular` & `s.search.bilibili.com/main/hotword`，免签名 JSON) | 年轻群体必看的科技、游戏、影视解说、动漫、生活搞笑与知识区爆款视频 |
| **中文大众深度讨论** | **知乎热榜** (`zhihu`) | `newsnow` (`www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=20&desktop=true` JSON) | 社会突发、职场生活、影视游戏评价、科普与行业内幕的高赞长文问答 |
| **中文实时大众风向** | **微博实时热搜** (`weibo`) & **今日头条热榜** (`toutiao`) & **澎湃热榜** (`thepaper`) | `newsnow` (`s.weibo.com/top/summary` 带 `新/热/爆` 标签提取、`toutiao`、`thepaper`) | 明星娱乐、社会民生热点、体育赛事与全网流行梗的实时风向标 |
| **中文游戏、体育与文娱口碑** | **机核网（Gcores）**、**虎扑步行街日常热帖** (`hupu`)、**什么值得买热门好物** (`smzdm`) | `newsnow` (`bbs.hupu.com/topic-daily-hot`、`post.smzdm.com/hot_1/`) | 主机/PC/独立游戏文化、体育与男性生活社区热议、大众消费数码生活好物 |
| **英文全球大众与娱乐社区** | **Reddit 全球大众与娱乐顶流版块**：`r/popular`、`r/gaming`、`r/movies`、`r/television`、`r/technology`、`r/worldnews`、`r/todayilearned`、`r/ExplainLikeImFive` | **三级采集**：先用 `.rss`（如 `reddit.com/r/gaming+movies+television/hot/.rss`）做 \$0 雷达，对高讨论贴按需调 `kaix` 水合前 50 条神评 | 欧美大众流行文化、Steam/主机游戏新作讨论、电影美剧口碑与全球奇闻轶事一手热帖 |
| **英文全球顶流视频创作者** | **YouTube 科技生活与娱乐顶流频道**：MKBHD、Linus Tech Tips、MrBeast、Veritasium、3Blue1Brown、IGN、GameSpot | `feed` (`https://www.youtube.com/feeds/videos.xml?channel_id=...` 原生免 Key Atom，提取视频封面、标题与原链) | 全球播放量最高的数码开箱、大众科普、游戏预告与娱乐挑战视频 |

---

## 3. 200 位 VIP 关注人物批次追踪降本算账与 Reddit/X 选型总结

### 3.1 X 关注人物：单账号时间线 vs. `advanced_search` 批次合并（节省 95% 预算）

| 策略 | 调用端点 | 200 位 VIP（每 30 分钟一轮 = 1,440 轮/月）总调用数 | 无人发推空窗期表现 | `TwitterAPIs` 月成本（`$0.0008/call`） | `ScrapeBadger` 备源月成本 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **旧方案：逐账号拉时间线** | `GET /twitter/user/tweets` | $200 \times 1,440 = \mathbf{288,000\text{ 次/月}}$ | 每次仍返回 20 条旧推文并全额扣费；且 `pageSize=25 > 20` 直接抛异常 | **$\$230.40\text{ / 月}$** | $\approx \$580\text{ / 月}$ |
| **新方案：10 组×20 人批次搜索** | `GET /twitter/tweet/advanced_search` | $10 \times 1,440 \times 1.05 = \mathbf{15,120\text{ 次/月}}$ | 编译 `since_time`/`until_time`，空窗返回 `0` 条；每条推文按 `author.handle` 精确还原人物归属 | **$\$12.10\text{ / 月}$**（**省 94.7%**） | **$\$3.00–\$8.00\text{ / 月}$**（`1 base + 1 credit/item`） |

### 3.2 在线渠道核验总结与 R4 `.zst` 物理隔离边界

- **已退役实删渠道**：`Arctic Shift` 在线 API（`422 Timeout` 与强限流）与 `TwitterAPI.io`（`$0.15/1k` 高成本且同源冗余）已在主线彻底实删，历史观测数据软归档保留。
- **主备渠道分工**：X 采用 `TwitterAPIs`（主力批次搜索与时间线）+ `ScrapeBadger`（独立备源与原生 `GET /v1/twitter/tweets/` 批量 ID 补全）；Reddit 采用原生 `.rss`（零成本发现雷达）+ `kaix/reddit-scraper`（主力搜索与单帖 `t3_...` 评论树水合）+ `red_crawler`（Actor 级搜索与单帖评论备源）；资讯与热榜采用 `newsnow`（13+ 主流中英榜单）+ `feed`（RSS/Atom + `web_list` + `json_list`）。
- **R4 `.zst` 离线归档隔离**：参考 [`ArthurHeitmann/arctic_shift@11bbf2e6`](https://github.com/ArthurHeitmann/arctic_shift/tree/11bbf2e62db1dd1d699e1280724916a079815ec8)，历史 `.zst` 归档仅在未来独立外挂 `plugins/zst-archive/` 中顺序解压转 Parquet 后经 `POST /v1/sources/:id/ingest` 推流，严禁进入主线依赖或容器镜像。
