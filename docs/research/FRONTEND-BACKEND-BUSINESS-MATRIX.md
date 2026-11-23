# PR30 前后端业务矩阵

依据 React 入口、实际 HTTP 注册、鉴权策略、公共契约以及隔离环境中的浏览器和 PG16 用例核对。

| 页面与操作 | 实际客户端或 Hook | HTTP 与契约 | 角色及数据归属 | 预期状态与证据 |
| --- | --- | --- | --- | --- |
| 研究与资讯来源目录、新建及编辑 | getSources / useSourcesQuery，updateSource / useUpdateSourceMutation | GET /v1/sources，POST /v1/sources，PATCH /v1/sources/:id；Source、SourceInput、SourceUpdate | 读取依会话及来源范围；管理员可编辑，授权机器限 sources:write；collection 管理 collection_source | 创建后定位、暂停及调度分别展示，重复版本返回 409。来源浏览器旅程与 PG16 来源用例。 |
| 资讯预览、导入和诊断 | previewSource、importSources、useSourceJobsQuery | POST /v1/sources/preview、/import，GET /v1/sources/:id/jobs；SourcePreview、SourceImportInput、JobStatusQuery | 管理员浏览器预览与导入；collection 管理来源和任务，content 写入样本 | 真实 Feed 解析、OPML 和 JSON、未更新与失败、无合法预览时拦截。隔离外部请求用测试响应。 |
| 额度、凭证和渠道设置 | useQuotasSummaryQuery、getProviderCredentials、更新额度与凭证的 mutation | GET /v1/quotas/summary、/v1/sources/credentials、预算和计划策略端点 | Viewer 读取本人额度；管理员管理渠道、预算和阻断，collection 持有凭证仓与预算 | PG16 验证 Free/Pro、凭证隔离、停用预算、未知计费状态。 |
| 项目选择、创建及总览 | getProjects / useProjectsQuery，getProjectOverview / useProjectOverviewQuery | GET /v1/projects、/v1/projects/:id/overview，POST /v1/projects；ProjectInput | 浏览器写入，Viewer 自有项目可编辑，系统共享只读；projects 持有 monitor_project | 浏览器验证深链、前进后退、搜索、只读及刷新；PG16 验证专属项目和 Free 项目数边界。 |
| 接入预检与采集提交 | previewResearchPlan / usePreviewResearchPlanMutation，collectSource / useCollectSourceMutation | POST /v1/research/collection-plans/preview、/v1/sources/:id/collect；ResearchPlanPreviewInput、采集选项及 Idempotency-Key | 预检与带项目的提交要求浏览器会话及项目写权限；collection 持有任务与额度 | 未登记、预检过期、参数改变、渠道预算变更、Pro 二次确认，任务可轮询，Worker 完成后关联批次。 |
| 批次列表、复用及状态修改 | getBatches / useBatchesQuery，attachProjectBatch / useAttachProjectBatchMutation，useUpdateProjectBatchStatusMutation | GET /v1/batches，GET/POST /v1/projects/:id/batches，PATCH /v1/projects/:id/batches/:batchId | Viewer 限本人及共享批次；projects 持有 monitor_project_batch；collection 持有 collection_batch 与 collection_batch_item | 重叠批次去重，私有批次不露出计数或记录；启停影响项目分析，复用上游调用计数保持不变。 |
| 内容探索、项目分析及导出 | listContent / useContentListQuery，getContentFacets / useContentFacetsQuery，内容探索的 exportContent | GET /v1/content、/v1/content/facets、/v1/content/export；ContentFilter 与 ContentFacetsQuery | 内容可见性由会话与项目共同验真；机器读取需要 read，导出需要 export；content 持有内容及观测 | PG16 验证来源范围、项目批次、分面和流式导出；项目分析 CSV 对应当前证据样本，内容探索导出使用后端分页流。 |
| 个人工作区 | 工作区列表和注释 mutation | /v1/workspace/`*`；个人资产与注释契约 | 浏览器主体隔离；workspace 管理收藏和批注 | 空态、个人资产、无权访问和旧版本写入冲突由浏览器及 PG16 覆盖。 |

[查看验证命令、角色覆盖和未核验环境](PR30-VERIFICATION.md)



## 第二轮用户路径

| 操作 | 实际调用与约束 | 结果或失败路径 |
| --- | --- | --- |
| 首次进入 | 项目清单、近期项目任务、额度摘要与 `GET /v1/batches?forProjectId=` | 写权限和用途范围决定可添加清单。仅有可用数据时显示入口。 |
| 选择研究对象 | `POST /v1/research/collection-plans/preview` 用小范围检查来源和权限 | 未登记和渠道限制以结构化业务码提示，停留在对象选择。管理员可带对象进入来源登记。 |
| 设置范围与确认 | 同一预检接口按实际选项计算预计请求和消耗 | 不可执行时没有额度确认动作。可执行时显示实际范围、估算和已有样本。 |
| 开始、刷新与查看 | `POST /v1/sources/:id/collect` 保留幂等键，`/v1/source-jobs/recent` 按项目和 jobId 查状态 | 预算变化拒绝，沿用原键重试；队列状态来自数据库。批次可用后提供结果入口。 |
| 使用已有数据 | `POST /v1/projects/:id/batches` 严格检查项目写权限与批次授权 | 成功刷新项目、已有数据、分析和内容缓存。复用不调用采集服务。 |
| 双来源管理 | `GET/PATCH /v1/sources`，预览、项目查询、历史任务和来源内容查询 | 研究看运行与影响，资讯看文章及更新；推送只提供适用的入口，管理员配置与 Viewer 无权限态分开。 |
| 批次与来源交集 | `GET /v1/projects/:id/content?sourceId=`，collection 参数化批次只读条件 | PG16 用同一内容在两来源的记录验证。只允许批次与显式来源条件在同一个来源发现记录上匹配。 |
