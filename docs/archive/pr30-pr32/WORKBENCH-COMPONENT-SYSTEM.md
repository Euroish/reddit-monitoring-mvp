# 工作台组件与主题

工作台运行于现有 React 19、Vite 8 和 TanStack Query 5。UI 源码取自 shadcn 的 Base Nova 注册表，运行时使用 Base UI 1.9.0，构建样式使用 Tailwind CSS 和 Vite 插件 4.3.5。依赖版本和锁文件在 Web workspace 中维护。分析继续使用原有 ECharts 6 和 Lucide。

| 路径 | 职责 | 当前调用方 |
| --- | --- | --- |
| `apps/web/src/components/ui/` | Button、Input、Card、Dialog、Tabs、Alert、Skeleton、Badge、Table | 项目选择、来源运维、接入确认、项目分析、内容探索及个人工作区 |
| `apps/web/src/components/workbench/KpiCard.tsx` | KPI 标签、数值与统计说明，以及可选趋势 | 项目总览 |
| `apps/web/src/components/charts/` | 图表主题、按 UTC 分桶、空态、画布挂载和资源清理 | 项目总览、跨平台分析和内容探索 |
| `apps/web/src/styles/workbench-ui.css` | Tailwind 扫描范围与 SIFTLINE 语义颜色桥接 | 懒加载工作台入口 |

Tailwind 仅导入 theme 和 utilities。Preflight 未导入，原有全局 CSS 继续处理元素默认样式。工具类扫描限定在 UI 源码目录，业务容器复用既有布局类。语义色通过 CSS 变量映射到原主题，ThemeStudio 在根元素应用变量，因此 Base UI Dialog 的 Portal 也能读取工作台主题。项目选择器沿用原工作台的导航层级和小屏菜单，使用 Base UI 管理聚焦、Esc、焦点回收和背景交互。公共首页没有静态依赖工作台交互或 ECharts chunk。

项目分析提供项目全范围 KPI 和按 UTC 窗口筛选的证据样本。全范围的去重讨论根数与命中节点数分别取服务端字段。痛点启发式只针对当前项目最多 100 条已加载样本，CSV 导出同一批经过界面筛选的样本。趋势数据不足显示缺失状态，未知热度在 CSV 中留空。最近 7、30 或 90 天使用同一 UTC 窗口。六小时视图使用服务端时间分桶，平台下钻保留所选窗口和对应的去重模式。表格、分析状态和卡片有独立的加载或重试反馈。

新增组件时沿用现有 UI 目录、Tailwind 本地扫描范围和根主题变量。依赖没有覆盖的交互可继续使用语义 HTML。来源类型与权限不同的流程保持独立页面结构。

[shadcn 的 Vite 安装](https://ui.shadcn.com/docs/installation/vite) · [shadcn 的主题配置](https://ui.shadcn.com/docs/theming) · [Tailwind 的 Preflight 导入规则](https://tailwindcss.com/docs/preflight)
