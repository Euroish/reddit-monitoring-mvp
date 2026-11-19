# 前端架构、双层可视化与 `semrush` 分支融合规范

本文确立产品界面从“单一重型采集后台”转变为 **“高密度编辑级信息流 + 克制、可溯源的交互可视化”** 的完整视觉语言、信息架构、动效标准与对 `origin/feat/semrush-frontend-rebuild@dbf8713` 分支的蒸馏融合准则。

---

## 1. 产品界面定位与三模态表面设计（Read / Explore / Operate）

参考 **Techmeme**（事件聚合）、**Ground News**（来源阵营/权威度微条）、**Folo**（多模态冷静流 + 快捷键）与 **Miniflux**（低噪声速读）的设计法则，严格依据页面使用目的切换界面密度与视觉克制等级：

| 表面模态 | 对应页面路由与默认状态 | 核心阅读与分析体验 |
| :--- | :--- | :--- |
| **1. Read 模态 · 信息流主视图** | **`/` 首页（Stories）**<br>视图：`最新` · `48h 热度` · `08:00 日报`（V2 加 `为你` + `未读/已收藏`）<br>筛选：8 个 `sourceGroup` 频道胶囊 + `tier` + `language` | 打开即读，**首页绝不加载几十 KB–数百 KB 的全量图表库**。每张事件卡呈现：<br>1. `T1 一手` / `T1_5 主创` / `T2` 徽章、来源名与权威标题；<br>2. 简洁摘要与外链媒体缩略图；<br>3. **克制内嵌微图（Inline Micro-Viz，纯 SVG）**：`16px` 高的 **`T1/T1_5/T2` 来源组成彩条** + **`48h 热度小火花线`**，扫一眼即可分辨“这是全网营销号转载，还是一手官方+核心开发者共同热议”；<br>4. 折叠的关联报道条与快捷键导览（`j`/`k` 上下篇、`o` 开原文、`s` 收藏、`m` 标已读/静音）。 |
| **2. Explore & Visualize 模态 · 探索与研判** | **`/content`（内容探索）**<br>**`/projects`（专题对比）** | 当读者从信息流中发现异常热度，下钻进入探索或专题工作台：<br>1. **跨平台发布脉冲柱图（Stacked Activity Pulse）**：按日 / `6h` 对接 `GET /v1/content/facets` 与 `/overview`，有采集无命中画实线 `0`，**覆盖未知区间用斜线 Hatch 纹理显式诚实留白**，点击柱体直接过滤下方列表；<br>2. **48h 热度 × 6h 增速四象限 / 分布条**：区分右上“正在爆发的一手热点”与右下“持续讨论议题”，直观标出 `T1/T1_5/T2` 与实体/体裁占比；<br>3. **单源时间序列观测图（`ObservationChart`）**：严格按 `(sourceId, provider, metricKey)` 分线、遵循 `sourceObservedAt` 真实时间轴并保留 `null` 断档，绝不伪造平滑或跨平台累加分数；<br>4. **三视图评论树抽屉（`ThreadTreeView`）**：`top` / `matches` / `op` 视图切换、OP 徽章、`contextMissing` 提示及“补全本帖讨论”显式水合按钮。 |
| **3. Operate 模态 · 信源运维与工作区** | **`/sources`（来源与预算）**<br>**`/workspace`（收藏与保存查询）**<br>**`/settings`（账户与 Agent Key）** | 服务高确定性操作：展示源健康指纹（`304` 命中率、`lastDurationMs`、截断高亮、连续错误预警）、“先预览前 20 条再创建”选择器助手（`rss`/`web_list`/`json_list`）、OPML/JSON 批量导入弹窗、预算使用率进度条（`QuotaMeters`）与任务恢复（`取消/重试/继续/解封`），支持 `Cmd/Ctrl+K` 全局命令面板快速跳转。 |

---

## 2. `feat/semrush-frontend-rebuild` 分支审计与融合矩阵

远端分支 `origin/feat/semrush-frontend-rebuild@dbf8713`（继承自旧 `dd2feb2`，超前/分叉 2 次提交：`40fb284` R4 插件存档 + `dbf8713` 36 文件 / `637,801 B` 前端重构）引入了工业级的组件拆分、键盘快捷键与 ECharts 封装，但也存在 **4 项不可直接合入的结构性冲突**：
1. **产品重力与契约倒退**：将 `/` 替换成了 1,477 行的 B2B SaaS 宣传首页（含假口碑与排行榜），未接入 `stories` / `feed` / `facets` / `preview` / `import` 与 `050` 新字段，且复制出脱离 `packages/contracts` 校验的 640 行前端私有类型文件；
2. **度量口径违背 `MET-04`**：在 `DailyTrendChart.tsx` 与 `TrendRadarCharts.tsx` 中将不同平台的 `reddit.score` + `x.likes` + `bluesky.likes` 混算总和，`SignalScoreGauge.tsx` 构造了 0–100 人工合成仪表盘分数；
3. **重型包与样式膨胀**：全量 `import * as echarts from 'echarts'` 带来超过 ~300 KB gzip 体积并在 84px 小火花线中每个实例化独立 Canvas，外加 `ThemeStudio`/`themes.ts` 等 5,500+ 行与核心阅读无关的 SaaS 装饰代码；
4. **越界混合**：`R4ArchivePanel.tsx` 硬编码 Windows 本机路径，违反主线与外挂隔离约定。

因此**严禁直接 merge 该分支**，必须严格按以下审计矩阵执行**逐件蒸馏融合**：

| 分支文件 / 能力 | 融合处置 | 具体落地与改造要求 |
| :--- | :--- | :--- |
| `styles/tokens.css`（Editorial Mineral & Ink 配色与排版变量） | **Adopt 采纳底色** | 抽取“温润纸面 `#f7f8f4` / 墨绿正文 `#20271f` / 矿石青主色 `#1f7471` / 细线 `#e3e6dc` / 5–6px 圆角 / `--t-fast` 曲线”；剔除荧光柠檬绿促销渐变条（`--promo-strip-bg` 等）。 |
| `api/client.ts` & `api/hooks.ts` | **Distill 精炼采用** | 保留分域 API + React Query Hook 清晰封装；**删除私有拷贝的 `contracts/api.ts`，全部类型与端点直接复用 `packages/contracts/src/*`** 并补充 `stories`、`facets`、`import`、`preview` Hooks。 |
| `pages/WorkbenchShell.tsx`（919 L） | **Distill 瘦身至 ~250 L** | 仅保留左侧折叠栏（`[` 快捷键）、`Cmd/Ctrl+K` 命令面板、阻塞源/零额度告警角标与响应式抽屉；剔除多品牌切换器与装饰性 SaaS 头部。 |
| `components/charts/ThreadTreeView.tsx`（154 L） | **Adopt 直接复用** | 直接迁移至主线并对齐 `packages/contracts` 类型，补齐键盘折叠、`32 跳` 预警提示与单条评论批注入口。 |
| `components/charts/ObservationChart.tsx`（183 L） | **Rewrite 保留诚实内核** | 完整继承其“按 `(sourceId, provider, metricKey)` 严格分线 + `sourceObservedAt` 回退提示 + 保留 `null` 断档”逻辑，改由懒加载 Chunk 加载。 |
| `components/charts/DailyTrendChart.tsx`（452 L） & `QuotaMeters.tsx` | **Rewrite 接入服务端聚合** | 保留 `createHatchPattern` 斜线“覆盖未知”交互与日期点击钻取，彻底删除前端假分页聚合，改为直连 **`GET /v1/content/facets`** 与 **`GET /v1/projects/:id/overview`**；`QuotaMeters` 改用零依赖 SVG/CSS 进度条。 |
| `Homepage.tsx`、`ThemeStudio.tsx`、`themes.ts`、`SignalScoreGauge.tsx`、`KpiSparkChart.tsx`、`R4ArchivePanel.tsx`、`homepage.css` | **Discard 物理丢弃** | 不进入主线；`/` 始终属于高频信息流（Stories），禁止在阅读首页嵌入 Canvas 仪表盘或主题工作坊。 |

### 双层轻量可视化引擎选型决策

为同时满足 **首页信息流首屏秒开（零重型 JS 包）** 与 **探索/专题页交互式深挖**，确立两层可视化渲染约束：
1. **Tier 1 · 纯原生响应式 `<svg>` 微图引擎（0 KB 外部依赖，常驻首页与来源页）**：实现事件卡片内嵌的 **信源分级分布条（`T1`/`T1_5`/`T2`）**、**48h 热度折线小火花**、轻量 **按日脉冲条** 与 **`QuotaMeters` 预算占比条**；
2. **Tier 2 · 按需懒加载分析图表引擎（`React.lazy` 独立分包，仅在打开 `/content` 趋势视图或 `/projects` 概览/详情时加载）**：优先选用 **`uPlot`（~21 KB gz）** 或经严格按模块按需引入的 **`echarts/core`（仅 `BarChart` / `LineChart` / `ScatterChart` + `CanvasRenderer`，~90 KB gz）**，严禁使用全量 `import * as echarts`。

---

## 3. 视觉体系、排版美学与交互验收标准

- **色彩与表面对比度**：沿用统一矿石编辑风（纸面 `#f7f8f4` / 卡片 `#ffffff` / 炭墨 `#20271f` / 次要文字 `#59645c` / 矿石青 `#1f7471` / 琥珀告警 `#d4821c` / 珊瑚报错 `#d93848`），拒绝盲目暗黑霓虹渐变或多层套娃边框（`>=3` 层描边嵌套）；全部正文与 `--muted` 文字确保满足 WCAG AA（`>= 4.5:1`）。
- **中英文混排与数字稳定**：使用 `Inter` + `Noto Sans SC` + `JetBrains Mono` 栈，正文字宽控制在 `55–70ch`（`text-wrap: pretty`），所有热度值、时间、计数与榜单名次强制开启 `font-variant-numeric: tabular-nums` 防数字抖动。
- **物理动效纪律（Emil Kowalski 标准）**：高频操作（`j`/`k` 切换、`Cmd+K`、频道与视图 Tab 切换）强制 **`0ms` 瞬时响应**；抽屉与气泡使用 `150–220ms cubic-bezier(0.22, 1, 0.36, 1)` 且仅动画 `transform`/`opacity`，严禁 `ease-in` 与 `transition: all`。

| ID | 等级 | 信息架构、图表联动与多端交互规范 | 验收出口 |
| --- | --- | --- | --- |
| UX-01 | MUST NOT | 在默认阅读视图暴露内部工程术语（`Phase`、`Legacy`、`Repository`、规则代号）或营销着陆页；根路径 `/` 永远直达库内信息流（Stories/Feed），项目分析固定在 `/projects`，来源管理与预算调度收拢至 `/sources`。 | 路由与文案审计 |
| UX-02 | MUST | 任意视图同屏只保留一个主要操作；事件与内容卡清晰展示**权威等级（`T1`/`T1_5`/`T2`）、作者/来源名、规范发布与入库双时间、体裁/语种、精选互动或榜单名次及内嵌来源分布/热度微图**；数字列统一 `tabular-nums` 且对比度满足 WCAG AA。 | 首屏密度与视觉审计 |
| UX-03 | MUST | 探索与专题页面通过**双层可视化引擎**（Tier 1 SVG + Tier 2 `React.lazy` 分包）完整渲染后端 `GROUPING SETS` 分面与观测图，无采区间明确画斜线“覆盖未知”，有采无命中显式标 `0`；点击柱体、平台、分级或事件节点联动收窄下方列表，进出详情保留滚动条与过滤条件。 | 图表联动与状态保全 E2E |
| UX-04 | MUST | V2 按题探索支持自然语言拆解状态实时反馈（Wave 0/1/2）与正文完整度区分（`full`/`summary`/`truncated`），并提供“一键关注作者 / 订阅站 RSS”转 `pull` 入口；若启用了 AI 扩展，卡片提供零跳转 `原文 | 双语对照 | AI 综述` 切换胶囊，未开启时零冗余报错。 | 动态探索与 AI 降级单测 |
| UX-05 | MUST | 跨平台直接比较原始点赞/分数遇到 `422` 时提供就地一键切换“内容量 / 事件热度”操作；`ThreadTreeView` 支持 `top`/`matches`/`op` 三视图、32 跳断链提醒、显式“补全本帖讨论”水合与单条评论独立收藏笔记；流式下载须验证 `complete: true` 尾块。 | 三视图、导出与断流测试 |
| UX-06 | MUST | `Sources.tsx` 完整支持目标类型切换、`feed`（含 `web_list`/`json_list`）先预览前 20 条再保存、OPML/JSON 批量导入、健康诊断面板、预算编辑与任务恢复操作；页面在 **`1440×900`、`768×1024` 与 `390×844`** 视口下保持零横向溢出、`dom_critic` 评分 `>= 88` 与全键盘无障碍通达。 | 来源全流与三端响应门禁 |
