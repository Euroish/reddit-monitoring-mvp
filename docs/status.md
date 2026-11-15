# 当前实现与证据状态

核对日期：2026-11-15。业务源码与 `main@3551900` 相同，应用版本 0.9.1；本次在独立 `docs/product-spec-unification` 分支整理规范。未修改业务代码/SQL，未采集、付费调用、扫描归档或部署。目标规范不代表实现。

## 1. 实码事实

| 范围 | 已实现 | 未实现 / 已知缺口 |
| --- | --- | --- |
| API / Web | TS 手写 node:http、React/Vite、账户/邀请/审计、内容/个人研究 | Fastify、项目实体/新导航、数据集页未实现 |
| 公共采集 | 生命周期、有界任务、checkpoint、页事务、租约、重试/阻塞、调用限额与心跳 | 仍与旧 scheduler/读模型并存；不是一套完全收敛的主链 |
| Reddit Arctic Shift | 社区/账号/帖子评论、范围内关键词与 ID 刷新；真实小样本落库 | 非全站关键词；13 位评论 ID 刷新校验缺陷待修；持续覆盖/新鲜度未验 |
| Reddit kaix | 跨社区 search 等能力、独立观测、未知收费操作不自动重放 | 默认关闭/零限额；无 cursor、始终 partial；长期质量未验 |
| X TwitterAPI.io | 账号/关键词/ID adapter、媒体/引用/可空指标 | 默认关闭；无真实凭证验收。旧“超单位价禁用”是已撤销产品假设，不是代码能力缺陷 |
| Bluesky | AppView 公开账号作者帖子/回复、AT URI/CID、opaque cursor；两页小样本 | 无搜索/完整历史/删除检测；保留不扩展 |
| 内容/研究 | 统一检索/详情/统计、全文投影、个人保存/注释、CSV/JSON、RR 冻结 | 即时查询不是冻结；旧热榜/增长仍读旧模型 |
| NewsNow / RSSHub | 本轮固定源码审查与选型 | **没有正式 adapter、受控实例或真实闭环**；AIHOT/RSS 也未接入 |
| 历史归档 | 另一分支四份架构讨论稿，本轮只读整合 | **没有当前 importer/producer/release 表或归档 UI**；旧 CLI/041 设想不可当实现 |
| 存储/运维 | PostgreSQL，42 个 SQL 迁移（最后编号040）、备份/恢复/发布工具、systemd/Nginx | 集合页写入、公共保留执行器、代表负载验证与环境收敛待做 |

`main` 已包含 E0 详情优化、Bluesky/040、kaix、静态资源恢复与初始会话竞态修复。不从旧分支重复引入它们。Instagram/web 类型与合成数据不等于真实来源。

### 复杂度定位

- `apps/api/src/create-api-server.ts` 3,606 行；`server.ts` 仍通过 `createPostgresPhase1Runtime()` 装配新公共能力。
- `SourceContentService` 同时做配置、过滤校验、任务、限额与执行；PG 来源仓储含大量压缩长行，页内逐条发 SQL。`commitPage()` 是事务性分页提交，**不是集合批量写入**。
- 公共 worker 与 phase1/keyword scheduler、旧 Markets/Queries/Run/Target、旧 tier/heat/driver/shadow 等体系并存。
- 归档分支另提 Python 在线后端及 68 项分析，既无当前实现，也与本次单一在线栈冲突；仅吸收离线/版本/证据契约。

## 2. 证据分级

| 证据 | 可支持的结论 | 不能推出 |
| --- | --- | --- |
| 本轮：关键入口、页写入/任务/契约、迁移、归档分支四稿及七个外部项目固定源码 | 支持范围/选型/删改决定；没有运行第三方项目或业务迁移 | 新架构已交付、来源可用、归档规模可承载 |
| 本轮本地检查 | docs:check（12份文档）、本地 Markdown 锚点、typecheck、发布包专项1/1、git diff --check 通过；复用已装依赖 | 未跑全量业务/数据库/浏览器/真实来源/归档/部署验收 |
| `3551900` 历史云 CI [43358775922](https://github.com/Euroish/reddit-monitoring-mvp/actions/runs/43358775922) | 此整合快照 workflow 成功 | 文档目标已实施 |
| 11-13 `cf05c12` 系列历史：531 离线/43 PG14 SQL、账户/内容/研究浏览器流程 | 当时整合快照回归通过，包括初始会话竞态修复 | 本轮重新执行、持续来源验收 |
| kaix `413bb75` 系列历史：530 离线、补7专项、1项 PG/API/CSV | adapter 接入与长 ID 离线重放；接入阶段新增收费请求0 | 正常长期有效成本、持续覆盖 |
| E0：1,029 内容/1,004 来源/20 引用，30次暖缓存 | 详情 SQL23→4，P95约179.3→51.6ms，解码 JSON 大幅减少 | 百万内容容量或普遍生产性能 |
| `c805ca1` 10-20 合成写入：100条页约128条/秒 | 当前逐条写入优化有具体动机 | 含网络吞吐、新架构已达目标 |
| E1 Bluesky：2页保存6条、重放新增0、PG/API/UI/导出 | 有界真实小样本闭环 | 全历史/连续运行能力 |

本轮来源固定 commit 与许可见[研究](research/data-sources.md)。旧原始报告只在相应机器 output/，不是仓库自带、可重跑的证据资产。

## 3. 既有部署记录

下述内容来自原工作区已存在的未提交部署记录，本轮保留但未重新探测：

11-13 本机 HTTP/IP 验收服务从 `bdada7b-http-preview` 切为 `main@3551900` 干净构建，发布目录 `/opt/reddit-monitoring-releases/main-3551900-20261113T073415Z`，`/opt/reddit-monitoring` 指向它。设计分支未部署。

当时完成 docs/typecheck/API+Web 构建/compiled smoke、发布包检查；数据库42项迁移 checksum 一致。创建数据库快照并读取归档目录，未恢复演练。部署后健康/ready、前端入口/35静态资源/SPA、未登录会话、bearer来源/内容/统计/CSV及近期worker心跳通过；未做真实账户登录浏览器验收。

当时 API/worker 保留原配置，网络开关false，未注入 Apify token、未触发真实采集/收费；内容/观测/来源/任务计数与 provider 限额未改变。旧构建与旧静态资源可用于回退。报告在独立 `/root/workspaces/reddit-deploy-main-3551900/output/`，本轮没有复核其文件或服务此刻状态。

10-28研究服务 public-tunnel/desktop/chrome/bridge 在11-10记录为 inactive，本轮未改变。健康、真实来源连续可用和内容新鲜度不能互相替代。

## 4. 当前工作与下一步

| 状态 | 内容 |
| --- | --- |
| 本轮规范完成 | 8份现行规范（另有2份历史记录）；明确产品/单机架构/数据与API/归档包/交互/删除计划；移除旧约束与65个旧原型/ZIP文件，保留Git追溯；文档检查/发布清单同步 |
| 未开始 R0/R1 | 实际资产盘点、独立 runtime、Fastify、长 ID、集合页写入 |
| 未开始 R2 | 项目、共享范围、概览/明细/对比/导出 |
| 未开始 R3 | 真实归档清单/最小 producer、包导入/release/固定证据 |
| 条件待验 R4 | Reddit/X 各一条路径；NewsNow getter/RSSHub 路由，凭证和实际样本待定 |
| 未开始 R5 | 业务代码大删、搬迁/性能/恢复/浏览器/上线 |

下一开发入口是[重建计划](plans/source-expansion.md)，不是旧阶段日志或冻结原型。原工作区未提交的部署说明已保留到本规范；文档按用户授权提交至 main，现网不随 Git 推送切换。
