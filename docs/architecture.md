# 主线架构规范

目标设计；尚未实施。产品边界见[CORE-01–06](README.md#2-主线与外挂边界)，对外行为见[契约](contracts.md)。

## 1. 技术与拓扑

```text
人类 Web / agent / 外部推流客户端
             │ HTTPS
     Nginx（唯一公网入口，静态 Web）
             │
   Fastify 5 应用 + 进程内有界调度器
             │
      PostgreSQL 16（私网）

独立外挂 → 标准 HTTPS 推流口；无 DB 凭证、目录挂载或主线 import
```

| ID | 决定 |
| --- | --- |
| ARC-01 | TypeScript / Node24 稳定运行时、Fastify5、pg、PostgreSQL16；保留 React/Vite、Router、TanStack Query。精确版本在实施时锁定，禁止 alpha。 |
| ARC-02 | Compose 的 proxy/app/db 三服务是目标默认部署；app 一个进程同时承载 HTTP 与有界调度，共用一个 pg pool。当前 systemd 服务仅用于搬迁，不是第二套长期流程。 |
| ARC-03 | TypeBox 定义 API schema 并推导类型/生成 OpenAPI；同一边界只解析一次。数据库约束与纯规则负责一致性，不建立另一套 DTO/校验层。 |
| ARC-04 | 不引入 ORM、DI、Redis、BullMQ、Kafka、独立搜索/向量库或在线 Python。新依赖必须替代具体机制或解决测得的瓶颈。 |

RSSHub 是可选外部 provider 服务，不是三服务核心的启动依赖；白名单 NewsNow getter 只复用 MIT 获取/映射代码，不运行其 UI/数据库/任务系统。外挂独立环境、依赖与测试，不进入根 tsconfig、主线镜像、发布包或 CI 必需路径；本轮不生成插件空壳。

## 2. 五个模块与所有权

```text
apps/api/src/          app.ts（装配/hooks）、server.ts（启动/退出）
src/modules/
  access/              routes.ts + sql.ts；账户、会话/API Key、邀请、审计
  collection/          routes.ts + sql.ts + worker.ts；来源、任务、推流
  content/             routes.ts + sql.ts + search.ts；批量正文/投影/观测、过滤/导出
  projects/            routes.ts + sql.ts；项目/关联、概览/对比
  workspace/           routes.ts + sql.ts；个人查询/收藏/批注
src/connectors/        ContentProvider 多实现、外部响应解析
src/storage/          db.ts、事务助手、schema 迁移
packages/contracts/   TypeBox/schema 派生类型
```

| ID | 模块 | 独占写入的状态 |
| --- | --- | --- |
| MOD-01 | access | app_user/password/session/invite/audit；API Key 复用 app_session 的摘要/撤销机制并扩展字段，不新增 token 表 |
| MOD-02 | collection | source、collection_source、source_collection_job、provider预算/用量、worker心跳/现有dispatch状态 |
| MOD-03 | content | content、content_discovery、content_observation、public_content_search_document |
| MOD-04 | projects | monitor_project、monitor_project_source（仅此两张新表） |
| MOD-06 | workspace | content_saved_query、content_annotation；不持久化导出副本 |

- ARC-05：模块内部直接用接收 `Pool | PoolClient` 的命名 SQL 函数；事务写函数必须接收 PoolClient，不能误用 pool 再开事务。删除全部单实现 Repository、InMemory 仓储和 pass-through service。ContentProvider 是唯一采集多实现契约；DTO/type 不等于额外运行层。
- ARC-06：默认 routes/sql 两文件；复杂纯规则/search/worker 有真实职责才拆。100–250行是审查提示，不是压行目标；超出应检查职责，不能机械切文件或删换行。评价可读性、重复、AST复杂度和实际查询，不以硬 LOC 配额替代正确性。
- 模块间可调用明确的函数；禁止任意跨模块写表。概览/注释可以只读联表，避免为读模型增加搬运层。connector 不访问业务库。

## 3. 唯一写入路径

`collection` 拥有调度/推流事务，`content` 提供 `commitContentBatch(client, source, items)`。在线页和标准推流调用同一函数，不复制一套 archive writer。

1. 入口完成结构校验/权限或adapter外部解析；正文按`(platform,kind,externalId)`选确定性胜出版本，独立observation按证据键去重后全部保留，不能选正文时丢掉同内容的其他观测。
2. collection 短事务按 **source → job → content identity 升序** 锁定；校验 active、交付类型和租约/推流幂等状态。
3. content 批量提交正文、投影、discovery、observation；返回接受的正文/计数。
4. collection 同事务推进 checkpoint 或保存推流回执，更新来源状态；提交后返回。网络/文件操作不在事务内。

### SQL 写入约束

| ID | 必须成立的不变量 |
| --- | --- |
| SQL-01 | 批量数据写入四个集合语句：正文 UNNEST upsert、投影 upsert、discovery upsert、observation insert；不得页内逐条 await query。事务 BEGIN/COMMIT、锁/租约/任务更新另计，不宣传“整个执行只有4条SQL”。往返数与页条数无关。 |
| SQL-02 | 正文/状态采用 DAT-04 的完整版本元组；增加 `content_evidence_key` 和 `content_version_fetched_at`。last_seen_at 仅是接收记录，不能作为接受正文版本的时钟。 |
| SQL-03 | 新版本省略 title/body 不清空已知内容；明确删除按版本处理。落后版本不得恢复已删除正文。投影只从真正接受的规范正文生成，不能直接用输入 search_text。 |
| SQL-04 | 受支持写入路径始终同步投影，删除038的失效DELETE触发器必须新增迁移；先回填/验完整性，再切新读路径，不能改已应用038或删完整性检查后假装没有缺口。 |

冲突输入在 UNNEST 前先去重，避免同语句更新同一行两次。参数数组长度/类型一致；JSON作者/媒体为各自类型，不复制审查稿示例里的位置参数。写入 SQL 的 RETURNING/后续读必须覆盖已有但未赢版本的内容，不能漏掉 discovery/observation。

## 4. 查询与性能

| ID | 约束 |
| --- | --- |
| SQL-05 | `compileContentFilter(scope,filter)`是唯一纯过滤入口；scope显式包含actor允许来源与项目范围，返回参数化条件与参数，不接用户SQL。来源/discovery 用 EXISTS，不放大内容数。 |
| SQL-06 | 列表 keyset 只取 limit+1，不预跑 coverage COUNT/total；totalMatching 默认 null。投影完整性检查放迁移/维护/写入，不在每页查全库。 |
| SQL-07 | 概览一条 SQL：matched CTE（每内容一行）+ GROUPING SETS 计算总量/日/平台/kind；provider 按 matched ID 单独去重后聚合，不能与 facets 直接 join 放大。来源运行状态可另用一条有界查询，不按平台/provider循环重扫。 |
| SQL-08 | 批注列表一条 JOIN content 查询，关联观测采用有界子查询/批量读取，不逐条 getContent。详情禁止N+1。 |
| SQL-09 | 搜索投影采用一个 `search_text` + GIN gin_trgm_ops；保存 `title_length` 作为字段边界，不再维护两个规范全文索引。规范标题和正文以 U+001F 分隔；输入禁止该控制符。title_length 用 PG char_length，不能用JS UTF-16长度。标题/正文 scope 先用组合索引候选，再按 substring 精确校验，短语不跨字段边界。 |
| SQL-10 | 字面检索使用转义后的参数化 LIKE（包括转义 `%`、`_`、反斜杠）才能使用 trigram 候选，不能继续用 strpos 期待GIN生效。短词/符号需先限定来源/时间；范围过宽422，执行超时503，绝不返回假0。 |

游标与空时间规则见 QRY-05。未知发布时间在选定日期窗外；概览与内容使用相同时间语义，不另设隐藏范围计算“未知数”。SQL计数使用 bigint，JSON只输出可安全表示的整数，不能 COUNT(*)::int 溢出。

目标负载：4vCPU/8GiB/SSD、100万内容/300万观测/20来源、5个读取并发。列表/详情P95≤400ms，90天概览≤1s；100条页纯应用落库初始门槛≥200条/秒。记录冷暖缓存、SQL次数、更新比例、CPU/内存/WAL；审查稿的2,000条/秒等不是已测承诺。

## 5. 调度与恢复

- RUN-01：进程内 scheduler 最大并发2、同来源一次执行；用现有PG租约/SKIP LOCKED领取，仍能抵御部署时短暂双实例。来源 due 不因轮询抖动重复建任务。
- RUN-02：续页 next_run_at=now，provider minimum_interval_ms 统一限流；有可领取任务立即继续，无任务按 clamp(nextDue-now,500ms,5000ms) 等待并可被退出信号打断。未来到期的任务不占连接/并发槽，不忙轮询已耗尽预算的来源。
- RUN-03：默认 provider 网络时限15s，传递取消信号；429/5xx有限退避，最多3次请求启动尝试。kaix既有收费操作需要更长上游等待时，必须显式provider级有界时限；不套15s后自动重发收费POST。未知操作结果人工核查，禁止自动回放。
- RUN-04：pull页/checkpoint原子；push回执/内容原子。暂停/取消后旧租约不能提交。无cursor的抽样始终partial；成功不是完整覆盖。304只更新检查状态，禁止更新源观测/新内容计数。

## 6. 远端安全稳定基线

| ID | 默认行为 / 验证 |
| --- | --- |
| SAFE-01 | `/v1/*`默认拒绝，只有明确列出的登录/会话探测/持邀请码注册例外；healthz只暴露存活。业务角色/机器scope/资源限制继续检查，不把鉴权等同授权。Cookie为HttpOnly/Secure/SameSite=Lax，写入校验Origin，秘密不进日志。 |
| SAFE-02 | @fastify/rate-limit：登录5次/分钟/IP，全API120次/分钟/IP，413 body上限；只信任明确代理hop/地址，Nginx替换客户端转发头。机器请求也限流，不信任任意XFF；内网健康检查不消耗用户限额。 |
| SAFE-03 | 一个pg pool max10，statement_timeout=10000ms，lock_timeout=3000ms，idle_in_transaction_session_timeout=10000ms；pool获取有界等待，HTTP断连取消查询/关闭cursor。迁移/备份用独立维护连接和明确维护时限，不把10s请求预算套给大索引创建。 |
| SAFE-04 | proxy独占公网443；app仅Compose内部网络，db无宿主机公网ports，仅内部数据库网段。域名/TLS为部署前提；HTTP本地开发必须显式选择，不能生产默认降级。 |
| SAFE-05 | SIGTERM/SIGINT停止领任务/新HTTP、取消外网与stream、等待事务提交或回滚再pool.end；应用退出总预算15s、supervisor宽限30s。不能承诺5s内必然等完10s SQL，不能把Compose替换说成滚动零停机。 |
| SAFE-06 | 首次配置只要求DATABASE_URL、SESSION_SECRET、ADMIN_BOOTSTRAP_PASSWORD；后者只用于首次空库引导且不覆盖已有用户。首次登录补全账户/改密后移除引导密码。第三方key按启用来源才需要，API Key从设置生成，不再强制全局超级bearer。 |

Compose数据库地址是内部服务名，不同时要求容器PG监听127.0.0.1；公网隔离由无ports映射和网络规则实现。HTTPS域名/证书/端口属于部署配置，不能以“三个应用secret”承诺无域名自动公网可用。

## 7. 发布、维护与简单实现

- OPS-01：一个不可变app镜像包含API/Web构建，同一版本执行；静态入口no-cache、哈希assets保留旧标签可用。构建/运行不带外挂依赖，不在启动时npm install。
- OPS-02：启动前独立迁移命令，数据库ready后才readyz；readiness检查受保护/内网，不能让健康重启循环清掉任务。索引回填有界执行，完成前不给出搜索已就绪。
- OPS-03：备份数据库及现有引用文件，至少一份离机副本，实际恢复验证；留存策略明确后有界清理。无服务器冻结表/导出文件后，不增加文件发布目录/清理平台。
- OPS-04：最少记录requestId、慢查询、队列积压、来源实际观测、失败类别、磁盘/内存和构建/迁移版本。用户看到可采取的动作，详细日志仅管理员可查；不部署监控集群。

主线不读写插件manifest/release，不提供原档/任意文件路径上传。扩展只需符合标准推流契约，不得为了“零侵入”跳过版本、权限、幂等和输入限制。
