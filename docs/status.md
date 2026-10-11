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
- 文档收敛为本目录四个文件及根目录 README / AGENTS，取消旧默认 skill 和 Reddit-only 范围锁定。
- 保留业务代码、SQL、测试及部署模板。旧 provider 待新源验收后清理，不在资料整理时删除仍有调用的功能。
- 运行报告改写入被 Git 忽略的 `output/provider-reports/`；文档结构与相对链接通过 `docs:check` 检查。

## 验证记录

- 文档检查通过：六个 Markdown 文件、相对链接有效；额外文档和失效链接的拦截也已检查。整理前有 203 个 Markdown 文件。
- `npm run typecheck`、`npm run lint:web`、`npm run build`、`npm run smoke:compiled` 通过；报告脚本在临时目录读取旧样本并只向 `output/provider-reports/` 写入的离线检查通过。
- 整理前串行全量测试：331 项，313 通过、18 失败；整理后：330 项，312 通过、18 失败，失败名称逐项相同，无新增失败。减少的一项是已删除旧部署文档的文本断言；运行配置与业务测试保留。
- 既有失败涉及 Ops 写入权限、采集分页/计数/provider 路由、phase1 调度、日事实覆盖与质量阈值。迁移开发需定位原因，不可据此宣称全量测试通过。
- 整理过程重任务串行、Node 堆上限 512 MiB；完成时服务器可用内存约 3 GiB，未启动采集或生产服务。

## 下一步

先确认并验证 Arctic Shift 最小采集流程，审计旧接口能力及数据语义，再实现与测试。更远的产品待定项统一见 [产品计划](README.md)，不从旧笔记恢复未确认的要求。
