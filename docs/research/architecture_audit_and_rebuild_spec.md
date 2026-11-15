# 架构审查与重建落实索引

本版将用户确认的审查决定同步为产品/架构/契约/交互/实施验收，并修正原稿中不能直接照抄的SQL、部署和性能断言。**仍是规范，业务改造尚未执行。** 原始完整审查稿固定在[`a078c9c`](https://github.com/Euroish/reddit-monitoring-mvp/blob/a078c9c/docs/research/architecture_audit_and_rebuild_spec.md)，基线源码`7045185`；不再维护一份与正式规范竞争的SQL/脚本蓝图。

## 1. 四项锁定决定

| 决定 | 唯一规范 / 实施门槛 |
| --- | --- |
| 主线与外挂物理隔离 | [CORE-01–02](../README.md#2-主线与外挂边界)：Fastify5/PG16/React/在线connectors；镜像、迁移、备份和测试不依赖Python/DuckDB/.zst；只留有鉴权推流口。七张归档表/顶层数据集移出主线，R4独立。 |
| 删除仓储双轨 | [ARC-05–06](../architecture.md#2-五个模块与所有权)：命名参数化SQL，接收Pool/PoolClient；只保留外部多实现ContentProvider；全部单实现Repository与14个in-memory目录文件退役。 |
| 研究留档采用方案B | [EXP-01–06](../contracts.md#5-流式导出与个人工作区)：保留保存查询/收藏批注，流式CSV/JSON；旧冻结资产先交付后删服务/表/API。全系统只新增两张项目表。 |
| 简洁、可读、真实验证 | [ENG-01–07](../README.md#4-工程与产品质量)、[SAFE-01–06](../architecture.md#6-远端安全稳定基线)：少层次、少重复扫描、真实PG HTTP闭环；按任务验UI，不用压行/删断言/长说明框换“精简”。 |

## 2. 代码审查证据与七项问题

原稿的576文件/74,468 LOC和删减类别来自其code-map/arch-audit扫描，本轮未重跑该工具；以下代码形态已逐项核对。原稿500ms、2,000条/秒、90%削减等数字不视为本轮测得结果或硬预算。

| 编号 | 当前证据 | 正式修复规则 | 交付验收 |
| --- | --- | --- | --- |
| AUD-01 | [in-memory目录](../../src/storage/repositories/in-memory)14个TS文件重复实现SQL状态/事务 | ARC-05，直调命名SQL，不再建InMemory镜像 | R3主线无该目录/单实现接口引用；关键契约仍由真实PG验证 |
| AUD-02 | [PG来源仓储](../../src/storage/repositories/postgres/postgres-source-content.repository.ts)、[个人service](../../src/application/services/content-personal.service.ts)、[内容页面](../../apps/web/src/pages/Content.tsx)有大量压缩长行 | ARC-06/ENG-03，减少真实职责/重复而非换行 | 人类可读diff；无把原文件压行/改名迁移的做法 |
| AUD-03 | 来源仓储coverageSql被分页热路径调用；[038迁移](../../src/storage/schema/038_public_content_search_document.sql)对受影响正文更新失效投影 | SQL-04/06，新迁移回填/校验后移除失效触发器，列表limit+1 | 查询追踪证明列表无额外coverage COUNT；所有接受正文与投影一致 |
| AUD-04 | [contentWorkbench](../../src/application/services/content-workbench.service.ts)按平台/provider多次contentStats；个人批注列表逐项getContent | SQL-07/08，单SQL GROUPING SETS、JOIN批注 | 同scope总数/分面一致；provider重叠不放大内容数；无N+1 |
| AUD-05 | [研究冻结服务](../../src/application/services/research-export.service.ts)与[仓储](../../src/storage/repositories/postgres/postgres-research-export.repository.ts)复制载荷/回写member；旧即时导出累积数组 | CORE-04/EXP-01–06，取消持久化冻结并流式下载 | 资产迁出对账；文件有终结/分段元数据，断流取消查询，内存不随总行数增长 |
| AUD-06 | commitPage页内4次query/项，无evidenceKey平局，较新缺字段可清空正文 | SQL-01–03/DAT-04：四组集合写、稳定版本时钟、接受正文投影 | 100条页数据SQL数不随条数增长；逆序/平局/缺字段/删除/回滚断言通过 |
| AUD-07 | listContent使用COALESCE(created_at_source,first_seen_at)排序；[Arctic Shift adapter](../../src/connectors/reddit/arctic-shift-content.connector.ts)限制2–12位ID | QRY-05/DAT-01，真实时间NULLS LAST、2–32位base36 | 跨null边界分页不漏不重；13/32位接受、非法ID拒绝 |

这些源码链接在R3实删时应改为固定基线提交链接，或改到新实现；删除文件不能使本索引变成坏链。审查数字是定位线索，修复必须证明行为，不能只比较总行数。

## 3. GAP-01–06 契约闭环

| GAP | 本次补齐的决定 | 验证出口 |
| --- | --- | --- |
| GAP-01 正文版本 | [DAT-04](../contracts.md#dat-04接受正文的确定性版本)：evidenceKey + 独立versionFetchedAt。不能用会随所有输入变化的last_seen_at比较已接受版本；落后available也不能补空复活删除正文。 | R1真实PG逆序/平局/未知时间/删除防复活；投影来自接受正文 |
| GAP-02 空时间分页 | [QRY-05–06](../contracts.md#3-过滤排序概览与对比)：两分支seek、NULLS LAST、过滤指纹/revision绑定 | R1跨null边界与改变scope的409 |
| GAP-03 单搜索索引 | [SQL-09–10](../architecture.md#4-查询与性能)：一个search_text GIN，title_length保留搜索字段边界；LIKE转义，短词限定范围 | 标题/正文/短语/Unicode不变，EXPLAIN显示实际候选索引，短词过宽不假0 |
| GAP-04 榜单身份 | DAT-02/03：canonical URL独立内容；board/bucket是观测证据，web.rank不是互动 | R2跨榜单去重/重试稳定/缓存时间不冒充上游时点 |
| GAP-05 项目比较 | QRY-07：同已存内容模型、同窗；engagement两侧同一单平台/指标/provider/timeBasis | R2不兼容422、内容量可比较、0分母为null |
| GAP-06 调度 | [RUN-01–04](../architecture.md#5-调度与恢复)：续页now、provider spacing、空队列有界等待；收费未知不回放 | R1/R3调度追踪、并发/预算/取消与关闭断言 |

过滤只有纯函数`compileContentFilter(scope,filter)`；scope显式包含actor与project限制，所有读取/统计/导出共用，不建立另一套过滤语法。

## 4. 原蓝图必须修正的落地细节

| 原稿风险 | 执行决定 |
| --- | --- |
| 提供可复制的UNNEST长SQL，但作者等参数类型/别名与真实schema未完整对齐，正文RETURNING未包含投影所需全部字段 | 不保留未验证的伪实现。实现用真实schema/typed参数数组，真实PG运行；四组数据语句与锁/事务/任务语句分别计数。 |
| 版本fallback用last_seen_at，落后版本ELSE COALESCE可以复活deleted正文，输入search_text可能覆盖canonical投影 | 增独立接受版本时钟；禁止落后版本补正文；投影由接受正文计算。 |
| 概览GROUPING SETS的grand total与未知日期都是null，provider关联可能扩大范围 | 使用GROUPING位区分；provider只在相同matched内容与有效来源范围聚合。日期窗排除未知时不能另算隐藏分母。 |
| 合并全文列却未定义原title/text scope，或继续strpos期待GIN | 保留字段边界与字面语义，改可索引候选谓词并精确recheck；不能借优化缩减搜索契约。 |
| 所有fetch一律15s会截断既有kaix收费启动 | 默认15s但允许明确有界provider例外；未知收费结果绝不自动再POST。 |
| 默认拒绝只例外login，会阻断初次会话探测/邀请注册 | SEC-02精确method/path例外与同源写保护；机器key有限scope/来源绑定、可撤销。 |
| Compose容器PG同时写127.0.0.1，使app不可连接 | PG仅私有Compose网络、无host ports，app用内部服务名；不暴露公网数据库。 |
| 5s优雅退出却允许10s SQL，声称compose up可滚动零停机 | 应用15s退出/supervisor30s、事务提交或回滚；单机维护窗口，不承诺零停机。 |
| 仅3个环境变量等于所有第三方/域名自动可用 | 3个必需应用secret；来源凭证按启用配置，HTTPS域名/证书属于部署前提。尚无Compose文件，不给当前不存在的启动命令。 |
| “仅两新表”但API Key、幂等回执归属不清 | Key扩展既有app_session；推流回执扩展source_collection_job；迁移清单/索引/生命周期见计划，不加通用平台表。 |
| CSV/JSON“流式”却未定义一致性/断流/缓冲 | 有界只读RR事务/cursor/backpressure/取消、有效终结、显式分段；≤2MiB是受记录大小约束的额外缓冲目标，不是Node RSS。 |
| 立刻删除所有旧服务与表可能丢个人冻结/查询 | R1隔离闭环，R2新产品完成，R3先迁出对账再实删/切换；删除范围仍必须完成，不保留永久兼容层。 |

## 5. 外挂研究的证据边界

保留“顺序解压→可重复利用的列式材料→选内容→标准推流”的方向；具体加工方案留[R4](../plans/source-expansion.md#6-r4独立归档外挂后续授权)独立验证，不给主线增加一个离线产品。

- 解码器允许windowLogMax=31不证明每个包都使用2GiB窗口/单帧。普通.zst不保证任意压缩偏移恢复；必须检查实际frame/seekable信息，不能把读取示例当格式承诺。
- 排序Parquet可帮助列裁剪/行组统计跳过，但过滤选择性、行组、DuckDB版本、存储和cache共同决定表现；Bloom需核对写入和读取支持，不是O(1)检索保证。
- 原稿4.8GB、3–5分钟、15–35ms、0.5–1.2s、30倍提速等没有本仓库可复核的实际材料/报告，全部降为待测假设；不以此规划远端容量或删除原档。
- 不保留未经执行的archive.py作可用命令。原型会把未知retrieved_on补发布时间、丢字段/数据而缺拒绝统计，路径/SQL插值和固定16GB内存也未验证；它不是受支持实现。
- 归档保留与删除必须单独授权；至少完成字段/行数/拒绝行/时间/抽样正文/摘要对账及可恢复备份后，才讨论源文件删除。不能以Parquet体积更小直接删原件。
- 主题分类模型单独研究真实标签/训练集/语言/许可与误差，不虚构现成模型，不把分类标签冒充全网范围。

## 6. 完成标准与维护方式

[重建计划](../plans/source-expansion.md)是唯一R1–R4实施表：R1内核与数据闭环，R2项目化前后端/来源，R3实删/性能/单机切换，R4外挂独立演进。主线只有五模块/五页面/两新表，标准推流是唯一外挂边界。

交付必须同时证明：①契约断言/真实PG；②人类与agent完成同任务；③来源实际检查；④远端安全/恢复/性能。四类证据分别写[status](../status.md)，未执行就仍未完成。文档检查只证明规范链接/结构，不证明架构已实施。

以后修改产品/技术/API/UI/计划只改对应唯一文档，本索引只更新证据与映射，不再复制长SQL、组件蓝图或部署脚本。
