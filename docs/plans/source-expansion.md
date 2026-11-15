# 重建与删除计划

状态：待开发。本文替代旧三人/周数/来源采购排期；只表达依赖、删改边界和验收。产品 PRD/MET/ENG、架构 ARC/MOD、数据 DAT/COL/QRY/IMP/EXP/SEC、交互 UX 是唯一规则来源。

## 1. 重建策略

采用**新组合根 + 按模块替换 + 一次默认入口切换 + 删除旧链路**。允许重建 API/表/页面，不要求长期兼容废弃产品；不整库重写账户，不平行开发 Python 在线系统。

- MIG-01：以当前 main 的实码与数据库盘点作为搬迁基线；`3551900` 只是本次审查快照，不覆盖后续合入的有效修复。
- MIG-02：新模块可在任务分支/隔离库完成；生产只进行明确的切换，不长期双写旧/新事实、不保留通配 legacy fallback。
- MIG-03：保留有价值的内容与研究资产不等于保留旧接口/算法。放弃的功能可直接删除，不必重新实现后才能删。
- MIG-04：本轮只交付规范；实施时按下面的纵向切片开发。不能把某阶段的表/路由空壳当完成。

## 2. 保留、改造、删除矩阵

| 范围 / 当前路径 | 处理 | 删除前的必要出口 |
| --- | --- | --- |
| `account-security.service.ts`、账户/会话/邀请/审计代码与表 | 保留业务规则，迁入 access | 登录/撤销/权限/个人隔离继续成立；无需重写密码系统 |
| `arctic-shift-content.connector.ts`、`kaix-content.connector.ts`、X/Bluesky 公共 adapter | 保留并收敛映射 | 通过 DAT/COL 对照；修复长 ID，不恢复旧抓取路由 |
| `SourceContentService`、`PostgresSourceContentRepository` | 按 collection/content 拆职责，保留核心任务语义 | 一页集合写入、可重放、租约拒绝、过滤单点；不是只格式化 |
| `content`、discovery、observation、公共搜索、个人/研究表 | 优先复用；必要时新表搬迁 | 身份、来源证据、正文与冻结载荷/所有权一致 |
| `apps/api/src/create-api-server.ts`、旧 HTTP validation/handler | Fastify 路由逐模块替代后删除 | 新 API 不导入旧 runtime；未采用端点直接退役 |
| `src/runtime/reddit-phase1-runtime.ts`、旧 fetch execution/routing/health/promotion | 删除 | 账户、公共采集与 ops 装配已经独立；必须保留的维护职责已迁移 |
| `workers/reddit-phase1-*`、`workers/keyword-query-live-refresh-scheduler.ts` | 删除 | 停止旧写入，单一 worker 调度；不为废弃表保留维护 scheduler |
| `src/connectors/reddit/` 中旧 http/scrapling/mock/circuit-breaker/create-reddit-connector 链 | 删除未被新主链使用的旧路径 | 先查实际 import，保留公共 adapter 确实共用的工具，不按目录一刀切 |
| 旧 tier/heat/growth/driver/anomaly/shadow/promotion/query planner 算法与旧 read models | 删除 | 项目概览使用新事实；不移植旧热度模型作新默认指标 |
| `MarketBoard/Queries/Compare/RunPhase1/TargetDetail/Dashboard` 旧页面与 workbench 特有组件 | 删除或以新 feature 完全替换 | PRD-03/06 用户流程可用，旧 API client/query keys/导航同时退出 |
| `scripts/*phase1*`、shadow/promotion、旧 reddit 导出/索引/维护 CLI | 删除退役链路专用入口 | 当前数据搬迁/备份确有用途的脚本完成后再退役，不按通配符直接 rm |
| `deploy/systemd/reddit-phase1-scheduler.service`、`reddit-keyword-refresh.service`、scheduler env | 删除 | 实际服务停止并退出默认部署；文档不再提示启动 |
| `packages/contracts` 中旧 target/market/run/workbench DTO | 删除无消费者的定义 | API/Web/CLI/测试均已移除对应调用，公共契约不被顺带误删 |
| 旧专用单测、in-memory 仓储、mock runtime、fixtures、旧 npm scripts/CI/环境开关 | 随功能一起删除 | 保留仍验证共享账户/事务/身份的有效断言，不为旧测试保留旧产品 |
| 旧 HTML/SVG 原型与 ZIP | 本次从工作树删除，Git 历史可查 | 新设计文档覆盖当前范围；不继续维护 39 功能并行规范 |

表中短文件名按当前仓库定位；实施 PR 必须列出实删路径和残留引用。不得把本文当自动删除脚本。

## 3. 数据搬迁与切换

### 必须保存

- `app_user`、密码摘要、角色、有效邀请及审计；会话可在切换时明确失效并要求重新登录。
- 有价值的规范内容、正文状态、原生 ID、discovery/observation；公共全文投影可重建。
- `content_saved_query`、`content_annotation`、`research_export/member` 的用户归属与必要冻结载荷。
- 来源配置、任务 checkpoint/uncertain 状态与实际用量。已完成任务可只读保留，不为重新运行未明收费操作而清零状态。

### 选择性迁移

旧 `monitor_target/collection_job/metrics_snapshot/raw_reddit_event`、旧 post engagement/growth、keyword/subreddit/anomaly 派生表不进入新产品默认读写。旧内容若尚无公共 discovery，先用专门搬迁身份和旧来源证据登记；无法可靠映射的记录列出数量/原因，不伪造 provider/观测时间。

旧 saved_workbench_view 若能等价映射到新 filter 则转换；无法等价的保留只读归档/导出，报告未迁数量，不继续保留整个旧工作台来解释它们。

### 切换步骤

1. 盘点表/规模/外键、当前构建、迁移账本、文件与仍运行的服务；明确搬迁脚本和过滤语义变化。
2. 在隔离库执行迁移/搬迁与重放，核对总量、身份重复、来源时间、个人所有权、研究样本；记录不能映射的资产。
3. 备份并实际恢复验证；确认数据库、引用文件和回退构建成套可用。
4. 停领任务并停止旧写入；完成最终增量搬迁，切 API/Web/worker。MAY 使用短维护窗，不为零停机引入长期双写。
5. 验证登录、来源/内容、项目/导出、静态资源及任务恢复；仅明确开启的来源恢复网络。
6. 代码主链删除后旧表先只读；确认无引用/需保留资产且备份有效，再用新 DROP 迁移删除。数据库回退不靠回退 JS 自动完成。

42 个既有 SQL 迁移保留完整文件名/checksum；不得改已应用 SQL 或补造旧讨论稿的 041。新迁移编号按实施时实际账本分配。全新精简基线只能在所有受支持旧库都有明确升级路径后替换安装入口，不与已部署账本混用。

## 4. 依赖切片与出口

| 切片 | 开发内容 | 完成证据 | 后续依赖 |
| --- | --- | --- | --- |
| R0 基线/保留清单 | 核对实码、运行资产、有效修复；冻结首批项目/数据样例 | 保留/删除矩阵与真实资产映射，无未解释的破坏性迁移 | R1 |
| R1 新骨架/单写入链 | Fastify+独立 runtime；迁账户/内容/来源；集合页提交；修长 ID | API 无旧 runtime 依赖；页失败/重放/取消正确；登录和已存内容可用 | R2/R3/R4 |
| R2 项目闭环 | 项目/来源关联、共享 filter、概览/内容/详情、个人保存/导出、两项目对比 | 两项目共享流只采一次；同帖多 provider 不重计；图表钻取与导出同范围 | R5 |
| R3 归档闭环 | 最小生产 CLI、包 schema、staging/COPY、原子发布、有限证据检索 | 一真实有界包→发布→图表→证据→固定导出；补月/替换/重放正确 | R5 |
| R4 来源接通 | Reddit/X 各一条路径；NewsNow 少量 getter；RSS/Atom + 限定 RSSHub | 每条实际入口有身份/时间/分页/重放报告；不合格明确阻塞 | R5 |
| R5 删旧/上线 | 删旧装配/读写/测试/配置；负载/恢复/浏览器检查；同构建发布 | 一套默认主链、资产迁移对账、P0 流程、性能与恢复结果可查 | 本次重建完成 |

R3 和 R4 可在接口稳定后并行进行，但不是两套产品。X 凭证、历史包未就绪不阻塞 R1/R2；也不能把夹具结果记作 R3/R4 真实交付。无固定团队角色/周数，交付按依赖和证据推进。

## 5. 相称的验证

优先少量、高信息量的集成场景，直接验证真实 PostgreSQL 和 API，不重复测试框架本身。

| 必须证明的风险 | 最小有效验证 |
| --- | --- |
| 页提交一致性 | 同页中途失败无部分写入/checkpoint；同页重放、两 provider 同帖、旧租约拒绝；检查接受正文与投影一致 |
| 任务恢复/收费 | 取消/暂停与提交竞争、过期租约、可续 cap、无 cursor partial、uncertain 操作不自动重发 |
| 范围/数字正确 | 项目共享来源不重复；列表/概览/导出同 filter；未知/零/缺口；不兼容归档过滤明确拒绝 |
| 归档发布 | 同包重放；损坏文件不发布；9月后补4–8月；同分区替换不累加；发布失败旧版可读；固定证据不随在线更新改变 |
| 账户与研究 | 未授权拒绝、用户 A/B 个人资产隔离、撤销会话；冻结成员/载荷不变 |
| 产品闭环 | UX-07 一条连贯浏览器流程 + 历史/对比分支；必要失败/窄屏场景 |
| 性能/部署 | ARC 验证负载与一次真实备份恢复；干净构建、迁移、关键读写和静态资源 |

新测试仅在暴露具体失败模式时增加。删除旧功能时同时删除仅服务该功能的测试；不能因为测试多就保留旧链路，也不能删掉共享不变量的断言掩盖缺陷。日常 CI 不请求付费或不稳定上游；真实来源验证单独记录。

## 6. 完成定义

重建完成 MUST 同时满足：PRD-01–08 用户任务可用；保留资产有搬迁对账；ARC-01–14 与核心契约落地；默认入口不导入/运行旧链；废弃代码、契约、脚本、测试与部署入口一起退出；新文档与源码一致。

只完成 Fastify、只换导航、只跑离线测试、只有漂亮图表、或只减少文件行数，都不构成完成。真实来源/归档条件未满足时明确标记未完成，不扩大候选清单来替代交付。
