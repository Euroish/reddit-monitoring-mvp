# R1–R4 主线重建与实删计划

状态：尚未实施。目标见[产品](../README.md)、[架构](../architecture.md)、[契约](../contracts.md)、[交互](../design.md)；[审查落实索引](../research/architecture_audit_and_rebuild_spec.md)将问题映射到以下验收。R1–R3只做在线主线，R4外挂不阻塞它们。

## 1. 切换原则

- PLAN-01：允许删业务表/API/页面；不能顺带丢账户、来源证据或个人研究资产。先盘点备份/迁出，再删；危险生产操作另需用户授权。
- PLAN-02：新入口必须能不加载旧Phase1 runtime独立启动；开发用隔离测试库，不让两个writer并行写生产。暂存旧代码仅用于对照/切换，R3必须实删，不长期双链兼容。
- PLAN-03：每阶段是一条可用的前后端任务链，不按“先全部仓储、再所有服务、最后UI”堆模块。UI和HTTP共享相同schema/权限/过滤。
- PLAN-04：只有monitor_project与monitor_project_source两张新表；新增列/索引/约束有明确owner，已应用迁移不可改。七张归档表若根本不存在就不造再删，实库以盘点结果为准。

## 2. 资产盘点与最小表变更

| 对象 | 实施动作 / 保护条件 |
| --- | --- |
| app_user/password/session/invite/audit | 保留ID、口令/会话摘要与角色边界；app_session增加机器key类型/权限/来源范围/label，不另建token表 |
| source、collection_source、source_collection_job | 保留来源身份/任务证据；加deliveryMode、必要条件请求元数据、push回执键/hash/结果；修改相关purpose/window/active-job约束 |
| content/discovery/observation | 保留身份/关系/时间；加接受版本evidenceKey、versionFetchedAt与明确正文状态；旧数据回填不伪造观测 |
| public_content_search_document | 新增迁移为单search_text/title_length，回填并校验完整性，再删除038失效触发器/旧字段/旧读逻辑 |
| monitor_project、monitor_project_source | 新增，仅保存项目filter/revision与来源关联；不复制内容 |
| content_saved_query、content_annotation | 保留userId归属、revision、收藏/笔记；显式转换废弃查询字段并报告不支持的条件 |
| research_export/member及引用文件 | 先按原owner列清单/校验数量、导出CSV/JSON文件并验证可读与授权交付；确认完成后删除服务/表/成员，不静默并入公共资产 |
| saved_workbench_view、keyword_query_session等旧资产 | 可转换的个人查询迁入content_saved_query；不可等价转换的保留离线文件/转换报告待确认，不塞进新库通用JSON表 |
| dataset/import_batch/dataset_partition_revision/dataset_release/dataset_release_partition/dataset_content/archive_activity_day | 从主线设计删除；若环境曾私下落表，先备份/确认依赖再退役，不直接DROP不明资产 |

新旧条目记录数、身份去重数、关系数、时间未知数、每用户个人资产清单、失败转换数必须对账。报告放output/，不提交实际用户数据。

## 3. R1：薄内核与数据闭环

**用户结果：** 受邀用户能登录，创建/读取来源，一页采集或一批推流进入内容库并可下载；不依赖项目、归档或旧runtime。

- Fastify5/TypeBox/openapi/auth hook与五模块最小边界；access复用已有身份规则，登录/邀请/会话列入精确公开例外。
- 保留既有ContentProvider，优先迁移Arctic Shift；修长ID、确定性版本/缺字段、四组集合SQL、同事务投影/discovery/observation/checkpoint。
- 实现标准push、现有job幂等回执/源绑定key；已有pool/事务函数直接用，禁止为切换另造Repository或InMemory。
- 内容列表/详情同filter函数，NULL游标、单投影索引；去逐页coverage COUNT。加入流式CSV/JSON，不再累积2k条数组。
- Web交付登录→来源→内容→下载薄闭环，错误/无权限/空/部分状态同步完成。

**出口断言：** 真实PG16 + HTTP验证长ID、页内重复、逆序到达、同观测时刻evidenceKey平局、null字段、删除防复活、整页回滚/旧租约拒绝；push鉴权/越界/413/同key重放和不同payload409；有/无发布时间跨页不漏不重；列表不额外COUNT。新增层不导入旧runtime/插件。

## 4. R2：项目化产品与来源闭环

**用户结果：** 创建监测→查看概览→钻取原文→批注/保存查询→下载，在一个连续上下文完成；agent用同HTTP完成。

- 只加两张项目表；创建复用/关联来源不触发网络，项目filter和召回target分离。共享来源修改提示影响。
- GROUPING SETS概览、同范围钻取/对比、单平台互动兼容判定；删除按platform/provider循环contentStats，批注读改JOIN。
- 把已有Reddit/X/Bluesky有效能力迁到新边界；接精选NewsNow getter与通用feed/受控RSSHub。只按实际授权请求，不把类型/fixture通过当真实接通。
- my research只留保存查询、收藏/批注；agent能力发现/schema、key生成/撤销、错误nextAction与Web操作对齐。
- Web只保留五导航；覆盖源失败/304/样本partial、revision冲突、未知时间和导出断开；无顶层数据集/冻结页。

**出口断言：** 一条真实PG HTTP E2E证明项目创建到文件终结；相同resolvedFilter在概览/列表/导出ID集一致；source多重发现不放大总数，provider分布明确重叠；跨平台engagement422而单平台可用；viewer个人资产隔离/key来源越权阻断；1440/768/390真实渲染和键盘任务流通过。

每个计划上线的provider至少一条真实有界采集链：目标/授权→稳定身份/时点→重复写入→API/UI/文件。缺X key或受控feed服务时该来源仍为未验收，须用户明确接受功能缺口才能发布，不能宣布PRD-02全部完成。

## 5. R3：实删、单机发布与性能证据

**用户结果：** 远端单服务器按简单方式持续运行；重启、请求故障与数据恢复可解释，不再加载废弃代码。

### 实删矩阵

| 删除对象 | 替代 / 删除前必须证明 |
| --- | --- |
| src/domain/repositories/*、src/storage/repositories/in-memory/* | 命名SQL/真实PG E2E；现有in-memory目录14个TS文件全部退出主线，不新建InMemory类填坑 |
| 当前巨型create-api-server及新主线不需要的service pass-through | 五模块routes/sql，api只装配/start；不把原3600行换名搬家 |
| createPostgresPhase1Runtime、旧runtime-factory、重复scheduler/worker | 单应用有界scheduler/PG租约；冷启动不触达旧runtime |
| 旧Phase1/heat/growth、旧搜索/coverage热路径及仅服务其的jobs/read models | 新content/project SQL；先迁好账户/内容/研究，不为旧热度算法保留依赖 |
| ResearchExportService/Repository、InMemoryResearchExport、冻结API/UI、research_export/member | 每owner旧资产已交付文件/确认；新工作区与流式下载验收通过 |
| dataset/release/importer目标骨架、顶层数据集入口 | 外挂仅标准HTTP推流；没有不存在的“兼容导入模式” |
| 旧前端markets/board/run/queries等Phase1路由 | 五页连续流程；个人旧查询完成转换后才删 |
| 配套旧专用tests/scripts/fixtures/文档入口 | 删除仅覆盖已删功能的用例；保留可复用的纯函数/权限/边界断言，必要时改写到新E2E |
| 废弃依赖与systemd默认部署材料 | Compose最小发布链；旧配置只保留离线迁出包/历史记录，不长期维护双部署 |

不要先整体删除src/connectors、全部测试、已应用SQL或历史数据；按引用图和资产归属逐路径处理。审查的“50k/35k行”只是基线估算，不设以删断言、压行或排除业务文件换通过的硬指标。

### 维护窗口切换

1. 在隔离副本完成迁移、回填、资产对账和恢复演练，构建不可变镜像；确认域名/TLS/容量/保留策略。
2. 经授权停止旧采集/写入口，做可恢复备份；执行新迁移及最终个人资产迁出/核对。
3. 新版本在维护模式完成账户、列表、项目、一次推流/采集和流式文件smoke；检查来源/租约/投影后才开放写入。
4. 失败时恢复匹配的数据库快照和旧构建；破坏性迁移后不能仅回滚镜像。开放新写入后回退需另行处理新增数据，不能覆盖。
5. 保留备份/离线旧资产直到确认；不承诺单机Compose零停机，不未经授权自动上线。

### 安全和性能门槛

必须用实际检查证明SAFE-01–06：公网无PG端口、精确代理/Origin/登录限流、scope越权、超时后连接归还、退出不截断提交；仅三个必需应用secret的首次空库引导可用。

用架构第4节负载测cold/warm P95、页SQL次数、并发调度、GIN计划、JOIN无放大、背压导出内存/断开清理。指标不达标先定位索引/扫描/往返/分配，不用降低阈值或引入缓存平台掩盖。现有量不足100万时记录夹具规模，不能宣称完成容量验收。

**出口：** 旧runtime/imports/仓储镜像/冻结端点/归档依赖为0；新关键契约断言全部通过；真实provider与生产部署验证分别记录。未做部署时R3部署部分仍未完成。

## 6. R4：独立归档外挂（后续授权）

主线完成后再按实际材料决定是否启动。未来`plugins/zst-archive/`可在独立Python环境流式解析.zst、DuckDB/Parquet做中间层、选出与项目相关的有限内容，再分批推送ING-01。主线不加依赖/表/路由。

- .zst单次顺序解压，不保证任意压缩偏移恢复；DuckDB扫描Parquet的谓词裁剪不能倒推为原始.zst可跳读。
- 续传、补月、本地release/manifest都属于外挂内部；不恢复主线七表或server COPY/staging importer。
- 分类器是外挂可选研究：fastText是训练流程，不是假装存在的通用预训练finance/music/tech主题模型。必须核对具体模型许可/标签/语言，并用独立标注集测precision/recall；不达标保留用户关键词，不用AI标签扩大主线范围。
- 先有限夹具验证拒绝行、完整性、稳定ID/时间/evidenceKey、checkpoint/相同key重放；实际全档/容量要等文件清单/资源/权限，不把旧74GB描述当当前已验证材料。

**出口：** 外挂只用HTTPS且无生产DB凭证；安装/失败/卸载不影响核心镜像/测试/迁移；推入内容可在同项目搜索/批注/导出，不冒充全档统计覆盖。

## 7. 最小验证组合

- 纯函数单测：ID/URL、filter、Unicode/LIKE转义、版本比较、CSV安全等有真实输入域的规则。
- 一套真实PG16+HTTP E2E：权限、事务/租约、重放、查询/概览/文件闭环；不InMemory双跑，不启动付费网络。
- 少量真实provider与浏览器任务smoke；安全/性能/部署检查按上文风险补充，不为每层重复建测试套。
- 结果区分离线、真实来源、部署、全档。运行命令与实际状态回填[development](../development.md)和[status](../status.md)原段落，不添加第二套交接文档。
