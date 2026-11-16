# 产品与架构

本文件定义目标；[契约](contracts.md)定义行为，[开发说明](development.md)定义执行方式，[状态](status.md)记录实现事实。MUST / MUST NOT / SHOULD / MAY 分别表示必须、禁止、默认建议、可选。规则只定义一次；引用使用编号。

## 1. 用户与任务

产品服务研究、运营与竞品观察：**创建项目 → 增量发现 → 筛选信号 → 按需补评论 → 阅读证据 → 保存或下载**。

共享内容库，沿用 owner/admin/viewer；个人查询与批注隔离。首版不做租户、计费、全网覆盖、LLM评分或通用工作流。

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| PRD-01 | MUST | 项目以三组词定义本地范围：任一提及、同时包含、排除。创建只预览已存数据，不启动采集。 | 浏览器 |
| PRD-02 | MUST | 精准词可直接带评论；宽泛词先发现根帖，再经确定性信号筛选并批量补全。 | HTTP闭环 |
| PRD-03 | MUST | 概览、钻取、比较、文件共用过滤与计数口径；每条结果可核对原文、渠道和时间。 | PG/HTTP |
| PRD-04 | MUST | Web与agent使用同一HTTP契约；授权范围内的巡检、补全和切备不重复等待人工批准。 | HTTP/浏览器 |
| PRD-05 | MUST | 研究资产仅为保存查询、收藏/批注和文件下载；旧冻结资产先迁出交付再删除。 | 资产对账 |
| PRD-06 | MUST NOT | 将样本数称为平台总量，将未知补0，或把单次成功称为持续覆盖。 | 结果核对 |

### 五个导航区域

| 区域 | 主操作 | 内容 |
| --- | --- | --- |
| 项目 | 创建监测 | 概览、信号筛选、期间/项目比较 |
| 内容库 | 查证据 | 根帖与命中评论、原文、评论树、下载 |
| 来源 | 接入来源 | 逻辑目标、主备渠道、任务状态与恢复 |
| 我的研究 | 保存判断 | 查询、收藏、批注 |
| 设置 | 管理访问 | 账户、机器key、配额 |

登录、详情和管理辅助路由不计为新导航。详情侧栏保留筛选/滚动位置；评论树提供Top高赞、命中父链、楼主互动三视图。缺父链、部分数据、费用未知和无匹配分别表达。默认页面只保留一个明确主操作；错误给下一步，诊断折叠。交付时实际检查1440/768/390和完整键盘流程。

## 2. 来源选择

| 平台 | 主源 | 备源/补充 |
| --- | --- | --- |
| Reddit | kaix/reddit-scraper | red_crawler搜索/树Actor；二者共享Apify基础设施 |
| X | TwitterAPIs | TwitterAPI.io；独立适配，不只替换base URL |
| 资讯 | 精选NewsNow MIT getter、通用feed | 受控RSSHub，可选外部服务 |
| Bluesky | 保留已有AppView能力 | 不扩展本轮范围 |
| 历史材料 | R4独立外挂 | 只经鉴权HTTP推流 |

Arctic Shift在线链路退役；历史内容与真实provider标识保留。ScrapeBadger/Xquik只在现有路径有已证实缺口时再选。来源价格、满页折算与上游宣传不是产品性能或成本承诺；真实验收记录目标、窗口、耗时、独立内容和实际账单。

## 3. 架构与所有权

```text
Web / agent / 外部推流
          │ HTTPS
       Nginx
          │
Fastify 5 + 进程内调度器
          │ 一个pg.Pool
    PostgreSQL 16
```

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 使用Node24、Fastify5、TypeBox、pg、PG16、React/Vite；TypeBox生成类型与OpenAPI，同一边界只解析一次。 | 构建/HTTP |
| ARC-02 | MUST | 五模块为access、collection、content、projects、workspace；模块默认routes.ts/sql.ts，额外文件须有独立职责并登记到lint。 | lint |
| ARC-03 | MUST | 仅新增monitor_project与monitor_project_source；其余状态扩展现有表。 | 迁移审查 |
| ARC-04 | MUST | 内部使用命名参数化SQL函数；事务函数接PoolClient，读取接Pool或PoolClient。仅外部ContentProvider保留多实现。 | lint/PG |
| ARC-05 | MUST NOT | 新模块依赖旧runtime/Repository/service镜像，或引入通用DI、队列、规则、插件平台。 | lint/依赖审查 |
| ARC-06 | MUST | 逻辑来源与provider分离；来源只关联项目/授权一次，主备实际渠道记录在任务与观测。 | SRC-01 |
| ARC-07 | MUST | 唯一写入函数commitContentBatch原子提交正文、投影、discovery、observation四组集合SQL；禁止逐条落库。 | PG/SQL次数 |
| ARC-08 | MUST | 单机Compose仅proxy/app/db；app一个进程，调度并发初始2、共享pool初始10；按来源互斥领取PG租约。 | 部署/并发 |

| 模块 | 拥有的写状态 |
| --- | --- |
| access | 账户、会话/机器key、邀请、审计 |
| collection | 逻辑来源、任务、调用用量、租约/调度；拥有批次事务 |
| content | 正文、搜索投影、发现、观测；提供批次写入和统一查询 |
| projects | 两张项目表、范围、补全策略 |
| workspace | 个人查询、收藏/批注 |

概览/个人查询可直接只读联表。connector不访问业务库；网络不进入数据库事务。调度器继续使用现有job/lease，不引入pg-boss或Graphile Worker。搜索仅用PG pg_trgm，不加独立搜索集群。

树关系使用已有reply_to/thread_root；按真实查询补父/根索引，以EXPLAIN证明，不建树表。搜索投影仅search_text + title_length + trigram GIN：标题/正文用U+001F分隔，title_length用PG char_length。短语不跨字段；参数化LIKE转义通配符，短词须收窄时间或来源。迁移先回填验证，再移除038失效触发器；不得修改已应用SQL。

R4的plugins/zst-archive独立运行/依赖/测试；核心不导入Python、DuckDB、原档、manifest或归档汇总。未开发外挂不阻塞R1–R3。

## 4. 复杂度与验证

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| ENG-01 | MUST NOT | 新增现行文档、模块文件或抽象层而不修改唯一允许清单并说明承担的职责。 | lint/差异审查 |
| ENG-02 | MUST | 每条规范只有一个编号与定义位置；注释仅解释必要原因/外部约束，不重复代码或规范；新内核单注释≤300字符。 | lint/审查 |
| ENG-03 | MUST NOT | 用文件数、压行、测试数或夹具通过代替用户任务、真实来源和性能证据。 | 交付审查 |
| ENG-04 | MUST | 保留纯规则单测、一套真实PG+HTTP闭环、一条浏览器用户流程；删除废弃行为对应测试，不双跑InMemory镜像。 | 阶段验收 |
| ENG-05 | MUST NOT | 在仓库、发布包、日志、对话或测试夹具中放真实密钥。私有配置方式见开发说明。 | lint/发布测试 |
| ENG-06 | SHOULD | 新依赖替代现有机制或解决已测瓶颈；性能先检查索引、扫描、往返和分配。 | EXPLAIN/基准 |

性能验收使用代表负载，记录数据规模、冷暖缓存、P95、SQL次数、内存与WAL；不预先承诺未测吞吐。列表不额外COUNT，概览一条GROUPING SETS，批注用JOIN，树与导出禁止N+1。

新审查仅采纳影响核心行为的决定。R1–R3仍包含多源、agent与推流；R4只做独立历史外挂。原审查和来源证据在[90dbe9a固定快照](https://github.com/Euroish/reddit-monitoring-mvp/tree/90dbe9a/docs)，不作为第二套现行规范。
