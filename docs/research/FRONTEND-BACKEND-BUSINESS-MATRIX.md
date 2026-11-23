# 前后端业务矩阵

Phase 0 以 PR30 源码核对调用链。主干合入后的角色和故障结果待 API、PG16 与浏览器复测。

| 页面与操作 | 实际客户端 / Hook | HTTP 与契约 | 角色及数据归属 | 待复测结果 |
| --- | --- | --- | --- | --- |
| 两域来源目录与编辑 | getSources / useSourcesQuery，updateSource / useUpdateSourceMutation | GET /v1/sources，PATCH /v1/sources/:id · Source、SourceUpdate | 会话读，管理员写 · collection 管理 collection_source | 创建后定位，409 与暂停 |
| 来源预览、导入、凭证 | previewSource、importSources、getProviderCredentials | POST /v1/sources/preview、/import，GET /v1/sources/credentials | 管理员浏览器 · collection | Feed 抓取、OPML、密钥就绪 |
| 项目选择与总览 | getProjects / useProjectsQuery，getProjectOverview / useProjectOverviewQuery | GET /v1/projects、/v1/projects/:id/overview | 项目所有权与来源范围 · projects 管理 monitor_project | Viewer 切换、只读、深链和历史 |
| 预检与采集 | previewResearchPlan / usePreviewResearchPlanMutation，collectSource / useCollectSourceMutation | POST /v1/research/collection-plans/preview、/v1/sources/:id/collect | 预检浏览器，带 projectId 的提交需项目写权限 · collection 管理来源、配额和任务 | 未登记、预算变更、幂等和任务关联 |
| 批次与项目关系 | getBatches / useBatchesQuery，attachProjectBatch / useAttachProjectBatchMutation | GET /v1/batches，GET/POST /v1/projects/:id/batches，PATCH /v1/projects/:id/batches/:batchId | Viewer 限本人及共享；projects 管理关系，collection 管理批次 | 私有隔离、禁用及复用零上游请求 |
| 内容与分析 | listContent / useContentListQuery，getContentFacets / useContentFacetsQuery | GET /v1/content、/facets、/export | 读取范围由项目和会话共同确定 · content 管理内容与观测 | 冻结筛选、下钻及导出一致性 |
