# 主线数据与操作契约

目标契约；未实施接口见[状态](status.md)。实现时以共享 TypeBox schema 为唯一结构真源，本文定义不能由 schema 单独表达的语义。Web、agent 和外挂遵守同一规则。

## 1. 身份与观测

| 名称 | 含义 |
| --- | --- |
| platform / provider | 原内容平台 / 获取渠道；不互相替代 |
| collection source | 平台、provider、kind、规范target的采集流；deliveryMode为pull或push |
| content | `(platform,kind,externalId)` 唯一；externalId始终string |
| discovery | 内容被某采集流发现的关系，不是一份新内容 |
| observation | provider对该内容的一次证据/指标快照 |
| project | 已关联来源 + 库内filter，不是租户、数据库副本或离线数据集 |

- DAT-01：Reddit规范t3_/t1_，X保留字符串ID。Reddit ID本体支持2–32位ASCII base36，统一小写，不能转number。平台/kind由服务端来源绑定。
- DAT-02：web优先canonical publisher URL；仅移除已知跟踪参数，不删除语义query。不具备可靠URL时用feed namespace + GUID；相似标题不得强合并。
- DAT-03：NewsNow条目用canonical URL作为web/article身份；provider/board是发现证据，不进内容唯一键。`web.rank`为名次不是互动，evidenceKey为sha256(boardId + ':' + externalId + ':' + snapshotBucket)，bucket为UTC五分钟。任务开始时固定bucket，重试复用；同bucket保留首次快照，不用后续缓存覆盖。不得无条件把所有web内容都算新闻原文或把综述拆成多篇原帖。

### DAT-04：接受正文的确定性版本

新增既有content表字段 `content_evidence_key TEXT NOT NULL`、`content_version_fetched_at TIMESTAMPTZ NOT NULL`；维护已有content_observed_at。按下列元组字典序较大者胜出，evidenceKey使用确定性字节排序（C collation）：

```text
(sourceObservedAt IS NOT NULL,
 COALESCE(sourceObservedAt, versionFetchedAt),
 evidenceKey)
```

versionFetchedAt只在接受正文版本时更新；first_seen_at/last_seen_at独立记录接收范围，不能参与已接受版本的比较。相同观测时刻仅由evidenceKey决胜，不能让重试取回时刻改变已知观测排序。

- 较新available版本中的省略/null表示未知，用COALESCE保留已知title/body；空字符串是明确的空正文。不要用默认空字符串消灭字段缺失信息。
- 较新deleted/removed必须清除受影响正文和投影；落后available输入不能以“补空字段”为由恢复已删除正文。
- 平局/落后输入仍可增加独立discovery/observation、更新last_seen_at，但不改正文版本。页内重复身份先按相同规则选正文胜者，独立observation全部保留；不能最后一个数组元素任意胜出或丢掉其他观测；同身份/同版本的已知字段互相冲突时拒绝该批，不任意选一项。
- 投影从最终接受的正文生成，不信任客户端search_text；所有写路径共用此规则。旧行回填使用可追溯已有证据/时间，无法证明时使用固定legacy证据键并报告，不伪造上游观测。

| ID | 时间/幂等规则 |
| --- | --- |
| DAT-05 | publishedAt为发布时间，sourceObservedAt为上游真实观测，fetchedAt为本系统取回/接收。未知为null；缓存时间/feed构建时间/接收时间不得冒充前两者。 |
| DAT-06 | `(contentId,collectionSourceId,evidenceKey)`幂等；同键重放不新增观测，指标证据不可原地改写；如证据内容冲突则报409或adapter明确生成新键，不能默默更新metrics。 |
| DAT-07 | 互动必须指定单平台metricKey、provider和观测timeBasis，缺失不补0。导入的归档合并字段按其真实字段时点标注，未知时不伪造完整单时点快照。 |
| DAT-08 | 默认按publishedAt分析，未知时间单列；榜单详情另标capturedAt，不与发布时间趋势合并。正文标记full/summary/missing/truncated，详情/导出一致。 |

## 2. 在线任务与推流

### COL-01–07：共享采集规则

| ID | 契约 |
| --- | --- |
| COL-01 | pull请求明确target、`[from,to)`、pageSize/maxPages、截止时间和调用上限；provider声明targets/cursor/history/metricKeys/replayPolicy。push来源不加入调度。 |
| COL-02 | 一个来源一个执行者；source→job统一锁顺序，内容/投影/发现/观测/checkpoint同事务，旧租约/取消任务不提交。 |
| COL-03 | nextCheckpoint只允许真实可续游标，绑定来源/窗口/排序；达到cap保留可续状态，不猜lastItem时间作cursor。 |
| COL-04 | 无cursor快照可exhausted=true但coverage=partial；任务结束不等于全量覆盖，也不推进“已完整取完”的水位。 |
| COL-05 | 限流/临时错误最多3次有界启动尝试，跨重启保存；收费结果未知时停止自动重放，人工Retry可能再收费。 |
| COL-06 | 调用预算/spacing拒绝不是已发请求；请求单位不等于账单。启用来源/提高上限需显式确认。 |
| COL-07 | ETag/Last-Modified按来源保存并条件请求；304不生成新内容/互动观测，只更新lastCheckedAt。实际观测/最近发布与检查成功分开。 |

### ING-01：标准入口

`POST /v1/sources/:id/ingest` 接收 `NormalizedContentItem[]`，不接ZIP、Parquet、文件路径、dataset/release或离线汇总。必须有匹配来源的`ingest`权限及`Idempotency-Key`头。push来源由管理员创建，provider为`external_ingest`，target仅含稳定客户端命名空间；不实现假fetchPage，不要求开全局外网开关。

```text
NormalizedContentItem = {
  externalId: string, kind: ContentKind,
  title?: string|null, text?: string|null, url?: string|null,
  publishedAt: UTC|null, availability: available|deleted|removed|unknown,
  textState: full|summary|missing|truncated, originalTextBytes?: integer,
  author?: object|null, language?: string|null, media?: bounded array,
  references?: bounded array, provenance?: bounded object,
  observation: {
    sourceObservedAt: UTC|null, evidenceKey: string,
    timeBasis: archive_initial|archive_refresh|provider_snapshot|unknown,
    maturity: initial|refreshed|unknown,
    metrics: Record<namespacedMetric, finite number|null>
  }
}
```

平台/provider/sourceId/fetchedAt/内部UUID由服务器赋值；kind必须等于来源kind，指标只能使用该平台声明的键。来源身份不可通过请求体改写；ingest接收的时间声明是外部客户端证据，不提升为服务器认证的上游事实。默认每批1–100项、解码body≤1MiB、title≤4KiB UTF8、text≤64KiB UTF8；其他数组/字段长度在共享schema中有界。超长正文客户端明确截断并带原长度/策略元数据，主线不静默截断。provenance只允许上游标识/文件摘要/变换说明等限定字段，不是任意JSON发布协议；同观测内metrics必须共享所声明时点/口径，不同字段时点用多项独立证据或保留unknown，不能强合并。

### ING-02：原子性、回执和重试

- 全批先校验，任一项无效整批400，details包含item index/field；大小超限413，不接受“前N项成功”。暂停/归档/pull来源拒绝新批409；权限仍有效的相同已提交请求可读取原回执。
- source_collection_job复用为短生命周期推流回执：扩展purpose=ingest、ingest_key、payload_hash、result_summary；此purpose允许区间/页大小字段为null，不占pull活动任务索引/领取队列；不新增import/job表，不设置虚假区间/cursor。
- 锁来源后检查`(sourceId,ingest_key)`唯一键；首次在同一事务提交内容和成功回执。失败全回滚；并发相同key只有一批生效。同key不同规范payload报409。
- hash针对规范化后、按身份/版本稳定排序的客户端语义字段，不包含服务端接收时间。回执至少保留7天；过期后不承诺相同请求回执，但内容/观测幂等仍成立。
- 首次成功201，重放200；返回`{data:{receiptId,received,inserted,updated,unchanged,observationsInserted,replayed},meta}`。inserted+updated+unchanged按批内去重身份计数，received是原始项数；不能把每次last_seen更新计为正文更新。
- 网络断开/结果未知后，客户端使用**相同key与payload**重试；不能换key冒充新批次。429遵守Retry-After，413缩小批次，409先查冲突；普通写请求不由UI无限重试。

receiptId/响应计数保存在现有job中；`GET /v1/source-jobs/:id`可查回执。外挂版本/原文件摘要可放限定长度的证据元数据，仅作来源线索，主线不执行其发布逻辑。

## 3. 过滤、排序、概览与对比

ContentFilter允许platforms、kinds、sourceIds、providers、deliveryModes、from/to、timeStatus、author、language、query、searchMode、searchScope、exclusions，以及同平台metricKey/min/max。query≤200字符、排除词最多10项、limit默认25最大100；数组用重复URL参数，时间ISO UTC。未知字段400；无datasetId、任意SQL/查询DSL。

| ID | 规则 |
| --- | --- |
| QRY-01 | 有效范围=actor允许来源∩项目已关联来源∩项目filter∩页面filter；actor/project/source/provider/delivery约束在同一个来源EXISTS内求交，内容去重；不能用分别匹配不同来源的EXISTS绕过限制。全局内容库没有项目交集，页面不能覆盖掉项目/actor限制。 |
| QRY-02 | NFKC/Unicode小写/空白规范；literal/phrase为连续字面，terms为空白词AND；`%`/`_`/反斜杠按字面。searchScope为title/text/title_text，短语不跨标题/正文边界。 |
| QRY-03 | 上游query决定召回，本地filter只查已存；项目关键词修改不会自动改变共享来源target或追补过去召回。 |
| QRY-04 | UTC、`[from,to)`；有日期条件时未知时间不匹配。timeStatus=unknown要求无from/to，否则422；UI切到“时间未知”时明确清除日期。unknownTimeCount仅针对同一有效范围，日期过滤排除未知时显示说明，不谎称库里无未知项。 |
| QRY-05 | `publishedAt DESC NULLS LAST,id DESC`；cursor非null时间时续取`published<t OR (published=t AND id<id0) OR published IS NULL`；cursor为null时仅`published IS NULL AND id<id0`。配套B-tree索引，不COALESCE first_seen_at。 |
| QRY-06 | cursor带version、规范filter/scope指纹、排序、projectRevision、位置，签名或严格编码校验；范围/revision改变返回409 cursor_scope_changed，客户端回第一页。实时分页不是固定快照。 |
| QRY-07 | 比较在同一已存内容模型上计算，无aggregate/evidence/release模式。engagement要求两侧有效platforms同为一个平台，metricKey/provider/timeBasis兼容，否则422；内容量可跨平台并列，provider数不可相加。 |

项目初始deliveryModes默认pull；创建流程选择仅push来源时显式设置push并显示“导入材料”。添加push来源时用户选择是否纳入项目趋势；全局内容库默认两类都可查，列表显示来源类型。所有默认值解析后在meta/filter回显，不靠隐藏前端状态。

projectId是可选查询上下文，不是可绕过项目约束的filter字段；全局export带相同projectId即可保持项目范围。V1排序仅published_desc；metricKey用于过滤/比较，不能暗中改为无已定义cursor的互动排序。

标准列表 `{items,nextCursor,meta}` 不强求COUNT；nextCursor由limit+1决定，totalMatching未知为null。分析 `{data,meta}`。公共meta包含`requestId,queryFingerprint,resolvedFilter,projectRevision?,timeAxis,asOf,coverage:{status,limitations},unknownTimeExcluded`。asOf是生成时刻，不是历史版本。

概览data：`contentCount,unknownTimeCount,daily[{date,count}],byPlatform,byKind,byDiscoveryProvider,sources`。只有GROUPING位为实际日维度的null桶代表未知时间，不能把grand total的null字段当未知桶。provider与source状态受相同actor/project来源范围约束；来源过滤后的facet不重新扩大到整个项目。

### 项目最小操作

```text
Project = {id,name,description,filter,sourceIds,revision,createdAt,updatedAt}
CreateProject = {name,description?,filter?,sourceIds?,sources?,expectedRevision:0}
PatchProject = {name?,description?,filter?,expectedRevision}
SetProjectSources = {sourceIds,expectedRevision}
```

名称1–100字符、描述≤2000；sourceIds是已有来源，sources是至多10个待规范化的来源定义。创建在一笔事务中复用相同规范身份来源、创建缺少的禁用调度来源并关联项目；不静默改已存在来源配置，不触发外网。返回完整Project与新增/复用来源结果。

project写配置共用revision，整集合PUT原子替换；owner/admin可写，viewer可读。删除项目只删除关联，不删公共内容/共享来源；停止监测采用来源pause，必须提示受影响项目。

来源身份(platform/provider/kind/规范target/deliveryMode)不可原地替换，改变搜索目标创建新来源；label/schedule/限额等配置带revision更新。pull来源状态与是否启用定时分开：创建不启动网络，手动collect需显式确认；push来源没有假调度。

比较请求`{leftProjectId,rightProjectId,from,to,metricProfile,metricKey?,provider?,timeBasis?}`；响应左右scope/revision/数值与兼容的差值/增长率，0分母为null。不提供两项目边际汇总的去重并集承诺。

## 4. 权限、人类与机器操作

### SEC-01：身份与访问矩阵

| actor | 可读 | 可写 |
| --- | --- | --- |
| owner/admin session | 公共项目/内容/来源、自己个人资产、授权管理 | 项目/来源/任务、自己个人资产；owner保留最后owner保护 |
| viewer session | 公共项目/内容、来源只读状态、自己个人资产 | 仅自己保存查询/批注/下载 |
| machine API Key | 由scope和allowedSourceIds限定的公共读取 | 明确授予的project/source/collect/ingest/export；不能使用个人工作区或账户管理 |

API Key复用app_session，增加client_kind、label、scopes、allowed_source_ids；只存token_hash，绑定签发用户和到期时间（默认30天、最长90天），停用/降权/撤销即时生效。管理员在设置或`POST /v1/access-tokens`生成，原文只返回一次；GET列摘要，DELETE撤销。无需新增表或OAuth/MCP平台。

scope为`read,projects:write,sources:write,collect,ingest,export`。ingest模板仅授read+ingest且必须绑定非空sourceIds；显式管理员批准的通用agent key可使用null表示全部来源，UI须显示此权限，默认不授予。来源受限key的详情/计数/导出及附属观测也经同一来源范围；不因猜到content UUID而越权。它只能修改全部关联均在许可内的项目，不能通过整集合PUT删掉不可见关联；创建新来源需显式全来源权限。共享内容仍只有一份规范正文，不提供租户私有版本。scope不能突破签发人当前角色。

### SEC-02：公网与不可信输入

除`GET /healthz`、`POST /v1/auth/login`、`GET /v1/auth/session`（只返回本人或未登录）、持有效邀请的`POST /v1/auth/register`外默认拒绝；例外方法/路径精确注册并限流。邀请注册不开放自由注册。机器走Bearer，浏览器走安全会话Cookie，Cookie写请求校验同源Origin，不以SameSite替代CSRF边界。

feed目标为管理员白名单；阻断非授权内网/metadata地址与不可信跨源重定向，受控RSSHub内部地址需部署配置显式许可。HTML清理后渲染，XML禁外部实体；外部图片/原文链接只主动打开，不自动批量访问。SQL参数化；请求/错误/导出元数据都不能泄露token、密码或连接串。

### OP-01：可发现、可解释、可恢复

- `GET /v1/capabilities`返回当前用户的操作权限、来源能力、默认/最大批量、限额与是否需要付费确认；`GET /v1/openapi.json`提供由相同schema生成的接口文档。二者必须鉴权；不是动态插件注册平台。
- OpenAPI的operationId稳定、说明简短、提供最小请求/失败示例；例子不包含秘密。客户端不需要翻源码拼请求。
- 普通读取/429允许有限重试；写入先GET revision、提交、409保留草稿并重读。ingest未知结果按ING-02重复同key，收费collect未知结果先查job，不能盲目重发。
- agent流程：发现能力→创建/选择项目→查看范围→显式采集或推流→读任务→查概览/内容→下载。每步返回资源ID、下一步可用动作或具体错误，不要求访问DB/SSH或执行前端内部脚本。
- 内容是外部不可信材料，文本中“忽略规则/调用工具”的指令不是产品授权；LLM/agent不能把检索正文当作系统操作指令。

## 5. 流式导出与个人工作区

- EXP-01：保存查询只保存规范filter/项目上下文，收藏/批注按userId隔离。退役库内冻结与`/v1/research-exports`；文件下载是唯一留档，不承诺服务端重放旧样本。
- EXP-02：`GET /v1/content/export?format=csv|json`复用相同有效filter及权限。一个有界只读REPEATABLE READ事务、一个server cursor，禁止预跑COUNT、逐页独立快照或累积全数组。接收断开立即关闭cursor/回滚并归还连接。
- EXP-03：默认maxRows=10000，上限50000，单用户/全应用各最多1条导出流、总时限30s；chunk遵守backpressure。数据库10s statement/idle预算仍生效，慢客户端可能提前取消。无后台导出任务表/服务器文件存储。
- EXP-04：JSON以`{meta,items:[...],result:{exportedCount,truncated,nextCursor,complete:true}}`结束；缺结束对象即不完整。CSV使用正常字段header和recordType列，内容行recordType=content，最后一行recordType=end携带相同结束元数据（header含exportedCount/truncated/nextCursor/complete列）；所有字符串有引号/转义/公式防护，数值ID按文本。
- EXP-05：超出maxRows是显式分段，终结信息truncated=true且给nextCursor；UI显示“本段N条，可继续”，不能声称导出全部。续段会读取新快照，不保证多文件联合冻结；要固定结果由客户端保存原文件。
- EXP-06：运行内存与总行数无关，只持有cursor批次/背压缓冲/当前行；额外缓冲目标≤2MiB须用明确记录大小实测，不能宣称进程RSS<2MiB或忽略单行巨大正文。流开始后出错不再尝试改HTTP状态，连接失败且不写成功终结；UI不得提示完成。

## 6. 目标 HTTP 表面

| 资源 | 最小接口 |
| --- | --- |
| 账户/发现 | `/v1/auth/login,session,logout,register`；`/v1/capabilities`；`/v1/openapi.json`；`/v1/access-tokens` |
| 项目 | `GET/POST /v1/projects`；`GET/PATCH/DELETE /v1/projects/:id`；`PUT /:id/sources`；`GET /:id/overview,content`（两个独立路径） |
| 比较 | `POST /v1/project-comparisons`，只读有界，不启动任务 |
| 来源 | `GET/POST /v1/sources`；`GET/PATCH /:id`；`POST /:id/pause,resume,archive,collect`（独立路径） |
| 推流/任务 | `POST /v1/sources/:id/ingest`；`GET /v1/source-jobs`及`/:id`；`POST /:id/cancel,retry,continue` |
| 内容/导出 | `GET /v1/content`、`/:id`、`/export` |
| 个人 | `/v1/content-saved-queries`、`/v1/content-annotations`及单资源更新/删除，所属session限定 |
| 运维 | `/v1/source-ops`、provider限额、现有必要账户/审计能力，管理员权限 |

表中逗号是能力缩写，不是字面URL；正式schema必须注册每个method/path。当前旧`/auth/*`仅在搬迁时替换，不要求维护双接口。未实施的功能不挂空endpoint冒充可用。

错误统一`{error:{code,message,requestId,details?,retryable,nextAction?}}`；nextAction是白名单动作/资源引用，不是可执行任意URL/脚本。400结构错，401未登录，403无权，404不可见，409revision/幂等/cursor冲突，413超限，422过滤/指标不兼容，429限流附Retry-After，503索引/数据库未就绪或查询超时。不存在release_expired错误或隐藏的archive模式。

旧IMP-01–07主线包协议停用；其离线研究仅保留在Git历史及[来源研究](research/data-sources.md#5-归档研究降为独立外挂)，不再要求主线实现。
