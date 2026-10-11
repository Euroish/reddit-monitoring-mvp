# 当前状态与下一步

核对日期：2026-10-11。本文件只记录已核对实现与本次验证，取代旧交接稿和历史报告。后续任务更新相应段落，不新增一份状态文档。

## 已实现与已知限制

- Node.js / TypeScript API、PostgreSQL 仓储和迁移、Reddit connector/worker、React 工作台存在。
- Web 包含认证、趋势/榜单、对比、关键词、保存视图与管理页面；代码存在不等于所有行为已经验收。
- 当前真实 provider 为旧 HTTP / Scrapling，mock 用于离线开发。此服务器此前真实 Reddit 请求返回 403，当前不能依赖旧路径继续稳定采集；这不是关于 Reddit 全球访问政策的判断。
- 2026-10-11 在此服务器对 Arctic Shift 做了一次有界历史帖子查询（technology、2026-02-01 之前、limit=1），HTTP 200 且返回一条记录；这只证明该次请求可达，不证明完整覆盖、实时性或接入完成。
- Arctic Shift 尚未实现，X、Instagram 及外部聚合源尚未实现。多平台是已确认方向，尚非代码能力。
- 共享开发目录 `/srv/team/project`，共同分支 `shared-dev`；开发环境与生产发布分开。本轮未启动公开部署或采集调度。

## 本轮整理

- 移除重复的项目 skills/prompts、Obsidian 笔记、第三方设计素材副本、旧交接稿及历史采集报告。历史可从 Git 恢复。
- 文档收敛为本目录四个文件及根目录 README / AGENTS，取消旧默认 skill 和 Reddit-only 范围锁定；清理已推送 main/shared-dev（068e357）。
- 保留现有业务功能、SQL 与部署模板。旧 provider 待新源验收后清理，不在资料整理时删除仍有调用的功能。
- 运行报告改写入被 Git 忽略的 `output/provider-reports/`；文档结构与相对链接通过 `docs:check` 检查。

## 深入审计与本轮优化

外部核对覆盖 Arctic Shift、AIHOT、NewsNow、RSSHub、Miniflux 和 Airbyte 的契约/存储/worker/状态协议；参考链接及取舍集中在架构。形成了平台/provider/目标、内容/发现/观测、分析/API/UI 与容量生命周期的端到端设计，未将设计中的新表和接口标记为已实现。

本轮实际代码变化：连接池默认 10 → 5 并支持 `PG_POOL_MAX`；未知 Reddit provider 明确报错；搜索 projection 未变化时跳过重复写；三类保留清理每轮每表最多 10 批。补齐旧 `/v1/runs/reddit-phase1` 的权限路径，使 viewer 不能提交采集任务，管理员和有效 bearer 行为由原有测试验证。

| 当前代码证据 | 对后续开发的影响 | 实施优先级 |
| --- | --- | --- |
| common.ts/connector 类型、SOURCE_IDS、多个仓储和 row mapper 写死 Reddit | 仅改 SourceCode 会误存/误读平台 | 第二来源之前一起迁移 |
| content 唯一键 `(source_id, external_id)`，upsert 会改 target_id | 一个内容匹配多目标时不能保留全部关联 | 多目标/聚合来源前补 discovery 关联 |
| post_engagement latest/window 没有 provider 维度，旧 job 用本地窗口时间作 observedAt | 归档与实时证据容易互相覆盖，算法时间语义不成立 | Arctic Shift 落库前处理 |
| persistCollectionPlan 各仓储分别提交，cursor 后置；claimRunnable 只有状态竞争保护 | 页写入中断会部分提交，running 任务没有完整通用回收 | 新采集路径落库/checkpoint 小事务与恢复 |
| daily/growth job 一次可读 50k/100k 内容，materialization 有较长回看 | 回填扩量时增加内存和重复计算压力 | 小目标闭环后改为增量桶/分页处理 |
| keyword query miss 仍 seed 最近 2000 内容，搜索数量有限而 countByScope 为整个范围 | 本轮只减少重复写；索引覆盖和命中率仍不能视为全量统计 | 公共读取模型迁移时改写入侧索引与统计范围 |
| normalizer 以 ASCII lexeme 为主，content kind 当前仅 post | 中文/多语言与评论落库不能假设沿用即可 | 对应来源实际接入时扩展与验收 |
| retention 只清 raw、target metrics、engagement window | fetch/job/query/health 等仍需保留策略；批数有界不代表库大小有界 | 上线前按引用和诊断需要补齐 |
| API 约 3769 行，回填还可走同步旧入口 | 新来源不应继续向单文件堆逻辑或在请求内长时间采集 | 随公共端点实施分离模块和统一入队 |

## 验证记录

- 文档检查通过：六个 Markdown 文件、相对链接有效；额外文档和失效链接的拦截也已检查。整理前有 203 个 Markdown 文件。
- `npm run typecheck`、`npm run lint:web`、`npm run build`、`npm run smoke:compiled` 通过；报告脚本在临时目录读取旧样本并只向 `output/provider-reports/` 写入的离线检查通过。
- 最终串行全量回归：331 项，314 通过、17 失败。相比原基线无新增失败，并修复 viewer 采集运行权限回归；旧部署文档文本断言已移除，增加一项有界清理回归。
- 56 项 provider/runtime/索引/清理相关测试与 16 项原有认证回归通过。独立临时 PostgreSQL 14 真实验证了默认/环境/构造覆盖连接池（并发后端数 5/2/1）、未变化 projection 不写/变化可更新（含空 snippet），三张表达到删除预算后可继续清理；临时库已停止并删除，业务数据库未启动或修改。
- 剩余 17 项既有失败涉及采集分页/计数/provider 路由、phase1 调度、日事实覆盖与质量阈值。迁移开发需定位原因，不可据此宣称全量测试通过。
- 整理过程重任务串行、Node 堆上限 512 MiB；完成时服务器可用内存约 3 GiB，未启动采集或生产服务。

## 下一步

按架构中的公共内容/来源观测、逐页 checkpoint 和能力边界实施 Arctic Shift 最小采集闭环；先处理归档时间与缺失指标，随后联通分析/API/UI，最后按真实容量扩目标。更远的产品待定项统一见 [产品计划](README.md)，不从旧笔记恢复未确认的要求。
