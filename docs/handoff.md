# 阶段交接与交付状态

用户要求阶段 1、2、3 均形成可交付结果。本文件维护每阶段版本、已实现范围、验证方法、待验收边界与接续步骤；过程见 [开发日志](development-log.md)，稳定启动说明见 [开发说明](development.md)。

## 版本与范围

| 版本 | 范围 | 当前交付状态 |
| --- | --- | --- |
| abd24f5 | 上一轮 Arctic Shift 内容采集/查询及共享接口快照 | 已保存本地；上一轮真实小样本验证不等于本轮真实来源测试 |
| 0.2.0（阶段 1） | 图表/保存/统计/增长与既有回归、原子迁移、本地开发入口 | 本地提交 52636a1；标签 local-phase1-v0.2.0；独立快照 365 项：362 pass / 3 skip / 0 fail，构建通过 |
| 0.3.0（阶段 2 中间快照） | 来源生命周期、周期任务、成熟归档刷新、任务中心/预算/心跳；提前交付统一统计/导出基础 | 0a05f41 构建通过，独立回归发现稳定 ID 前缀漏项；保留记录，不作为交付版本 |
| 0.3.1（阶段 2 交付） | 同上，补齐公共稳定身份前缀 | 提交 0496b1d / local-phase2-v0.3.1；独立快照 386 项：382 pass / 4 skip / 0 fail；构建通过 |
| 0.4.0（阶段 3 交付） | X 可配置 adapter 与 demo、共享身份/规范写保护、请求观测、双语入口和多平台查询/导出 | local-phase3-v0.4.0；最终离线 400 pass / 7 SQL skip / 0 fail，SQL 另跑 7/7；真实 X 按用户意见保留 |

## 验收约束

- 本轮不调用 Arctic Shift、Reddit 或 X 真实采集 API，也不产生付费 provider 费用。localhost 服务、隔离 SQL 与合成 provider 可以用于冒烟/E2E。
- 离线测试、真实数据库测试、浏览器流程和真实来源/持续新鲜度验收分开记录。48–72 小时模拟时钟不代表 48–72 小时真实网络运行。
- 本地功能分支逐路径提交；不 push、force push、删分支或合并 PR。凭证、数据库与报告不进 Git。
- 前端保留现有工作台结构，补充来源配置、任务、查询/导出等功能。只有实际功能实现受到重大阻碍时，才另评估大规模前端改进；当前没有据此重设计。

## 与审计清单的对应

基线仍为最初接手的 cd920c5，上一轮 Arctic Shift 保存快照为 abd24f5；不是把阶段 1 后的样子改称初始基线。来源获取新功能和旧模型修正分开记。

| 原任务 | 本轮交付或保留 |
| --- | --- |
| P0-01 / P0-02 / P0-03 | 原 17 失败修复、日期并集/null、图表生命周期和移动布局回归 |
| P0-04 | 合法比较/目标 URL、保存失败提示、系列/overlay/范围恢复；非法路径仍拒绝 |
| P0-05 / P1-11 / P1-12 | 同范围完整计数/独立样本；中文/英文词项与负向排除；写入索引、有界回填；旧 OR 与公共连续字面、emoji/标点/上游语法明确区分 |
| P0-06 / P0-07 | v2 实际观测差分，旧 v1 不作为实测增长；平台/provider、真实/合成、null/0、时间和覆盖均显式；旧榜单候选上限标识 |
| P1-14 | 正式 Windows local:*、独立复制 PostgreSQL、owner/端口/代理/进程身份、重复启动和完整停止/重启保留数据 |
| P1-01 / P1-02 / P1-05 | 来源标签/分组/状态/设置、持久化周期/增量/重叠/有界追赶与 checkpoint 子任务、任务历史/取消/恢复/冲突 |
| P1-04 | 成熟归档按 ID 有界补抓、独立观测、晚到旧字段不覆盖；X snapshot 不套用成熟刷新 |
| P1-06 / P1-18 | 每日/月度请求与保守资源预留、重试/退避/页间让出、默认付费禁止；心跳/队列/独立时间年龄/页计数、已登记请求和取页解析耗时 |
| P1-07 | 全部公共字段单调更新、旧路径 canonical guard、web namespace 身份工具；尚无真实 web adapter |
| P1-08 / P1-10 | 公共观测查询/基础平台与渠道工作台，JSON/CSV 有界安全导出和同过滤分母/续页；旧热度模型迁移仍后续，不发明跨平台 heat |
| P1-09 | TwitterAPI.io 可配置账号/搜索/ID adapter、能力注册/预算/字段/分页/限流与离线闭环；真实 X 凭证、费用、覆盖/新鲜度验收保留 |
| P1-13 | 动态平台/provider/目标/指标、来源→内容入口、设置/预算/最近任务、空态链接；保留原 UI 结构 |
| P1-03 | 72 小时模拟与真正本地合成闭环通过；48–72 小时真实来源持续验收明确未执行 |

## 修改文件与证据

- 公共契约：[source-content.ts](../packages/contracts/src/source-content.ts)。后台主要为 source-content service/repository、provider interface、Arctic/X/demo connector、source worker、共享 web identity；旧关键词/增长/质量阈值路径同时修正。
- 数据库新增 030 来源生命周期、031 X 注册、032 请求观测；原迁移 checksum 保持。旧 PostgresContent upsert 保护公共规范字段，run-migrations 保证事务/并发锁。
- API 为 source-content-routes、create-api-server、saved-view-route 与环境加载入口；Web 为图表/URL/Saved/Compare/TargetDetail、Content 与四个管理/导出组件及旧分析范围说明。
- 本地工具为 scripts/local-dev.mjs、seed-local-demo.ts、backfill-post-search-index.ts、三套 smoke 脚本；相应离线/权限/native SQL 测试覆盖真实语义边界。正式文档八份按原职责更新。
- 完整阶段文件列表可用 `git diff --name-only abd24f5 local-phase3-v0.4.0`，最初基线完整对照用 `git diff --name-only cd920c5 local-phase3-v0.4.0`；原始证据只在忽略目录。final-stage3-offline-tests.txt、final-postgres-tests.txt、final-stage3-build.txt 与各专题报告在 output/validation/，合成 UI 与本机流程在 output/playwright/ 和 output/local-dev/smoke-evidence.json。

## 本地验证与接续

已初始化的本机使用 `npm run local:start`，地址/进程看 `local:status`，owner 凭证看 `local:account`；进入 `/content` 即可查询 Reddit/X 合成数据与管理来源。首次其他机器需要完整 PostgreSQL bin 和 Node/npm 依赖，流程统一在 [开发说明](development.md)。`smoke:local` 写入有界合成 E2E 来源后归档，不运行真实 provider；完整测试与隔离 SQL 指令也见开发说明。

后续只有得到用户真实请求授权与私有凭证/预算后，才安排真实 Arctic/X 小样本与连续新鲜度验收。进一步交付目标是保留策略、实际负载/容量、旧热度向公共观测迁移以及生产部署；这些不因本轮离线通过而自动完成。

前端目前存在旧/新分析入口并列和信息密度问题，但新增来源/任务/预算/导出流程均可运行且桌面/390px 已验收，没有必须开始大规模前端改造的功能阻碍。后续可以根据实际使用反馈评估默认入口与导航调整，当前不启动重设计计划。
