# 项目架构与重构边界

基线：`main@3551900`，2026-11-13。**当前实现**见[状态](status.md)；本文明确目标设计，实施与删改顺序见[开发安排](plans/source-expansion.md)。

## 1. 架构决策

采用 **TypeScript 模块化单体 + Fastify 5 + node-postgres（pg）+ PostgreSQL**。前端保留 React/Vite。主产品只部署 Web 静态资源、API、worker 和一个数据库，不改写 Python/Java 后端，不按平台拆服务。

| 部分 | 决定 | 解决的具体问题 |
| --- | --- | --- |
| HTTP | 从手写 `node:http` 路由迁到 Fastify 5 稳定版；审查参照 v5.12.8，实施时锁定兼容补丁 | 用路由注册、hooks、错误处理和 inject 替代 3,606 行组合根中的重复 HTTP 编排 |
| DB 访问 | 保留 `pg`、参数化 SQL、现有连接池与事务；模块内集中查询 | 已有关键 SQL/迁移可直接复用；性能问题是逐条往返，不是缺 ORM |
| 后台任务 | 保留 `source_collection_job`、预算、租约和页事务；移除旧两条 scheduler 主链 | 一套采集状态，避免换队列时重做 checkpoint、取消与收费重放保护 |
| 数据库版本 | 新环境以 PG16 为统一目标；旧 PG14 在独立备份/恢复演练后升级 | 收敛环境差异，不让升级与业务重构捆绑上线 |
| 运行时 | 目标收敛 Node24（现有 CI 已用）；迁移前当前 Node22 命令继续有效 | 不长期维护两套默认开发配置；升级单独验证 |
| 契约 | 保留 `packages/contracts`；新增/迁移 HTTP schema 用 TypeBox 推导类型 | 逐端点替换旧手写 DTO/结构校验，同一路径不永久保留两份模型 |

不选整库 NestJS：当前不需要其 DI/装饰器与多模块装配成本。暂不加 Prisma/Drizzle/Kysely：先消除旧查询与逐条写入；今后若新模块查询的类型维护成为主要成本，再用一个实际查询验证收益。暂不引入 pg-boss：它能替代通用任务机制，不能直接替代本项目来源级互斥、预算、checkpoint 和 paid replay 语义；现在套在原队列外只会增加一层。Redis/BullMQ、Kafka、ClickHouse、Elasticsearch/向量库均不进入本轮。

Fastify 默认分支已是 6 alpha，本项目只采用已发布 5.x 稳定版。选型依据是减少自建 HTTP 机制，不引用框架跑分承诺业务吞吐。

## 2. 当前复杂度的实际来源

| 已读源码 | 事实与处理 |
| --- | --- |
| [create-api-server.ts](../apps/api/src/create-api-server.ts)、[server.ts](../apps/api/src/server.ts) | 组合根 3,606 行；新内容接口仍随 `createPostgresPhase1Runtime()` 启动旧 runtime。先切断装配依赖，再迁路由，不能只拆文件 |
| [SourceContentService](../src/application/services/source-content.service.ts) | 约 20.7KB，只有 157 行但混有配置、查询校验、预算、任务和执行。先格式化，再按真实职责拆分；行数不是复杂度指标 |
| [PG 来源仓储](../src/storage/repositories/postgres/postgres-source-content.repository.ts) | 约 50.9KB；`commitPage()` 逐 item 执行正文、投影、discovery、observation SQL，并非真正集合批量写入 |
| [旧 scheduler](../workers/reddit-phase1-scheduler.ts)、[关键词刷新](../workers/keyword-query-live-refresh-scheduler.ts) | 与公共来源 worker 并存；旧热度、查询与新公共检索语义不同，不能长期双写维护 |
| [Web 路由](../apps/web/src/App.tsx)、[http.ts](../packages/contracts/src/http.ts) | 旧 Markets/Queries/Run/Target 与新 Content 并列，共同契约混合旧 DTO；按首版替代关系删除，而非全部复制进新模块 |

## 3. 目标模块与目录

保留现有根目录，不新建一套 npm workspace。应用用例归入 `src/application/<模块>/`，SQL 归入 `src/storage/<模块>/`，API 归入 `apps/api/src/routes/`；`src/domain/` 只保留确有业务规则的类型/纯函数。一个简单用例允许直接调用模块查询函数，不强制 service → repository → DAO 三层接口。

| 模块 | 对外能力 / 数据所有权 |
| --- | --- |
| access | 用户、会话、角色、邀请、审计；复用现有实现，不重新开发账户系统 |
| collection | 来源配置、provider 注册、预算、任务、worker；adapter 只获取/映射，不写业务表 |
| content | 规范正文、发现关系、独立观测、检索、详情；页提交入口拥有一致性规则 |
| projects / insights | 项目与来源关联、过滤、概览/对比；后续事件与通知结果，不能改写原始内容 |
| workspace | 个人保存、注释、研究冻结与导出；读取 content，不反向依赖采集执行 |

ops 是运行入口与读模型，不另造领域平台。`runtime` 只组装配置、连接池和模块；HTTP/worker 调用用例，用例调用规则/SQL，纯规则不导入 HTTP、storage 或 runtime。只对可替换外部依赖和实际跨模块能力定义接口。

Web 按 `features/projects|content|sources|workspace|ops` 组织，page 只组合。传输/认证集中 `api/client`，筛选保存在 URL，沿用账户切换缓存边界。新页面不依赖旧 target read model。

## 4. 运行与 HTTP 迁移

```text
React/Vite → Nginx → Fastify API → 用例/读取 SQL → PostgreSQL
                              ↑
provider / 聚合出口 → adapter → worker → 页事务
```

网络请求在事务外，页面查询不触发采集/模型。初始一个采集 worker、并发 1；先测写入和排队，再增加并发。若使用自托管 NewsNow，它是一个可选外部 provider 服务，有单独资源/版本记录，不复制本产品的用户、任务和分析数据库；AIHOT 首期只读 RSS/API，不部署整套框架。

Fastify 按 access、collection、content、projects、workspace、ops 注册路由。共同 hooks 处理 actor、Origin/CORS、body 限额、限流、requestId 和审计；各路由就近声明权限。账户的凭证 fencing、最后 owner 保护、个人数据隔离，以及已有 audit attempted/result 行为保持不变。

迁移先做最小骨架与 content 读取，随后迁来源/账户/工作区/必要 ops。过渡期可按明确路径由 Nginx 分流到旧 API；同一 method/path 只有一个处理者，不设吞掉所有未匹配请求的长期 legacy fallback。保留现有 `/v1/content*`、`/v1/sources*`、登录与 Saved 契约；新增项目接口示意为 `/v1/projects`、`/:id/content`、`/:id/overview`，实施时再正式定义 schema。

新增 schema 放共享契约并推导 TS 类型；已有端点未迁时保留原定义，迁到新 schema 的端点删除旧结构校验。日期/指标可比性等业务规则仍调用现有纯函数，不在 schema、handler、service 重复实现。一个事务始终使用同一个 pg client。

## 5. 数据模型：保留核心，只加产品所需表

### 已有表继续作为权威数据

| 表 | 身份与用途 |
| --- | --- |
| `source` | 平台注册；不是某个采集渠道 |
| `collection_source` | 平台/provider/kind/规范 target 的采集流；持有周期与状态 |
| `source_collection_job` | 有界窗口、checkpoint、预算、租约与执行结果 |
| `content` | `(source_id, kind, external_id)` 唯一；`source_id` 指平台，external ID 始终 string |
| `content_discovery` | 内容与采集流多对多，保留首次/最近发现 |
| `content_observation` | 同内容、来源、evidence key 幂等；不同 provider 的指标证据互不覆盖 |
| `public_content_search_document` | 已存完整 title/text 的检索投影；不是外网搜索索引 |
| 个人/研究/账户表 | 保留当前所有权、revision、冻结样本和审计规则 |

### 首版新增（计划，尚无迁移）

- `monitor_project`：id、名称、描述、规范过滤配置、revision、创建/更新时间。
- `monitor_project_source`：project_id + collection_source_id 复合唯一。一个来源可被多个项目复用，关联不复制内容或重复收费。

项目内容先通过 source 关联 + discovery + 统一过滤 SQL 读取，用 EXISTS/去重保证一个内容只计一次；不先建每项目一份正文或 `project_content` 事实表。项目过滤复用现有 `ContentQuery` 支持的字段子集，不能放任意 SQL。首版所有有读取权限的团队用户可见全部项目；个人收藏/注释不因此共享。

采集 target/query 决定上游召回，项目 filter 决定已存样本中的命中，两者不能互相替代。同一采集流只有一份周期设置，项目关联不能静默改它；设置冲突由管理员在来源页明确调整。取消项目关联不自动停止仍被其他项目使用的来源。规则变更按当前规则重查全部已存历史，不宣称历史版本回放。

事件分组进入 P1 时才增加 event/member；只有概览聚合实测不达标时才增加带规则版本的日桶。当前 42 个迁移按完整文件名/checksum 保留，新增文件从实际账本之后分配，不改写历史 SQL、不补造蓝本中的 041。

## 6. 采集、清洗与聚合契约

延续 **provider → CollectedPage → 页事务 → 内容/观测 → 项目读模型 → API/UI**。

1. adapter 校验外部数据一次，规范 ID、正文、时间、媒体、引用和 capability；供应商分页留在 adapter。
2. 一页的正文、检索投影、discovery、observation、checkpoint 同事务提交；取消/旧租约不能提交。
3. 正文版本沿用已知源观测时间优先规则；未知时间不覆盖已知版本。真实 0 保留，缺失 null；重复归档快照不伪装成新增互动。
4. `publishedAt`、`sourceObservedAt`、`fetchedAt` 分开。没有发布时间的榜单条目可以展示，但不进入按发布时间统计的趋势，另列未知时间数。
5. 新闻 URL/GUID 用 publisher/feed namespace + kind 生成 web 身份；采用已有 `webContentIdentity`。不按猜测的站点 ID 冒充 Reddit/X 内容，不把摘要补成原始正文。
6. NewsNow 的缓存时间/HTTP 返回时间不等于原平台观测时间；无可信快照时刻则 `sourceObservedAt=null`。榜单 rank 只在同榜比较，P0 可不采指标；采 rank 时先扩展统一 capability/契约，不硬塞 `reddit.score`。
7. AIHOT 文章/事件可能是整理后的二手产物，保留其链接与渠道；不将其一篇事件综述当多条独立原帖。来源链去重规则见[来源研究](research/data-sources.md)。

临时错误沿用每页最多三次尝试；收费操作未知结果保持现有人工 Retry，禁止借框架重试再次收费。没有持久 cursor 的来源可定期取重叠样本，但只能标 partial；不能据“任务成功”推进声称完整覆盖的高水位。

## 7. 查询与性能

第一优先级是少往返、少搬 JSON，而不是增加缓存/中间件。

- 将 `commitPage` 改为集合写入：页内去重 → 一次规范内容 upsert RETURNING → 批量投影/discovery/observation → 更新任务。保留单调版本守卫，投影使用实际 RETURNING 的正文，不用过期输入覆盖。原子性、幂等与计数需用 PG 场景对照。
- 项目列表/概览共用过滤构造；按稳定时间+id 游标。先在请求范围内 SQL 聚合，不在 Node 拉全历史算图表。列表与即时统计允许并发变化；固定研究结果继续走 RR 冻结。
- 优先复用现有索引；实际 EXPLAIN 后增加 project_source 反向索引或合适检索索引。现有字面/中文子串语义不能无声改成英文全文检索；短词扫描单独测量。
- 派生桶只在扫描成本成为瓶颈时引入；迟到/修改内容重算受影响桶，不假装只加计数即可。含过滤的查询不能错误复用无过滤的预聚合。

目标验收负载：PG16、4 vCPU/8GiB、100 万内容/300 万观测、20 个来源、5 个并发读取用户。初始目标为列表/详情 P95 ≤400ms、90 天概览 P95 ≤1s、100 条/页纯落库 ≥200 条/秒（不含网络），记录冷/暖缓存、更新比例、内存与 SQL 次数。**这是 M5 验收目标，不是已测性能或上游容量**；不达标先定位查询/写入，不能靠缩小样本宣称通过。硬件不同另报结果。

## 8. 删除边界与数据生命周期

旧 Markets/Compare/Queries/Run/Target 的价值由项目概览、明细、项目对比替代；旧 tier/heat/driver/shadow-promotion 不移植到新主链。先列对应关系、切默认入口/停旧写入，再删旧路由、算法、runtime、connector、CLI 和专用测试。**不再要求为已放弃的旧功能重新实现一份替代品才可删除**；保留有产品价值的用户流程即可。具体路径见开发安排。

停旧 scheduler 前盘点其额外职责：若还承担必须保留的维护任务，迁成有界维护命令/worker tick；废弃数据的维护随链路退役。历史表先只读保留，最终 DROP 另开迁移并核对引用和备份，不把删代码变成删业务数据。第三方冻结蓝本保留为历史，不按其 39 个功能逐项开发。

保留期提案：内容 90 天、观测 30 天、完成任务/请求摘要 30 天、日聚合 365 天；M0 确认后才实现清理。当前没有覆盖新表的自动删除执行器。本轮不批准删除正文或研究样本；源删除/撤回政策需同时处理投影、派生结果与冻结导出，个人收藏不能自动获得无限保留权。

## 9. 一手工程依据

| 固定源码 | 采用与不采用 |
| --- | --- |
| [Fastify 5.12.8 Plugins](https://github.com/fastify/fastify/blob/0c7413a8332a7892e12dcc351c27a190fefc0053/docs/Reference/Plugins.md)、[Testing](https://github.com/fastify/fastify/blob/0c7413a8332a7892e12dcc351c27a190fefc0053/docs/Guides/Testing.md) | 静态注册、作用域 hooks、inject；不是动态业务插件平台 |
| [AIHOT app](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/apps/api/src/app.ts)、[queue](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/packages/backend/src/jobs/queue.ts)、[db](https://github.com/KKKKhazix/AIHOT/blob/e3857943ddb53b1d2ea13d346be2e06709b2be19/packages/backend/src/db.ts) | 可见 API/worker/SQL 分工与事务内入队；本项目保留自己的领域任务，不整库迁入其模块系统/模型流水线 |
| [NewsNow API](https://github.com/newsnext/newsnow/blob/5da836c49c327f2c352216c5cbb4dea1abd9fcd3/server/api/s/index.ts) | 作为有界榜单 provider；不拿其缓存表充当本产品持久内容库 |

本次只做源码/文档核查，不安装业务框架、不执行第三方采集、不变更业务库或部署。来源和许可证证据集中维护在研究文档。
