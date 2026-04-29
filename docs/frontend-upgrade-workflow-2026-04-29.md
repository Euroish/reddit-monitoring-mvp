# Frontend Upgrade Workflow

日期：2026-04-29
状态：active，target-detail recovery landed in working tree
适用范围：当前 `apps/web` 前端升级、UI/UX 优化、图表交互升级、设计资源编排

## 1. 真相源

当前前端升级只以以下内容为执行真相：

1. `obsidian-reddit专用/Projects/project.md`
2. 当前 `apps/web` 代码
3. 本文件

以下内容只能作为历史参考，不能直接当执行合同：

- `obsidian-reddit专用/Projects/后端能力盘点与前端后台规划-2026-04-28.md`
- `docs/analytics-workbench-framework-2026-04-24.md`（只保留产品方向和 guardrails；其中旧的 ECharts/thin-chart 现状已过时）

## 2. 当前已验证前端现状

### 2.1 技术底座

- 前端是 `React 19 + Vite + TypeScript + TanStack Query`
- 全局视觉 token 在 `apps/web/src/index.css`
- 基础 UI primitive 在 `apps/web/src/components/ui/index.tsx`
- 路由入口在 `apps/web/src/App.tsx`
- 壳层导航在 `apps/web/src/app/Layout.tsx`

### 2.2 当前核心页面

- `Dashboard.tsx` 对应 `/markets`
- `MarketBoard.tsx` 对应 `/markets/board`
- `TargetDetail.tsx` 对应 `/target/:targetId`
- `Compare.tsx` 对应 `/compare`
- `Queries.tsx` 对应 `/queries`

### 2.3 当前图表现状

- `apps/web/src/features/workbench/components/WorkbenchChart.tsx` 已替换为本地 `lightweight-charts` adapter
- `apps/web/src/features/workbench/model/chartOptions.ts` 已经提供了稳定的产品级图表模型
- 当前 adapter 保留 `WorkbenchChartModel` 输入边界，后端 DTO 不暴露图表库结构
- 当前图表已具备：
  - crosshair
  - 鼠标/触控拖拽与缩放
  - line/histogram 混合 series
  - primary/secondary 双轴映射
  - 本地 legend/readout
  - TradingView attribution
- 当前图表仍未完成：
  - pane 化的主图/副图拆分
  - 可同步 tooltip/time scale
  - 更强的 marker/annotation 交互
  - 浏览器级桌面/窄屏验收
- 最新浏览器反馈 recovery：
  - 目标页已进入第二轮 recovered workbench：更强的首屏层级、大号 fetched/qualified/driver readout、互动 composition donut。
  - 视觉方向采用 TradingView 信息密度 + Spaceship 式柔和几何深度，不再以卡片堆叠作为首屏主结构。
  - 互动扇形/环形组成图由真实 `TargetWorkbenchResponse.composition` 数据驱动。
  - `Qualified Posts` 和总抓取帖子量已提升为主指标。

### 2.4 当前产品语言

- `project.md` 已明确 target detail 的计数语言应以 `Captured New Posts` / `Captured Qualified Posts` 为准
- 前端升级不能把这部分重新退回旧的 observed-only 语言

## 3. 当前前端升级目标

这次升级不是单纯“换皮”，而是把当前 Reddit analytics shell 提升成更稳定的分析工作台。

目标拆成四层：

1. 统一视觉系统
2. 升级图表交互内核
3. 强化页面分析流，而不是只堆 KPI
4. 建立可重复的设计开发工作流

优先页面顺序：

1. `/target/:targetId`：第二轮 recovery 已落地，下一步是迁移/部署/浏览器验收
2. `/compare`：等 target-detail recovery 浏览器验收后再复用视觉语言
3. `/markets`：先处理返回路由稳定性/重载感，再做视觉重构
4. `/markets/board`
5. `/queries`
6. `/saved`
7. `/ops*` 只做跟随式视觉收敛，不先驱动产品方向

## 4. 图表工具决策

### 4.1 推荐方案

TradingView-like 交互图表优先采用 `lightweight-charts`。

原因：

- 官方定位就是交互式金融图表
- 有现成的 crosshair、time scale、series API
- 提供 pane API，适合把主趋势图和 posts volume 拆开
- TypeScript 直接可用
- 适合在现有 React shell 里包一层自定义适配组件

实现原则：

1. 后端 DTO 不暴露任何图表库私有结构
2. `chartOptions.ts` 继续保持产品级数据模型
3. 新图表库只存在于 `apps/web/src/features/workbench` 内部适配层
4. `WorkbenchChart` 内核已替换；下一步扩交互和页面复用时仍不得大面积改后端 DTO

### 4.2 当前产品建议的 pane 切分

- 主 pane：`heat_price`、`ema_7`、`ema_30`
- 副 pane：`Captured New Posts`、`Captured Qualified Posts`
- overlay：keyword heat、anomaly marker、事件标注
- compare：单 pane 标准化对比线，不先做过度复杂的多 pane

### 4.3 实施注意

- `lightweight-charts` 用于公开页面时需要保留 TradingView attribution
- 不要在前端重新发明指标算法
- 不要为了图表交互改动现有 read-model 语义
- 图表升级以 target/compare/queries 复用为第一目标

### 4.4 新增互动组成图要求

- 已增加可交互扇形图/环形图，用于展示真实数据组成，而不是静态装饰。
- 候选数据维度：
  - listing source mix：`new` / `hot` / `best` / `rising` / `top`
  - post classification mix：qualified / driver / ordinary
  - engagement mix：score-led / comment-led / balanced
- 前端不得伪造组成比例；当前字段来自 `TargetWorkbenchResponse.composition`。
- 扇形图交互包括 hover readout、segment focus 和 mode switch。

## 5. 前端技能与设计资源编排

### 5.1 已安装的外部技能

已安装到 `~/.codex/skills`：

- `web-design-engineer`
- `gpt-image-2`
- `rag-skill`

其中当前前端升级主要使用：

- `web-design-engineer`：视觉实现、页面结构、展示型 HTML/CSS/React 参考
- `gpt-image-2`：需要生成 raster 美术素材、纹理、插图、mockup 时再用

### 5.2 项目内前端技能入口

项目内统一入口保持为：

- `skills/frontend-dev-suite/SKILL.md`

它负责编排：

1. `frontend-patterns`
2. `senior-frontend`
3. `frontend-design`
4. `frontend-ui-ux`
5. `web-design-engineer`
6. `awesome-design-md-main` 设计资源
7. `frontend-browser-review`

### 5.3 `awesome-design-md-main` 的使用顺序

先读文本设计系统，再看 HTML 预览，不反过来。

顺序固定为：

1. 选品牌目录
2. 读 `DESIGN.md`
3. 打开 `preview-dark.html`
4. 如有必要再打开 `preview.html`
5. 只抽取适配当前页面的 token、布局、动效和密度策略

### 5.4 当前 repo 的推荐品牌映射

针对本项目，默认不要随机选设计参考。

- 市场/分析工作台：`kraken`、`linear.app`、`raycast`
- 查询与保存页：`voltagent`、`warp`、`vercel`
- 运维后台：`sentry`、`clickhouse`、`hashicorp`

### 5.5 HTML 资源的实际用途

`awesome-design-md-main` 里的 `preview.html` / `preview-dark.html` 不直接抄页面。

它们只用于四件事：

1. 快速看颜色层级是否成立
2. 快速看标题/正文/mono 字体比例
3. 快速看按钮、卡片、输入框、表格的密度
4. 快速看深色表面是否会塌成一片

## 6. 实际开发流程

### 阶段 A：冻结当前产品语义

- target detail 文案和数据含义已按最新用户反馈重新冻结
- product-facing 主 UI 不再用 `observed` 作为核心语言，改为 fetched/captured pool
- backend/read-model 已区分 `new` time-contiguous totals 与 broader fetched composition pool
- 不重开 compare 超过 6 个 target 之类的边界
- 不根据视觉需要发明新字段

### 阶段 B：抽视觉系统

- `index.css` 已加入第二轮 target recovered visual system：hero band、large metrics、composition donut、grid depth、responsive collapse
- 当前视觉方向：TradingView 信息密度 + Spaceship 风格 polish，避免卡片堆叠和普通后台感
- 再整理 `ui/index.tsx` primitive 的尺寸、状态、边框和阴影
- 目标是统一壳层、卡片、表格、表单、badge、按钮的基本语言

### 阶段 C：图表内核升级

- 已保留 `chartOptions.ts`
- 已在 workbench feature 内用 `lightweight-charts` 替换 `WorkbenchChart` 内核
- 已替换 target detail 使用路径
- 下一步先完成 target-detail 浏览器验收，再复用到 compare、queries
- 不引入 frontend-only 指标公式

### 阶段 D：页面级重构

顺序固定：

1. target detail：第二轮 recovery 已实现，待迁移/部署/浏览器验收
2. compare：target recovery 验收后再推进
3. markets：在 route-return 稳定性确认后执行
4. markets/board
5. queries
6. saved

原因：

- target detail 最能检验图表和分析流
- compare 会验证 shared chart kernel
- markets 会验证列表密度和发现流

### 阶段 E：浏览器验收

每次用户可见改动都要做：

1. 桌面宽屏检查
2. 窄屏检查
3. 图表容器 resize 检查
4. 空状态 / loading / error 状态检查
5. 键盘 focus 和可点击性检查

## 7. 本轮升级的非目标

- 不在这一步引入新的后端公式
- 不做评论级分析 UI
- 不在运维页面先做高风险 SQL 控制台扩展
- 不把所有页面一次性重写成一个新设计系统
- 不先做大量动画再回头修结构

## 7.1 新增产品反馈合同

来自 2026-04-29 浏览器测试：

1. 视觉不接受：当前仍像卡片堆叠，需要更多前端美化，参考 TradingView 和 `https://www.spaceship.com/`。
2. `Qualified Posts` 过少：后端筛选条件已放宽，并在 UI composition rule 中说明新规则。
3. Driver posts 未显示：已增加 driver fallback；如果 growth-fact read-model 为空，使用 captured listing posts。
4. 抓取范围扩大：live collection 已多开 listing lane/window，一个抓 `new`，其余抓 `hot`、`best`、`rising`、daily `top`，并纳入 fetched composition pool。
5. 文案与图表重点：target 主 UI 已把 `Qualified Posts`、总抓取帖子量、driver count 提升为大号主 readout。

实现约束：

- 第 2、3、4、5 条已涉及后端采集、存储 provenance、read-model 和 API contract，不是只在前端改文案。
- `new` 仍是时间连续总量证据；`hot` / `best` / `rising` / `top` 是 broader fetched/discovery pool。UI 可以统一展示抓取池，但不能谎称它是时间完整总量，除非后端提供覆盖证明。
- 扇形/环形图必须使用真实 API 字段；字段不存在时先补合同。

## 8. 本轮完成标准

当以下条件满足，才算前端升级工作流落地：

1. 前端任务统一从 `frontend-dev-suite` 进入：已满足
2. 外部设计技能已可用：已满足
3. `awesome-design-md-main` 已被纳入固定使用顺序：已满足
4. 图表升级路径明确为 `lightweight-charts` + 本地 adapter 边界：已满足，且 target detail 第一轮实现已部署
5. 后续页面升级不再依赖过时盘点文档：已满足
6. 新增完成门槛：target detail recovery 已完成代码实现；仍需迁移、部署、fresh collection、浏览器级桌面/窄屏验收后，才视为产品验收完成

## 9. 当前执行状态

- 已完成：`lightweight-charts` dependency 已安装并被 `WorkbenchChart` 使用。
- 已完成：`/target/:targetId` 第二轮 recovered workbench 已落地，包含 large metric hero、interactive composition donut、driver fallback visibility。
- 已完成：`npm --prefix apps/web run build` 通过。
- 已完成：`npm --prefix apps/web run lint` 通过。
- 已完成：`npm run build` 通过，包含 API 合同/类型检查。
- 未完成：数据库迁移应用、API/web 部署、fresh collection 后的浏览器级验收。
- 下一步：先迁移/部署/验收 target-detail recovery，不再直接推进 `/compare`。
