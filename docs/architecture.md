# 项目架构与工程边界

当前实现与目标设计分别标注。本文定义模块职责、依赖和数据规则；实施顺序见 [全项目工程路线](plans/source-expansion.md)，命令及交付流程见 [开发说明](development.md)。

## 当前代码结构

当前是 TypeScript 模块化单体，前端为独立 React / Vite 应用。

| 路径 | 职责 |
| --- | --- |
| `apps/api/src/` | HTTP、认证、请求解析与响应 |
| `apps/web/src/` | 工作台、图表、查询、管理页面 |
| `packages/contracts/src/http.ts`、`source-content.ts` | 共同 HTTP 入口与多平台来源/内容/观测契约 |
| `src/application/` | 用例编排、读取模型、应用服务 |
| `src/domain/` | 实体、仓储接口、评分与业务语义；公共检索纯规则、来源失败类别 |
| `src/connectors/` | 来源请求、响应适配与原始记录 |
| `src/runtime/` | 环境解析、依赖组装与 provider 路由 |
| `src/storage/` | PostgreSQL 仓储与 SQL 迁移 |
| `src/workers/`、`workers/` | 采集任务、调度与派生数据构建 |
| `scripts/`、`tests/` | 运维、导出、验证与自动测试 |
| `deploy/` | 环境、Nginx、systemd 模板，部署前需核对 |

## 目标设计及实施状态

当前已实现 Arctic Shift 的公共契约、来源配置/生命周期、任务、逐页事务、周期调度、成熟归档 ID 刷新、查询统计与 UI。X 的 TwitterAPI.io 账号/搜索/ID adapter 已实现，默认禁用并保留真实验收；Instagram/web 仍为字段设计和合成存储验证。保持模块化单体、一个 PostgreSQL 和一个 API；`workers/source-content-worker.ts` 统一消费公共来源任务，现有旧 scheduler 暂保留，不按每个平台增加服务。

当前流程：目标/来源设置 → 手动或持久化周期窗口入队 → provider 预算预留 → 有界取一页 → 公共内容和独立观测 → 小事务落库/checkpoint → 同范围唯一内容/UTC 日统计/按平台渠道汇总 → API → UI/JSON/CSV 导出。同来源不同 purpose 可并存排队、每来源一个 running，持久化四次领取中为 manual/refresh 保留一次优先机会；暂停/归档取消旧租约；重启回收租约并从已提交页继续。周期高水位只在耗尽窗口后推进，失败或页预算不足保留同窗口子任务；每页间让出 worker，不持有整段历史回填。免费/付费每日月度预算分开，重试/未知结果保守保留 requests/resources 预留；provider 计数因多发现可重叠。

自动成熟刷新只支持 archive provider 的 initial 观测，snapshot 不套用 36 小时成熟规则。统一工作台的跨平台通用量是内容数，不把 Reddit score 与 X likes 相加；各指标使用 capability 的单位/符号与观测时间。内容读取/导出不会向provider联网；即时list/stats/export分页与统计不是冻结快照，研究导出另用同RR冻结。内容详情由独立 `content-detail.service.ts` 按规范身份批量查已存引用、按关联 ID 查来源配置；Map 恢复引用顺序与重复关系，缺失保留 null，引用/children 各限20。PostgreSQL 成对匹配 kind/externalId 并复用既有身份唯一索引，避免逐引用往返和全量来源配置读取；作者按externalId/handle忽略大小写准确匹配，语言准确匹配，source group区分大小写。指标筛选取当前scope每来源最新观测，任一符合即可，null不按0；时间排序以身份打破平局，cursor绑定全部筛选。036个人保存查询/收藏注释表user FK、内容annotation FK与revision；仅用户session可读写自己的记录，机器不拥有个人空间，HTTP与落库沿同契约。API 不等待远端抓取完成；旧热度模型尚未迁移至 Arctic Shift，旧增长 v2 使用实际相邻观测，不将单个归档快照写成实时热度。

## 长期模块边界与数据对齐

以下是后续开发约束；当前已实现范围见上一节。保持模块化单体与 PostgreSQL，模块间优先直接调用明确的 TypeScript 接口。新增 provider 通常只增加请求/分页/映射和注册；新增监测项目通常增加配置、领域分析与读模型，复用现有采集任务、预算和存储能力。

数据流为 **来源 → 规范内容/观测 → 页事务 → 整理读模型 → API/模块**；它不是源码 import 方向。

目标依赖方向：HTTP/worker 入口调用应用用例；应用用例依赖领域规则和所需端口；provider/SQL 实现这些端口；runtime 注入实现。纯规则不依赖 HTTP、数据库或 runtime；公共 ID 校验放 domain，不为复用校验导入采集服务。DTO 放公共契约，领域错误不携带 HTTP 状态，HTTP 层负责映射（E0 首批已对 `SourceContentError` 实施，账户与研究等其他错误仍待按需整理）；平台映射和数据库映射各在自己的边界做一次。这里不要求每个函数增加接口或类，只有外部替换点和模块公共能力需要明确接口。

### 目标模块与数据所有权（待渐进实施）

模块是代码与数据职责，不是独立部署单元。先在现有目录按业务划分公共入口，不立即拆 npm 包或搬迁整个仓库。

| 模块 | 对外能力 | 拥有的写入规则与数据 |
| --- | --- | --- |
| 账户与访问 | actor、权限决策、会话和审计入口 | 用户、会话、角色、操作审计；其他模块传 actor，不另写认证 |
| 来源与采集 | 来源配置、预算、排队、执行一页、取消/恢复 | collection_source、job、provider usage、checkpoint；adapter 只产出规范页 |
| 内容与观测 | 页数据写入规则、按身份读取、查询与详情 | content、discovery、observation、公共检索投影；拥有版本顺序和去重规则 |
| 研究与个人工作区 | 保存、注释、固定成员导出 | 个人查询/注释、research export；读取内容模块，不修改规范正文 |
| 监测项目（新增时） | 目标集合、运行计划、项目视图 | project 与 source/目标关联；同一采集流可被多个项目复用 |
| 分析/变化检测（按需求增加） | 从规范数据计算结果、重建派生数据 | 自己的日期桶、检测结果、规则/算法版本；不把派生结果回写成原始观测 |
| 运维与组合根 | 启停、配置、连接池、健康、迁移、备份与发布 | 运行资源与装配；不成为任意业务逻辑的归宿 |

每张表有一个写入规则归属模块；跨模块读取通过明确查询接口或命名读模型完成。需要联表时仍可在 PostgreSQL 执行一条 SQL，读模型集中维护，不为了模块化改成逐条 API 调用。采集页的内容、观测、检索投影与 checkpoint 必须继续共享同一个事务：由一个页提交入口协调，内部调用所属模块的写入函数，不拆成异步双写。

项目共享来源只适用于相同目标、窗口策略和数据可见范围；采集预算在来源/provider 上计一次，项目显示归属和共享情况。现在的 source group 是标签，不直接改解释为项目或租户。出现真正多租户需求时再设计隔离与共享政策，不把个人 Saved 权限扩大为全库租户隔离。

### 工程目录与扩展方式

沿用 `apps/api`、`apps/web`、`src`、`workers`、`packages/contracts` 和集中迁移目录。后续将应用用例、领域规则按业务子目录归类，既有入口逐个迁移；只有独立使用/版本发布需求才提取 package。`shared` 只放已被多个模块使用的稳定基础函数，不收纳业务对象。

- **新增 provider：** adapter + 字段映射 + 静态注册 + 代表夹具，复用来源任务与页提交；第三方响应不进入模块公共接口。
- **新增监测项目：** 项目配置/来源关联 + 需要的领域结果和查询入口；内容类数据复用内容模块，独立时序测量使用自己的表。
- **新增分析或通知：** 先用应用服务直接调用纯计算；耗时工作才提交持久任务。通知确有交付需求时，结果与待投递记录同事务写入，单独消费者投递；不提前建全局事件总线。
- **新增页面：** `features/<业务>` 持有查询状态、请求和组件，page 只组合；公共 `api/client` 处理传输和认证，领域过滤仍由共享契约定义。保留现有 React/Vite、URL 查询状态和账户切换缓存边界。

### 运行拓扑与容量演进

基础拓扑仍为 Nginx/Web 静态资源、一个 API、一个后台 worker 和 PostgreSQL。HTTP 查询读取已存数据，采集/计算在后台执行。API 和 worker 可分别重启/扩容，但共享同一版本契约、迁移和发布产物，不按数据商或项目新增进程。

先用现有租约/预算/公平调度保证任务进度。确有积压且 PostgreSQL/上游有余量后再增加 worker 并发，验证总连接数、来源互斥和预算竞争；耗 CPU 的新模块若阻塞 API/采集，则将该任务类型放到独立进程，共享代码而非复制业务服务。退出时停止领取、结束或取消当前有界工作、释放资源，未提交页由已有租约机制恢复。

性能预算在功能交付时用代表负载确定：交互读 P95、每页处理耗时/吞吐、最老可运行任务等待时间、API/worker 峰值内存、数据库增长；同时记录样本规模/并发/冷热缓存。低延迟与持续低成本一起评估，不用单次暖缓存结果承诺容量。

### 从来源到数据库的一份契约

接入时在 adapter 旁维护简短字段映射，沿用共享契约与迁移，不另建一套通用 schema 框架。

| 对齐项 | 规范化与数据库落点 | 整理和下游约定 |
| --- | --- | --- |
| 身份 | platform + kind + 字符串 externalId → content 唯一身份 | 同内容跨 provider 去重；跨平台不按相似标题自动合并 |
| 来源与目标 | collection_source → content_discovery | 项目/主题通过关联复用内容，不按项目复制内容表；需要项目实体时再新增迁移 |
| 正文与结构 | title/text/author/media/references → content 及受控扩展字段 | 缺失与空值分开；保留原正文，检索规范化进入现有投影 |
| 时间 | published_at、source_observed_at、fetched_at 分开 | UTC 统计，业务日桶按发布时间；未知值不伪造，更新沿用版本顺序 |
| 指标与证据 | 带单位/来源的 metrics → content_observation | 缺失不补零，观测幂等；仅在同口径内比较和计算变化 |
| 分页与完成度 | provider checkpoint + job 状态 | 当前页内容/发现/观测/投影/checkpoint 同事务提交；partial 传递到 API |
| 派生数据 | 现有检索投影和按需增加的分析读模型 | 可从规范数据重建；增加统计桶时标明算法版本、时间范围和分母 |

清洗在入口完成必要的类型、身份、时间和字段映射；检索规范化复用已有实现。下游模块共用这些结果，避免各自清洗、重复存储和定义不同统计口径。新增非内容类监测（例如独立时序测量）时，在同一数据库增加该领域自己的表与小接口，复用确实相同的基础能力，不强塞进 content 或任意 JSON 大表。

### 性能与代码量取舍

- 延续按页批量写入、小事务、增量 checkpoint 和无变化不更新；避免逐条数据库往返、重复全量扫描及内存累积全历史。
- 读取按真实筛选/排序建立必要索引，优先数据库聚合和稳定游标；缓存、预聚合或并发增加由瓶颈测量触发。
- 新来源核对每页耗时、写入吞吐与进程峰值内存；新读模型核对查询计划和代表负载延迟。使用一次可比较基线决定优化，不预设所有模块的性能指标相同。
- 只抽取已出现的重复行为，保留供应商特殊分页在 adapter 内。暂不引入微服务、插件 DSL、通用工作流引擎或新消息系统；未来由实际规模和模块需求决定。

## 平台、获取渠道和订阅目标

| 概念 | 含义与示例 | 必须保持的边界 |
| --- | --- | --- |
| 平台 `platform` | 内容原属系统，如 Reddit、X、某个新闻站 | 内容身份和指标语义的命名空间 |
| 获取渠道 `provider` | Arctic Shift、官方 API、RSS、RSSHub、聚合 API | 请求、授权、限流、分页与来源证据 |
| 来源实例 `collection source` | 一个 provider、目标及内容类型的持久化 stream | 已保存目标/标签/分组/周期/成熟刷新与 active/paused/archived；凭证来自私有环境，不写入目标或公开响应 |
| 目标 `target` | 社区、账号、feed、受支持的查询范围 | 用户监测对象；同一内容可匹配多个目标 |

Arctic Shift 是 Reddit 的 provider；RSS 是传输方式，不能自动当作文章原属平台。聚合项目须保留原始发布者与中间渠道，不从域名猜出不存在的原平台 ID。新路径的 `ContentPlatform` 与实际 `source.code` JOIN 相配合，不使用旧 `SOURCE_IDS.reddit` mapper；旧 `SourceCode`/Reddit 分析仓储仍保留其范围。第二来源须实现 adapter、注册能力、用新迁移注册平台并联通仓储/API/UI，不能只改枚举宣称支持。

首版订阅由系统写入目标与来源配置：Reddit 社区/主题、X 账号/查询表达式；只启用 provider 实际支持的目标类型。API 校验后保存目标并提交有限任务，worker 读取持久化配置，不能让前端直连数据商，也不能把用户输入直接当任意 URL。用现有认证限制配置修改和查询范围，不先搭一套复杂订阅规则 DSL。

用户接受最多 12 小时延迟。当前支持手动有限窗口和持久化周期调度，窗口耗尽后推进高水位，重叠区去重与有界 catch-up 保留恢复状态。4A 调度先判断 eligible，再限候选批次；近期和后台任务有持久化公平机会，默认近期 12 小时/每 6 小时迟到回查（0 可关闭），与增量高水位分开，不能保证窗口外覆盖。provider 请求最小间隔与配额在同一预算锁中预留。调度间隔、上游入库延迟、排队和恢复共同决定新鲜度；UI 展示最近成功、内容/观测时间年龄与 partial/unknown，最新帖子年龄不能证明覆盖或源延迟。12 小时目标与连续可用性尚未通过持续真实验收；当前没有自动多商切换，其依赖和设计见 [开发路线](plans/source-expansion.md)。

Arctic Shift 文档说明新内容初始指标可能为 1/0，约 36 小时后更新；这些不能直接用于近期真实热度。保留归档成熟状态与指标来源证据，不把所有真实零值一律丢弃；可对需要分析的内容安排一次有界成熟后刷新，观察时间未知时明确 unknown，旧证据不能覆盖新观测。X 来源按实际取回语义保存独立观测。

付费 provider 的额度在来源调度/取页边界统一控制：每目标页数、日/月请求或资源预算、重复取回与空页费用都计入；临界时停止该来源并保留已落库读取。费用预估不是账单，运营侧还需要数据商控制台限额；不通过生产查询或每次网页刷新触发收费请求。

已实现的 [ContentProvider](../src/connectors/shared/content-provider.interface.ts) 声明 `capability`，以 `normalizeTarget(target, kind)` 适配目标，以 `collectPage({source, from, to, limit, checkpoint, signal})` 返回 `CollectedPage`：内容/观测、provider 自己解释的 checkpoint、覆盖、耗尽及 warning。服务按 platform/provider 注册 adapter，仅启用实际能力；provider 标识使用小写字母、数字和下划线。未来 feed/search 留给对应 adapter 校验，公共层不透传任意 URL 或秘密，不把 Reddit about/hot/fullname cursor 强加给其他来源。

Arctic Shift 重叠分页按边界已见 ID 数增加请求大小，最多 100 条，每次保守预留 100 个资源；小 pageSize 不再被重叠记录占满。同秒达到上游上限仍不能前进时，任务失败并保留原窗口/checkpoint，需人工处理后 Retry，不跳秒或记作耗尽。其他 provider 未耗尽却无 next checkpoint 时有限重试，保留上一页。

能力不足返回明确的 unsupported 或 partial；网络失败与有效空结果区分。默认不切到另一个语义不同的来源补零。0.9.1 将任务失败记录为 transient/permanent；明确的数据库死锁、序列化冲突和临时连接错误按原有三次页尝试上限延后，不阻塞来源；非 retryable 错误使当前任务失败并阻塞该来源的自动调度、领取和新增/续采。配置修正后显式 Retry 原子解除来源阻塞并保留原检查点，resume 或配置保存不会解除；后台进度不提升配置revision。临时错误与429同一任务页/刷新轮次最多三次保守请求启动尝试，预算/间隔拒绝不增加或重置，崩溃后的租约恢复仍检查持久上限。首次刷新请求前在source→job事务中记录轮次和冷却，进程若在记账后请求前崩溃也保守占用；成功提交不重复计数，不能把计数当账单。自动轮次耗尽后停止；手动 Retry 明确授权额外一轮，仍受provider预算/间隔限制。取消后的旧租约不能登记新尝试或提交页；已发上游请求不能保证撤回。

## 统一存储：共享身份，独立证据

现有 `source` 继续承载平台注册。[029 迁移](../src/storage/schema/029_source_content_collection.sql) 复用 `content`，增加关联/观测/任务，没有复制整套内容表。当前源码共 41 个 SQL 迁移；039 增加失败策略，对缺少失败类别的历史 failed 保守归为 permanent，并阻塞最新任务仍失败的来源，修正后需显式 Retry。只新增迁移，不修改已应用 SQL。各环境应用与部署结果见 [状态](status.md)，历史阶段结果见 [交接](history/handoff.md)。

| 逻辑对象 | 最小信息与去重 | 存储原则 |
| --- | --- | --- |
| `collection_source`（已实现） | platform、provider、target、kind、标签、采集/覆盖状态 | 同一平台/provider/kind/target 唯一；凭证通过私有环境提供，不进 target JSON |
| `content`（已扩展） | platform、kind、字符串 ID、链接、可空标题/正文/作者/发布时间、媒体/引用/平台字段 | SQL `(source_id, kind, external_id)` 唯一，source_id 是平台；旧 target_id 保留；无 ID 的 feed 后续由 adapter 定义稳定身份 |
| `content_discovery`（已实现） | content、来源实例、首次/最近发现时间 | 正文共享，来源实例持有目标，多来源匹配不丢失 |
| `content_observation`（已实现） | provider/来源实例、指标、源观测/取回时间、evidence_key | 同内容/来源/证据幂等；同来源 latest 优先真实源观测时间，已知时间优先于 unknown；不跨 provider 覆盖 |
| `source_collection_job`（已实现） | 来源、窗口、checkpoint、页/数量预算、状态、租约、错误 | 每来源每 purpose 最多一个活动任务、每来源一个 running；页数据/checkpoint 同一事务提交 |
| analysis bucket（后续） | 时间桶、算法版本/范围、输出与覆盖 | 当前内容统计按同范围 SQL 聚合，复杂增量桶尚未迁移 |

时间至少区分 `published_at`（内容发生）、`source_observed_at`（指标观测/归档）、`fetched_at`（本平台取回），不能相互替代。正文版本只使用源观测时间：已知源时间优先，未知时间不覆盖已知版本；双方均未知时才按取回时间更新。搜索投影 fingerprint 和格式未变化时不执行冲突更新。观测时间未知则明确 unknown；重复获取同一归档快照不增加新的互动证据。可查询、排序和去重的核心字段用列与约束，来源扩展属性和少量指标用受控 JSONB；不用一张任意 JSON 大表，也不将每个可选指标拆成大量 EAV 行。

每个平台的能力定义指标 key/名称、count/ratio/rank 单位、是否累计、是否有符号、适用 kind 和 higher/lower/neutral 方向。指标用 `reddit.score` 等命名空间，真实 0 保留，缺失用 null；Reddit score、X likes 和榜单 rank 不直接合并。当前 Arctic Shift 保存三类实际指标及归档成熟状态，仅按来源取最新观测，小时/日互动窗口尚未实现。`post_engagement_*`、`metrics_snapshot` 和 `subreddit_*` 保持旧范围，不双写归档指标到增长事实。

写入按页批量完成。网络请求在事务外；身份 upsert、发现关联、当前页证据与 checkpoint 在事务内。重放可重复发生，业务依赖唯一约束幂等，目标是至少一次获取下的无重复内容，不承诺跨服务 exactly-once。不能在整个历史回填期间持有一个事务。源码中的既有 SQL 文件按完整文件名和校验和管理，增量变化只加新迁移。

### 不同平台字段契约

[source-content.ts](../packages/contracts/src/source-content.ts) 是新路径的唯一字段定义，通过 `http.ts` 导出。外部 ID 全部使用 string，避免大整数精度丢失；kind 支持 post/comment/article/image/video，与平台分开。title/text/url/language/author/publishedAt 可为 null，评论无需伪造标题，未公开指标不填 0。author 的 ID/handle/displayName/url 各自可空。`references` 表达 reply_to/thread_root/quote/repost；media 支持 image/video/audio/link、预览、alt 和时长。

| 平台 | 专属 `platformDetails` 字段 | 保留的差异 |
| --- | --- | --- |
| Reddit | community、flair、nsfw | 帖子/评论身份和父关系不同，score 可负，Arctic Shift 指标为归档观测 |
| X（可配置 adapter 已实现，真实验收待授权） | conversationId、isReply/isRepost/isQuote、sensitive | 大整数 ID、无标题正文、引用/转发；likes/replies/reposts/quotes/views/bookmarks 可空，缺指标不补零 |
| Instagram（设计） | mediaProduct、caption、carouselIds | feed/story/reel 与轮播不同；播放/触达可能不可得，不能与点赞等价 |
| web（设计） | publisher、canonicalUrl、feedUrl | 可能缺作者/发布时间，rank 有方向，RSS 不保证历史互动 |

`platformDetails` 为判别联合，额外字段仅由 adapter 白名单映射到 namespaced `extensions`，不保存任意上游 payload。`availability` 区分 available/removed/deleted/unknown。观测单独携带 provider/sourceId、sourceObservedAt/fetchedAt、timeBasis、maturity、metrics、evidenceKey，源时间未知不以本地抓取时间伪造历史指标时间。

当前 Arctic Shift adapter 提取外链媒体、作者、父/根/转帖引用与上述 Reddit 字段；TwitterAPI.io adapter 已映射 X 媒体/引用/线程与受控指标，离线契约及合成 SQL 验证通过。5A 已实现公共详情与主动 image/video/audio/link 预览、媒体缺失和加载失败说明；真实 provider 媒体覆盖仍未验收。Instagram/web 的真实 adapter 尚未实现；X 没有凭证或真实接入验收，字段及合成样本不能证明真实覆盖或数据质量。

## API 与前端契约

沿用 `packages/contracts/src/http.ts` 作为共同入口，前后端不维护另一份内容模型。已实现来源列表/创建/设置/生命周期/有限采集、任务筛选/cancel/retry/continue、provider 预算与 sourceOps；内容列表/stats/workbench/即时CSV/JSON、详情、个人查询/注释与冻结研究export，准确方法及路径见 [开发说明](development.md)。`source-content-routes.ts` 处理来源/任务/预算并分派到独立的 `content-read-routes.ts` 内容读取路由，method/path/write 权限就近声明；composition root 统一认证，读取要求 session/bearer，来源/运维写入限admin/owner/machine；个人保存/注释与研究export只允许拥有资源的session，viewer可管理自己的记录，机器无个人空间。

- 读取仅查已落库数据，支持 platform/provider/sourceId/kind、标题/正文关键词、发布时间 `[from,to)`、limit/cursor。5B公共索引覆盖完整已存title/text；NFKC+Unicode lowercase+空白归一，literal/phrase连续匹配、terms空白term全AND字面子串，exclusions对指定title/text/title_text排除；中文/%不当SQL通配符，不stemming或兼容旧OR词界语义。候选覆盖基于非文本筛选scope，正文present仅指索引已知的存储字符串（包括已知空串）；未索引和null分开计数。排序为 `(COALESCE(publishedAt,firstFetchedAt),id)`，cursor 绑定过滤条件；采集 checkpoint 与产品分页分开。
- 抓取/回填/重算通过管理员写端点提交有限任务，返回 202 与 job ID，读取任务状态查看进度。网页刷新不会自动启动全平台抓取。
- 列表返回观测、时间和实际指标，coverage 为 stored_sample；任务/来源只标 partial 或 unknown，不声称全量。统计与列表用相同过滤，总数覆盖匹配的全部已落库样本；UTC 日桶排除未知发布时间并返回 unknownPublishedAtCount。复杂 series 后续再定义版本/单位与范围。
- UI 根据来源能力提供筛选和图表，保留来源筛选和原链接。不能因为服务健康检查成功就展示“实时数据正常”。权限继续在 API 边界验证，业务函数不重复实现另一套登录与角色判断。
- E0 第二批已从 `create-api-server.ts` 拆出 `saved-workbench-view-routes.ts`，保存视图的个人会话约束、校验和响应映射归该模块，共用比较指标解析放 `api-validation.ts`。Origin、body 限额和审计仍在组合根。组合根当前约 3,600 行；后续新增公共功能时按 auth、collection、content/analysis、ops 分离路由处理函数，保留一个 composition root。每次只迁移要改的模块，不整库换框架。路由的 method/path/权限与 handler 就近声明，共用一次授权入口，避免新增端点忘记加入独立权限路径清单。

账户采用凭证版本 fencing，改密原子写新 hash/提升版本并撤销会话；机器身份禁止个人账户操作。owner/admin/viewer 政策覆盖角色、状态和邀请，最后 active owner 有事务锁保护。业务审计先保存 attempted，变更后保存脱敏结果；intent 失败拒绝变更，结果持久化失败返回 `audit_result_unknown`，不声称业务与审计原子，UI 先刷新确认。匿名登录/注册走安全日志和独立 IP 限流，不伪造审计 actor。配置 revision 仅配置变更提升，bulk 锁定全部目标验证后再写，来源页提交与暂停采用一致 source→job 锁序。

037研究冻结在同一个REPEATABLE READ事务先固定分母/数据库必要载荷与来源字节预算，再按同filter有界读取规范内容、所选成员关联来源、每来源最新已知观测和真实索引覆盖，保存manifest及ordinal成员后原子提交。最多20,000条/32MiB，任何超额/中途插入失败全rollback。成员无live content FK，live删除不破坏冻结；user/export ownership、cursor和显式delete级联，未做自动保留。manifest版本、单位、未知/null/字符串大ID与CSV公式防护明确；预算包含可能被sanitize去除的未知JSON，避免先撑爆Node。

038投影content FK CASCADE；canonical RETURNING after monotonic guard的实际title/body在同页事务写入，重放不让旧body降级。其它SQL改字段的trigger删除旧document使其失效；历史回填按缺失投影选择、行锁限批并写入fingerprint/format，未扫描已有投影校验fingerprint，查询无自动回填。覆盖partial时文本检索拒绝503，普通列表仍报告缺口；存储样本覆盖不能当平台覆盖。没有搜索集群或自动删除。

## 算法与跨来源聚合

先建立可靠的内容量、来源分布和覆盖时间序列，再决定复杂评分。统计分子和分母必须来自相同时间窗、来源和过滤范围，受搜索上限截断的样本不能当全量命中；现有 high/medium/low 质量标签只是启发式，不代表统计置信区间。公共算法只接收归一化观测与质量信息，不读取 provider 原始字段。平台内按同类型、同观测口径的 cohort 分析；跨平台展示保留平台原指标，若需要总排序再定义可解释的归一化分数与权重。

历史 v1 增长事实中的 `score / age` 是累计量除年龄，不是两个真实观测的差分，现不进入实测 driver/增长异常。当前旧增长 v2 使用相邻真实观测差分；公共归档/快照分析仍未迁移，单快照不能用于声称实时速度或加速度。缺少可比观测时只展示归档统计并标明限制；缺失的 subscribers/active users 不能转成零值送进旧 Reddit tier/quality 算法。历史回填不改变内容发生时间，也不让近期热榜因为“刚抓回来”而变热。

精确内容去重和“同一事件”的分组分开：先稳定 ID/链接去重，正文身份不因标题相似而合并删除；以后按需要建立事件与成员关系，聚合按独立原始发布者计数，中间 provider 重复转载不增加独立信源。来源信息未知时不能假装可辨独立发布者。标题近似匹配可作为候选，LLM/embedding 仅在需求与预算明确后增加，并缓存按内容指纹和模型版本生成的结果。

派生分析按受影响的目标和时间桶更新。带前序窗口的 EMA/基线按实际依赖范围补算，不能只重算一个桶而断开历史。保留算法版本、关键参数与覆盖证据即可，不默认给每条结果写庞大的逐步骤解释副本。

## 资源与数据生命周期

开发机与 Linux 部署的容量预算分开核算。新 worker 并发 1，每页最多 100、每任务最多 20 页；Arctic Shift 请求超时 20 秒、响应最多 8 MiB，页后释放响应，不积累完整历史。评论按目标、时间和数量有界获取，不保存所有媒体文件或全站历史。生产优先级调度与负载预算尚未验收。

连接池当前默认每进程 5，可用 `PG_POOL_MAX` 调整。API、现有两个 scheduler、人工开发与迁移进程各有池，总数必须留出 PostgreSQL 管理连接；增加进程时不能只考虑单池。RSSHub 等外部聚合优先视为 provider 使用已有授权/可用服务；若自建，先计入资源预算，默认不在本机启浏览器集群。

容量估算用实测“日新增唯一内容数 × 单条内容/索引字节 + 日观测数 × 保留天数 × 单条观测/索引字节”，另留 WAL、VACUUM、备份和发布空间。运维库存动态统计全部public表大小/行数；现capacityProjection仅估内容与观测，明确排除现有公共投影/discovery/冻结成员/个人和其它表。新任务/观测尚无已批准的自动保留策略。删行不保证立刻释放文件空间，常规维护采用 autovacuum，不用频繁 VACUUM FULL 或清 Linux page cache 作性能手段。

| 数据类别 | 初始策略与当前边界 |
| --- | --- |
| 原始大 payload | 默认只保留错误/必要样本；旧代码 raw 保留 7 天，迁移后需敏感字段过滤 |
| 内容及当前观测 | 保留选定目标与产品窗口；保留天数由历史查询需求确定，不能未经确认删正文 |
| 窗口观测/指标 | 旧 engagement window 7 天、target metrics 30 天；迁移前核对算法所需窗口，超期聚合后再删 |
| 请求摘要、任务、查询会话、健康证据 | 当前未形成完整统一保留策略；需按引用与诊断窗口清理，不能因原始 payload 清理就认为整个库有上限 |
| 派生日统计 | 小体积可保留更久，按版本只保留产品实际用到的结果 |

旧维护每张表每轮最多 10 批，未完留到下一轮；有界批数不等于全库自动容量管理。上线前用代表目标测每页延迟、每任务 RSS、数据库/索引增长和读接口延迟。API/worker/数据库合计约 1–1.5 GiB、系统余量至少约 0.8 GiB 是旧服务器测量预算，尚未负载证明，不能直接当作当前机器容量。

继续使用 PostgreSQL 的现有索引和队列表。旧关键词查询使用中文字面匹配、英文词边界/复数与排除词；仓储在同一范围计算完整计数，再提供有界样本，检索范围是旧目标已索引的标题/320 字符正文保留片段。旧 collector 维护投影、历史通过显式有界 CLI 回填，正常查询不重建索引；5B新Arctic/X页提交已按独立公共mode/scope在页事务中维护完整已存title/text投影、更新/删除/重放一致性；旧target索引仍保留320字符/旧词界语义，二者不混用。web 身份按显式 namespace+kind+原 GUID 通过 webContentIdentity 派生，URL 默认保留路径/查询语义；adapter 将原 ID/namespace/version 放白名单 extensions，不改旧合成 ID。旧 PostgreSQL upsert 保留已有公共规范字段；新旧路径不能相互绕过观测守卫。只有执行计划、实际吞吐或功能要求显示瓶颈后才评估新组件、分区或拆服务；不预设 Redis、消息中间件、搜索集群或向量库。最少监控关注内存/磁盘、数据库和 API 延迟、任务积压/失败及源延迟/覆盖，先复用现有日志和 ops 页面。

4C 运维以只读事务统计全部 public 表大小与精确行数，保留预览保护活动/可续 checkpoint、被引用父任务、每来源最新观测与 archive_initial、当前UTC月预算和未决 attempted 审计。没有删除执行器或自动保留政策。备份由 RR 导出 snapshot 同步 pg_dump 与库存/迁移checksum；仅恢复到新建指定前缀数据库，拒绝已有目标，校验SHA和库存后还需业务验收。发布采用允许清单、不可覆盖新目录、逐文件SHA256/精确库存；该机制不提供发布签名，实际部署范围见状态文档。生产保留时长和冷恢复/RPO/RTO还需明确。

## 失败场景与必要保证

| 情况 | 最小处理方式 |
| --- | --- |
| 上游限流/暂时不可达 | 有限重试或延后该来源；已保存结果仍能读取，显示 stale/partial |
| 返回空页或缺字段 | 区分完整空结果、部分/未知覆盖和解析失败；在 adapter 校验外部数据一次 |
| 进程中断 | 新任务以两分钟租约和 token 防止旧 worker 提交；超时 running 可重领，页/checkpoint 原子提交；正常取消重排未提交页 |
| 多任务重复获取 | 按来源/stream 的任务键去重，必要时单次租约；不能把进程内 inFlight 当作跨进程互斥 |
| 老归档与实时源冲突 | 保留独立观测和来源，按时间及明确选择策略读，禁止最后取回者无条件覆盖 |
| 磁盘/内存压力 | 降低或暂停回填/采集，保持已落库数据读取；清理受保留策略与 FK 引用约束 |
| schema/接口演进 | 小迁移 + 同步契约/read model/UI，保留过渡兼容，验收后删旧入口 |

保证集中在外部输入、权限、数据唯一性/事务与工作量边界，不给每一层重复加校验/重试。新来源任务已实现租约、每 purpose 活动约束/单来源运行互斥与逐页 checkpoint 事务；上游临时错误每页最多三次自动尝试，授权错误直接失败。Arctic Shift 时间分页重读边界秒并去重，时间戳拥挤无法推进时停止并标 partial，不能静默跳过或声称覆盖完整。旧 Reddit 队列及自动周期调度不因此获得同样保证。

## 成熟工程参考与本项目决策（2026-10-19）

以下查阅了指定提交的源码/工程文档；链接固定到提交，观察与本项目取舍分开。借鉴边界和演进方式，不移植完整技术栈。外部架构说明也可能包含历史拓扑，因此这里不依赖其部署图推断当前运行结构。

| 一手证据 | 实际观察 | 本项目采用的做法 |
| --- | --- | --- |
| [Miniflux worker pool](https://github.com/miniflux/v2/blob/71cfdb8b214cec94e5833fefce5ffcfd77b32813/internal/worker/pool.go) | 明确 worker 数，停止接收任务并等待当前 worker 结束 | 维持简单后台执行与清晰资源生命周期；继续使用本仓库已有 PostgreSQL 持久任务，不替换成它的进程内队列 |
| [changedetection.io processors](https://github.com/dgtlmoon/changedetection.io/blob/804876fdd189f7d2aa8152f165e1965c56b77d51/changedetectionio/processors/README.md) | 文本/JSON 比较、补货检测按领域处理器区分；处理器配置可扩展 API schema | 将获取与领域处理分离，未来不同监测项目可有不同处理逻辑；先静态注册与显式配置，不照搬动态 schema 合并 |
| [Immich architecture](https://github.com/immich-app/immich/blob/53618ff7496ee313d1cff7b3bcdf19c82b765cdf/docs/docs/developer/architecture.mdx) | 服务逻辑与技术实现仓储分离，客户端通过 API 契约协作，后台承担耗时任务 | 明确服务/端口/实现边界，统一客户端契约；沿用现有 Node/PostgreSQL，不为模仿引入 Nest、Redis 或 ML 服务 |
| [Immich API compatibility workflow](https://github.com/immich-app/immich/blob/53618ff7496ee313d1cff7b3bcdf19c82b765cdf/.github/workflows/check-openapi.yml) | 用 OpenAPI 差异检查破坏性接口变化 | 现阶段检查共享契约与调用方一起变更；有外部客户端后再考虑 OpenAPI 和生成客户端，届时从一个定义生成，避免双维护 |

本项目判断：长期可扩展性首先取决于数据所有权、依赖方向、可恢复任务和可发布版本。继续采用模块化单体，先消除当前耦合；新中间件、独立服务或通用插件只在具体瓶颈/部署需求出现时评估。工程迁移和旧链路退役条件见全项目路线。
