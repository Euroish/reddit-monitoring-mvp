# 来源选择与研究证据

核对：2026-11-15。结论基于本仓库与 GitHub 固定源码/许可；本轮未执行第三方采集、登录会话、付费请求或全档加工。源码存在证明可研究，不证明本服务器实时可用。

## 1. 决定

**在线原平台：保留 Reddit / X 的已有可用设计；聚合项目：选 NewsNow + RSSHub；历史：离线归档生产后导入同一产品。** 不把多个完整项目的账户、数据库和任务系统拼起来。

| 候选 | 固定提交 / 许可 | 结论与决定性证据 |
| --- | --- | --- |
| [NewsNow](https://github.com/newsnext/newsnow/tree/5da836c49c327f2c352216c5cbb4dea1abd9fcd3) | `5da836c4`，MIT | 选用少量 getter。TS 采集器易裁剪，适合榜单/资讯快照；不部署其前端/API/缓存库 |
| [RSSHub](https://github.com/DIYgod/RSSHub/tree/2340a032022c4382b2f5a165a2e3d3665ec06d89) | `2340a032`，AGPL-3.0 | 选用 HTTP feed 路由，为热榜之外补垂直订阅。主产品通用 RSS/Atom adapter；不复制其框架 |
| [DailyHotApi](https://github.com/imsyy/DailyHotApi/tree/36c77e3bd891c11642d314cfb229bf31646704de) | `36c77e3b`，MIT | 热榜后备。与 NewsNow 价值重叠；已读请求缓存仅以 URL 为 key，GET params/POST body 未入 key，不原样移植其缓存工具 |
| [TrendRadar](https://github.com/sansan0/TrendRadar/tree/8a316628215c53ad34b7200ecb0fba76de3ef6c7) | `8a316628`，GPL-3.0 | 参考关键词呈现/推送，不接作独立源。其主榜单 fetcher 请求 NewsNow `/api/s`，增加项目名不会增加上游独立性 |
| [AIHOT](https://github.com/KKKKhazix/AIHOT/tree/76e3b6ea52ac45ed3e2f30272514c83f1845b989) | `76e3b6ea`，MIT | 不作为首批第二聚合项目；偏精选/整理/模型流水线。已有 RSS 可作为普通 feed 后续按需读取，不引入整个系统 |

选择依据是互补内容、可控集成边界和源码能力，不是星数或“全网”营销。没有一个项目提供全网完整内容库。代码许可不等于上游内容再分发许可；移植 MIT 文件保留版权/许可，自托管/修改 RSSHub 按实际使用方式履行 AGPL 等义务，HTTP 隔离不自动消除义务。

## 2. NewsNow：裁剪 getter，不裁剪语义

已读：[榜单 API](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/api/s/index.ts)、[类型](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/shared/types.ts)、[HN getter](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/sources/hackernews.ts)、[IT之家 getter](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/sources/ithome.ts)、[AIHOT channel](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/sources/aihot.ts)。

- API 最多取 30 条，无历史 cursor；interval 内即便读缓存也可能 `status=success, updatedTime=now`。失败可返回旧 cache。公开 API 状态不能推定上游实际新鲜度。
- HN getter 先读 HTML，失败回退 hnrss；二者字段与时间来源不同。不得默默把回退当独立 source 或同口径完整快照。
- IT之家 getter 返回列表标题、URL、相对日期解析；不是文章全文。CSS/相对时间解析需要实际样本验证，不假设长期稳定。
- pubDate 可缺；extra.info 是展示字段，不是统一互动指标。索引顺序仅在明确榜单中作 rank。

**实现选择：** 把首批 2–3 个选定 getter 改写到 `newsnow` adapter，复用本项目 HTTP 限额/错误/观测机制；只移植必要代码和许可，不模拟 `defineSource/myFetch` 整套框架。每个移植文件记录原路径与 commit，后续按 getter 更新，不同步整仓。

首个结构验证可用 IT之家列表；其余榜单按实际项目对象选择。所有快照 coverage=partial；无发布时间仍可展示，时间轴遵循 DAT-08。公开演示实例只作人工样本比对，不作为生产依赖或 SLA。

## 3. RSSHub：受控路由 → 通用 feed adapter

已读：[cache middleware](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/lib/middleware/cache.ts)、[feed template](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/lib/middleware/template.tsx)、[HN 路由](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/lib/routes/hackernews/index.ts)、[GitHub trending](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/lib/routes/github/trending.tsx)、[package.json](https://github.com/DIYgod/RSSHub/blob/2340a032022c4382b2f5a165a2e3d3665ec06d89/package.json)。

- 支持 RSS/Atom/JSON 等出口；本项目先只维护 RSS/Atom 通用入口，不为每个路由写一套正文落库。
- cache middleware 保存 lastBuildDate，template 也可生成当前构建时间；feed-level updated/lastBuildDate 不等于每条内容的发布时间或平台指标观测。
- 路由能力不同：HN 无需 Puppeteer，GitHub trending 在此 commit 需要 GITHUB_ACCESS_TOKEN 和 GraphQL，不可因“开源免费”推定免凭证。评论展开路由不进入首批。
- 当前 package 的 Node engines 为 `^24.15.0 || ^26.13.0`；自托管必须单独锁定兼容版本/运行时，不假定本仓库任意 Node24 即兼容。

**实现选择：** 只读取管理员白名单的受控 endpoint；HTTP 缓存/条件请求、ID、日期、summary/full、HTML 清理全部沿统一契约。首个结构样本可用 `/hackernews/newest/sources`，只在不与已启 NewsNow getter 重复时计作新信息覆盖。生产路由按研究对象选取，不默认启全目录、浏览器、Redis 或额外全文补抓。

自托管可在单服务器运行一个受限 RSSHub 进程；是否有足够内存/路由依赖由实际部署测量。若无受控服务或能力不合格，保持“未接通”，先交付 NewsNow，不能退回公共演示站冒充稳定服务。

## 4. Reddit / X：复用能力，移除历史采购锁定

| 路径 | 本仓库事实 | 重建取舍 |
| --- | --- | --- |
| Reddit / Arctic Shift | 社区/账号/帖子评论、范围内关键词、已知 ID；历史真实有界落库 | 继续作为定向/历史补充。不是全站关键词入口；先修 13 位评论刷新 ID 本地校验 |
| Reddit / kaix Apify | 已有跨社区 search 等 adapter；无持久 cursor，始终 partial；未知收费启动不自动重发 | 保留能力/语义，不承诺完整持续覆盖；真实采样与授权后再决定是否主用 |
| X / TwitterAPI.io | 已有账号/搜索/ID adapter、可空指标/媒体/引用，未真实验收 | 最少变更的首条验证路径。旧“单价超限禁用”理由已废止，但凭证/使用授权/实际质量仍待验证 |
| X / twscrape、OpenCLI | 历史只有会话/源码研究，非本产品正式 provider | 现有路径不足才研究；不为重构同时维护会话池、远程浏览器和多家供应商 |
| Bluesky | 已有 AppView 账号 adapter、小样本落库 | 保留不扩展；不是 Reddit/X 替代。web/Instagram 类型不证明有正式 adapter |

原来固定采集费、赠额试跑顺序、官方申请路线排除和云端浏览器前置均不是当前产品约束。当前没有新增采购、自动开网络或恢复浏览器服务的授权。接入选择由可用数据/质量/权限和维护成本决定；不把仅改 base URL 当 provider 兼容。

首个真实来源验收要有：目标/时间窗、首/续页或无 cursor 声明、稳定身份、时间/指标缺失、重放计数、落库/API/导出证据，以及正常请求耗时/用量。持续可用性需连续运行记录，不用一次成功或轮询配置替代。

## 5. 归档分支：吸收契约，不合并第二个产品

只读核对分支：`codex/frontend-blueprint-20261108@723596e392fee93684af62cc21519384b9204d84`。四份讨论稿位于该提交 `docs/architecture/`：

| 原文件 | 保留的结论 | 不继承的要求 |
| --- | --- | --- |
| [分析能力与计算存储架构设计-v0.1](https://github.com/Euroish/reddit-monitoring-mvp/blob/723596e392fee93684af62cc21519384b9204d84/docs/architecture/分析能力与计算存储架构设计-v0.1.md) | 新原档单次顺序解压、列式中间层、稀疏关系、质量/规则版本、后补月份、汇总与证据分离 | 一次实现 38+30 项分析、固定主题树、GPU 路线、特定本机磁盘假设 |
| [在线平台技术栈与部署决策-v0.1](https://github.com/Euroish/reddit-monitoring-mvp/blob/723596e392fee93684af62cc21519384b9204d84/docs/architecture/在线平台技术栈与部署决策-v0.1.md) | 本地生产、在线独立；PG + 私有文件；单重任务；文件/DB 一起备份 | FastAPI/SQLAlchemy/Alembic、Caddy/Compose 第二套在线运行栈 |
| [服务端数据模型与查询方案-v0.1](https://github.com/Euroish/reddit-monitoring-mvp/blob/723596e392fee93684af62cc21519384b9204d84/docs/architecture/服务端数据模型与查询方案-v0.1.md) | batch/revision/release、类型化汇总、精选证据与完整保留范围区分、COPY/staging/原子发布 | 全量目录/视图注册平台、每个分析族预建表、另造 content_identity 平行身份库 |
| [完整实现范围与验收契约-v0.1](https://github.com/Euroish/reddit-monitoring-mvp/blob/723596e392fee93684af62cc21519384b9204d84/docs/architecture/完整实现范围与验收契约-v0.1.md) | 小夹具验证恢复与补月、真实首包闭环、资源测量 | “68项必须同一次交付”、旧机器依赖可用即当前环境可用 |

该分支记载 9 月 RS/RC 原档存在、约 74.36GB 压缩输入，未扫描；这是当时机器事实，本轮没有检查原档，也没有发现当前 main 的归档 importer。其 CLI/041 设想不是已交付功能。

首批只落实[包协议 IMP-01–07](../contracts.md#5-归档生产与包协议)及内容量/分布/有限可检索证据；新分析必须单独定义输入、分母、支持过滤与证据范围。API 消耗减少来自复用历史材料，不能宣称归档覆盖未下载时期、当前实时内容或不存在的全文证据。

### Arctic Shift 原档格式的一手核对

固定 [`11bbf2e6`](https://github.com/ArthurHeitmann/arctic_shift/tree/11bbf2e62db1dd1d699e1280724916a079815ec8) 的[内容说明](https://github.com/ArthurHeitmann/arctic_shift/blob/11bbf2e62db1dd1d699e1280724916a079815ec8/file_content_explanations.md)、[流读取示例](https://github.com/ArthurHeitmann/arctic_shift/blob/11bbf2e62db1dd1d699e1280724916a079815ec8/scripts/fileStreams.py)：2024-04 起仅 `.zst`；UTF-8、每对象为帖子/评论，retrieved_on 与部分字段二次取回时间分开。源对象可能是合并观测，不能误作单一时点完整快照。

只借鉴流式读取，不直接复制其示例的宽松异常吞掉行为；生产包必须可说明拒绝行与完成性。正常 `.zst` 的任意偏移恢复没有由此源码证明，按 IMP-02 设计。

## 6. 历史证据与停止线

- `3551900` 及历史日志保留 Arctic Shift、Bluesky、kaix 与浏览器研究原结论；本轮不重新认证旧价格或上游状态。
- 旧匿名 Reddit 403、云端登录失败只证明当时环境；不自动转成全平台永久不可用，也不以换爬虫库解释所有故障。
- 每个新入口先明确身份、观测时间、召回/分页、正文状态、使用权限，再沿 adapter→事务→查询→UI 打通；不先搭动态插件市场、Provider Lab 或万能爬虫 DSL。
- 本轮第三方固定源码/树与归档稿副本放忽略的 `output/research/`；不提交原始数据、凭证或第三方整仓。后续研究只有能改变一个真实决定时才继续扩展候选。
