# PR #30 / #32 集成质量审计

> **历史证据快照，不再维护动态状态**：下文“候选已修复”及测试数量描述 #34 合入前的 `e88b0df` 对照；#34 已以 `73c50d7` 合入 main。保留复现、静态热点与验证记录供追溯，不代表热点已全部解决。当前版本见 [状态页](../status.md)，AUD 后续工作只查 [统一台账](business-audit-2026-11-23/SIFTLINE_修复进度完成表_2026-11-23.md)。

## 1. 基线、范围与计数口径

- 产品演进基础是已合入的 Backend V2：`main@dbf2753`；质量协议 #33 的集成基准为 `main@e88b0df`。较早实现没有设计优先权；已落地 SQL 历史不可改写。
- #30 的产品变更范围：`git diff --name-only 4b05369 3fece79 -- src apps packages`，共 **92 个文件**：API 装配 3、Web 55、Contracts 4、Backend 28、迁移 2；其中 81 个 TS/TSX 文件执行了静态复杂度扫描。
- 扩展追踪 V2 的 `managed.ts`、Intelligence 手动采集、Worker、资源预留与旧 Refresh/Hydrate 重放入口。内容写入仍走 `commitContentBatch`，不改变 9 域 DAG。
- **已确认 8 类根因**：2 类在 #32 已修复，6 类由 `fix/v2-collection-contracts` 提供候选修复。多个症状或测试失败不重复计数。功能缺陷与可维护性/资源浪费分别标记，不将代码行数、文件数或复杂度报警冒充缺陷数。
- **范围限制**：完成全量文件清点与静态扫描、关键后端组合调用链深查及回归；尚未完成所有页面的逐项行为审查。19 个超限诊断是后续调查热点，不等于 19 个已确认缺陷，也不能据此宣称前端全面收口。

## 2. 已确认根因与处置

| ID | 问题与证据 | 影响与修复 | 状态 |
| :--- | :--- | :--- | :--- |
| A01 | `recordCommittedBatch` 曾在每页提交后重新统计完整批次 | 分页累计重复扫描；#32 改为实际插入成员的增量，保留重放/并发/分页交叠语义 | #32 已合入 |
| A02 | 来源删除未将任务清理后残留的历史批次计入保留条件 | 触发 FK 错误或错误退役策略；#32 对历史来源归档 | #32 已合入 |
| A03 | `attachBatchToProjectInTx` 每次 Worker 页回调都 `ON CONFLICT UPDATE status='enabled'` 并递增项目 revision | 后续页覆盖用户禁用/移除，且重复写；自动关联只插入一次、仅新关联更新 revision。显式用户复用仍可重新启用 | 候选已修复 |
| A04 | #30 路由与 V2 `enqueueCollectionForSource` 并行实现雷达任务创建，后者未携带个人时间窗准入、未执行 provider 节点限制 | 同一 Viewer 48 小时时间窗在直接入口被拒，而监测入口被接受；Owner 也可从监测入口提交 >2000 节点。两个入口收敛到 V2 helper，保留项目权限、fallback、幂等及预算行为 | 候选已修复 |
| A05 | 监测重试每次重算 `from/to`，再将绝对窗口作为幂等比较输入 | 相同 key / 客户端意图返回 409；用既有 `payload_hash` 保存规范化客户端意图与监测 revision 的指纹，首次绝对窗口保留。重放不重复预留，不受之后个人额度/系统预算变化影响；新任务预算失败完整回滚 | 候选已修复 |
| A06 | Worker `estimateResources` 复制 Contracts 已有的 `providerResourceReservation` | 同一计费边界维护两套公式；删除重复实现，预检和调度复用既有纯函数。此项是已确认重复，不声称此前已发生错计费 | 候选已修复 |
| A07 | 预检先拉取来源全部可见历史批次 UUID，再传回 SQL 检查成员关系 | 多一次 SQL 和随历史批次数 B 增长的 O(B) 应用内物化；改用现有 SQL membership 谓词，保留私有/共享、Actor 来源权限与 discovery 同源约束。显式空数组仍匹配空集 | 候选已修复 |
| A08 | V2 雷达 helper、旧 Refresh 与项目 Hydrate 的重放快路径未完整核实存储的 user/client kind | 可向其他用户或另一客户端类型返回原任务 ID；三个入口恢复请求者绑定。原请求者仍可取回历史凭证，其他身份 409，不新增任务或预留 | 候选已修复 |

### 根因复现与验收

- 在 `e88b0df` 隔离检出运行新回归：监测时间窗与节点限制预期 422、实际 200；同意图并发重试预期 200、实际 409。旧自动关联也会改写已有成员状态或 revision。
- A08 在修复前实际重现：Refresh 的另一用户与 Hydrate 的同用户另一客户端，均预期 409、实际 200；不是仅凭字符串相似性推断。
- 当前测试覆盖：成功与拒绝、并发同 key、参数改变、额度变化、跨身份重放、事务回滚、自动回调重入、禁用/移除保持、显式恢复、私有-only 内容与显式空集合。
- 调度、采集、Refresh、Hydrate、自动评论水合是不同的工作流，不强行用一个万能入队器替代。只合并语义相同的手动雷达路径；有区别的契约保留。

## 3. 保留能力与兼容性

没有删除停用但有价值的产品能力、页面、数据契约、表或迁移。研究采集、来源编辑/导入、批次复用、R4 外挂、AI 信源、Feed 与 Intelligence 均保留。删除的是重复实现及多余查询，不是通过减少功能证明“简化”。

- 公开 TypeBox Schema、路由与返回形状不变；项目检查仍由装配注入，域间只走公开门面。
- 旧直接采集凭证继续按原请求 JSON 与 user/client kind 比较；新监测凭证按意图指纹比较，首次窗口不覆盖。
- 监测 revision 或客户端参数改变复用原 key 为 409。旧监测凭证没有意图指纹时保持保守冲突，不篡改历史凭证或自动重放付费请求。
- `batchMembership(undefined, actor)` 仅用于来源预检的“全部授权批次”；项目仍传具体 ID 列表，`[]` 不升级为全量。
- 不新增依赖、表、SQL 迁移、缓存或中间服务。生产环境未变更。

## 4. 静态热点与后续验收

以下为 `e88b0df` 在 #30 产品范围内的 19 个 ESLint 复杂度 >25 诊断。前值取 #30 之前的 `4b05369`；“—”表示没有同诊断身份的 >25 报告，可能未存在或未超阈值，**不表示 0**。同名匿名诊断不是稳定函数身份，不能作逐函数归因或给贡献者打分。

| 路径 / 诊断 | #30 之前 | 当前基线 |
| :--- | ---: | ---: |
| `web/App.tsx` · Function 'App' | 41 | 43 |
| `web/components/ProjectCollectView.tsx` · Function 'ProjectCollectView' | — | 61 |
| `web/components/QuotasManagementView.tsx` · Function 'QuotasManagementView' | 40 | 31 |
| `web/components/R4ArchivePanel.tsx` · Function 'R4ArchivePanel' | — | 34 |
| `web/components/SourceEditor.tsx` · Function 'SourceEditor' | — | 154 |
| `web/components/SourceEditor.tsx` · Async function 'submit' | — | 49 |
| `web/components/ai/AiSourceOperations.tsx` · Function 'AiSourceOperations' | — | 32 |
| `web/components/charts/DailyTrendChart.tsx` · Arrow function | — | 27 |
| `web/lib/collectionLimits.ts` · Function 'collectionLimits' | — | 42 |
| `web/pages/AiReviewQueuePage.tsx` · Function 'AiReviewQueuePage' | 67 | 70 |
| `web/pages/ContentExplorerPage.tsx` · Function 'ContentExplorerPage' | 73 | 75 |
| `web/pages/ContentExplorerPage.tsx` · Function 'ContentDetailDrawer' | 41 | 41 |
| `web/pages/ProjectsPage.tsx` · Function 'ProjectsPage' | 68 | 130 |
| `web/pages/SettingsPage.tsx` · Function 'SettingsPage' | 54 | 56 |
| `web/pages/SourcesPage.tsx` · Function 'SourcesPage' | 74 | 178 |
| `web/pages/SourcesPage.tsx` · Arrow function | — | 119 |
| `web/pages/SourcesPage.tsx` · Arrow function | — | 39 |
| `web/pages/WorkbenchShell.tsx` · Function 'WorkbenchShell' | 86 | 163 |
| `modules/ai/ai-llm.ts` · Async function 'extractWithOptionalLlm' | 31 | 30 |

优先复核状态和事务所有权，而非机械切函数：来源编辑/保存与域/目标切换；Sources 与 Projects 的请求、选中态、表单和导航；WorkbenchShell 的装配；Collection intake 的过期响应、估算和确认。Frontend V2 交付时应按用户旅程分批收敛，保留现有有效任务，并提供真实渲染、窄屏、键盘和空/错/权限状态证据。未逐页验证前不宣布这些热点已经解决。

静态扫描复现（复用现有依赖与规则，无新增审计工具）：

```sh
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { complexityViolations } from './scripts/check-complexity.mjs';
const files = execFileSync('git', ['diff', '--name-only', '4b05369', '3fece79', '--', 'src', 'apps', 'packages'], { encoding: 'utf8' }).trim().split('\n');
for (const file of files.filter(file => /\.tsx?$/.test(file)))
  for (const item of complexityViolations(readFileSync(file, 'utf8'), file))
    console.log(JSON.stringify({ file, ...item }));
JS
```

静态后端导入图无循环，但存在 Node 内置模块/外部依赖解析边界；循环图不是运行时安全证明。跨域约束另由 depcruise 与表归属门禁验证，实际 Worker 钩子和 route 注册已追踪。

## 5. 验证记录

- 最终补丁后完整重跑：单元 **66/66**，隔离 PG16 **48/48**。
- 双端 typecheck、API ESLint、DAG/表归属与 OpenAPI 通过；269 模块 / 1222 依赖无违规，122 路径 / 140 操作契约不变。
- 最终 API 构建与编译产物 PG16 冒烟通过：66 SQL 文件、`readyz`、登录与鉴权来源查询。
- 没有 UI 改动，未重跑浏览器/前端构建；未对生产环境或上游付费渠道进行本轮测试。
- 候选修复的远端 CI 和集成状态以对应 PR 为准。本文是本轮快照，动态进展见 [状态页](../status.md)。

## 附：92 个产品变更文件

```text
apps/api/src/app.ts
apps/api/src/route-policy.ts
apps/api/src/server.ts
apps/web/components.json
apps/web/package-lock.json
apps/web/package.json
apps/web/src/App.tsx
apps/web/src/api/ai-client.ts
apps/web/src/api/client.ts
apps/web/src/api/hooks.ts
apps/web/src/components/CollectionIntakeSteps.tsx
apps/web/src/components/CollectionJobsView.tsx
apps/web/src/components/CrossPlatformAnalyticsPanel.tsx
apps/web/src/components/ProjectCollectView.tsx
apps/web/src/components/ProjectSwitcher.tsx
apps/web/src/components/ProjectWorkspaceViews.tsx
apps/web/src/components/ProviderBudgetEditor.tsx
apps/web/src/components/ProviderBudgetTable.tsx
apps/web/src/components/ProviderCredentialsTab.tsx
apps/web/src/components/QuotasManagementView.tsx
apps/web/src/components/R4ArchivePanel.tsx
apps/web/src/components/SourceDomainOverview.tsx
apps/web/src/components/SourceEditor.tsx
apps/web/src/components/SourceImportDialog.tsx
apps/web/src/components/SourceManagementDetail.tsx
apps/web/src/components/ai/AiSourceOperations.tsx
apps/web/src/components/charts/DailyTrendChart.tsx
apps/web/src/components/charts/KpiSparkChart.tsx
apps/web/src/components/charts/QuotaMeters.tsx
apps/web/src/components/ui/alert.tsx
apps/web/src/components/ui/badge.tsx
apps/web/src/components/ui/button.tsx
apps/web/src/components/ui/card.tsx
apps/web/src/components/ui/checkbox.tsx
apps/web/src/components/ui/dialog.tsx
apps/web/src/components/ui/input.tsx
apps/web/src/components/ui/skeleton.tsx
apps/web/src/components/ui/table.tsx
apps/web/src/components/ui/tabs.tsx
apps/web/src/components/workbench/KpiCard.tsx
apps/web/src/contracts/api.ts
apps/web/src/lib/collectionLimits.ts
apps/web/src/lib/researchIntake.ts
apps/web/src/lib/sourceStatus.ts
apps/web/src/lib/utils.ts
apps/web/src/pages/AiReviewQueuePage.tsx
apps/web/src/pages/ContentExplorerPage.tsx
apps/web/src/pages/ProjectsPage.tsx
apps/web/src/pages/SettingsPage.tsx
apps/web/src/pages/SourcesPage.tsx
apps/web/src/pages/WorkbenchShell.tsx
apps/web/src/pages/WorkspacePage.tsx
apps/web/src/styles/collection.css
apps/web/src/styles/workbench-ui.css
apps/web/src/styles/workbench.css
apps/web/tsconfig.app.json
apps/web/tsconfig.json
apps/web/vite.config.ts
packages/contracts/src/ai-catalog.ts
packages/contracts/src/collection-budget.ts
packages/contracts/src/collection.ts
packages/contracts/src/projects.ts
src/modules/access/index.ts
src/modules/access/sql.ts
src/modules/ai/ai-discovery.ts
src/modules/ai/ai-llm.ts
src/modules/ai/ai-routes.ts
src/modules/collection/batches.ts
src/modules/collection/config.ts
src/modules/collection/credentials.ts
src/modules/collection/hydrate.ts
src/modules/collection/index.ts
src/modules/collection/jobs.ts
src/modules/collection/plans.ts
src/modules/collection/policy.ts
src/modules/collection/routes.ts
src/modules/collection/sql.ts
src/modules/collection/worker.ts
src/modules/content/export.ts
src/modules/content/facets.ts
src/modules/content/index.ts
src/modules/content/queries.ts
src/modules/content/routes.ts
src/modules/content/search.ts
src/modules/content/sql.ts
src/modules/content/thread.ts
src/modules/projects/batches.ts
src/modules/projects/index.ts
src/modules/projects/routes.ts
src/modules/projects/sql.ts
src/storage/schema/059_project_batches_and_ownership.sql
src/storage/schema/060_batch_visibility_and_field_policy.sql
```
