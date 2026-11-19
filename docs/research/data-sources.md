# 开源架构参考、8 大活跃分组与 L1–L3 扩源矩阵

> **核对日期** `2026-11-19` · 基于 `prod@8e436ac` 线上 **100 个已验证活跃来源** 及最新开源信息流/聚合生态源码与产品模式调研更新。

---

## 1. 行业标杆拆解：信息流 × 选择性可视化 × 知识复利

| 代表产品 / 开源参考 | 我们明确吸收的成熟设计 | 我们主动拒绝的重型复杂度 / 误区 |
| :--- | :--- | :--- |
| **[Folo (Follow)](https://github.com/RSSNext/Follow)** | 按媒介形态区分的多模态卡片（文章/视频/社交）、冷静克制的时间线、快捷键 triage 与 Human+Agent MCP 协同思路 | 避免强绑定桌面壳或为了兼容外部插件把个人单机后端重型化 |
| **[Miniflux v2](https://github.com/miniflux/v2)** | 按源产出自适应轮询、同域互斥、HTTP `ETag`/`304` 零冗余读取、URL 跟踪参数剥离与干净极速服务端过滤 | 用 Node 进程内 `worker.ts` 调度 + PG16 原位实现，不拆独立 Go 服务 |
| **[KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)** | `T1`/`T1_5`/`T2` 信源分级、`T1` 一手优先代表选举、48h 独立参与者热度（24h 半衰期）+ 6h 升温、08:00 日报、`web_list` 预览 | 拒绝 3 个 Node 容器耗尽 4 GB 内存、拒绝 105 碎迁移、拒绝入库前串行 6 次大模型调用 |
| **[NewsNow](https://github.com/ourongxing/newsnow)** | 轻量零依赖 JSON/HTML 热榜 getter（B站/知乎/V2EX/HN/GitHub Trending/HF Daily Papers 等） | 不引入其前端与 SQLite 层；已移植入 `src/connectors/web/sources.ts` 并采用 **UTC 1 小时快照桶** |
| **[Ground News](https://ground.news/) & [Techmeme](https://www.techmeme.com/)** | 卡片内嵌的 **16px 权威分布彩条**（`T1`/`T1_5`/`T2` 一目了然）、一件事聚成一张主标题卡 + 下挂多源关联脉络 | 仅做事实维度与权威度透明展示，拒绝臆造 0–100 AI 黑盒评分 |
| **[Readwise Reader](https://readwise.io/read) & [Karakeep](https://github.com/karakeep-app/karakeep)** | 未读/稍后/归档阅读工作流（映射至 V2 `content_annotation` 扩充字段）、全文阅读器提取与按需 AI 摘要缓存 | 不常驻 Puppeteer 与 Meilisearch 双服务；沿用 PG16 GIN + V2 轻量 Readability |
| **[TrendRadar](https://github.com/sansan0/TrendRadar) & [Vane](https://github.com/ItzCrazyKns/Vane)** | 热点波动追踪、正向多槽拆解探索（V2 `POST /v1/discovery/query`）与 `keepKPerHostname` 域名去噪 | 保持单机一体，不拆散为独立 Streamlit/向量库栈 |

---

## 2. 当前生产 8 大 `source_group`（`prod@8e436ac` · 100 活跃源分布）

`050` 已激活 `collection_source.source_group` 与 `locale` 字段，并对全部 100 个在线来源完成自动分组与语种回填（零空值）：

| `source_group` | 当前在线源数 | 等级分布与语种构成 | 核心覆盖内容（覆盖“硬核技术 + 商业设计 + 大众生活”） |
| :--- | ---: | :--- | :--- |
| **`ai-firsthand`** | 16 | `T1` 12 · `T1_5` 1 · `T2` 3（全英文一手） | OpenAI News & SDK Releases、Anthropic SDK Releases、Google DeepMind/Research、HF Blog、Qwen/NVIDIA/AWS ML Blog、Simon Willison、Latent Space 等 |
| **`dev-infra`** | 16 | `T1` 12 · `T2` 4（全英文） | GitHub Blog、Cloudflare、Go/Rust/Django/Kubernetes、PostgreSQL、Debian、CISA 安全公告、Stack Overflow、Hacker News RSS 等 |
| **`lifestyle`** | 15 | `T1_5` 2 · `T2` 13（英 13 · 中 2） | 日常料理（Budget Bytes）、居住与建筑（Never Too Small）、流行文化与生活方式精选、独立旅行与消费日常 |
| **`public-affairs`** | 13 | `T1` 5 · `T2` 8（英 9 · 中 4） | BBC World、NPR、ProPublica、联合国新闻、德国之声中文等全球公共事务与长篇调查新闻 |
| **`tech-media`** | 12 | `T1_5` 2 · `T2` 10（英 7 · 中 5） | The Verge、Ars Technica、TechCrunch、Eurogamer、InfoQ、爱范儿、泛科学等中英科技数码媒体 |
| **`science`** | 11 | `T1` 3 · `T1_5` 2 · `T2` 6（英 10 · 中 1） | NASA、Quanta Magazine、MIT/nature 科学专栏、科技新报等基础科研与天文科普 |
| **`design-visual`** | 9 | `T1_5` 2 · `T2` 7（英 8 · 中 1） | Shopping Design、Spoon & Tamago、Colossal、The Public Domain Review、NOWNESS 原创影像等设计审美与视觉策展 |
| **`social-trends`** | 8 | `T1_5` 1 · `T2` 7（英 5 · 中 3） | B站全站热门视频（`newsnow`）、知乎热榜（`newsnow`）、Google Trends US（`newsnow`）、吹音乐独立音乐与社区热议 |

---

## 3. 从 100 源向 500+ 异构信源演进的三级分级策略（L1 → L2 → L3）

为了持续吸纳全球科技、小众爱好者社区、中文高频大众热点与海外社交创作者，所有新增信源按抓取成本与反爬强度落入三层架构，避免单机资源过载：

| 扩容层级 | 适用网站 / 平台与代表示例 | 接入协议与配置方式 | 单机开销与成本护栏 |
| :--- | :--- | :--- | :--- |
| **L1 · 主线内置直采**<br>（主力承担 80% 新增源） | • 博客、文档 Changelog、Substack、YouTube 频道 Atom、GitHub `.atom`、arXiv<br>• 无 RSS 官网更新页（`anthropic.com/news`、`cursor.com/changelog`）<br>• Reddit 免费 `.rss` 雷达（`r/LocalLLaMA`、`r/gaming`）<br>• `newsnow` 内置扩展榜（`hackernews`、`github-trending`、`huggingface-papers`、`v2ex-share` + 可扩展 IT之家/少数派/36氪/酷安/虎扑）<br>• 开源去中心社交 `bluesky_appview` | Web Admin 直接使用 **OPML 2.0 批量导入（`POST /v1/sources/import`）** 或 `web_list`/`json_list` 预览前 20 条创建（无需写白名单/无需重启） | `$0` 成本；`6` 协程并发 + `1.5s` 同域冷却 + 真 `304` 跳过 + `newsnow` 1 小时桶；500 源日常 CPU/RAM 极低 |
| **L2 · 预算门控付费 API**<br>（精确打击高信号讨论） | • X/Twitter 核心研究者、工程师、设计师与独立开发者<br>• Reddit 高热帖的深层神评讨论树 | • `twitterapis` 采用 **15–20 人 `from:u1 OR from:u2` 批次搜索**（200 VIP 每 30m 一轮约 `$12/月`，省 95% 调用），`scrapebadger` 作备源与批量刷指标<br>• Reddit 平时靠 L1 `.rss` 发现，仅当需深挖时按专题手工/阈值触发 `POST /v1/projects/:id/hydrate` 走 `kaix`/`red_crawler` | 仅按配额开启，受 `source_provider_budget` 与 `unknown` 停发闸门保护，严禁无限制全量扫 |
| **L3 · 外部隔离 Collector Sidecar**<br>（强反爬、JS 渲染与生活娱乐生态） | • 小红书公开热帖、豆瓣/什么值得买强校验页、微博防盗链热搜、Telegram 公开频道、Instagram / TikTok 公开创作者 | 在主线单机之外（或独立隔离低配容器/托管 Apify/自建轻量 RSSHub）运行采集器，持 **限定 `sourceId` + `ingest` scope 的 Machine Key** 调用 `POST /v1/sources/:id/ingest` 推流 | 零侵入主线 Fastify 内存预算与开源许可证边界；推流自带 `100条/1MiB` 校验与 `Idempotency-Key` 幂等 |
