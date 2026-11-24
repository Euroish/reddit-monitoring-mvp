# 工作台组件盘点

| 入口 | 现有实现 | 整合工作 |
| --- | --- | --- |
| 来源目录与新建 | SourcesPage、SourceDomainOverview、SourceEditor、SourceImportDialog | 保留真实操作与双领域重点，核对键盘、加载和业务状态 |
| 项目选择 | WorkbenchShell、ProjectSwitcher 原生 Dialog | 保留搜索、权限分组和 URL 切换；迁移对话框交互底座 |
| 数据接入 | ProjectCollectView、ProjectWorkspaceViews | 保留步骤与幂等确认，统一卡片、任务和批次表 |
| 项目 Dashboard | ProjectsPage、CrossPlatformAnalyticsPanel、KpiSparkChart、DistributionCharts | 核对项目查询和指标窗口，统一容器并移除模拟趋势 |
| 检索与研究 | ContentExplorerPage、WorkspacePage | 审查筛选、读写权限、导出和查询缓存 |
| 品牌与主题 | tokens.css、global.css、workbench.css、ThemeStudio | 样式桥接优先继承原 Tokens；验证 Portal、动态主题与公开站 |
