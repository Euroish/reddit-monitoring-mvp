# 当前实现与证据状态

核对日期：2026-11-16。本次基于`main@8f16e05`，独立`docs/spec-funnel-alignment`分支同步新版Master Spec；应用仍为0.9.1/旧主链。仅修文档，未改业务代码/SQL/依赖、未启动Actor或收费采集、未扫描归档/部署。下列目标均不代表实现。

## 1. 实码事实

| 范围 | 已实现 | 未实现 / 已知缺口 |
| --- | --- | --- |
| API / Web | TS 手写 node:http、React/Vite、账户/邀请/审计、内容/个人研究 | Fastify、项目/五导航、鉴权OpenAPI/capabilities、来源scope key未实现；数据集页已取消 |
| 公共采集 | 生命周期、有界任务/checkpoint、页事务/租约、限额/心跳 | 当前强制单来源单kind；无主备、radar/hydrate、派生水合/新水位语义 |
| Reddit Arctic Shift | 在线connector/配置/测试仍在，历史小样本证据保留 | **母本已决定在线退役，实删未执行**；不再修该adapter长ID/超时，原档仅留R4研究 |
| Reddit kaix | 跨社区search等基础adapter、独立观测、防未知收费重放 | 默认关闭；写死不带评论/≤100、post丢根帖、literal误杀OR、树字段未保留；主源升级/批量postUrls未实现 |
| Reddit备源 / X新主源 | 母本指定red_crawler和TwitterAPIs | **没有adapter/真实闭环**；ScrapeBadger/Xquik仍候选 |
| X TwitterAPI.io | 账号/关键词/ID adapter、媒体/引用/可空指标 | 目标为备源/精查；未真实验收，thread_context未接通，不冒充TwitterAPIs |
| Bluesky | AppView 公开账号作者帖子/回复、AT URI/CID、opaque cursor；两页小样本 | 无搜索/完整历史/删除检测；保留不扩展 |
| 内容/研究 | 统一检索/详情/统计、个人保存/注释、CSV/JSON、RR冻结 | 三段词组/signal/threadAware/评论树三视图和目标流式导出未实现；冻结先迁出再退役 |
| NewsNow / RSSHub | 沿用固定源码选择，作为资讯补充 | **没有正式 adapter、受控实例或真实闭环**；AIHOT/RSS 也未接入 |
| 标准推流/外挂 | 当前无标准ingest或独立外挂 | 推流属于R1目标；原档加工仅R4未来独立客户端，七张归档表/包导入/顶层数据集不再是主线待办 |
| 存储/运维 | PostgreSQL，42 个 SQL 迁移（最后编号040）、备份/恢复/发布工具、systemd/Nginx | 仍逐条页写；无Compose/进程内调度/新安全默认值；公共保留执行器、代表负载和恢复验收待做 |

`main` 已包含 E0 详情优化、Bluesky/040、kaix、静态资源恢复与初始会话竞态修复。不从旧分支重复引入它们。Instagram/web 类型与合成数据不等于真实来源。

### 复杂度定位

- `apps/api/src/create-api-server.ts` 3,606 行；`server.ts` 仍通过 `createPostgresPhase1Runtime()` 装配新公共能力。
- `SourceContentService` 同时做配置、过滤校验、任务、限额与执行；PG 来源仓储含大量压缩长行，页内逐条发 SQL。`commitPage()` 是事务性分页提交，**不是集合批量写入**。
- 公共 worker 与 phase1/keyword scheduler、旧 Markets/Queries/Run/Target、旧 tier/heat/driver/shadow 等体系并存。
- 列表热路径跑coverage COUNT，workbench反复contentStats，批注列表N+1；版本缺evidenceKey/独立接受时钟，缺字段可能清空正文，排序用first_seen_at补空；14个in-memory目录TS文件/单实现接口仍在。
- kaix的metric定义还依赖Arctic Shift导出，writer强制item.kind===source.contentKind；只开放includeComments表单仍会在adapter/落库层失败。退役必须抽离共享规则/注册/配置，不重命名历史provider证据。
- 五模块/两新表、混合集合写、词组/信号/评论联动、主备与开放API仍是目标；原有节点/关系可复用，不新增评论树/规则平台表。

## 2. 证据分级

| 证据 | 可支持的结论 | 不能推出 |
| --- | --- | --- |
| 本轮文档/源码核对 | 完整读取8f16e05母本，核对kaix、X、ContentProvider和混合写限制；同步退役/主备/三阶漏斗、统一过滤与anchor计数/树/文件语义 | 不是功能实现或来源验收 |
| 本轮公开页 | 读取kaix店铺schema/输出/父先子后/限额/代理语义、TwitterAPIs按call/空页费用及ScrapeBadger公开页 | 非固定Actor build回归、非实际收费/长期成功率验证 |
| 母本2026-11-16网络报告 | Arctic Shift 422超时/强限流、匿名Reddit403，记录在来源研究并据此退役在线依赖 | 用户更新母本提供，本轮未重跑这些探测 |
| 本轮本地检查 | docs:check通过（13份文档/本地锚点/根README≤60行）、typecheck通过、发布包专项1/1、git diff --check通过；复用已装依赖 | 未跑新PG/浏览器/真实来源/全档/部署验收 |
| df8ab15历史文档检查 | 13份docs/锚点、typecheck、发布包1/1、doc guard3项通过 | 不是本轮重跑或新架构验收 |
| 7045185文档轮历史检查 | docs:check当时12份、Markdown锚点、typecheck、发布包1/1、diff通过 | 不是本轮重跑，也不是目标业务验收 |
| `3551900` 历史云 CI [43358775922](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/43358775922) | 此整合快照 workflow 成功 | 文档目标已实施 |
| 11-13 `cf05c12` 系列历史：531 离线/43 PG14 SQL、账户/内容/研究浏览器流程 | 当时整合快照回归通过，包括初始会话竞态修复 | 本轮重新执行、持续来源验收 |
| kaix `413bb75` 系列历史：530 离线、补7专项、1项 PG/API/CSV | adapter 接入与长 ID 离线重放；接入阶段新增收费请求0 | 正常长期有效成本、持续覆盖 |
| E0：1,029 内容/1,004 来源/20 引用，30次暖缓存 | 详情 SQL23→4，P95约179.3→51.6ms，解码 JSON 大幅减少 | 百万内容容量或普遍生产性能 |
| `c805ca1` 10-20 合成写入：100条页约128条/秒 | 当前逐条写入优化有具体动机 | 含网络吞吐、新架构已达目标 |
| E1 Bluesky：2页保存6条、重放新增0、PG/API/UI/导出 | 有界真实小样本闭环 | 全历史/连续运行能力 |

第三方固定源码/许可沿用[来源研究](research/data-sources.md)；本轮只补公开文档核对，无收费请求。旧原始报告只在相应机器 output/，不是仓库自带、可重跑的证据资产。

## 3. 既有部署记录

下述内容来自原工作区已存在的未提交部署记录，本轮保留但未重新探测：

11-13 本机 HTTP/IP 验收服务从 `bdada7b-http-preview` 切为 `main@3551900` 干净构建，发布目录 `/opt/reddit-monitoring-releases/main-3551900-20261113T073415Z`，`/opt/reddit-monitoring` 指向它。设计分支未部署。

当时完成 docs/typecheck/API+Web 构建/compiled smoke、发布包检查；数据库42项迁移 checksum 一致。创建数据库快照并读取归档目录，未恢复演练。部署后健康/ready、前端入口/35静态资源/SPA、未登录会话、bearer来源/内容/统计/CSV及近期worker心跳通过；未做真实账户登录浏览器验收。

当时 API/worker 保留原配置，网络开关false，未注入 Apify token、未触发真实采集/收费；内容/观测/来源/任务计数与 provider 限额未改变。旧构建与旧静态资源可用于回退。报告在独立 `/root/workspaces/reddit-deploy-main-3551900/output/`，本轮没有复核其文件或服务此刻状态。

10-28研究服务 public-tunnel/desktop/chrome/bridge 在11-10记录为 inactive，本轮未改变。健康、真实来源连续可用和内容新鲜度不能互相替代。

## 4. 当前工作与下一步

| 状态 | 内容 |
| --- | --- |
| 本轮规范完成 | 母本五项决定对齐到全部现行文档；新增混合树、词组/门控、按需水合、主备及agent可执行契约，明确口径/限额而不另建平台 |
| 未开始 R1 | Fastify/key/capabilities/OpenAPI、两表迁移、kaix解锁/混合批/通用长ID、推流/collect幂等、分页/流式文件；新链不注册Arctic Shift |
| 未开始 R2 | 三阶漏斗/根帖联动/三视图、Reddit/X主备、NewsNow/feed、同口径概览/对比/文件与真实PG HTTP/浏览器任务闭环 |
| 未开始 R3 | 个人旧资产迁出、仓储/冻结/旧runtime实删，性能/安全/恢复、Compose与维护窗口切换 |
| 后续独立 R4 | 原档清单/许可/资源明确后再研究外挂；不阻塞主线，不恢复归档表/包协议 |

下一开发入口是[重建计划](plans/source-expansion.md)，不是旧阶段日志或冻结原型。原工作区未提交的部署说明已保留到本规范；文档按用户授权提交至 main，现网不随 Git 推送切换。
