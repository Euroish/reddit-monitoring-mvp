# 架构与数据边界

## 当前代码结构

当前是 TypeScript 模块化单体，前端为独立 React / Vite 应用。

| 路径 | 职责 |
| --- | --- |
| `apps/api/src/` | HTTP、认证、请求解析与响应 |
| `apps/web/src/` | 工作台、图表、查询、管理页面 |
| `packages/contracts/src/http.ts`、`source-content.ts` | 共同 HTTP 入口与多平台来源/内容/观测契约 |
| `src/application/` | 用例编排、读取模型、应用服务 |
| `src/domain/` | 实体、仓储接口、评分与业务语义 |
| `src/connectors/` | 来源请求、响应适配与原始记录 |
| `src/runtime/` | 环境解析、依赖组装与 provider 路由 |
| `src/storage/` | PostgreSQL 仓储与 SQL 迁移 |
| `src/workers/`、`workers/` | 采集任务、调度与派生数据构建 |
| `scripts/`、`tests/` | 运维、导出、验证与自动测试 |
| `deploy/` | 环境、Nginx、systemd 模板，部署前需核对 |

## 目标设计及实施状态

当前已实现 Arctic Shift 的公共契约、来源配置、任务、逐页事务、查询统计与 UI。X、Instagram 与 web 有字段设计及合成存储验证，真实 provider 尚未接入。当前可运行能力见 [状态](status.md)。保持模块化单体、一个 PostgreSQL 和一个 API；新增 `workers/source-content-worker.ts` 统一消费公共来源任务，现有旧 scheduler 暂保留。自动周期提交新窗口及复杂派生分析仍待实施，不按每个平台增加服务。

当前流程：目标/来源配置 → 入队 → provider 有界取一页 → 公共内容和观测 → 小事务落库/checkpoint → 同范围内容/UTC 日统计 → API → UI。API 不等待远端抓取完成；旧热度/增长算法尚未迁移至 Arctic Shift，不将归档快照写成实时热度。每个阶段只向下一阶段传需要的字段。

## 平台、获取渠道和订阅目标

| 概念 | 含义与示例 | 必须保持的边界 |
| --- | --- | --- |
| 平台 `platform` | 内容原属系统，如 Reddit、X、某个新闻站 | 内容身份和指标语义的命名空间 |
| 获取渠道 `provider` | Arctic Shift、官方 API、RSS、RSSHub、聚合 API | 请求、授权、限流、分页与来源证据 |
| 来源实例 `collection source` | 一个 provider、目标及内容类型的持久化 stream | 当前保存目标/标签/最近成功与覆盖；凭证、周期启停待相应 provider 实施 |
| 目标 `target` | 社区、账号、feed、受支持的查询范围 | 用户监测对象；同一内容可匹配多个目标 |

Arctic Shift 是 Reddit 的 provider；RSS 是传输方式，不能自动当作文章原属平台。聚合项目须保留原始发布者与中间渠道，不从域名猜出不存在的原平台 ID。新路径的 `ContentPlatform` 与实际 `source.code` JOIN 相配合，不使用旧 `SOURCE_IDS.reddit` mapper；旧 `SourceCode`/Reddit 分析仓储仍保留其范围。第二来源须实现 adapter、注册能力、用新迁移注册平台并联通仓储/API/UI，不能只改枚举宣称支持。

首版订阅由系统写入目标与来源配置：Reddit 社区/主题、X 账号/查询表达式；只启用 provider 实际支持的目标类型。API 校验后保存目标并提交有限任务，worker 读取持久化配置，不能让前端直连数据商，也不能把用户输入直接当任意 URL。用现有认证限制配置修改和查询范围，不先搭一套复杂订阅规则 DSL。

用户接受最多 12 小时延迟。当前手动提交有限时间窗口，worker 消费队列，按小时自动创建任务尚未实现。调度间隔、上游入库延迟、排队和恢复共同决定新鲜度。UI 展示最近成功采集、源观测/内容时间、超过 12 小时未成功采集的提示及 partial/unknown；最新帖子年龄不能证明覆盖或来源延迟。后续周期调度需先验收代表目标，不增加复杂自动多商切换。

Arctic Shift 文档说明新内容初始指标可能为 1/0，约 36 小时后更新；这些不能直接用于近期真实热度。保留归档成熟状态与指标来源证据，不把所有真实零值一律丢弃；可对需要分析的内容安排一次有界成熟后刷新，观察时间未知时明确 unknown，旧证据不能覆盖新观测。X 来源按实际取回语义保存独立观测。

付费 provider 的额度在来源调度/取页边界统一控制：每目标页数、日/月请求或资源预算、重复取回与空页费用都计入；临界时停止该来源并保留已落库读取。费用预估不是账单，运营侧还需要数据商控制台限额；不通过生产查询或每次网页刷新触发收费请求。

已实现的 [ContentProvider](../src/connectors/shared/content-provider.interface.ts) 声明 `capability`，以 `normalizeTarget(target, kind)` 适配目标，以 `collectPage({source, from, to, limit, checkpoint, signal})` 返回 `CollectedPage`：内容/观测、provider 自己解释的 checkpoint、覆盖、耗尽及 warning。服务按 platform/provider 注册 adapter，仅启用实际能力；provider 标识使用小写字母、数字和下划线。未来 feed/search 留给对应 adapter 校验，公共层不透传任意 URL 或秘密，不把 Reddit about/hot/fullname cursor 强加给其他来源。

能力不足返回明确的 unsupported 或 partial；网络失败与有效空结果区分。默认不切到另一个语义不同的来源补零。重试由明确的一层负责，短暂传输问题有限重试，429 延后任务，401/403 配置或授权错误直接记录并停止该来源，避免 connector、任务、API 三层重复重试。

## 统一存储：共享身份，独立证据

现有 `source` 继续承载平台注册。[029 迁移](../src/storage/schema/029_source_content_collection.sql) 已在隔离 PostgreSQL 验证；它复用 `content`，增加必要关联/观测/任务，没有复制整套内容表。业务数据库与部署环境尚未执行本轮迁移。

| 逻辑对象 | 最小信息与去重 | 存储原则 |
| --- | --- | --- |
| `collection_source`（已实现） | platform、provider、target、kind、标签、采集/覆盖状态 | 同一平台/provider/kind/target 唯一；凭证未来通过私有环境提供，不进 target JSON |
| `content`（已扩展） | platform、kind、字符串 ID、链接、可空标题/正文/作者/发布时间、媒体/引用/平台字段 | SQL `(source_id, kind, external_id)` 唯一，source_id 是平台；旧 target_id 保留；无 ID 的 feed 后续由 adapter 定义稳定身份 |
| `content_discovery`（已实现） | content、来源实例、首次/最近发现时间 | 正文共享，来源实例持有目标，多来源匹配不丢失 |
| `content_observation`（已实现） | provider/来源实例、指标、源观测/取回时间、evidence_key | 同内容/来源/证据幂等；同来源 latest 优先真实源观测时间，已知时间优先于 unknown；不跨 provider 覆盖 |
| `source_collection_job`（已实现） | 来源、窗口、checkpoint、页/数量预算、状态、租约、错误 | 每来源最多一个活动任务；页数据/checkpoint 同一事务提交 |
| analysis bucket（后续） | 时间桶、算法版本/范围、输出与覆盖 | 当前内容统计按同范围 SQL 聚合，复杂增量桶尚未迁移 |

时间至少区分 `published_at`（内容发生）、`source_observed_at`（指标观测/归档）、`fetched_at`（本平台取回），不能相互替代。观测时间未知则明确 unknown；重复获取同一归档快照不增加新的互动证据。可查询、排序和去重的核心字段用列与约束，来源扩展属性和少量指标用受控 JSONB；不用一张任意 JSON 大表，也不将每个可选指标拆成大量 EAV 行。

每个平台的能力定义指标 key/名称、count/ratio/rank 单位、是否累计、是否有符号、适用 kind 和 higher/lower/neutral 方向。指标用 `reddit.score` 等命名空间，真实 0 保留，缺失用 null；Reddit score、X likes 和榜单 rank 不直接合并。当前 Arctic Shift 保存三类实际指标及归档成熟状态，仅按来源取最新观测，小时/日互动窗口尚未实现。`post_engagement_*`、`metrics_snapshot` 和 `subreddit_*` 保持旧范围，不双写归档指标到增长事实。

写入按页批量完成。网络请求在事务外；身份 upsert、发现关联、当前页证据与 checkpoint 在事务内。重放可重复发生，业务依赖唯一约束幂等，目标是至少一次获取下的无重复内容，不承诺跨服务 exactly-once。不能在整个历史回填期间持有一个事务。源码中的既有 SQL 文件按完整文件名和校验和管理，增量变化只加新迁移。

### 不同平台字段契约

[source-content.ts](../packages/contracts/src/source-content.ts) 是新路径的唯一字段定义，通过 `http.ts` 导出。外部 ID 全部使用 string，避免大整数精度丢失；kind 支持 post/comment/article/image/video，与平台分开。title/text/url/language/author/publishedAt 可为 null，评论无需伪造标题，未公开指标不填 0。author 的 ID/handle/displayName/url 各自可空。`references` 表达 reply_to/thread_root/quote/repost；media 支持 image/video/audio/link、预览、alt 和时长。

| 平台 | 专属 `platformDetails` 字段 | 保留的差异 |
| --- | --- | --- |
| Reddit | community、flair、nsfw | 帖子/评论身份和父关系不同，score 可负，Arctic Shift 指标为归档观测 |
| X（设计） | conversationId、isReply/isRepost/isQuote、sensitive | 大整数 ID、无标题正文、引用/转发；likes/views 等待真实 provider 定义 |
| Instagram（设计） | mediaProduct、caption、carouselIds | feed/story/reel 与轮播不同；播放/触达可能不可得，不能与点赞等价 |
| web（设计） | publisher、canonicalUrl、feedUrl | 可能缺作者/发布时间，rank 有方向，RSS 不保证历史互动 |

`platformDetails` 为判别联合，额外字段仅由 adapter 白名单映射到 namespaced `extensions`，不保存任意上游 payload。`availability` 区分 available/removed/deleted/unknown。观测单独携带 provider/sourceId、sourceObservedAt/fetchedAt、timeBasis、maturity、metrics、evidenceKey，源时间未知不以本地抓取时间伪造历史指标时间。

当前 Arctic Shift adapter 仅提取外链媒体、作者、父/根/转帖引用与上述 Reddit 字段；完整图片/视频元数据和其余平台 adapter 留待实际来源实现。X/Instagram/web 类型及 SQL 合成样本只证明字段兼容，不证明真实接入。

## API 与前端契约

沿用 `packages/contracts/src/http.ts` 作为共同入口，前后端不维护另一份内容模型。已实现 `/v1/sources`、`/v1/sources/:id/collect`、`/v1/source-jobs/:id` 及 retry/continue、`/v1/content` 和 `/v1/content/stats`，方法见 [开发说明](development.md)。`source-content-routes.ts` 独立处理新路由，method/path/write 权限就近声明；composition root 统一认证，读取要求 session/bearer，写入限 admin/owner/machine。

- 读取仅查已落库数据，支持 platform/provider/sourceId/kind、标题/正文关键词、发布时间 `[from,to)`、limit/cursor。关键词为字面匹配，中文和 `%` 不当 SQL 通配符；尚未做全站全文索引。排序为 `(COALESCE(publishedAt,firstFetchedAt),id)`，cursor 绑定过滤条件；采集 checkpoint 与产品分页分开。
- 抓取/回填/重算通过管理员写端点提交有限任务，返回 202 与 job ID，读取任务状态查看进度。网页刷新不会自动启动全平台抓取。
- 列表返回观测、时间和实际指标，coverage 为 stored_sample；任务/来源只标 partial 或 unknown，不声称全量。统计与列表用相同过滤，总数覆盖匹配的全部已落库样本；UTC 日桶排除未知发布时间并返回 unknownPublishedAtCount。复杂 series 后续再定义版本/单位与范围。
- UI 根据来源能力提供筛选和图表，保留来源筛选和原链接。不能因为服务健康检查成功就展示“实时数据正常”。权限继续在 API 边界验证，业务函数不重复实现另一套登录与角色判断。
- `create-api-server.ts` 已约 3,768 行，新增公共功能时按 auth、collection、content/analysis、ops 分离路由处理函数，保留一个 composition root。每次只迁移要改的模块，不整库换框架。路由的 method/path/权限与 handler 就近声明，共用一次授权入口，避免新增端点忘记加入独立权限路径清单。

## 算法与跨来源聚合

先建立可靠的内容量、来源分布和覆盖时间序列，再决定复杂评分。统计分子和分母必须来自相同时间窗、来源和过滤范围，受搜索上限截断的样本不能当全量命中；现有 high/medium/low 质量标签只是启发式，不代表统计置信区间。公共算法只接收归一化观测与质量信息，不读取 provider 原始字段。平台内按同类型、同观测口径的 cohort 分析；跨平台展示保留平台原指标，若需要总排序再定义可解释的归一化分数与权重。

旧增长事实中的 `score / age` 是累计量除年龄，不是两个真实时间观测的差分。归档单快照不能用于声称实时速度或加速度；缺少可比观测时只展示归档统计并标明限制。缺失的 subscribers/active users 不能转成零值送进旧 Reddit tier/quality 算法。历史回填不改变内容发生时间，也不让近期热榜因为“刚抓回来”而变热。

精确内容去重和“同一事件”的分组分开：先稳定 ID/链接去重，正文身份不因标题相似而合并删除；以后按需要建立事件与成员关系，聚合按独立原始发布者计数，中间 provider 重复转载不增加独立信源。来源信息未知时不能假装可辨独立发布者。标题近似匹配可作为候选，LLM/embedding 仅在需求与预算明确后增加，并缓存按内容指纹和模型版本生成的结果。

派生分析按受影响的目标和时间桶更新。带前序窗口的 EMA/基线按实际依赖范围补算，不能只重算一个桶而断开历史。保留算法版本、关键参数与覆盖证据即可，不默认给每条结果写庞大的逐步骤解释副本。

## 资源与数据生命周期

当前 Windows 本地开发与旧约 4 GiB 服务器容量预算分开。新 worker 并发 1，每页最多 100、每任务最多 20 页；Arctic Shift 请求超时 20 秒、响应最多 8 MiB，页后释放响应，不积累完整历史。评论按目标、时间和数量有界获取，不保存所有媒体文件或全站历史。生产优先级调度与负载预算尚未验收。

连接池当前默认每进程 5，可用 `PG_POOL_MAX` 调整。API、现有两个 scheduler、人工开发与迁移进程各有池，总数必须留出 PostgreSQL 管理连接；增加进程时不能只考虑单池。RSSHub 等外部聚合优先视为 provider 使用已有授权/可用服务；若自建，先计入资源预算，默认不在本机启浏览器集群。

容量估算用实测“日新增唯一内容数 × 单条内容/索引字节 + 日观测数 × 保留天数 × 单条观测/索引字节”，另留 WAL、VACUUM、备份和发布空间。storage observability 已加入四张新表，新任务/观测尚无完整自动保留策略。删行不保证立刻释放文件空间，常规维护采用 autovacuum，不用频繁 VACUUM FULL 或清 Linux page cache 作性能手段。

| 数据类别 | 初始策略与当前边界 |
| --- | --- |
| 原始大 payload | 默认只保留错误/必要样本；旧代码 raw 保留 7 天，迁移后需敏感字段过滤 |
| 内容及当前观测 | 保留选定目标与产品窗口；保留天数由历史查询需求确定，不能未经确认删正文 |
| 窗口观测/指标 | 旧 engagement window 7 天、target metrics 30 天；迁移前核对算法所需窗口，超期聚合后再删 |
| 请求摘要、任务、查询会话、健康证据 | 当前未形成完整统一保留策略；需按引用与诊断窗口清理，不能因原始 payload 清理就认为整个库有上限 |
| 派生日统计 | 小体积可保留更久，按版本只保留产品实际用到的结果 |

旧维护每张表每轮最多 10 批，未完留到下一轮；有界批数不等于全库自动容量管理。上线前用代表目标测每页延迟、每任务 RSS、数据库/索引增长和读接口延迟。API/worker/数据库合计约 1–1.5 GiB、系统余量至少约 0.8 GiB 是旧服务器测量预算，尚未负载证明，不能当作当前 Windows 配置。

继续使用 PostgreSQL 的现有全文索引和队列表。当前关键词 normalizer 主要支持 ASCII lexeme；引入中文或其他语言时先明确可搜索文本、分词/匹配和范围，用真实关键词验收，不把现有英文测试当多语言支持证据。只有执行计划、实际吞吐或功能要求显示瓶颈后才评估新组件、分区或拆服务；不预设 Redis、消息中间件、搜索集群或向量库。最少监控关注内存/磁盘、数据库和 API 延迟、任务积压/失败及源延迟/覆盖，先复用现有日志和 ops 页面。

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

保证集中在外部输入、权限、数据唯一性/事务与工作量边界，不给每一层重复加校验/重试。新来源任务已实现租约、单来源活动任务约束与逐页 checkpoint 事务；上游临时错误每页最多三次自动尝试，授权错误直接失败。Arctic Shift 时间分页重读边界秒并去重，时间戳拥挤无法推进时停止并标 partial，不能静默跳过或声称覆盖完整。旧 Reddit 队列及自动周期调度不因此获得同样保证。

## 外部项目核对及取舍（2026-10-11）

这些是设计参考，不是已安装依赖，也不代表已选定用户所说 AIHot 的具体数据接口。

| 一手资料 | 核对到的做法 | 本仓库的取舍 |
| --- | --- | --- |
| [Arctic Shift API](https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md) | 归档检索有查询能力与可用性限制 | 将归档 provider 与实时指标分开，按窗口验收 |
| [AIHOT 源契约](https://github.com/KKKKhazix/AIHOT/blob/main/packages/backend/src/sources/types.ts)、[数据库](https://github.com/KKKKhazix/AIHOT/blob/main/database/migrations/0001_core.sql) | 不同获取类型进入内容身份、发现和处理记录 | 采用身份/发现/观测分离的边界，暂不移植全套精选和模型链 |
| [NewsNow 来源适配](https://github.com/newsnext/newsnow/blob/main/server/utils/source.ts)、[RSSHub 类型](https://github.com/DIYgod/RSSHub/blob/master/lib/types.ts) | 独立来源 handler 输出统一列表/Feed，能力和刷新策略独立 | 轻量 adapter 接入；列表热点不能当完整历史或互动序列 |
| [Miniflux worker](https://github.com/miniflux/v2/blob/main/internal/worker/pool.go) | 有界 worker 处理后台工作，生命周期简单 | 初始一个采集 worker，按预算扩并发 |
| [Airbyte 协议](https://github.com/airbytehq/airbyte/blob/master/docs/platform/understanding-airbyte/airbyte-protocol.md) | 数据记录与增量状态分离，state 用于恢复 | 保留逐页提交/stream checkpoint 语义，不部署完整 ETL 平台 |

上述资料提供模式，本文件的模型、进程预算和迁移顺序是基于本仓库的设计判断，需以实际来源、容量和查询验收校准。
