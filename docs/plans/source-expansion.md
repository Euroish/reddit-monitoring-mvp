# R1–R4 主线重建与物理实删计划

状态：尚未实施。目标定义见[产品与架构](../README.md)、[主线架构规范](../architecture.md)、[数据与 API 契约](../contracts.md)、[产品交互规范](../design.md)，问题溯源与 SQL 蓝图对照[唯一母本 Master Spec](../research/architecture_audit_and_rebuild_spec.md)，供应商清理坐标见[来源替换规格](../research/source_replacement_and_twitterapi_io_removal_spec.md)。`R1–R3` 仅实施远端在线主线，`R4` 历史外挂独立演进且不阻塞主线交付。

## 1. 切换与减法原则

| ID | 等级 | 切换边界与安全约束 | 验收出口 |
| --- | --- | --- | --- |
| PLAN-01 | MUST | 允许大刀阔斧删除旧业务表、接口与页面，但**严禁连带丢失账户、来源观测证据与用户个人研究资产**；任何删除前须完成盘点、备份或迁出交付，危险生产库变更须获用户显式授权。 | 资产对账报告 |
| PLAN-02 | MUST | 新内核入口（Fastify 5）必须能够**零加载旧 `Phase1` 运行时独立启动**；开发期严格使用隔离测试库，严禁新旧两套调度器或 writer 并行写入同一生产库；暂存旧入口仅作迁移对照，R3 必须彻底物理实删，绝不维护永久兼容双链。 | 冷启动与依赖树检查 |
| PLAN-03 | MUST | 按真实端到端用户任务切片纵向交付（每个里程碑打通后端 $\to$ HTTP $\to$ Web 最小闭环），严禁先堆几个月仓储/空壳服务最后才拼前端；Web 与 Agent 始终共享唯一 TypeBox Schema、权限与过滤编译函数。 | 纵向 E2E 闭环 |
| PLAN-04 | MUST | 全系统数据库仅允许新增 **`monitor_project`** 与 **`monitor_project_source`** 两张新表（外键指向 `collection_source(id) ON DELETE CASCADE`）；其余状态通过新增向前迁移扩展既有表，严禁篡改已应用 `001..040` SQL；7 张归档表既不在主线建立也不作空表占位。 | 迁移顺序与外键校验 |

## 2. 既有资产盘点与最小迁移矩阵

| 对象 | 实施动作与不可变保护条件 |
| :--- | :--- |
| `app_user` / `password` / `app_session` / `invite` / `audit` | 保留既有用户 ID、口令哈希与角色体系；扩展 `app_session`（`client_kind`、`label`、`scopes`、`allowed_source_ids`），不新建通用 Token 表。 |
| `source`、`collection_source`、`source_collection_job` | 保留平台注册与来源/任务证据；扩展 `collection_source`（`delivery_mode`、`primary_provider`、`fallback_provider`/`fallback_source_id`、`http_etag`、`http_last_modified`）与 `source_collection_job`（`operation`、`request_key`、`request_json`、`provider`、`provider_state`、`parent_job_id`、`fallback_of_job_id`；复用推流回执 `purpose='ingest'`、`ingest_key`、`payload_hash`、`result_summary` 时**必须显式执行 `ALTER TABLE source_collection_job ALTER COLUMN from_at/to_at/page_size/max_pages DROP NOT NULL`** 并改造按 `purpose='collect'` 生效的条件约束与活动任务唯一索引）。 |
| `content`、`content_discovery`、`content_observation` | 保留规范身份 `(platform, kind, externalId)` 与关系时间；`content` 补 `content_evidence_key`、`content_version_fetched_at` 及 `(created_at_source DESC NULLS LAST, id DESC)` keyset 索引（+ `reply_to`/`thread_root` 树索引）；`content_observation` 唯一键纳入 `provider` 防主备同键冲突；旧行回填不伪造上游观测时间。 |
| `public_content_search_document` | 通过新迁移改为单列 `search_text` + `title_length`（PG `char_length`）+ `GIN gin_trgm_ops`，先全量回填并核对完整性再卸载 `038` 失效 `DELETE` 触发器与旧双索引读取路径。 |
| `monitor_project`、`monitor_project_source` | R2 迁移新建（仅此两张新表），保存项目 `filter JSONB`、`hydration JSONB`、`revision` 与 `collection_source(id) ON DELETE CASCADE` 关联；不复制正文内容。 |
| `content_saved_query`、`content_annotation` | 保留 `user_id` 归属隔离、乐观锁 `revision`、收藏与批注；针对历史查询失效字段做显式转换并生成不支持项报告。 |
| `research_export` / `member` 及引用文件 | R3 退役前按原 `owner` 清单核对行数、导出可验证可读的 CSV/JSON 档案并确认交付后，再删除服务、表、成员及后端路由，绝不静默并入公共库。 |
| `saved_workbench_view`、`keyword_query_session` 等旧资产 | 可等价转换的个人查询迁入 `content_saved_query`；不可等价转换的导出离线包及转换报告等待确认，绝不塞进新库通用 JSON 垃圾表。 |
| `dataset*` / `import_batch` / `archive_activity_day` 7 表 | 从主线彻底删除；若特定旧环境曾私下创建，先备份核实依赖再受控退役。 |

新旧数据总条数、身份去重数、发现/观测数、未知发布时间条数、分用户个人资产清单一律输出核对报告至 `output/`（严禁提交至 Git）。

## 3. R1：薄内核重构与数据写读闭环（迁移 `041_core_and_provider_retirement.sql`）

**用户可感知目标**：受邀用户在全新独立启动的 Fastify 5 主链上登录 $\to$ 管理或连接来源 $\to$ 完成一次解封后 `kaix` 在线发现或标准 `POST /v1/sources/:id/ingest` 推流（含主帖与附属评论混合树） $\to$ 检索列表并流式下载 CSV/JSON（尚不依赖监测项目或旧 Phase 1 运行时）。

1. **新内核骨架与安全边界**：搭建 Fastify 5 + `@fastify/type-provider-typebox` + `@fastify/swagger` + `@fastify/rate-limit` 五模块入口；实施全局 Default-Deny Auth Hook（精确公开例外）、Cookie 同源写保护、扩展 `app_session` 机器 Key、`GET /v1/capabilities` 与 `GET /v1/openapi.json`、`pg.Pool (max=10, statement_timeout=10s)` 与 `SIGTERM` 15s 优雅退出。
2. **数据层 `041+` 核心迁移与混合集合写**：执行核心表字段扩展、单全文投影回填与触发器清理，按照[开发说明：来源退役顺序](../development.md#来源退役顺序)平滑取消可安全终结任务、软归档 `arctic_shift` / `twitterapi_io` 来源并强制禁用其预算、`defaultProviderBudget` 移除 `"arctic_shift"` 免费列表回退。
3. **混合批 `commitContentBatch` 与 `kaix` 解封**：实现 4 组 `UNNEST` 集合写与 `DAT-04` 确定性版本比较（移除 `item.kind === source.contentKind` 锁死校验）；解除 `kaix`（build `0.2.25`）对 `ArcticShift` 的指标导入、`includeComments=false`、`maxItems<=100`、`mode="post"` 丢主帖与客户端 `literal()` 布尔误杀 4 项封印，落实 `starting -> running -> reading -> committed` 异步 `runId`/`datasetId` 持久化恢复与 2,000 条/16 MiB 在线批上限。
4. **标准推流、双分支分页与流式导出**：实现 `POST /v1/sources/:id/ingest` 与 `source_collection_job` 幂等回执；实现 `compileContentFilter`、`QRY-05` 基于 `created_at_source` 的 NULL 游标双分支 seek 与单列 LIKE-GIN 搜索（取消每页全库 `coverage COUNT`）；实现 `REPEATABLE READ` + `SET LOCAL 35s` + `X-Accel-Buffering: no` + 断连中止游标流式导出（彻底取代旧 2,000 条数组导出）。
5. **代码解耦与薄前端闭环**：清理旧 `Arctic Shift` 与 `TwitterAPI.io` 在线连接器及环境注册，并将 ~29 个公共测试夹具重构为独立合成 `StubContentConnector`（同步将 `twitterapi-io-content-pipeline.test.ts` 迁为 `x-content-pipeline.test.ts` 保留零退化断言）；Web 同步交付“登录 $\to$ 来源 $\to$ 内容 $\to$ 流式下载”最小闭环。

**R1 出口门禁**：真实 PG 16 + HTTP 证明 13+ 位长 ID、页内重复混合树、逆序到达、同 `sourceObservedAt` 下 `evidenceKey` 决胜、空字段保持、删后防复活、`source->job->content` 锁序回滚、旧租约拒写、异步 Apify `runId` 断点续读、`unknown` 状态防再发、推流鉴权/`413`/同 key 重放 `200` 与异体 `409`、跨 NULL 边界分页零漏重、列表零额外 `COUNT`、流式断流终止与 `x-content-pipeline.test.ts` 通过；新 `src/modules/` 严格通过 `npm run lint` AST 检查。

## 4. R2：项目化三阶漏斗、评论树交互与多源双备闭环（迁移 `042_monitor_projects.sql`）

**用户可感知目标**：通过“**创建三段词监测项目 $\to$ 精准带评 / 宽泛发现 $\to$ 确定性信号筛选 $\to$ 批量水合评论树 $\to$ 联动阅读父链上下文与三视图 $\to$ 保存查询/批注并同口径导出**”完成真实研究，外部 Agent 使用机器 Key 走通同等全流程。

1. **项目表迁移与工作区**：新建 `monitor_project` 与 `monitor_project_source`（外键 `collection_source(id) ON DELETE CASCADE`）；项目 CRUD 单事务复用或新建禁用调度来源；`projects` 实现单 SQL `GROUPING SETS` + `COUNT(DISTINCT anchor)` 概览（彻底删除 `platform/provider` 循环 `contentStats`）及单平台 `422` 兼容校验对比；`workspace` 的 `listAnnotations` 改为单条 `JOIN content`（零 `1+N`）。
2. **三阶漏斗与三视图评论树**：落地 `anyTerms` / `allTerms` / `exclusions` 与 `discussion` / `pain` / `growing` 确定性门控；落地 `threadAware` 联动映射、有界自动派生 `hydrate`（父 `job` 快照与冷却检查）及 `GET /v1/content/:id/thread?view=top|matches|op`（50 选中 / 200 总节点 / 32 跳环检测）。
3. **多源双备落地与受控采样**：接通 Reddit 备源 **`red_crawler/reddit-search-v2` + `reddit-scrape-v2`**，接通 X 主源 **`TwitterAPIs`**（`$0.0008/call`、禁止 `/tweet/thread`、防空页死循环）与独立备源/批量 ID 补全 **`ScrapeBadger`**（`GET /v1/twitter/tweets/`、`X-Credits-Used` 请求诊断、单跳切备），接通 **精选 `NewsNow` MIT getter**（canonical URL + UTC 5 分钟桶 `evidenceKey`）与 **通用 `feed`（管理员白名单 SSRF 防护 + `ETag`/`304`）**，保留 Bluesky 现有能力。
4. **干净五页前端与 Agent 开放对齐**：收敛至“项目 / 内容库 / 来源 / 我的研究 / 设置”五导航（全面清理旧原型与说明墙），完整落地联动卡片、三视图抽屉、批量补全按钮、共享来源影响提示、`unknown` 收费保护与“我的研究”工作区。

**R2 出口门禁**：一条真实 PG 16 + HTTP E2E 跑通项目创建到流式文件终结；同一 `resolvedFilter` 在概览、列表与导出间锚点 ID 集严格一致；多发现来源重叠时 `byDiscoveryProvider` 正确重叠而不放大 `contentCount`；跨平台互动对比返回 `422` 而单平台放行；`viewer` 隔离与机器 Key 越权（枚举其他 `contentId` 返回 `404` / 碰个人工作区返回 `403`）通过；浏览器在 `1440×900`、`768×1024`、`390×844` 走通全键盘任务流；各拟上线新 `provider` 均留存一份有界真实请求 + 账单诊断 + 入库报告至 `output/`（欠缺密钥或受控 feed 的渠道明示“未验收”，绝不擅自宣称 PRD-02 全员完成）。

## 5. R3：物理实删旧架构、性能安全证明与单机 Compose 切换

**用户可感知目标**：远端单服务器跑在精简干净的 Compose 三服务架构上，旧代码与冗余测试清零，安全基线、恢复演练与目标基准有真实报告支撑。

### 物理实删总矩阵

基于 `main@7045185`（**457 源码文件 / ~73,534 LOC $\to$ ~62 核心文件 / ~7,250 LOC**，约削减 **90%**：`apps/api/src` 5,120→~450 LOC `-91%`、`src/` 27,236→~3,000 LOC `-89%`、`apps/web/src` 6,508→~2,000 LOC `-69%`、`scripts/+workers/` 10,624→~600 LOC `-94%`、`tests/` 24,046→~1,200 LOC `-95%`）的逐路径淘汰清单：

| 待删除遗留对象 | 替代或删除前必须具备的保护门禁 |
| :--- | :--- |
| `src/connectors/x/twitterapi-io*`、`arctic-shift-content.connector.ts`、旧 env/CI 键与相关废弃单测 | R1/R2 新双源与 `x-content-pipeline.test.ts` 验证通过；DB 通过向前迁移完成历史来源软归档与零额度禁用，绝不物理删除历史观测行 |
| `src/domain/repositories/*`（除 `ContentProvider`）与 `src/storage/repositories/in-memory/*`（14 文件） | 5 模块命名 SQL 与真实 PG HTTP E2E 全量接管；严禁私造新 `InMemory` 替代品 |
| `apps/api/src/create-api-server.ts`（3,606 行）、`readyz-observability.ts` 及冗余 pass-through `service` | Fastify 5 `app.ts` + 五模块 `routes/sql` 接管；禁止只是把原巨型文件换目录改名拆分 |
| `createPostgresPhase1Runtime`、旧 `runtime-factory`、独立 worker 与双调度器、`opossum`、旧 `rate-limiter-flexible` | 单应用进程内有界调度与 `@fastify/rate-limit` 接管，冷启动零引入旧 `runtime` |
| 旧 Phase1 / Markets / Trends / Heat / Growth、旧 `coverage` 与旧前端 16+ 个废弃路由页 | 5 导航新前端与旧个人查询等价转换交付完成 |
| `ResearchExportService` / 仓储 / 冻结 API / 冻结 UI、`research_export` / `member` 表 | **按原 `owner` 完成历史冻结资产文件导出、校验与交付确认** |
| 旧 `dataset/release/importer` 残留骨架与配套过时单测、假 mock 测试 | 确认纯函数单测 + PG HTTP E2E 已完整覆盖权限/幂等/口径断言后清理 |
| 旧默认 `deploy/*.service` 启动链（保留迁移对照归档直至切换结束） | Docker Compose 三服务完成验证 |

### 维护窗口切换与验收
1. **隔离预演**：在独立副本库完成全部向前迁移、单全文列回填与对账、冻结资产导出校验与 `pg_restore` 恢复演练，构建不可变 `app` 镜像并确认公网域名与 TLS 证书就绪；
2. **停写切换**：按授权暂停旧采集、确认无 `unknown` 未决收费任务并执行最后一份全库物理备份；执行新迁移与最终个人资产核对；
3. **验证开放**：维护模式启动新版执行 `healthz` / `readyz`、账户、项目、一次推流/采集与流式导出 smoke 后放行公网写流量；如遇阻塞须恢复匹配快照与旧镜像（开放新写入后不可粗暴覆盖回滚）。
4. **安全与代表负载测试**：实测并归档 [SAFE-01–06](../architecture.md#6-远端单机公网安全与稳定运行基线) 全部门禁与第 4 节负载（若当时生产数据未及 100 万，诚实标注夹具规模，不用降低门槛或加缓存掩盖真实瓶颈）。

## 6. R4：独立归档外挂扩展（后续按需授权启动）

仅在在线主线稳定运行后按需单独授权启动 `plugins/zst-archive/`（完全独立 Python / DuckDB 环境、依赖与测试，不碰主线数据库、镜像与 CI）：
- `.zst` 单遍流式顺序解压（不假定任意压缩偏移跳读恢复）$\to$ 写出自索引精简核心列 Parquet（建议约定核心列 `id, subreddit_lower, subreddit, author, title, selftext, created_utc, retrieved_on, score, num_comments, upvote_ratio, url`，按 **`ORDER BY subreddit_lower, created_utc`** 聚簇、`ROW_GROUP_SIZE 100000`、`COMPRESSION ZSTD` 与按需实测 Bloom Filter）；
- 续传清单、拒绝行统计、本地分类器研究（如有，须独立核对训练集/许可/准确率，不将标签冒充全网范围）均属外挂内部职责，绝不在未完成行数、时间与备份核对前删除原始 `.zst` 档案；
- 最终仅将命中项目需求的小批筛选记录规范为 `NormalizedContentItem[]`（带真实 `timeBasis` 与 `Idempotency-Key`）经 `POST /v1/sources/:id/ingest` 推流进入主线。

## 7. 最小高价值验证组合

- **纯函数单测**：ID/URL 归一化、词组与三段过滤、LIKE 转义、版本比较元组、信号阈值、CSV 公式防注入；
- **唯一真实 PG 16 + HTTP E2E 套件**：RBAC/来源越权隔离、锁序与租约、异步付费 `unknown` 停发与幂等推流 `409`、13 位评论树混合写、NULL 双分支分页、`GROUPING SETS` 与联动钻取一致性、断连游标取消；
- **浏览器任务流与受控来源检查**：1440/768/390 无鼠标全键盘主流程 + 分来源有界真实请求验收报告；所有命令与实测记录回填至[开发说明](../development.md)与[状态](../status.md)原段落，不另起第二套交接文档。
