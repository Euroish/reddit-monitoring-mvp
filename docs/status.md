# 当前实现与证据状态

核对日期：2026-11-15。本次基于`main@a078c9c`，在独立`docs/audit-spec-product-contracts`分支同步架构审查；应用仍为0.9.1/旧主链。只改规范、文档检查和发布允许清单/专项测试，未修改业务代码/SQL，未采集、付费调用、扫描归档或部署。下列目标均不代表实现。

## 1. 实码事实

| 范围 | 已实现 | 未实现 / 已知缺口 |
| --- | --- | --- |
| API / Web | TS 手写 node:http、React/Vite、账户/邀请/审计、内容/个人研究 | Fastify、项目/五导航、鉴权OpenAPI/capabilities、来源scope key未实现；数据集页已取消 |
| 公共采集 | 生命周期、有界任务、checkpoint、页事务、租约、重试/阻塞、调用限额与心跳 | 仍与旧 scheduler/读模型并存；不是一套完全收敛的主链 |
| Reddit Arctic Shift | 社区/账号/帖子评论、范围内关键词与 ID 刷新；真实小样本落库 | 非全站关键词；13 位评论 ID 刷新校验缺陷待修；持续覆盖/新鲜度未验 |
| Reddit kaix | 跨社区 search 等能力、独立观测、未知收费操作不自动重放 | 默认关闭/零限额；无 cursor、始终 partial；长期质量未验 |
| X TwitterAPI.io | 账号/关键词/ID adapter、媒体/引用/可空指标 | 默认关闭；无真实凭证验收。旧“超单位价禁用”是已撤销产品假设，不是代码能力缺陷 |
| Bluesky | AppView 公开账号作者帖子/回复、AT URI/CID、opaque cursor；两页小样本 | 无搜索/完整历史/删除检测；保留不扩展 |
| 内容/研究 | 统一检索/详情/统计、全文投影、个人保存/注释、CSV/JSON、RR 冻结 | 目标流式导出未实现；RR冻结将先迁出再退役；旧热榜/增长仍读旧模型 |
| NewsNow / RSSHub | 前轮固定源码选型，本轮对齐核心/外挂边界 | **没有正式 adapter、受控实例或真实闭环**；AIHOT/RSS 也未接入 |
| 标准推流/外挂 | 当前无标准ingest或独立外挂 | 推流属于R1目标；原档加工仅R4未来独立客户端，七张归档表/包导入/顶层数据集不再是主线待办 |
| 存储/运维 | PostgreSQL，42 个 SQL 迁移（最后编号040）、备份/恢复/发布工具、systemd/Nginx | 仍逐条页写；无Compose/进程内调度/新安全默认值；公共保留执行器、代表负载和恢复验收待做 |

`main` 已包含 E0 详情优化、Bluesky/040、kaix、静态资源恢复与初始会话竞态修复。不从旧分支重复引入它们。Instagram/web 类型与合成数据不等于真实来源。

### 复杂度定位

- `apps/api/src/create-api-server.ts` 3,606 行；`server.ts` 仍通过 `createPostgresPhase1Runtime()` 装配新公共能力。
- `SourceContentService` 同时做配置、过滤校验、任务、限额与执行；PG 来源仓储含大量压缩长行，页内逐条发 SQL。`commitPage()` 是事务性分页提交，**不是集合批量写入**。
- 公共 worker 与 phase1/keyword scheduler、旧 Markets/Queries/Run/Target、旧 tier/heat/driver/shadow 等体系并存。
- 列表热路径跑coverage COUNT，workbench反复contentStats，批注列表N+1；版本缺evidenceKey/独立接受时钟，缺字段可能清空正文，排序用first_seen_at补空；14个in-memory目录TS文件/单实现接口仍在。
- 审查要求的五模块/两新表、标准push、四组集合SQL、单搜索索引/GROUPING SETS与流式下载均未落地；主线已从目标上移除归档包与冻结，但当前冻结源码/表/API仍需R3实删。

## 2. 证据分级

| 证据 | 可支持的结论 | 不能推出 |
| --- | --- | --- |
| 本轮审查 | 读取a078c9c审查及现行规范，核对关键写入/查询/账户schema/worker/UI；同步AUD-01–07/GAP-01–06，修正伪SQL/last_seen版本时钟/15s收费超时/退出与Compose等冲突 | 不证明新架构已实现或来源/原档可用 |
| 本轮本地检查 | docs:check（13份文档/本地锚点/根README≤60行）、typecheck、发布包专项1/1、doc guard临时夹具3项、git diff --check通过；发布专项还证明外挂源码/编译产物不入核心包 | 未跑全量业务/数据库/浏览器/真实来源/归档/部署验收 |
| 7045185文档轮历史检查 | docs:check当时12份、Markdown锚点、typecheck、发布包1/1、diff通过 | 不是本轮重跑，也不是目标业务验收 |
| `3551900` 历史云 CI [43358775922](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/43358775922) | 此整合快照 workflow 成功 | 文档目标已实施 |
| 11-13 `cf05c12` 系列历史：531 离线/43 PG14 SQL、账户/内容/研究浏览器流程 | 当时整合快照回归通过，包括初始会话竞态修复 | 本轮重新执行、持续来源验收 |
| kaix `413bb75` 系列历史：530 离线、补7专项、1项 PG/API/CSV | adapter 接入与长 ID 离线重放；接入阶段新增收费请求0 | 正常长期有效成本、持续覆盖 |
| E0：1,029 内容/1,004 来源/20 引用，30次暖缓存 | 详情 SQL23→4，P95约179.3→51.6ms，解码 JSON 大幅减少 | 百万内容容量或普遍生产性能 |
| `c805ca1` 10-20 合成写入：100条页约128条/秒 | 当前逐条写入优化有具体动机 | 含网络吞吐、新架构已达目标 |
| E1 Bluesky：2页保存6条、重放新增0、PG/API/UI/导出 | 有界真实小样本闭环 | 全历史/连续运行能力 |

首次typecheck因独立目录缺Web依赖失败；复用已装的根/Web依赖后重跑通过，未改业务代码或依赖锁。来源固定commit/许可沿用前轮[研究](research/data-sources.md)，本轮未重跑第三方采集。旧原始报告只在相应机器 output/，不是仓库自带、可重跑的证据资产。

## 3. 既有部署记录

下述内容来自原工作区已存在的未提交部署记录，本轮保留但未重新探测：

11-13 本机 HTTP/IP 验收服务从 `bdada7b-http-preview` 切为 `main@3551900` 干净构建，发布目录 `/opt/reddit-monitoring-releases/main-3551900-20261113T073415Z`，`/opt/reddit-monitoring` 指向它。设计分支未部署。

当时完成 docs/typecheck/API+Web 构建/compiled smoke、发布包检查；数据库42项迁移 checksum 一致。创建数据库快照并读取归档目录，未恢复演练。部署后健康/ready、前端入口/35静态资源/SPA、未登录会话、bearer来源/内容/统计/CSV及近期worker心跳通过；未做真实账户登录浏览器验收。

当时 API/worker 保留原配置，网络开关false，未注入 Apify token、未触发真实采集/收费；内容/观测/来源/任务计数与 provider 限额未改变。旧构建与旧静态资源可用于回退。报告在独立 `/root/workspaces/reddit-deploy-main-3551900/output/`，本轮没有复核其文件或服务此刻状态。

10-28研究服务 public-tunnel/desktop/chrome/bridge 在11-10记录为 inactive，本轮未改变。健康、真实来源连续可用和内容新鲜度不能互相替代。

## 4. 当前工作与下一步

| 状态 | 内容 |
| --- | --- |
| 本轮规范完成 | 核心/外挂隔离、五模块/五页面/两新表、保存查询+流式文件；落实索引逐项映射AUD/GAP/安全/实删验收；人类与agent沿同任务链操作。旧原型在前轮已删除，不是本轮新删 |
| 未开始 R1 | 隔离内核、资产盘点、Fastify/权限、长ID/版本/集合写入、标准推流、NULL分页/流式下载 |
| 未开始 R2 | 项目创建/概览/对比→钻取/批注/保存/下载；来源与真实PG HTTP闭环；五导航与agent能力发现 |
| 未开始 R3 | 个人旧资产迁出、仓储/冻结/旧runtime实删，性能/安全/恢复、Compose与维护窗口切换 |
| 后续独立 R4 | 原档清单/许可/资源明确后再研究外挂；不阻塞主线，不恢复归档表/包协议 |

下一开发入口是[重建计划](plans/source-expansion.md)，不是旧阶段日志或冻结原型。原工作区未提交的部署说明已保留到本规范；文档按用户授权提交至 main，现网不随 Git 推送切换。
