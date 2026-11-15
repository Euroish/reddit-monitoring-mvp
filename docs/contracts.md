# 数据与接口契约

状态：重建目标契约，不是当前 API 清单。当前可运行接口见[开发说明](development.md)。本文规定跨模块含义；实施时将其落实为 `packages/contracts` 中的 schema，不再维护另一套字段手册。

## 1. 术语与身份

| 名称 | 含义 / 例子 |
| --- | --- |
| platform | 原始内容所在平台：reddit、x、web；不是供应商 |
| provider | 获取渠道：arctic_shift、twitterapi_io、newsnow、rsshub |
| collection source | platform + provider + kind + 规范 target 的采集流；关联调度与 checkpoint |
| content | 平台原生身份确定的内容，不因多个 provider 获取而增加 |
| discovery | 某采集流发现某内容的关系，不是一次互动快照 |
| observation | 某 provider 对同内容的独立证据/指标观测 |
| dataset | 有范围和覆盖政策的历史数据集，不是监测项目 |
| batch / revision / release | 一次导入包 / 不可变分区产物 / 对外可见的完整分区组合 |
| project | 采集流/数据集关联与库内过滤规则，不是租户或另一份正文库 |

- DAT-01：内容唯一键 MUST 是 `(platform, kind, externalId)`。externalId 始终 string；Reddit 保留 t3_/t1_ 规范身份，X 不转 JS number。
- DAT-02：web 优先使用能跨渠道确认的规范发布者 URL；只去已知跟踪参数，不删有语义的 query。不具备可靠 URL 时使用 feed namespace + GUID。不能按相似标题强合并，也不能只因 provider 不同复制同一已确认原文。
- DAT-03：新闻转载/综述与原帖是不同内容；provider、原发布者、原文链接、聚合链各自保存。无可靠身份的榜单条目只保留快照证据或跳过并计数，不能造稳定 ID。正文区分 full/summary/missing/truncated。

## 2. 正文、时间与观测

最小规范内容：`id, platform, kind, externalId, title, text, url, author, language, publishedAt, availability, textState, references, media`。允许缺失的外部字段为 null，不用空字符串或零伪造事实。

观测：`contentId, collectionSourceId, provider, evidenceKey, sourceObservedAt, fetchedAt, timeBasis, metrics`；指标键使用平台命名空间，真实零与未知分开。榜单快照还可携带 `boardId, rank, snapshotKey`，不塞入 reddit.score/x.likes。

| ID | 约束 |
| --- | --- |
| DAT-04 | 同一内容正文更新 MUST 使用确定性的版本比较：已知 sourceObservedAt 优先于未知；两个已知取较新者；均未知时用 fetchedAt，平局用稳定 evidenceKey。只有更优版本才替换正文/投影；未知/省略字段不清空已知字段，明确删除状态可按版本生效。 |
| DAT-05 | publishedAt 是内容发布时刻；sourceObservedAt 是上游实际观测时刻；fetchedAt 是本系统取得数据的时刻。feed 构建时间、缓存响应时间、导入时间不能冒充前两者。 |
| DAT-06 | `(contentId, collectionSourceId, evidenceKey)` MUST 幂等。相同归档快照反复导入不新增互动；新渠道观测独立保留。 |
| DAT-07 | 图表选择哪条观测 MUST 明确 provider/指标/timeBasis；同一图不能逐行静默切换口径。归档中的第二次抓取时间只适用于其说明中已更新的字段，不将整个对象误称同一时刻快照。 |
| DAT-08 | 项目发布轴默认 publishedAt；缺失发布时间另列 unknownTimeCount。榜单可选择 capturedAt 轴，但必须明确是“采到榜单的时间”。 |

正文版本规则应复用/收敛已有写保护并进行对照；历史发布证据按 ARC-11 固定，不随规范 content 的后续更新而变。

## 3. 采集页与恢复

沿用现有 `CollectedPage` 的 `items, nextCheckpoint, exhausted, coverage, warning`，其中 exhausted 只表示本次遍历结束，coverage 描述实际召回范围；不能同义替换。

| ID | 契约 |
| --- | --- |
| COL-01 | 请求 MUST 有规范 target、`[from,to)`、pageSize、maxPages、截止时间与调用上限。provider 显式声明 targetKinds、cursor、history、metricKeys、observationModel、automaticRequestReplay。 |
| COL-02 | 一个来源同一时间只有一个写入执行者；任务领取短事务提交后才发网络请求。每页内容/投影/发现/观测/checkpoint MUST 原子提交；旧租约和取消任务不得提交。 |
| COL-03 | 可续页时 nextCheckpoint MUST 非 null，并绑定来源/窗口/排序。不能把 last item timestamp 猜成供应商 cursor。达到本地 cap 时保留可续状态。 |
| COL-04 | 无可续 cursor 的榜单/一次抽样 MAY 返回 exhausted=true、coverage=partial；MUST NOT 推进“完整覆盖”的高水位。不能返回 exhausted=false 却丢掉 checkpoint。 |
| COL-05 | 429/暂时网络错误按 Retry-After/退避有限重试；认证/结构错误暂停并等待修正。付费启动结果未知时记录 uncertain，禁止自动重发；人工重试明确可能重复收费。 |
| COL-06 | 调用/资源上限是运行保护，不是产品固定费用目标。限额拒绝不算已请求；真实计费由供应商账单确认。 |
| COL-07 | feed 可用 ETag/Last-Modified 条件请求；304 只更新检查状态，不生成新内容/新指标或证明发布时间变新。RSSHub/NewsNow 缓存命中单独呈现。 |

provider 的每个新字段只在外部边界验证一次；页事务验证身份/版本/幂等等业务不变量。禁止在 handler、service、repository 重复实现相同结构检查。

## 4. 项目过滤与分析范围

首版 `ContentFilter`：platforms、kinds、sourceIds、providers、datasetIds、published range、author、language、query、searchMode、searchScope、exclusions；指标过滤必须指定同平台 metricKey。具体数量上限沿当前有界契约实施，不新增任意逻辑表达式或 SQL。

- QRY-01：项目范围 = 已关联来源或历史数据集的内容并集 ∩ 当前项目 filter ∩ 页面 filter。来源/discovery 用 EXISTS；同一身份只计一次。来源 provider 计数可能重叠，不得相加作内容总数。
- QRY-02：query 默认 literal；phrase 为连续字面匹配；terms 为规范空白分词 AND。统一 NFKC、Unicode 小写、空白规范；`%`/`_` 不作 SQL 通配符。排除词应用相同规则。
- QRY-03：上游 query 决定召回；ContentFilter 只查已存范围。改项目关键词不自动重扫历史、不回溯获得之前未采集数据。
- QRY-04：时间统一 UTC，窗口 `[from,to)`；日期图默认 UTC，改变时区须进查询指纹。发布时间缺失不自动进入时间窗统计。
- QRY-05：默认 `publishedAt DESC NULLS LAST, id DESC`，null 分支的 cursor 顺序必须显式定义。cursor 绑定规范 filter、排序、scope/release；改变过滤须回第一页。实时 keyset 不提供快照隔离，内容更新时可变化；固定研究另走冻结。
- QRY-06：历史 `mode=aggregate` 只允许已发布事实具备的维度；`mode=evidence` 只检索保留文本。不支持的全文/标签/维度组合返回 422，而非忽略 filter 或用精选样本改算宏观数量。
- QRY-07：在线/归档按数据模式分面；只有保留明细在声明范围内完整且能按身份去重时，才允许统一内容去重读取。不能从两份边际汇总还原去重并集。

目标分析响应的公共元数据：

```text
meta = {
  queryFingerprint, projectRevision?, mode,
  resolvedReleases: [{datasetId, releaseId}],
  timeAxis, range, metricProfile, asOf,
  coverage: {status, limitations, unknownTimeCount},
  evidence: {mode: retained_complete|curated_examples|none,
             matchedCount: number|null, retainedCount: number|null}
}
```

`asOf` 是读取/生成时刻，不表示实时数据被冻结。coverage status 使用 unknown/partial/complete；complete 只对声明的范围/处理能力成立。精确总数不可得时为 null，不能用 0。

首批历史指标：`content_count`（去重内容）、`known_time_count`、`unknown_time_count`、`availability_count`，按发布日/平台/社区/kind 的可用粒度。provider discovery 分布是发现数，不是互斥内容分布。比率需返回 numerator/denominator；独立作者、分位数和多标签并集不按日边际计数简单累加。

## 5. 归档生产与包协议

ARC-07 的离线生产线：原档清单 → 流式解压/解析 → 规范紧凑事实/质量统计/候选文本 → Parquet → 首批汇总与有限证据 → manifest。正常新文件只顺序解压一次；后续分析读取列式产物，不为每张图重新读原档。

- IMP-01：MUST 记录原文件摘要、原始/接受/拒绝/重复行数、来源/月份、producer/schema/rule 版本与完成状态。质量失败不能静默跳过后宣称 complete。
- IMP-02：普通 `.zst` 不保证任意压缩偏移可恢复。checkpoint 以已提交输出分片为准；中断 MAY 从文件/独立帧起点重读并跳过已提交记录，不宣传 O(1) 随机续读。
- IMP-03：CPU 为默认；内存/临时目录/输出大小有界。MUST NOT 全量 `read()`、全档解压落地后再复制多遍、按每个社区制造大量小文件。GPU/向量不是基础路径依赖。
- IMP-04：在线只导入可查询汇总和明确定义的证据语料。保留完整入选正文优先；若截断记录 originalLength/retainedLength/textHash/policy，并声明搜索仅覆盖保留部分。新项目需要未入选的历史主题时，显式从离线列式产物生成新包；缺少所需文本才决定重读原档或授权 API 补充，页面不自动付费回填。

目标包为目录 + manifest，不要求巨大 ZIP。示例只说明字段，不是当前可运行 CLI 或完整 JSON schema：

```json
{
  "schemaVersion": 1,
  "datasetKey": "reddit-history",
  "packageId": "immutable-package-id",
  "producerVersion": "producer-commit",
  "baseReleaseId": null,
  "ruleVersion": "rules-v1",
  "inputs": [{"key": "RS_YYYY-MM.zst", "sha256": "<64 hex>", "kind": "post"}],
  "partitions": [{
    "key": "YYYY-MM/post",
    "operation": "append",
    "revisionId": "immutable-partition-id",
    "replacesRevisionId": null,
    "range": {"from": "YYYY-MM-01T00:00:00Z", "to": "next-month-start"},
    "coverage": {"status": "partial", "reason": "declared-scope-only"},
    "evidenceMode": "curated_examples",
    "files": [{"path": "activity.parquet", "sha256": "<64 hex>", "rows": 0, "bytes": 0}]
  }]
}
```

schemaVersion 不支持、摘要/行数错误、路径越界、身份冲突、规则不兼容 MUST 拒绝发布；失败包不影响当前可见版本。摘要针对文件字节/规范清单，不对含自身摘要字段的 manifest 自我求 hash。

### 5.1 加载与发布

1. 在私有目录接收完整不可变包；校验相对路径、文件摘要、schema 和 producer 范围。
2. 登记 import_batch，以 datasetKey + packageId 幂等；同 ID 不同字节报冲突。分片 COPY 到不可见 staging，可重放已验证分片。
3. 校验唯一键、范围、统计总数与证据引用；建立所需索引并 ANALYZE；完成后登记不可变 revision。
4. `publish` 在短事务锁定 dataset，校验 expected/base release、所有必需产物与文件就绪，构造完整 release_partition 清单并更新 current_release_id。
5. 失败只清理未发布暂存；有引用的 revision/file 不删除。文件先就绪、数据库后引用；崩溃留下的孤立文件可按批次回收，不能留下已发布但文件不在的版本。

- IMP-05：append 只能新增逻辑分区；replace 必须指明旧 revision 并替换，不能增加一次计数。同包重放无额外数据；同分区异包不得隐式覆盖。
- IMP-06：乱序补月必须可用。比如先导入 9 月后补 4–8 月，新 release 复用未变的 9 月；跨月关系/基线若重算则显式替换依赖产物，未产出则能力不可用。
- IMP-07：分页、研究与导出 MUST 固定 resolvedRelease；旧版到期返回 410 release_expired，不静默换 current。宏观数据和证据都随版本固定。

不创建通用数据湖目录服务、任意视图 SQL 注册平台或完整历史语义分析框架。首个真实包证明上述契约后，再扩充分析族。

## 6. 目标 HTTP 表面

采用 `/v1` 目标路由，重建可替换旧契约。每条路径的 schema 在实施时定义；下表是必要能力，不是要求一次性铺设所有空 endpoint。

| 资源 | 目标接口 |
| --- | --- |
| 账户 | 复用当前会话/邀请/账户能力，保持角色与个人隔离 |
| 项目 | `GET/POST /v1/projects`；`GET/PATCH /v1/projects/:id`；`PUT /:id/sources`、`PUT /:id/datasets` |
| 项目分析 | `GET /v1/projects/:id/overview`、`GET /:id/content`；`POST /v1/project-comparisons` 为只读有界比较 |
| 内容 | `GET /v1/content`、`GET /v1/content/:id`；历史证据通过 dataset/release 上下文定位 |
| 来源/任务 | 复用并简化 `/v1/sources`、`/v1/source-jobs`、`/v1/source-ops` 生命周期能力 |
| 历史 | `GET /v1/datasets`、`GET /:id/releases`、`GET /:id/summary`、`GET /:id/content`；`GET /v1/import-batches` |
| 历史导入 | 首期管理员 CLI `validate → load → publish`；不开发浏览器大文件上传、远程任意路径读取接口 |
| 工作区 | 保存查询/注释沿用；`POST /v1/research-exports` 固定结果，查询/分页/下载沿当前资源模型收敛 |

### 6.1 项目最小 DTO 与操作

```text
Project = {
  id: UUID, name: string, description: string|null,
  filter: ContentFilter, sourceIds: UUID[], datasetIds: UUID[],
  revision: positive integer, createdAt: UTC, updatedAt: UTC
}
CreateProject = {name, description?, filter?, sourceIds?, datasetIds?, expectedRevision: 0}
PatchProject = {name?, description?, filter?, expectedRevision: positive integer}
SetProjectSources = {sourceIds: UUID[], expectedRevision: positive integer}
SetProjectDatasets = {datasetIds: UUID[], expectedRevision: positive integer}
```

名称去首尾空白后1–100字符，description 最多2000字符；默认空 filter/关联数组，sourceIds/datasetIds 去重并校验存在。POST 在一个事务建立项目及初始关联，返回201；PATCH/PUT 返回更新 Project，关联 PUT 为整集合替换。所有配置写入共用 project revision 并递增，revision 冲突时无部分更改。owner/admin 可修改共享项目；viewer 可读，个人工作区权限不变。source/dataset filter 不能越过项目关联扩大范围。

项目 content 接受 ContentFilter 的页面子集与 limit/cursor；overview 接受同一过滤但不含分页。URL 数组使用重复同名参数，时间为 ISO UTC，文本为正常 URL 编码；不开放嵌入 SQL/任意表达式。

概览 `data` 至少包含 `contentCount, unknownTimeCount, daily[{date,count}], byPlatform[{platform,count}], byDiscoveryProvider[{provider,count}], sources[{sourceId,state,lastCheckedAt,lastObservedAt,coverage}]`。byDiscoveryProvider 允许重叠，UI 明确标签；未接通来源时间为 null。历史 aggregate 模式只返回有对应事实的维度，其他维度列入 meta 的限制，不编造零分布。

比较请求为 `{leftProjectId,rightProjectId,from,to,mode,metricProfile}`；两边解析相同公共时间窗，响应 `{data:{left,right,comparison},meta}`，left/right 含各自 revision/scope。comparison 只有兼容指标才包含差值/增长率，不兼容返回422；跨平台内容量可以并列，互动只按同平台 profile。首版不承诺两项目交并差或跨汇总去重并集。

数据集列表至少返回 `id,key,platform,range,currentReleaseId,coverage,evidenceMode`；release 返回完整 partition revision 清单、规则版本和发布时间。summary/content 都先解析并返回 resolvedRelease，再执行分页；不能先读数据后补 current 版本号。

成功列表使用 `{items, nextCursor, meta}`，分析使用 `{data, meta}`。错误目标为 `{error:{code,message,requestId,details?}}`，不暴露 SQL/token/原始响应。旧错误封装只在搬迁端点时转换并删除，不保留永久多套 adapter。

| HTTP | 语义 |
| --- | --- |
| 400 | 结构/格式无效 |
| 401 / 403 | 未认证 / 权限不允许 |
| 404 | 资源不存在或按隔离策略不可见 |
| 409 | revision/当前 release 冲突；保留草稿后重新读取 |
| 410 | 钉住的 release/产物已按政策到期 |
| 413 | 请求或冻结样本超限；不得返回静默截断“成功” |
| 422 | 查询组合不支持、指标/数据口径不兼容 |
| 429 | 限流，按 Retry-After 处理 |
| 503 | 依赖/检索投影未就绪，不伪装成零命中 |

写配置必须携带 expectedRevision；创建值为 0，更新匹配当前版本。权限在 HTTP/公开用例边界检查，SQL 用资源所有权约束落实；不因复用 UI 而跳过权限。

## 7. 导出与权限

EXP-01：保存查询是会变的范围；研究快照固定成员、必要载荷、过滤指纹、数据 release 与口径。小型即时导出可沿当前 cursor 分段；大导出固定 scope 后后台生成并流式写文件，不在内存积累全量。

EXP-02：CSV/JSON MUST 包含同范围元数据、文本 ID、缺失/截断说明；CSV 公式防护保留。文件不得默认公开，下载重新鉴权；产物行数/字节/有效期可配置。现有 2,000 条即时导出、20,000 条/32MiB 冻结是当前上限，不自动推广为所有历史包的容量。

SEC-01：复用当前 owner/admin/viewer、可撤销会话、Origin/写请求保护、最后 owner 守卫和审计。machine 只执行明确授权的公共读取/采集，不取得个人研究空间；不借重构另造 token 平台。

SEC-02：外部 feed/媒体按不可信输入处理；禁止不受控 HTML 直接渲染、XML 外部实体、任意内网 URL 抓取与开放文件下载。首期 feed 路由/host 使用管理员白名单，避免为支持任意 URL 新造复杂爬虫沙箱。
