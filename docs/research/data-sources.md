# 数据源与开源项目选型

本轮核查：2026-11-13，读取当前项目及 AIHOT、TrendRadar、NewsNow、Fastify 的固定源码和许可证。**没有执行第三方采集、供应商带凭证请求或模型调用**。价格与 Reddit/X 历史运行证据保留其原核对日期，不因本文重写变成最新验收。

结论：**Reddit/X 是原平台采集线；NewsNow 是首个热榜聚合入口，AIHOT RSS/API 是可选第二入口。TrendRadar 作为产品参考，不再增加为独立数据源。** 一个薄 adapter 接入本产品内容库，不把几个完整项目及其数据库/任务系统拼起来。

## 1. 开源项目：已读源码，而非按 star 选择

| 项目 / 固定版本 | 关键源码与观察 | 本项目决定 |
| --- | --- | --- |
| [AIHOT e385794](https://github.com/KKKKhazix/AIHOT/tree/e3857943ddb53b1d2ea13d346be2e06709b2be19) | [collect.ts](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/packages/backend/src/sources/collect.ts) 分派 RSS/网页/JSON/X；[x.ts](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/packages/backend/src/sources/x.ts) 使用 SocialData，不是免费 X 采集器；[queue.ts](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/packages/backend/src/jobs/queue.ts) 是 pg-boss；[v1.ts](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/apps/api/src/routes/v1.ts) 提供 items/stories/报告等公开读取 | 先读 RSS/API，不 fork 整套站。公开库只有示范信源，不含线上信源名单/运营数据；不能靠安装获得同等数据覆盖 |
| [NewsNow 5da836c](https://github.com/newsnext/newsnow/tree/5da836c49c327f2c352216c5cbb4dea1abd9fcd3) | [getters.ts](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/getters.ts) 注册各站 getter；[API](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/api/s/index.ts) 每次最多返回 30 条且可回退缓存；[aihot.ts](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/sources/aihot.ts) 读取 AIHOT RSS | 主选热榜入口；只接 2–3 个实际有价值榜单，不宣称全历史/全文。原 ourongxing/newsnow URL 当前重定向 newsnext/newsnow |
| [TrendRadar 8a31662](https://github.com/sansan0/TrendRadar/tree/8a316628215c53ad34b7200ecb0fba76de3ef6c7) | [fetcher.py](https://github.com/sansan0/TrendRadar/blob/8a316628215c53ad34b7200ecb0fba76de3ef6c7/trendradar/crawler/fetcher.py) 默认请求 `newsnow.busiyi.world/api/s`，接受 success/cache；另有 RSS、关键词/AI 分析、通知和 SQLite 存储 | 可参考提醒/过滤流程；不作为第三个独立上游，不引入其 Python+SQLite 运行链，不复制本轮未处理许可义务的代码 |
| [Fastify v5.12.8](https://github.com/fastify/fastify/tree/0c7413a8332a7892e12dcc351c27a190fefc0053) | 官方 Plugins/Testing 文档与实现提供路由注册、作用域与 inject；默认分支本轮是 6.0.0-alpha.6 | 只采用 5.x 稳定版替代手写 HTTP，目标与迁移边界见[架构](../architecture.md)；上游性能宣传不当本项目验收 |

AIHOT 的 [hot.ts](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/packages/backend/src/events/hot.ts) 实现 48 小时窗口、24 小时半衰期、每个独立参与者一次贡献，并区分来源滞后/不可比。这值得借鉴“独立证据 + 时间衰减”的思想；不复制其依赖 site 配置/归组状态的整个 SQL 模型。当前产品先交付内容量，事件分组进入 P1 后才定义本项目分母和来源独立性。

### 许可证与数据使用

- AIHOT [MIT](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/LICENSE)、NewsNow [MIT](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/LICENSE)：若复制/改写实质代码，保留版权和许可；AIHOT 品牌/Logo 不随框架使用。
- TrendRadar [GPL-3.0](https://github.com/sansan0/TrendRadar/blob/8a316628215c53ad34b7200ecb0fba76de3ef6c7/LICENSE)：分发其修改/衍生版本须按对应义务处理；调用数据不等于自动污染本项目，也不能靠“独立进程”断言豁免。
- 代码许可不授予聚合站内容、原文、账户会话和数据转售权限。上线前核对实际出口的条款、署名、缓存/留存和可导出范围；本轮没有完成内容商业使用授权。

## 2. 聚合入口如何接入

### NewsNow：首个入口

先白名单 2–3 个榜单；通过一个受控实例的 `/api/s?id=...` 获取，或只移植所需 MIT getter（二选一，连通试验后锁定）。不将公开演示域名当 SLA。若自托管，仅作为 provider 服务维护其版本与资源，不移入它的账户系统/缓存库作为本产品数据层。

已知源码限制必须进入 adapter/UI：

- 响应 `status=success` 也可能直接来自 interval 内缓存；该分支 `updatedTime=now`，因此不能当原平台新观测时刻。
- `latest` 不保证绕过缓存，失败可能返回旧 cache；应保留 cache/取回证据，不把读取成功等同来源新鲜。
- 返回最多 30 个条目，没有本产品可续历史 cursor；每次只是榜单快照，覆盖 partial。
- [NewsItem](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/shared/types.ts) 的 pubDate 可缺，extra 非统一互动指标；未知时间/正文/指标保持 null，不能把榜单顺序当平台热度值。

原发布者、原文链接和中间聚合渠道分别映射。统一以 web 内容进入；有可靠原平台 ID 的专用映射以后再加，不能仅从 URL 猜身份。没有发布时间的条目仍可浏览，按“榜单被采到的时间”展示时必须明确那不是发布时间。

### AIHOT：可选第二入口

优先 RSS `/feed/all.xml`，需要特定查询/结构时才使用公开 `/api/v1/items`；首期不同时维护两个等价出口。文章是精选/整理产物，不是其全部原始采集库。若扩到 stories，只当事件综述，不能凭引用数量生成多条原帖或补齐缺失原文。

直接 AIHOT 与 NewsNow 的 AIHOT channel 默认只开一个。其余相同原文跨渠道出现时按稳定 URL/GUID 与 namespace 去重；不能确认共同身份时保留关联线索，不强合并。

```text
TrendRadar → NewsNow → AIHOT → 原发布者
本产品    → NewsNow 的选定非 AIHOT 榜单
本产品    → AIHOT RSS（可选）
```

项目数量不是独立上游数量，provider 数量也不是独立媒体数。首版宁可显示“独立发布者未知”，不制造独立性评分。

## 3. Reddit：已有能力与缺口

| 路径 | 当前事实 | 取舍 |
| --- | --- | --- |
| Arctic Shift | 已接入社区/账号/评论/已知 ID；真实有界落库成功。关键词是限定范围，不是全站入口；近期覆盖与持续稳定未验 | 保留定向/历史补充；修复本地 13 位评论刷新校验后才启成熟刷新 |
| kaix / Apify | 已接入跨社区 search、社区/账号帖子、账号/帖子评论；无持久续页，始终 partial；收费未知结果不自动重放 | 先核对现有实现的质量/正常费用；未证明可支撑全站持续完整监测，不默认启用 |
| 匿名 JSON/HTML / 旧 Scrapling | 本服务器多次 403，10 月 28 日云端登录也未成功；旧 bridge 未实现持久登录 profile | 不重启已关闭服务，不把换爬虫库当修复 |
| OpenCLI / 浏览器 | 源码有搜索/内部翻页，但 CLI 不外显可靠 cursor/完整性；有离线 capped/补全边界复现 | 不直接把 JSON 数组包装成完整采集页；不是现成生产来源 |
| 新商业/自采候选 | 只有价格、源码与维护者描述，缺本项目真实首/续页和长期账单 | 当前链路不够时再验一家，不并行建设多个 adapter |

### 正常价格研究（2026-11-10，未在本轮重验）

| 候选 / 一手链接 | 当时公开信息 | 决定 |
| --- | --- | --- |
| [opportunity-biz Actor](https://apify.com/opportunity-biz/reddit-scraper) / [元数据](https://api.apify.com/v2/acts/opportunity-biz~reddit-scraper) | 结果事件 $0.05/千条，启动 $0.0001/GB、至少一次；平台/数据集/有效去重收益仍需核账 | 新候选中先做赠额内小样本，不把两项事件费当总账单 |
| [CiteRocket](https://www.citerocket.com/pricing) / [搜索](https://www.citerocket.com/docs/listings/search) | $10/10,000 credits，普通读取 1 credit；赠 1,000；搜索文档列 limit 1–100/after | 仅赠额验证；到 $0.10/千条需平均≥10条有效内容/全部收费尝试，到 $0.07 需≥15；最大 limit 不等于页收益 |
| [Redditapis](https://www.redditapis.com/pricing) | 普通读取 $0.0015/次，最小充值 $10；另有免费读取/$19 月包；高级评论 $0.02/次 | 仅可用赠额对照，不采购月包；达两档单位价需≥15/≥22条有效内容/次 |
| [Fatih Actor](https://apify.com/fatihtahta/reddit-scraper-search-fast)、[Bright Data](https://brightdata.com/products/web-scraper/social-media-scrape) | 正常约 $1.19–1.49/千结果、$1.50/千记录 | 超单位价硬上限，不作自动备源 |

Redditapis 自报帖子搜索中位约 9 条/次，既非项目平均页收益，也未计失败/去重，不能据此批准采购。kaix 固定 build/上限与费用边界在[配置](../development.md#reddit-kaix--apify)；曾有独立试验授权不等于长期收费调度授权。

[Reddrix 55815c5](https://github.com/Coding-Doctor-Omar/reddrix/tree/55815c54c6c9c8a0cbe7bd0239342cb5f5af9297) 是未运行的自采后备：Camoufox/HTML/internal endpoints、固定 relevance、逐命中补详情、默认并发/初始化重试较多；不直接接入增量高水位。Scrapling v0.5.1 是通用获取工具，未提供本项目已验收的 Reddit 搜索源。暂不因重构安装/扩展这些路径。

## 4. X：先证明一条路径可用

| 路径 / 固定研究依据 | 能力与缺口 | 本轮安排 |
| --- | --- | --- |
| [OpenCLI X search 9bc5f5c](https://github.com/jackwener/OpenCLI/blob/9bc5f5ca132ec4d4e48d7ee517d4303bf159e8e8/clis/twitter/search.js) | 已登录 x.com 会话内 SearchTimeline；结果后出错可返回部分数组，缺少对外续页/终止元数据，部分未知指标补零 | 正常设备先做只读五条试验；不原样接入公共页事务 |
| [twscrape d26aac0](https://github.com/vladkens/twscrape/tree/d26aac09325b7873a62c3a6ec92e7dea3c277051) | 账号会话/SQLite，支持搜索/时间线；limit 不是请求硬上限，没账号可能等待 | 若需脚本化则与 OpenCLI 二选一，单会话有界验证；不搭账号池 |
| [TwitterAPI.io](https://twitterapi.io/pricing) | 已有账号/搜索/ID adapter；11-10 报价 $0.15/千返回帖子、每请求最低 $0.00015 | 超当前单位价上限，保留默认关闭，不直接付费启用 |
| [TwitterAPIs](https://www.twitterapis.com/pricing) / [GetXAPI](https://www.getxapi.com/pricing) | 11-10 研究分别标准 $0.0008/次、按余额 $0.001/次；套餐/端点差异需再核对 | 只是备选，不是采购计划；不能只替换现有 adapter 的 base URL |

上述 X 会话研究最后核对为 11-10，本轮未运行真实会话；免费开源客户端仍依赖正常会话和上游内部接口，不等于免费/免账号的稳定数据服务。[Nitter 原仓库](https://github.com/zedeus/nitter) 已归档，不作为主源；FxEmbed 仅为已知链接补全，不能发现未知关键词内容。

## 5. 成本和准入

沿用[产品预算](../README.md#产品约束)，采集总额在 Reddit/X/聚合来源间分配。正常成本包含空页、失败、重试、重复、补全、启动、平台和支付费用；帖子/评论、新内容/刷新分别列账。

`有效成本/千条 = 窗口内全部可归属费用 ÷ 去重且成功落库的有效内容数 × 1000`；分母为零报告不可计算。

10 万条按 $0.07/千条需 $7、按 $0.10 需 $10，不能直接视为通过 50 元总预算。实际汇率 r 元/美元、其他采集费用 F 元时，10 万条的美元单位价上限为 `min(0.10, (50-F)/(100*r))`。最低充值现金支出与月度消耗分开；没有授权不充值，赠额不抵扣长期选型成本。

首测限少量目标、页数/请求/时长/费用，保存响应、cursor、UTC、有效独立条数、缺失和扣费到私有 `output/`。来源准入和 48–72h 持续验收只在[开发安排 M3](../plans/source-expansion.md#m3来源准入与持续验收)维护。没有合格来源就缩减规模或重新确定预算，不通过自动重试/代理/另一包装项目掩盖不可用。

## 6. 历史证据索引

本节是历史事实摘要；原参数、响应和更长调查可在 Git `3551900:docs/research/data-sources.md` 及相应提交查阅。原始数据不要求进入 Git。

| 时间 / 基线 | 可确认结果 | 证据边界 |
| --- | --- | --- |
| 10-16 / `6bd18ad` | Arctic Shift 一小时社区帖子/评论各5条落库、API读回、帖子重放新增0 | 非全站关键词、完整覆盖或持续验收 |
| 10-20 / `c805ca1` | Arctic Shift 5次真实请求：2次帖子成功各7条，3次422 Timeout；隔离合成测得逐条页落库约128条/秒 | 上游不稳定；合成 SQL/调度吞吐不是生产上限 |
| 10-23 / `eb2a80e` | 3次 Arctic Shift 请求各5条；首次解析支持13位评论 ID，`refreshIds()` 离线拒绝同一 ID、网络0次 | 已确认本地刷新缺陷，非归档完全停摆或网络403解释 |
| 10-23 | 匿名列表 JSON/搜索 HTML 各一次均403；OpenCLI 3个基础及3个独立离线边界场景 | 未有真实登录搜索；capped/部分补全状态不能丢失 |
| E1 / `c805ca1` 系列 | Bluesky 两页筛出6条作者内容，重放新增0，PG/API/UI/导出通过 | 现在已在 main，非 Reddit 备用、持续新鲜度或全历史验收 |
| 10-28 | Chromium/OpenCLI/noVNC/Bridge 连通，但 Reddit 登录被阻断；随后按要求停服务 | 安装/连通不等于取数成功 |
| 11-10 | 四项旧浏览器服务 inactive；新临时匿名 HTML 两次403、0帖子、结束退出 | 未验收 Reddrix/Camoufox/Scrapling，也没有恢复常驻服务 |

历史报告位于各研究机器的 `output/research/reddit-access-20261023/`、`reddit-direct-20261023/`、`aggregation-projects-20261023/`、`reddit-audit-20261023/`、`paid-review-20261110/`；本轮源码副本在 `output/research/product-rebuild/`。这些是本地证据位置，不是仓库自带数据集。

### JSONL 独立复核与 ego-lite 的位置

历史复核发现 OpenCLI 达 limit 会丢 capped、补全部分失败只输出剩余数组、by_id 403不返回已发现 ID。公共 worker 拒绝 `exhausted=false && nextCheckpoint=null`，所以直接包装 CLI 数组仍缺恢复契约，不能伪造 exhausted 推进高水位。Agent Reach 的 Reddit 后端当时仍调用 OpenCLI，不是独立数据源。

ego-lite 按既有决定排除；Linux 支持/原生绑定限制属于历史研究，不再安排安装或适配。官方 API/Devvit 申请、全站 dumps 前置和重启旧云端浏览器均不进入当前计划。

## 7. 其余候选

Bluesky 保留已有账号 adapter；PullPush 当时明确拒绝本环境免费 agent 请求，保持暂停。RSSHub、HN、GitHub、V2EX、Forem、YouTube、Steam、联邦平台等留作后续线索，不同时实施；Instagram/web 类型声明不证明存在真实 adapter。BettaFish 的报告/多 Agent、搜索引擎线索都不替代原平台采集。

新来源的最小准入是明确 platform/provider/target、稳定身份、时间与指标能力、费用/权限，然后沿 connector→落库→查询→UI 闭环。动态脚本、通用抓取 DSL、独立 Provider Lab 不是接入前提。
