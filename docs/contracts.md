# 数据与API契约

本文件定义目标行为。字段类型、默认值和请求示例在实施时由共享TypeBox schema生成；本文只规定语义与不可变条件。

## 1. 领域与身份

| 名称 | 唯一含义 |
| --- | --- |
| Platform | 原内容平台；现有source表是平台注册表，content.source_id指向它 |
| Provider | 实际获取渠道，例如kaix、TwitterAPIs |
| CollectionSource | 逻辑监测目标；API的sourceId始终指collection_source.id |
| Project | 关联逻辑来源与本地过滤，不复制内容 |
| Content | 平台内独立内容，身份为(platform,kind,externalId) |
| Discovery | 内容被哪个逻辑来源发现 |
| Observation | 某逻辑来源经某provider取得的一份不可变证据 |

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| SRC-01 | MUST | pull来源身份为platform + seedKind + 规范target，push来源另含客户端namespace；provider不参与逻辑身份。deliveryMode创建后不变，kind由每条真实记录决定。 | PG/HTTP |
| SRC-02 | MUST | collection_source保存primaryProvider与可选fallbackProvider；任务固定实际provider，观测记录实际provider，项目/key只授权逻辑来源。现有provider字段迁为主渠道语义。 | 主备闭环 |
| SRC-03 | MUST | 主备目标/operation兼容才可切一次；明确失败或限流可切，空结果/partial/未知收费结果不切。备源不独立定时轮询，不级联。 | provider夹具 |
| DATA-01 | MUST | ID始终为字符串；Reddit本体为2–32位ASCII base36、小写，post/comment分别带t3_/t1_。X回复仍为post。web优先canonical URL，否则feed namespace+GUID。 | 纯函数 |
| DATA-02 | MUST | publishedAt、sourceObservedAt、fetchedAt分别记录发布、上游观测、本系统获取；未知为null，不相互冒充。 | PG/HTTP |
| DATA-03 | MUST | 正文按下述版本元组决胜；省略/null不清空已知字段，明确删除清正文/投影，旧版本不得复活删除。独立发现/观测不因正文落后被丢弃。 | PG |
| DATA-04 | MUST | 观测身份为(contentId,collectionSourceId,provider,evidenceKey)；同键同证据重放不新增/不更新历史，冲突报错。 | 重放/PG |
| DATA-05 | MUST | evidenceKey使用稳定operation/run身份与规范记录摘要，排除本次读取时钟；同dataset重读沿用已保存fetchedAt。新观测必须有新的证据身份。 | dataset重读 |
| DATA-06 | MUST | 同批可含根帖/评论/父链；校验平台、operation支持的kind与引用，禁止item.kind==source.contentKind。缺父可存真实引用，已知跨根/环整批拒绝。 | 混合批/PG |

正文版本字典序为`(sourceObservedAt IS NOT NULL, COALESCE(sourceObservedAt, versionFetchedAt), evidenceKey)`，键用C字节排序；新增content_evidence_key/content_version_fetched_at。last_seen_at仅记最近发现，不参与决胜。同身份/版本的已知字段冲突拒绝该批。

Reddit保留reply_to、thread_root及depth/isSubmitter/collapsed/collapsedReasonCode，未知为null。NewsNow条目按canonical URL去重，rank只表示名次；快照键使用boardId+externalId+任务固定UTC五分钟桶，不以重试时刻重建。

provider过滤与指标读取使用同一逻辑来源的实际观测，不能从当前primaryProvider推断历史渠道。discovery仅标发现关系，其最近渠道不替代观测历史。

## 2. 任务、恢复与推流

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| JOB-01 | MUST | radar发现候选，hydrate按根帖列表补上下文，ingest接外部规范内容；复用source_collection_job，不增加任务平台。 | HTTP |
| JOB-02 | MUST | 同逻辑来源一次执行；短事务按source→job→content身份排序锁定，校验租约/取消状态，内容与checkpoint/回执原子提交。 | 并发/PG |
| JOB-03 | MUST | 外部创建前持久化starting；收到runId/datasetId立即保存，未完成则轮询已知run，不重新创建。创建结果未知则标unknown，停止自动重发/切备。 | 故障恢复 |
| JOB-04 | MUST | collect/ingest使用Idempotency-Key；同来源+key+规范payload复用结果，不同payload409；回执至少7天。 | 重放/并发 |
| JOB-05 | MUST | cursor绑定provider/目标/窗口；无cursor始终partial。incrementalTo只表示已执行窗口，可重叠回看，触顶标gap，失败不推进，不递归二分抓全量。 | provider夹具 |
| JOB-06 | MUST | 自动补全使用已授权项目策略，每次radar至多派生一个hydrate；请求快照/parentJobId/选择结果保存在原job，重启可补建且不重复。 | 重启/PG |

收费阶段为`starting → running → reading → committed`，异常分为已确认失败与unknown。已知run读取可恢复；普通Retry、新key或新job不能绕过同来源未决收费状态。查明后显式确认可能再次收费才可新建操作。一次人工授权可持续执行正常巡检，不逐次弹确认。

Apify使用异步创建后轮询，而不是同步等待结束就认定任务失败。单次网络读取默认15s；Apify等待兼容上限65s，任务等待由持久状态控制，不长期占连接/租约。非收费临时读取最多3次有界尝试；上游HTTP GET也可能收费。

| operation | 请求语义 | 初始预设 |
| --- | --- | --- |
| radar | from/to、maxItems/maxPages、includeComments、maxCommentsPerPost、commentSort/time/sort | 精准词带Top15；宽泛词100–300根、先不带评论 |
| hydrate | rootExternalIds、maxCommentsPerPost、commentSort、projectId/revision | 10–30根或单根，每根50条 |
| ingest | NormalizedContentItem[]、来源绑定key | 1–100项/1MiB；title≤4KiB、text≤64KiB |

maxItems是主目标数，不是混合dataset总行数。在线接受批初始2000条/16MiB，按根帖×(1+评论上限)预留，不用maxItems+2截断；超限调用前422。无限抓取的0值禁止。hydrate目标来自可见根帖、可见评论的root引用或已配置post目标；不再按发现日期/关键词删根帖。上游原生布尔query不做整段literal复筛。

自动策略初始关闭；启用即持续授权，初始10%/最多30根/每帖50/top/冷却6h，选择本平台过门控根帖，按讨论数、发布时间、ID排序。入队/领取检查revision、冷却、来源权限与预算；手选不受百分比限制。

备源任务复用同一sourceId，固定实际provider与fallbackOfJobId；不复用另一provider的cursor。调度按provider spacing运行，空队列有界等待，不加固定逐页睡眠。

推流由服务端绑定platform/provider/sourceId/fetchedAt，客户端仅提交身份、正文/状态、发布时间、引用/白名单平台字段与观测。任一项无效整批400/413，暂停或错误交付类型409；成功首次201、重放200。回执保存原job，不加入pull领取队列。304只更新lastCheckedAt，不生成新观测。

## 3. 查询、信号与讨论

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| QUERY-01 | MUST | 唯一compileContentFilter(scope,filter)编译参数化条件；候选范围=actor来源∩项目来源∩项目filter∩页面filter。来源/provider/delivery在同一来源关系中求交。 | 权限/PG |
| QUERY-02 | MUST | 同一证据节点满足query AND anyTerms任一 AND allTerms全部 AND NOT exclusions任一；空组为true，项目/页面各组分别AND，不扁平合并OR。 | 纯函数 |
| QUERY-03 | MUST | 日期为UTC [from,to)，有日期窗则未知不匹配；timeStatus=unknown要求清除日期。 | 纯函数/HTTP |
| QUERY-04 | MUST | 列表仅limit+1、keyset，不额外COUNT；cursor绑定filter/scope/revision/排序，变更409并回第一页。 | PG/HTTP |
| QUERY-05 | MUST | threadAware先匹配可见证据再提升至可见根帖；列表/文件按anchor去重，父链仅上下文，不计新命中。 | 联动闭环 |
| QUERY-06 | MUST | 概览与钻取共用证据→anchor映射，各分组COUNT DISTINCT anchor；日桶/证据类型/provider可重叠，不能相加作期间总数。 | ID集核对 |
| QUERY-07 | MUST | 互动/增长只在同平台、provider、指标、时间口径比较；缺观测不补0，前期为0的增长率为null。 | PG/HTTP |

规范化采用NFKC、小写、空白归一与LIKE字面转义。query≤200字符，anyTerms/allTerms各≤20项、exclusions≤10项、每词≤100字符；短语不跨标题/正文。上游target只决定召回，项目filter修改只重查已有内容。

项目默认threadAware=true、deliveryMode=pull；全局内容库默认逐内容/两种交付方式。选择push趋势须显式回显。threadAware是呈现选项，不放宽数据条件。

| 信号 | 固定判定 |
| --- | --- |
| discussion | Reddit评论≥10 / X回复≥5，可改minReplies |
| pain | 痛点词命中；或Reddit评论≥max(score,1)且≥minReplies，score必须已知 |
| growing | 同source/provider/metric/timeBasis两次独立观测，间隔与差值达到显式阈值 |

数值信号读取可见根帖观测，文本痛点可来自评论。缺根不伪算数值；未知上游时间只可按同渠道fetchedAt比较快照并标时间依据，不跨主备拼增长。

联动结果为`{content,thread:{rootId,contextMissing,matchedAt,matchedEvidence}}`。父链可不命中页面filter，但必须满足actor/项目来源授权；缺根用原节点作anchor并标未归并。contentCount数anchor，matchedContentCount数证据节点；byKind表示命中证据类型。

matchedAt取最新命中节点真实publishedAt作排序；daily按每个命中节点UTC日各自去重anchor，日期/类型钻取ID集必须一致。根帖发布时间不改。排序`time DESC NULLS LAST,id DESC`；非空cursor续取更早时间、同时间更小ID及null，null cursor只续取null且ID更小的行。不用first_seen_at补值。

评论树`view=top|matches|op`只读已存节点；Top按平台内score/likes，matches与op附必要父链，未知楼主标记不当false。默认50个选中节点、含父链总预算200、最多32跳/检测环；不足标partial，分页不触发收费补全。列表摘录与文件证据有明确截断标记。

## 4. HTTP与授权

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| API-01 | MUST | GET只读库，不启动外部采集；capabilities/OpenAPI鉴权且反映当前实际能力与剩余额度。operationId稳定。 | HTTP |
| API-02 | MUST | 浏览器使用Cookie、机器使用Bearer；机器key扩展app_session，只存摘要，绑定签发人当前角色/scope/逻辑来源/期限，撤销即时生效。 | 权限/PG |
| API-03 | MUST | 默认拒绝，仅healthz、登录、本人会话探测和持邀请码注册为精确例外；Cookie写操作校验Origin，SQL参数化，秘密不进响应/日志。 | HTTP |

机器scope为read、projects:write、sources:write、collect、ingest、export；无个人空间/账户管理。ingest key必须绑定非空逻辑来源；通用agent可显式授全部来源。详情/树/统计/导出均受同一授权，不凭UUID越权；主备不增加第二份来源授权。viewer仅可写自己的查询/批注，owner/admin管理共享配置。外部正文不是操作指令。

| 资源 | 目标HTTP操作 |
| --- | --- |
| 访问/发现 | /v1/auth/login,session,logout,register；/v1/access-tokens；/v1/capabilities；/v1/openapi.json |
| 项目 | GET/POST /v1/projects；GET/PATCH/DELETE /:id；PUT /:id/sources；GET /:id/overview、/:id/content |
| 比较 | POST /v1/project-comparisons，只读 |
| 来源 | GET/POST /v1/sources；GET/PATCH /:id；POST /:id/pause、resume、archive、collect、ingest |
| 任务 | GET /v1/source-jobs及/:id；POST /:id/cancel、retry、continue |
| 内容 | GET /v1/content、/:id、/:id/thread、/export |
| 个人/管理 | /v1/content-saved-queries、/v1/content-annotations；/v1/source-ops、provider配额 |

表中逗号为独立路径简写。项目创建/来源集合更新在一个事务中，配置带expectedRevision，409重读；变更target创建新逻辑来源，切provider不改sourceId。删除项目不删来源/内容。比较统一两侧threadAware，互动不兼容422。

响应带requestId、queryFingerprint、resolvedFilter、projectRevision、timeAxis、asOf、coverage；resolvedFilter保留project/request/options三部分。错误为`{error:{code,message,requestId,details,retryable,nextAction}}`；nextAction仅白名单动作，资源ID放details。结构400、无权403/不可见404、冲突409、过大413、不兼容422、限流429、未就绪/超时503。

## 5. 文件导出

| 编号 | 等级 | 规则 | 验收 |
| --- | --- | --- | --- |
| EXPORT-01 | MUST | 同filter/scope的只读RR事务与server cursor流式输出；默认10000/上限50000行、全应用一条流、总时限30s，禁止累积全数组/预COUNT。 | PG/断连 |
| EXPORT-02 | MUST | 导出连接SET LOCAL独立idle预算35s，单次SQL仍10s；HTTP总时限优先，断连取消/关cursor/回滚/归还连接。代理关闭缓冲或返回X-Accel-Buffering:no。 | 代理/背压 |
| EXPORT-03 | MUST | JSON/CSV都有终结标记、exportedCount/truncated/nextCursor；断流不写成功终结。CSV转义/防公式注入，ID按文本。 | HTTP/文件 |

联动每行是一个anchor，附最多20个命中节点和必要父链，总节点≤200；超限标evidenceTruncated。续段是新快照，不承诺多段联合冻结；服务器不存冻结文件。更多树节点可经只读分页另存。
