# 单机架构规范

状态：目标设计。当前源码基线 `main@3551900`；本轮只整理规范，不实施重建。产品规则见[产品规范](README.md)，字段与事务细节见[契约](contracts.md)。

## 1. 技术决定

| ID | 决定 | 依据 / 被替代的复杂度 |
| --- | --- | --- |
| ARC-01 | 在线后端使用 TypeScript + Fastify 5 稳定版 | 保留现有 TS 能力；删除手写 HTTP 路由、解析和重复装配。不建设第二套 FastAPI 在线后端 |
| ARC-02 | 保留 pg + 参数化 SQL + PostgreSQL 16 目标基线 | 有明确批量/分析查询需求；当前问题是逐条 SQL 与职责混合，不是缺 ORM。PG14 升级单独演练 |
| ARC-03 | 保留 React/Vite、React Router、TanStack Query | 已有依赖足够；按 feature 重组，不复制旧页面，不增加 SSR 或另一个状态框架 |
| ARC-04 | Node 24 为重建目标运行时，Fastify 采用核对过的 5.x 稳定版本 | 当前开发 Node22、CI Node24；版本升级与业务切换分开验证，不使用默认分支 alpha |
| ARC-05 | TypeBox schema 推导 HTTP 类型并生成 OpenAPI | 一份结构契约供校验/类型/文档；纯业务函数不依赖 HTTP schema，不保留另一份手写 DTO |
| ARC-06 | PostgreSQL 持久化领域任务；沿用并收敛现有来源任务 | 不外套 BullMQ/pg-boss；保留页提交、来源互斥和收费重放语义，不开发通用工作流引擎 |
| ARC-07 | Python + DuckDB + Parquet 只用于离线归档生产 | 列式扫描/聚合独立运行；通过数据包接在线端，不共享数据库连接和在线业务代码 |
| ARC-08 | Nginx + systemd 作为唯一默认上线方式 | 复用现有 Linux 发布、服务与静态资源资产；不同时建设 Compose/Caddy 第二套生产流程 |

暂不引入 NestJS、Redis、消息总线、独立搜索/向量库、ClickHouse、微服务、Kubernetes、单机对象存储服务。新增组件 MUST 说明哪个已确认瓶颈或具体机制被替代，并给出测量；“现代化”本身不是理由。

图表默认复用当前封装；重建页需要分布/矩阵图时 MAY 统一改用 ECharts 按需模块，但 MUST 同批删除被替代的图表依赖，不能长期双栈。

## 2. 拓扑与执行边界

```text
浏览器 / 授权机器客户端
          │ HTTPS
       Nginx ── Web 静态资源
          │
      Fastify API ───────────── PostgreSQL
                                      ▲
Reddit / X ── adapter ── 在线 worker ───┤
NewsNow 选定 getter ───────┘            │
受控 RSSHub / 原生 feed ───┘           │
                                      │
历史 .zst → 离线 Python/DuckDB → 数据包 → 导入 CLI
                                               └─ 私有文件目录
```

- 在线系统 MUST 只有一个 API、一套采集 worker 代码和一个数据库；导入 CLI 是同产品的一次性执行入口，不是第二个后端。
- 初始一个 worker 进程、采集并发 1。任务页无需吞吐等待时不固定睡眠；按最早 due time 等待，并服从 provider 限流。
- 导入/大导出初始只允许一个重任务，与采集共享整机资源预算。离线全档加工 SHOULD 在原档所在机器执行；在线产品不依赖该机器常开。
- NewsNow 仅移植白名单 MIT getter 与必要工具，保留许可和固定来源版本；不运行其 UI/缓存/API 服务。RSSHub 通过 HTTP 消费，需自托管时可作为同机可选旁路进程；不复制其框架进主仓库。
- 网络请求、解压和文件传输 MUST 在业务事务之外；数据库领取/页提交/发布事务保持短小。

## 3. 模块所有权

目标按业务模块纵向组织；现有目录只作搬迁输入，不维持两套分层结构。

```text
apps/api/src/          app、server、HTTP hooks、模块路由注册
apps/web/src/          app、api、features、共享 ui
src/modules/
  access/              accounts、sessions、invites、audit
  collection/          sources、providers、jobs、worker、采集状态
  content/             规范内容、观测、发现、查询、详情、写入
  projects/            项目规则、范围解析、概览、对比
  datasets/            历史包校验、导入、发布、汇总读取
  workspace/           个人查询、注释、固定研究、导出
src/connectors/        Reddit、X、newsnow、feed 的外部获取与映射
src/storage/           pg pool、事务、既有迁移与新迁移
src/runtime/           配置与依赖装配，无业务逻辑
packages/contracts/   HTTP schema、页/数据包版本契约
workers/              在线执行入口
scripts/              一次性维护与导入入口
```

| ID | 所有者 | 写入权与公开能力 |
| --- | --- | --- |
| MOD-01 | access | 独占账户/会话/个人身份与审计写入；提供 actor/权限检查 |
| MOD-02 | collection | 独占来源配置、调度、租约、限额与 checkpoint；只通过 content 的页写入入口提交内容 |
| MOD-03 | content | 独占规范正文、搜索投影、discovery、observation；提供批量写入、过滤、详情读取 |
| MOD-04 | projects | 独占项目/关联/规则；解析项目范围，调用 content/datasets 读取，不复制正文 |
| MOD-05 | datasets | 独占数据包、分区修订、release 与历史汇总；导入文本调用 content 的写入能力 |
| MOD-06 | workspace | 独占用户保存、注释、研究快照与导出产物；读取公共内容，不触发采集 |

ops 是上述模块的状态读模型，不另建运维领域。adapter MUST NOT 访问业务库。HTTP MUST NOT 编写跨模块写表 SQL。纯规则不得导入 runtime/HTTP。

模块可以有 `service.ts`、`queries.ts`、`writer.ts` 等真实职责文件；简单用例可直接调用本模块 SQL。MUST NOT 强制 controller→service→repository→DAO、逐用例 class、全局 DI 容器、事件总线或每张表一个接口。只有外部 I/O 与真实跨模块能力需要稳定边界。跨模块读模型 MAY 使用明确的只读 SQL 联表，不为一次概览增加多个进程内搬运层。

## 4. 一次实际采集的链路

1. `POST /v1/sources/:id/collect` 经身份/结构校验后，只登记有界任务并返回 202。
2. worker 短事务领取来源任务，提交后调用 adapter。外部返回结构只在 adapter 边界解析一次。
3. adapter 返回规范页；collection 开启页事务并验证租约，传入同一个 pg client 调用 content 的集合写入函数，再更新自己拥有的 checkpoint。content 不反向导入 collection，也不另开事务。
4. 项目读取经范围解析为同一规范过滤 SQL，列表/概览/导出都使用它。
5. UI 显示已存结果和实际覆盖；采集失败不使已存数据失效。

ARC-09：来源互斥、租约 fencing、重放规则 MUST 保留。首次处理与重试具有相同内容幂等键；不宣称 exactly-once。暂停/取消与提交遵循相同锁顺序。付费操作结果未知时不自动重发。

当前对应入口为 `server.ts → createPostgresPhase1Runtime → SourceContentService`、`source-content-worker.ts → workOnce → collectPage → commitPage`。这条路径说明真正需要切断的是新功能对旧 runtime 的依赖，而不只是把 3,606 行文件拆小。

## 5. 在线数据与历史数据

### 5.1 优先保留的模型

现有 `collection_source`、`source_collection_job`、`content`、`content_discovery`、`content_observation`、`public_content_search_document` 具有可复用语义。MUST 先验证再复用其约束；允许重建物理表，但不能丢掉身份/版本/观测含义。

最少新增实体：

| 实体 | 唯一职责 |
| --- | --- |
| `monitor_project` | 名称、描述、规范 filter、revision |
| `monitor_project_source` | 项目关联采集流，不复制流与调度 |
| `monitor_project_dataset` | 项目关联历史 dataset；默认读当前 release，固定研究另行钉住 release |
| `dataset` | 历史来源范围、producer 与覆盖政策 |
| `import_batch` | 包身份、校验/加载状态、失败信息 |
| `dataset_partition_revision` | 不可变逻辑分区、摘要、规则版本与行数 |
| `dataset_release` / `dataset_release_partition` | 可见版本及其完整分区清单 |
| `dataset_content` | 分区修订与入选 content 的关系，保留该包的证据载荷或不可变版本引用；允许只有汇总、没有在线证据 |
| `archive_activity_day` | 首批日期×平台×社区×kind 的计数；绑定分区修订 |

`dataset.current_release_id` 是发布指针。不存在通用 EAV 指标大表、每项目正文副本、每张图一份事实，也不默认建 `project_content` 全量命中表。后续新增标签/指标须有明确产品用途与契约，不从旧研究目录一次性生成几十张表。

### 5.2 为什么需要 release

实时采集按内容身份更新；历史包是不可变事实。两者不能仅靠一个 `imported_at` 混在一起。

ARC-10：历史统计 MUST 绑定完整 release 清单；同一分区替换不是再次累加。相同旧分区可被新 release 复用，不复制全量事实。逻辑分区修订不是 PG 物理分区，初期普通表加 revision_id 即可。

ARC-11：历史证据 MUST 固定该次发布的保留文本/状态。在线正文随后更新，不能改变旧 release 的搜索命中或导出；可复用已有冻结载荷方式，不要求全库内容 event sourcing。没有变化的正文 MAY 按内容摘要复用。

历史预计算只支持其维度；任意关键词在精选文本中检索，不能据此改算全量归档趋势。在线内容和历史证据可共用详情组件与身份，但历史事实与在线事实默认分面，遵循 MET-03/08。

## 6. 写入、查询与性能

### 写入

- ARC-12：在线一页先按内容身份去重，再集合 upsert 正文，批量写投影/discovery/observation，最后推进任务；页内数据库往返数 MUST 不随条目数线性增加。
- 正文采用已有单调版本守卫；投影从真正接受的正文生成，而非过期输入。缺失字段不冲掉已知版本。具体比较规则见 DAT-04。
- 批量归档用 `COPY FROM STDIN → staging → 校验/去重 → 发布`；服务器不替用户读取任意文件路径，不能把整个包塞进 JSON HTTP body。
- PostgreSQL 事务只使用同一个 client。保留 FK/唯一约束，不为加速关闭持久化或完整性保护。

### 查询

- ARC-13：filter 编译在一处；project scope 是参数，不另造项目查询语言。关联来源用 EXISTS，跨 provider/项目 join 不放大内容数。
- 默认 keyset 分页与有界结果；列表只选必要列，不为每行载入所有历史 JSON。详情按关联类型批量读取，禁止 N+1。
- 字面检索保留当前 NFKC/大小写/空白语义；首选评估 `pg_trgm` GIN 加速规范文本匹配。短词/符号/中文子串仍需范围和耗时限制，不能假设 trigram 对所有查询都走有效索引。英文词项检索以后作为显式新模式，不静默替代。
- 历史汇总在 SQL 归并小事实表；全文只查已声明 retained corpus。前端不拉全量数据计算图表。
- 先 EXPLAIN (ANALYZE, BUFFERS) 与 SQL 次数，再补索引/日桶/缓存。若引入缓存，key MUST 包含 scope、规则、release 和权限；不先加第二份数据库或 Redis。

### 验证负载

目标验证起点：4 vCPU / 8 GiB / SSD，100 万内容、300 万观测、20 个采集流、5 个并发读取；列表/详情 P95 ≤400ms、90 天概览 ≤1s、100 条页纯应用落库 ≥200 条/秒。归档另外测加载时长、证据索引、WAL/临时磁盘和查询共存。

这些是待验证工程目标，不是当前容量。先确认可用硬件/数据样本；报告必须区分冷暖缓存、网络、数据库、调度等待和更新比例。不能通过减少断言或偷偷缩小负载宣布达标。

## 7. 发布与最小运维

- ARC-14：API/worker MUST 使用同一不可变构建；入口 HTML 不缓存，哈希 assets 保留供旧标签使用。数据库与私有文件不进入构建产物。
- 数据库迁移不修改已应用 SQL；重建采用新库/新表与显式搬迁映射。现有账户/个人资产保留稳定 ID，必要时维护临时 ID 映射。
- 当前 systemd/Nginx 模板保留必要入口；重建上线后删除旧 scheduler/桥接服务模板。生产配置只表达实际能力，不保留几十个退役开关。
- 最小观测：requestId/耗时、慢 SQL、任务积压/错误、实际最近观测、导入进度、磁盘/WAL/内存、构建/迁移版本。结构化日志与管理页足够，不默认部署监控集群。
- 备份 MUST 覆盖数据库及被 release/研究引用的文件，且有离机副本；恢复验证后才能承诺可回退。留存策略确认前不自动删正文/原档。

## 8. 工程参考与采用边界

| 固定依据 | 本项目采用 | 不照搬 |
| --- | --- | --- |
| [Fastify 5.12.8 Plugins](https://github.com/fastify/fastify/blob/0c7413a8332a7892e12dcc351c27a190fefc0053/docs/Reference/Plugins.md)、[Testing](https://github.com/fastify/fastify/blob/0c7413a8332a7892e12dcc351c27a190fefc0053/docs/Guides/Testing.md) | 静态模块注册、作用域 hooks、inject 测试；复用 HTTP 机制 | 动态业务插件平台、框架跑分作为业务吞吐 |
| [Miniflux handler](https://github.com/miniflux/v2/blob/fb043227ef6ad98569c848e8cdade0d237dab87e/internal/reader/handler/handler.go)、[worker pool](https://github.com/miniflux/v2/blob/fb043227ef6ad98569c848e8cdade0d237dab87e/internal/worker/pool.go) | 条件请求、feed 解析/存储分离、小规模 worker | Go 重写、阅读器账户与订阅系统 |
| [PostgreSQL 16 COPY/ANALYZE](https://www.postgresql.org/docs/16/populate.html)、[SKIP LOCKED](https://www.postgresql.org/docs/16/sql-select.html)、[pg_trgm](https://www.postgresql.org/docs/16/pgtrgm.html) | 批量加载、短事务领取、实测索引 | 关约束/关 WAL 作为生产默认；把行锁当 exactly-once |
| [DuckDB 工作负载](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads) | 离线列裁剪/批量聚合、显式内存/临时目录 | 每个在线请求扫描原档、第二个高并发 OLTP 数据库 |

来源采集源码与许可统一见[来源研究](research/data-sources.md)。这些证据支持机制选择，不证明本项目已完成迁移或达到性能目标。
