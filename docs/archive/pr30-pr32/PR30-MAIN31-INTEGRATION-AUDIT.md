# PR30 与 PR31 整合审计

PR30 基线 8221dd2，主干 4b05369，共同基线 8626ce7。合并预览识别 18 个内容冲突。PR31 保留七域 DAG、路由声明、SQL 表读写检查和 Worker 通知机制。

| PR30 文件 | 状态 | 主干重叠 | 整合处置 |
| --- | --- | --- | --- |
| `apps/api/src/route-policy.ts` | M | 是 | 保留主干声明式策略；重新声明功能路由 |
| `apps/api/src/server.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `apps/web/src/App.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/api/ai-client.ts` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/api/client.ts` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/api/hooks.ts` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/CollectionJobsView.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/CrossPlatformAnalyticsPanel.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/ProjectCollectView.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/ProjectSwitcher.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/ProjectWorkspaceViews.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/ProviderBudgetEditor.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/ProviderBudgetTable.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/ProviderCredentialsTab.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/QuotasManagementView.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/R4ArchivePanel.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/SourceDomainOverview.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/SourceEditor.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/SourceImportDialog.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/ai/AiSourceOperations.tsx` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/components/charts/QuotaMeters.tsx` | D | — | 迁移业务并以真实接口验证 |
| `apps/web/src/contracts/api.ts` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/lib/collectionLimits.ts` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/pages/AiReviewQueuePage.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/pages/ContentExplorerPage.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/pages/ProjectsPage.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/pages/SettingsPage.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/pages/SourcesPage.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/pages/WorkbenchShell.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/pages/WorkspacePage.tsx` | M | — | 迁移业务并以真实接口验证 |
| `apps/web/src/styles/collection.css` | A | — | 迁移业务并以真实接口验证 |
| `apps/web/src/styles/workbench.css` | M | — | 迁移业务并以真实接口验证 |
| `docs/contracts.md` | M | — | 保留并验证 |
| `docs/design.md` | M | — | 保留并验证 |
| `docs/research/data-ingestion-alignment-2026-11-22.md` | A | — | 保留并验证 |
| `eslint-suppressions.json` | M | 冲突 | 适配主干后恢复业务变更 |
| `packages/contracts/src/ai-catalog.ts` | M | 是 | 适配主干后恢复业务变更 |
| `packages/contracts/src/collection-budget.ts` | A | — | 保留并验证 |
| `packages/contracts/src/source-content.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `scripts/check-table-ownership.ts` | M | 冲突 | 保留主干门禁；仅登记新增表所有者 |
| `src/modules/ai/ai-discovery.ts` | M | 是 | 适配主干后恢复业务变更 |
| `src/modules/ai/ai-llm.ts` | M | — | 保留并验证 |
| `src/modules/ai/ai-routes.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/collection/batches.ts` | A | — | 保留并验证 |
| `src/modules/collection/config.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/collection/credentials.ts` | M | 是 | 适配主干后恢复业务变更 |
| `src/modules/collection/hydrate.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/collection/jobs.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/collection/plans.ts` | A | — | 保留并验证 |
| `src/modules/collection/policy.ts` | M | 是 | 适配主干后恢复业务变更 |
| `src/modules/collection/routes.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/collection/sql.ts` | M | 是 | 适配主干后恢复业务变更 |
| `src/modules/collection/worker.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/content/export.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/content/facets.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/content/routes.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/content/search.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/content/sql.ts` | M | 是 | 适配主干后恢复业务变更 |
| `src/modules/content/thread.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/projects/batches.ts` | A | — | 保留并验证 |
| `src/modules/projects/index.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/projects/routes.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/modules/projects/sql.ts` | M | 冲突 | 适配主干后恢复业务变更 |
| `src/storage/schema/059_project_batches_and_ownership.sql` | A | — | 保留已应用字节，验证前向兼容及索引门禁 |
| `src/storage/schema/060_batch_visibility_and_field_policy.sql` | A | — | 保留已应用字节，验证前向兼容及索引门禁 |
| `tests/browser/workbench.test.ts` | M | — | 保留并验证 |
| `tests/integration/ai-catalog-postgres.test.ts` | M | — | 保留并验证 |
| `tests/integration/kernel-postgres.test.ts` | M | — | 保留并验证 |
| `tests/integration/project-batches-postgres.test.ts` | A | — | 保留并验证 |
| `tests/unit/web-contracts-and-labels.test.ts` | M | — | 保留并验证 |



## 后端兼容与迁移结果

- API 装配层注入项目可编辑校验、批次关系处理和 Worker 健康度读取。PR31 的单向依赖、声明式鉴权、分域共享契约、PG LISTEN/NOTIFY 和表级所有权检查均保留。
- 批次清单与可见性由 collection 验证，项目关系由 projects 持有。内容过滤接收 collection 构建的参数化批次见证，并在同一 discovery 来源范围内求交。Viewer 的项目统计和批次清单共享授权口径，机器访问受 scope 和来源范围约束。
- 已应用迁移 `059` 和 `060` 保留原始字节。059 的 SHA-256 为 `ca149dda66979d260c2d2091b11d97ffbb88ed19d8366cdab48c0052ba75c893`，060 为 `3ebc21d5e74029b4eb963dc4eece265311ced206a3f15112d0ece97964bdc44c`。本机既有 060 台账的对应记录已只读核对。
- 059 的三个普通索引位于同一事务新建的空表上。从其已应用的哈希限定单条 Squawk 例外可维护可重放性。工作流仅把待验证的 SQL 文件交给 Squawk。新旧迁移的 Atomic rollback、058 到 060 及幂等重跑由隔离 PG16 验证。

[业务矩阵](FRONTEND-BACKEND-BUSINESS-MATRIX.md) · [缺陷记录](BASELINE-DEFECTS.md) · [验证记录](PR30-VERIFICATION.md)
