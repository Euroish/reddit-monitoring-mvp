# 前端架构、双层可视化与 `semrush` 分支融合规范（STD-100）

本文严格区分 **`[LIVE]` 线上前端现状** 与 **`[V2]` 融合改造规格**，防止误将未实现 UI/图表写成现状。

---

## 1. `[LIVE]` 现状 vs `[V2]` 三模态界面演进

- **`[LIVE]` 现行统一前端（`apps/web/src`，信息流优先 + Siftline 监测工作台融合形态）**：
  - **`/`（公开 Stories 信息流）**：`publicRead=true` 时允许匿名直读（`publicRead=false` 时呈现内联登录门控）；提供 `latest`（今日精选）、`hot`（48h 热度）、`digest`（08:00 日报与历史日期切换）、8 频道/等级/语种过滤、`StoryMicrocharts`（零依赖 SVG）、`ReaderDrawer` 与 `j`/`k`/`m` 快捷键，首屏零 ECharts 依赖；
  - **`/product`（产品介绍页）**：保留 `Homepage.tsx` 与视觉资产，提供直达 `/` 信息流与 `/projects` 工作台入口，已清除虚构排行、客户评价与静态伪指标；
  - **`/content`（内容检索与分面分析）**：`publicRead=true` 支持匿名检索、详情抽屉与真实 `/v1/content/facets` 按需分面分析（显示实际 UTC 窗口，查询跨度最多 90 天，推流样本按专题趋势设置计入），收藏/批注/保存查询/流式导出严格鉴权门控；
  - **`/projects`、`/sources`、`/workspace`、`/settings`（登录态工作台）**：保留 `WorkbenchShell`、Theme Studio（17 套皮肤）、30 套品牌 Logo 与 `R4ArchivePanel`，恢复 `/sources` 规范 JSON 文件导入（1 MiB 预检，载入编辑器后手动提交，失败重试复用幂等键）与动态 UTC 采集窗口；`/projects` 保留真实 `DailyTrendChart`、`DistributionCards` 与讨论表并隐藏虚构 `SignalScoreGauge` 与跨平台相加的 `TrendRadarCharts`；`/workspace` 仅展示真实批注/收藏计数；ECharts 保持 `React.lazy` 模块化 `echarts/core` 按需加载。
- **`[V2 Phase B–D]` 目标演进**：

| 表面模态 | 路由与阶段 | 核心阅读与分析体验 |
| :--- | :--- | :--- |
| **Read · 信息流主视图** | **`/`（Stories）**<br>`[V2 Phase A/B]` | 打开即读。每张事件卡呈现：`T1`/`T1_5`/`T2` 徽章、原题与摘要、**Tier-1 纯原生 SVG 内嵌微图（16px 权威分布条 + 48h 热度火花线，数据由 Phase A `readStoryWindow` 提供）**、关联报道折行及 `j`/`k`/`o`/`s`/`m` 键盘速读；Phase B 接入 `read_before_at` 未读水位线与 `为你` RRF；Phase D 接入轻量 `原文 \| 双语对照 \| AI 综述`（若启用）。 |
| **Explore & Visualize · 探索与专题** | **`/content` & `/projects`**<br>`[V2 Phase A/B]` | 按需下钻：Tier-2 懒加载模块化 **`echarts/core`** 渲染后端 `GROUPING SETS` **跨平台脉冲柱图（无采集区间显式绘斜线 Hatch，有采零命中标 `0`）**、48h 热度 × 6h 增速四象限、`ObservationChart`（按 `(sourceId, provider, metricKey)` 严格分线、保留 `null` 断档）、多专题对比（Phase B）与三视图评论树 `ThreadTreeView`（`top`/`matches`/`op`）。 |
| **Operate · 运维与工作区** | **`/sources`、`/workspace`、`/settings`**<br>`[LIVE]` + `[V2 Phase A]` | 维持 `/sources` 作为导入、预览、预算（SVG/CSS `QuotaMeters`）与源健康（`304%`/`lastDurationMs`/截断/错误）主控台；Phase A 融合精简版 `WorkbenchShell`（`[` 折叠、`Cmd/Ctrl+K` 命令面板、告警角标）。 |

---

## 2. `feat/semrush-frontend-rebuild` 分支审计与融合矩阵

> **拉取提醒**：`origin/feat/semrush-frontend-rebuild@dbf8713`（含 `40fb284` + `dbf8713`，36 文件 / `637.8 KB`）目前仅位于 GitHub 远端 `origin`，审阅或提取前须在仓库执行 **`git fetch origin feat/semrush-frontend-rebuild`**。**`MUST NOT` 整支 merge 到 `prod`**，必须逐件执行下表裁剪：

| 分支资产（`@dbf8713`） | 处置决策 | 审计发现的隐患与准确落地方式 |
| :--- | :--- | :--- |
| `styles/tokens.css` | **Adopt** | 采纳 Editorial Mineral & Ink 色板（`#f7f8f4` 纸面、`#20271f` 炭墨、`#1f7471` 矿石青、`#e3e6dc` 细线、WCAG AA `--muted >= 4.5:1`、`tabular-nums`）；剔除荧光柠檬绿促销渐变条。 |
| `api/client.ts` & `api/hooks.ts` | **Distill** | 采纳 React Query 封装模式；**彻底删除其私有拷贝且残余 `THREE_ALNUM_RE`（误杀 `算力`/`o3`）的 `contracts/api.ts`**，改从 `packages/contracts/src/*` 直接引型，并补全 `stories`/`facets`/`preview`/`import` Hooks。 |
| `vite.config.ts`、`i18n/translations.ts`、`SettingsPage.tsx`（Key 管理）、`ContentExplorerPage.tsx`（导出/并发保护） | **Distill** | 提取分包构建配置、中英文词条骨架、43 位 Machine Key 复制 UX 与并发导出状态保护，接入现行 API。 |
| `pages/WorkbenchShell.tsx`（919 L） | **Distill (~250 L)** | 仅保留 `[` 侧栏折叠、`Cmd/Ctrl+K` 命令面板与阻塞源/零额度告警角标；剔除 SaaS 品牌切换器与多主题工坊挂件。 |
| `components/charts/ThreadTreeView.tsx`（154 L） | **Adopt** | 迁移三视图结构（`top`\|`matches`\|`op`、32 跳预警、OP 徽章），补单条评论独立笔记与显式水合入口。 |
| `components/charts/ObservationChart.tsx`（183 L） & `chartUtils.ts` | **Rewrite** | 完整保留按 `(sourceId, provider, metricKey)` 分线、`sourceObservedAt` 回退与 `null` 断档；**将 `chartUtils.ts` 的 `createHatchPattern` 从被丢弃的 `useTheme()` 解耦为静态 token**，切至按需加载的 `echarts/core`。 |
| `DailyTrendChart.tsx`（452 L） & `QuotaMeters.tsx` | **Rewrite** | 原 `DailyTrendChart` 截断前 100 行且伪造 `{ reddit: 1 }` 分平台柱图、并因后端缺 `(day, platform)` 造假：改造为**直连后端补充 `(day, platform)` 后的 `GET /v1/projects/:id/overview` 与 `GET /v1/content/facets`**；`QuotaMeters` 改用零依赖 SVG/CSS。 |
| `Homepage.tsx`、`AuthModal.tsx`、`ThemeStudio.tsx`、`themes.ts`、`R4ArchivePanel.tsx`、`SignalScoreGauge.tsx`、`TrendRadarCharts.tsx` | **Curate / Hide** | `Homepage.tsx` 移至 `/product` 并清除假排行/评价/静态指标；`AuthModal.tsx` 修复密码校验（注册 `>=12`、登录 `1..128`）、开放注册文案与示意标注；`ThemeStudio.tsx`、30 套 Logo 与 `R4ArchivePanel.tsx` 保留；`SignalScoreGauge.tsx`、`TrendRadarCharts.tsx` 及 `WorkspacePage.tsx` 臆造研判百分比已从生产视图隐藏，避免违背 `MET-04` 度量诚实性。 |

### 双层图表架构锁定（Phase A 唯一技术路线）

1. **Tier 1 · 原生响应式 `<svg>` 微图（`0 KB` 依赖，常驻首页与来源页）**：渲染故事卡片 `T1`/`T1_5`/`T2` 分布条、48h 热度火花线与预算 `QuotaMeters`。
2. **Tier 2 · `React.lazy` 懒加载模块化 `echarts/core`（仅 `/content` 与 `/projects` 加载）**：严格按需注册 `BarChart` + `LineChart` + `ScatterChart` + `MarkArea` + `CanvasRenderer`（初始首页零加载，分析模块体积以构建输出为准），**绝不使用全量 `import * as echarts`**；放弃 `uPlot`（缺乏原生堆叠柱、斜线 Hatch 与象限散点支持）。

---

## 3. `[V2]` 排版、动效与 UI 规范（`docs:check` 受控规则）

- **动效物理规范**：高频切页、`j`/`k` 游标与 `Cmd+K` 锁定 **`0ms` 瞬时响应**；抽屉与弹窗使用 `150–220ms cubic-bezier(0.22, 1, 0.36, 1)` 且只允许动画 `transform`/`opacity`（禁 `ease-in` 与 `transition: all`）。

| ID | 等级 | 信息架构、图表联动与多端交互规范 | 验收出口 |
| --- | --- | --- | --- |
| UX-01 | MUST NOT | 在界面暴露 `Phase`、`Legacy`、`Repository` 等内部工程代号；`/` 为公开 Stories 信息流主视图，`/product` 保留产品介绍页，`/content` 为公开/登录态内容检索与分面分析，`/projects` 为项目监测总览，`/sources` 为来源/采集/配额运维，`/workspace` 与 `/settings` 为个人研究与账户治理。 | 路由与文案审计 |
| UX-02 | MUST | 任意视图同屏只突出一个主操作；事件与内容卡展示等级（`T1`/`T1_5`/`T2`）、作者/来源名、发布/入库双时间、体裁/语种、互动或榜单名次及 `[V2]` 内嵌微图；数字启用 `tabular-nums`，正文字宽 `55–70ch`，对比度满足 WCAG AA。 | 卡片元数据与对比度审计 |
| UX-03 | MUST | `[V2 Phase A]` `/content` 与 `/projects` 经双层可视化引擎渲染服务端 `GROUPING SETS` 分面，无采区间明确画斜线“覆盖未知”，有采无命中显式标 `0`；点击柱体/分面联动过滤下方列表并进出细节保留筛选与滚动条。 | 图表联动与状态 E2E |
| UX-04 | MUST | `[V2 Phase D]` 按题探索实时展示 4 槽取证波次与 `full`/`summary`/`truncated` 完整度并支持一键转 `pull`；若启用 AI 扩展则提供零跳转 `原文 \| 双语对照 \| AI 综述` 胶囊，关闭时不报错。 | 探索与 AI 降级单测 |
| UX-05 | MUST | 跨平台比较原始互动返 `422` 时提供一键切换“内容量 / 事件热度”；`[V2 Phase A]` `ThreadTreeView` 支持 `top`\|`matches`\|`op`、32 跳预警、单条评论笔记与显式水合；流式下载必须验真 JSON `complete: true` 尾块。 | 三视图、导出与断流 E2E |
| UX-06 | MUST | `Sources.tsx` 完整支持目标类型切换、预览前 20 条、OPML/JSON 导入、健康面板、预算编辑与任务恢复；页面须在 `1440×900`、`768×1024`、`390×844` 下保持零横向溢出、键盘可达且 `[V2]` 改造须通过 `dom_critic >= 88`。 | 来源全流与三端门禁 |
