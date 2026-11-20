# 开源架构对标、8 大活跃分组与 L1–L3 扩源矩阵（STD-100）

> **核对基准**：`2026-11-19` · 基于 `prod@8e436ac` 线上 **100 个活跃排期来源** 及开源生态产品与架构模式调研更新。

---

## 1. 开源生态标杆拆解（吸收最小高收益设计 · 拒绝重型堆栈）

| 参考标杆 | 采纳产品 / 工程模式 | 主动剔除的冗余成本（4 GB 单机约束） |
| :--- | :--- | :--- |
| **[Folo](https://github.com/RSSNext/Follow)** | 多模态阅读流、快捷键 triage 与 Human+Agent 统一开放契约 | 不引入重桌面壳或过重客户端同步协议 |
| **[Miniflux v2](https://github.com/miniflux/v2)** | 自适应退避、`hostCooldown` 同域隔离、真 `ETag`/`304` 与跟踪参数剥离 | 并入单一 Node Worker，不拆 Go 独立进程 |
| **[KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)** | `T1`/`T1_5`/`T2` 分级、`T1` 一手代表、48h 半衰期 + 6h 飙升、08:00 日报、`web_list` 预览 | 拒绝 3 容器高内存、105 碎迁移与入库前强绑 6 次 LLM |
| **[NewsNow](https://github.com/ourongxing/newsnow)** | 零依赖纯函数热榜 getter（B站/知乎/HN/GitHub Trending/HF Papers 等） | 仅移植纯函数进 `web/sources.ts`，存在 `rank`/`metrics` 时走 UTC 1h 桶 |
| **[Ground News](https://ground.news/) & [Techmeme](https://www.techmeme.com/)** | 卡片内 **16px `T1`/`T1_5`/`T2` 组成微条**、同题聚成单卡+关联链接脉络 | 拒绝臆造 0–100 AI 黑盒评分 |
| **[Readwise Reader](https://readwise.io/read) & [Karakeep](https://github.com/karakeep-app/karakeep)** | `[V2]` 水位线未读流转、按需 Readability 提取与按簇 AI 摘要缓存 | 不常驻 Puppeteer 与 Meilisearch 双重后台 |

---

## 2. `[LIVE]` 线上 8 大活跃分组实测分布（共 100 源）

| `source_group` | 活跃源数 | 等级与语种分布 | 代表覆盖范围 |
| :--- | ---: | :--- | :--- |
| **`ai-firsthand`** | 16 | `T1` 12 · `T1_5` 1 · `T2` 3（全 `en`） | OpenAI News/SDK、Anthropic SDK、DeepMind/Research、HF Blog、Qwen、NVIDIA/AWS ML、Simon Willison、Latent Space 等 |
| **`dev-infra`** | 16 | `T1` 12 · `T2` 4（全 `en`） | GitHub Blog、Cloudflare、Go/Rust/Django/K8s、PostgreSQL、Debian、CISA、Stack Overflow、HN RSS 等 |
| **`lifestyle`** | 15 | `T1_5` 2 · `T2` 13（`en` 13 · `zh` 2） | 日常料理（Budget Bytes）、小户型居住（Never Too Small）、独立生活与文化消费精选 |
| **`public-affairs`** | 13 | `T1` 5 · `T2` 8（`en` 9 · `zh` 4） | BBC World、NPR、ProPublica、联合国新闻、德国之声中文等公共与调查报道 |
| **`tech-media`** | 12 | `T1_5` 2 · `T2` 10（`en` 7 · `zh` 5） | The Verge、Ars Technica、TechCrunch、Eurogamer、InfoQ、爱范儿、泛科学等 |
| **`science`** | 11 | `T1` 3 · `T1_5` 2 · `T2` 6（`en` 10 · `zh` 1） | NASA、Quanta Magazine、MIT/Nature 科学、科技新报等科研与科普 |
| **`design-visual`** | 9 | `T1_5` 2 · `T2` 7（`en` 8 · `zh` 1） | Shopping Design、Spoon & Tamago、Colossal、Public Domain Review、NOWNESS 等 |
| **`social-trends`** | 8 | `T1_5` 1 · `T2` 7（`en` 5 · `zh` 3） | B站热门视频（`newsnow`）、知乎热榜（`newsnow`）、Google Trends US（`newsnow`）、吹音乐及海外讨论 |

---

## 3. L1 → L3 扩源分级表（`100 → 500+` 异构源路径）

| 扩源层级 | 适用渠道 | 接入方式与技术要点 | 资源与成本边界 |
| :--- | :--- | :--- | :--- |
| **L1 · 主线内置直采**<br>（主力承担 ~80%） | RSS/Atom、`web_list`、`json_list`、GitHub `.atom`、YouTube Atom、arXiv、Reddit `.rss` 雷达、内置 `newsnow`（`hackernews` / `github-trending` / `huggingface-papers` / `v2ex-share` + `[V2]` IT之家/少数派等）、`bluesky_appview` | Web **`/sources`** 预览或 **OPML/JSON 批量导入**（无需重启）；`[V2]` Phase C 补 `linkedom` + `Readability` 提取正文与外链 | `$0` 成本；`6` 协程 + `1.5s` 同域冷却 + 真 `304` + `newsnow` 存在 `rank`/`metrics` 时走 1h 桶 |
| **L2 · 预算门控付费 API** | X 核心 AI/开发者动态、Reddit 高讨论贴深层评论树 | `twitterapis` 用 15–20 人 `from:u1 OR from:u2` 批次搜索（较单号省 ~95%）+ `scrapebadger` 刷新；Reddit 高赞贴经 `/v1/projects/:id/hydrate` 走 `kaix` | 受 `source_provider_budget` 与 `unknown` 停发闸门严格控费 |
| **L3 · `[V2]` 外部 Sidecar 推流** | 小红书、豆瓣、什么值得买、Telegram 频道、Instagram / TikTok 公开创作者 | 外部独立采集进程持限定 `sourceId` + `ingest` scope Key 调 `POST /v1/sources/:id/ingest`；依赖 `[V2]` `stream_class='live'` 方进默认 `/` 与趋势 | 主线零无头浏览器/Python 依赖；`1..100` 条/`<=1 MiB` 幂等落库 |
