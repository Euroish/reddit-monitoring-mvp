# R1–R4 主线重建与实删计划

状态：尚未实施。目标见[产品](../README.md)、[架构](../architecture.md)、[契约](../contracts.md)、[交互](../design.md)；[Master Spec](../research/architecture_audit_and_rebuild_spec.md)为母本，以下切片落实其五项决定。R1–R3只做在线主线，R4外挂不阻塞它们。

## 1. 切换原则

- PLAN-01：允许删业务表/API/页面；不能顺带丢账户、来源证据或个人研究资产。先盘点备份/迁出，再删；危险生产操作另需用户授权。
- PLAN-02：新入口必须能不加载旧Phase1 runtime独立启动；开发用隔离测试库，不让两个writer并行写生产。暂存旧代码仅用于对照/切换，R3必须实删，不长期双链兼容。
- PLAN-03：每阶段是一条可用的前后端任务链，不按“先全部仓储、再所有服务、最后UI”堆模块。UI和HTTP共享相同schema/权限/过滤。
- PLAN-04：只有monitor_project与monitor_project_source两张新表；新增列/索引/约束有明确owner，已应用迁移不可改。七张归档表若根本不存在就不造再删，实库以盘点结果为准。

## 2. 资产盘点与最小表变更

| 对象 | 实施动作 / 保护条件 |
| --- | --- |
| app_user/password/session/invite/audit | 保留ID、口令/会话摘要与角色边界；app_session增加机器key类型/权限/来源范围/label，不另建token表 |
| source、collection_source、source_collection_job | 保留身份/任务证据；加deliveryMode/条件请求/单跳fallback，以及operation参数快照、request_key、provider_state、派生/切备job引用与push回执；修改purpose/window/active-job约束，不增任务表 |
| content/discovery/observation | 保留身份/关系/时间；加接受版本evidenceKey、versionFetchedAt与明确正文状态；旧数据回填不伪造观测 |
| public_content_search_document | 新增迁移为单search_text/title_length，回填并校验完整性，再删除038失效触发器/旧字段/旧读逻辑 |
| monitor_project、monitor_project_source | R1仅新增这两表；项目filter/revision/有界hydration配置与来源关联，不复制内容、不建signal/tree表 |
| content_saved_query、content_annotation | 保留userId归属、revision、收藏/笔记；显式转换废弃查询字段并报告不支持的条件 |
| research_export/member及引用文件 | 先按原owner列清单/校验数量、导出CSV/JSON文件并验证可读与授权交付；确认完成后删除服务/表/成员，不静默并入公共资产 |
| saved_workbench_view、keyword_query_session等旧资产 | 可转换的个人查询迁入content_saved_query；不可等价转换的保留离线文件/转换报告待确认，不塞进新库通用JSON表 |
| dataset/import_batch/dataset_partition_revision/dataset_release/dataset_release_partition/dataset_content/archive_activity_day | 从主线设计删除；若环境曾私下落表，先备份/确认依赖再退役，不直接DROP不明资产 |

新旧条目记录数、身份去重数、关系数、时间未知数、每用户个人资产清单、失败转换数必须对账。报告放output/，不提交实际用户数据。

## 3. R1：薄内核与数据闭环

**用户结果：** 受邀用户能登录，创建/读取来源，一页采集或一批推流进入内容库并可下载；不依赖项目、归档或旧runtime。

- Fastify5/TypeBox、鉴权capabilities/OpenAPI、机器scope key与五模块；迁移两张项目表和现有表字段，R2再交付项目UI。
- 以kaix为首条数据闭环：带评论参数、批量postUrls保留根帖、移除布尔query误杀、树字段白名单；同任务混合post/comment，以row.type规范身份，不继续修Arctic Shift在线adapter。
- 内容版本/缺字段/删除、四组集合SQL、同事务投影/发现/所有独立观测/checkpoint；改radar水位为“已执行窗口”而非全量证明。
- 实现push回执、collect同key复用、源绑定key及外部操作阶段/runId持久化；65s kaix等待与未知收费阻断。已有pool/事务函数直接用，不另造Repository/InMemory。
- 内容列表/详情同filter函数，NULL游标、单投影索引；去逐页coverage COUNT。加入流式CSV/JSON，不再累积2k条数组。
- Web交付登录→来源→内容→下载薄闭环，错误/无权限/空/部分状态同步完成。

**出口断言：** 真实PG16+HTTP证明13/32位通用ID、同事务主帖+多层评论+独立观测、乱序父子/缺父标识、版本平局/null/删除防复活、整批失败/旧租约回滚；原生OR搜词不被字面复筛丢掉，hydrate不按旧时间丢根帖。push与collect幂等/越界/413/409、capabilities/schema/key撤销均验证；65s例外及未知收费任务普通Retry/新key/新job不二次启动Actor；NULL分页不漏重，列表无COUNT。新入口不加载旧runtime/Arctic Shift/外挂。

## 4. R2：项目化产品与来源闭环

**用户结果：** 创建词组项目→增量发现→信号筛选→按需补评论→主帖/命中父链研判→批注/下载；agent用同HTTP完成。

- 使用R1两表交付项目；anyTerms/allTerms/exclusions与固定signal分支，项目/页面各组独立求交，filter与上游原生query分离，不造规则DSL。
- threadAware候选→anchor→GROUPING SETS概览/钻取/比较/导出同口径；批注改JOIN。评论命中反查根帖、缺根降级、上下文不计命中。
- React五页交付信号chips、主帖+评论卡片、Top/命中父链/OP三视图、手动批量补全及可选有界自动策略；不新开漏斗/任务平台。
- Reddit接red_crawler备源，X接TwitterAPIs主源并真实验证TwitterAPI.io备源/上下文；NewsNow精选getter和feed/受控RSSHub接通，Bluesky保留不扩。ScrapeBadger/Xquik是有具体缺口再选的候选，不同时实现所有供应商。
- 单跳备源配置/源归属/一次派生job；capability、预算、key范围和普通Web动作一致；my research只留查询/批注/文件。

**出口断言：** 一套真实PG HTTP E2E贯穿词组→巡检→门控→批量hydrate→三视图→文件终结。主帖未含词但评论含词、多命中同根、旧根新评论、缺父/无OP标记、32跳边界都有明确结果；同threadAware/scope的概览/列表/文件anchor一致；同根跨日/跨证据类型各自去重，日期/类型钻取ID集一致，日值不可相加。多来源发现/父链不抬高分母，provider分组可重叠。二次发酵不跨provider/缺观测补0，跨平台互动422；主备空结果/partial不误切、未知收费不切、真实故障仅切一次且不越key来源；viewer个人资产隔离、GET零外部调用、capabilities/OpenAPI与实际动作一致。1440/768/390和键盘走完整流程。

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
| arctic-shift-content.connector.ts、专用单测、注册/配置/旧脚本与直接依赖 | R1新入口已不注册；提取kaix共享metric规则，旧来源停调度/保留证据标识，历史读取不依赖provider仍注册；R3实删所有可执行引用，不恢复在线回退 |
| ResearchExportService/Repository、InMemoryResearchExport、冻结API/UI、research_export/member | 每owner旧资产已交付文件/确认；新工作区与流式下载验收通过 |
| dataset/release/importer目标骨架、顶层数据集入口 | 外挂仅标准HTTP推流；没有不存在的“兼容导入模式” |
| 旧前端markets/board/run/queries等Phase1路由 | 五页连续流程；个人旧查询完成转换后才删 |
| 配套旧专用tests/scripts/fixtures/文档入口 | 删除仅覆盖已删功能的用例；保留可复用的纯函数/权限/边界断言，必要时改写到新E2E |
| 废弃依赖与systemd默认部署材料 | Compose最小发布链；旧配置只保留离线迁出包/历史记录，不长期维护双部署 |

不要先整体删除src/connectors、全部测试、已应用SQL或历史数据；按引用图和资产归属逐路径处理。审查的“50k/35k行”只是基线估算，不设以删断言、压行或排除业务文件换通过的硬指标。

### 维护窗口切换

1. 在隔离副本完成迁移、回填、资产对账和恢复演练，构建不可变镜像；确认域名/TLS/容量/保留策略。
2. 经授权停止旧采集/写入口，备份；旧未结束任务先清点/取消或归档，未决收费查明，不盲目当新任务恢复。再执行迁移及最终个人资产迁出/核对。
3. 新版本在维护模式完成账户、列表、项目、一次推流/采集和流式文件smoke；检查来源/租约/投影后才开放写入。
4. 失败时恢复匹配的数据库快照和旧构建；破坏性迁移后不能仅回滚镜像。开放新写入后回退需另行处理新增数据，不能覆盖。
5. 保留备份/离线旧资产直到确认；不承诺单机Compose零停机，不未经授权自动上线。

### 安全和性能门槛

必须用实际检查证明SAFE-01–06：公网无PG端口、精确代理/Origin/登录限流、scope越权、超时后连接归还、退出不截断提交；仅三个必需应用secret的首次空库引导可用。

用架构第4节负载测cold/warm P95、混合批2000条/16MiB上限、页SQL次数、并发调度、GIN/父链查询计划、JOIN无放大、背压导出/断开清理；不是只跑100条平铺帖子。指标不达标先定位索引/扫描/往返/分配，不用降低阈值或引入缓存平台掩盖。现有量不足100万时记录夹具规模，不能宣称完成容量验收。

**出口：** 旧runtime/仓储镜像/冻结端点/Arctic Shift在线注册及可执行依赖为0（历史provider证据不删除）；归档仍与主线隔离；新关键契约断言全部通过；真实provider与生产部署验证分别记录。未做部署时R3部署部分仍未完成。

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
