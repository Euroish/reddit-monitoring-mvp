# 当前实现与证据状态

核对日期：`2026-11-16`。本轮工作分支：`r1-content-batch`，基于当前主线文档开始重整。用户明确说明：过去的本机部署均为内部测试，从未公开运营；本轮不兼容旧测试服务、不执行部署，先整体清理与重建后再考虑开放。以下只记录当前源码及实际检查结果，目标规范的其余条目仍是待办。

## 1. 当前主链

- 唯一 API 入口改为 `apps/api/src/server.ts` → `app.ts` → Fastify 5 五模块；已物理删除旧 `node:http` 巨型入口、`Phase1` runtime、单实现 Repository、全部 InMemory SQL 模拟器、独立 worker、旧趋势/市场/异常任务与对应旧业务脚本。
- 保留 `access / collection / content / projects / workspace` 的函数式 SQL 与路由；新模块不导入旧层。全应用一个 `pg.Pool`，进程内两个工作槽；默认连接/SQL/锁/空闲事务均有上限。
- 仅保留 `kaix` 与 Bluesky AppView 两个现有在线连接器，外加标准 `external_ingest`；`Arctic Shift`、`TwitterAPI.io` 在线源码、环境注册及 `opossum` / `rate-limiter-flexible` 依赖实删。历史观测的真实 provider 不改写。
- Web 已替换为五导航“项目 / 内容库 / 来源 / 我的研究 / 设置”；旧 Phase1、Markets、Trends、Heat、Growth、冻结研究等页面实删。按页面职责保留五个组件，移除图表库及旧双语/说明墙。
- 根脚本与 CI 已转向新入口和唯一 PG16 HTTP 套件；发布构建先清空生成目录，发布包不再要求独立 worker，也不打包残留旧 runtime。

## 2. 已编码行为与剩余差距

| 范围 | 当前实际行为 | 尚待完成 |
| --- | --- | --- |
| 鉴权与安全 | Default-Deny、同源写校验、签名 HttpOnly Cookie、复用 app_session 的受限机器 Key、viewer 写限制、撤销/过期/credential_version、全局及登录限流、鉴权 OpenAPI/capabilities | 完整账户管理界面、代理/TLS 与生产 Compose 验证不在本轮部署范围 |
| 混合写入 | 唯一 commitContentBatch；四条 UNNEST 集合写；事务外预合并；保留独立观测；长字符串 ID；按真实 kind 验证；父链环/跨根检查；确定性版本、空字段保持、删除防复活；观测同键冲突整批回滚 | 大规模并发写入/WAL/百万级容量报告 |
| 搜索与读取 | 单 search_text + title_length + trigram GIN；LIKE 字面转义；统一 compileContentFilter 交集授权；NULL 双分支 keyset；每页 limit+1、无 coverage COUNT；详情不暴露其他授权来源观测 | threadAware 根帖联动、三视图评论树、完整聚合口径与信号门控 |
| 推流与下载 | POST ingest：100 条/1MiB、source→receipt 锁序、同 key 同体重放、异体 409、内容与回执原子提交；JSON/CSV 游标下载，RR + 35s 空闲事务上限、背压、30s 总预算与断连销毁连接 | 下载面板的终结统计与分段续传交互；完整压力与恢复演练 |
| kaix | 自有指标定义；保留原生布尔搜索；1–300 根帖、可带评论且总节点≤2000；帖子取评保留旧时间根帖；runId/datasetId 持久化；RUNNING 轮询续读不重发 POST；未知创建结果锁源停发 | 批量根帖 hydrate/自动门控派生、人工核查后的标准恢复接口、新版本受控真网样本 |
| 调度与预算 | 两个有界槽，source→job 锁序，租约回收/过期拒写；默认关闭的额度；UTC 日/月请求和资源预留；预算/间隔拒发不发网络请求；安全读错误最多三次，预算等待不消耗请求重试次数；预算当前通过 API 编辑 | 自动到期 Radar、跨页继续、独立备源单跳与完整工作状态诊断；当前为显式单次采集，非持续监测完成版 |
| 项目 | 两张项目表、创建/读取、三组词库内过滤、一次 GROUPING SETS 内容节点概览；不因保存项目自动采购 | 编辑/比较/钻取、threadAware 默认口径、确定性信号与自动 Hydrate；响应明确 threadAware=false，尚不能宣称目标项目漏斗完成 |
| 个人研究 | 保存查询、单条 JOIN 批注列表、用户隔离与批注 revision 冲突；新 Web 无冻结功能 | 历史查询不兼容字段转换、旧资产实际迁出交付与最终旧表删除 |
| 新渠道 | 尚未接入 | red_crawler、TwitterAPIs、ScrapeBadger、NewsNow、feed 属于后续 R2；不宣称已验收 |

## 3. 数据迁移与资产保全

`001..040` 全部保留原文与校验和；新增：

- `041_content_batch.sql`：正文版本字段、观测唯一键纳入 provider、观测 payload_hash 与发布时间/引用索引。
- `042_monitor_projects.sql`：仅新建 monitor_project 与 monitor_project_source 两张表。
- `043_kernel_cutover.sql`：会话、逻辑来源与任务扩展；退役旧渠道预算与来源；全量回填并检查单列投影后删除旧失效触发器；旧测试队列取消。若存在 running 或已有请求尝试的未决旧任务，迁移拒绝执行，防止把本地取消误当作外部计费结束。

迁移只在全新隔离验证库执行；未连接或修改既有内部测试库。账户、正文、发现、观测、收藏、批注及历史冻结表没有被删除。旧业务表仍随历史迁移保留，不参与新运行时。

`scripts/export-legacy-assets.ts` 在只读 RR 快照内按原 owner 导出冻结记录及成员、保存查询、批注与旧保存视图，生成行数与 SHA-256 清单；文件目录 700、文件 600、拒绝覆盖、零数据库写入。当前完成合成资产验证，**尚未对用户历史资产执行迁出或确认交付**；因此冻结旧表不执行 DROP。

## 4. 验证证据与测试迁移

新测试只采用纯函数/外部协议夹具 + 真实 PG16/HTTP + 真实浏览器，不再保留 SQL InMemory 双跑。旧趋势、市场、Phase1、冻结 API 的测试随退役业务删除；核心断言迁至：

| 断言 | 当前测试 |
| --- | --- |
| 长 ID、混合帖评、预合并、版本平局/逆序、独立证据、环/跨根拒收、16MiB/2000 条边界 | content-batch.test.ts / kernel-postgres.test.ts |
| 鉴权、CSRF、机器 Key 来源交集、枚举内容 404、viewer、撤销/过期/凭证变更、伪造转发头限流、个人资产隔离与 revision | kernel-postgres.test.ts |
| 推流并发回执、异体 409、413、缺 key、原子回滚、四条 SQL、空值、删后防复活 | kernel-postgres.test.ts |
| Apify Run 中断续读、unknown 停发、防再发、额度、取消/旧租约拒写 | kaix-content.connector.test.ts / collection-postgres.test.ts |
| NULL 游标、微秒游标、字面转义、跨标题正文边界、同范围流式下载与断连清理 | search.test.ts / kernel-postgres.test.ts |
| 迁移 DDL/ledger 原子回滚、checksum、防覆盖、原 owner 文件与冻结成员保全 | migration-assets-postgres.test.ts |
| 文档与旧层防回流、发布白名单、R4 隔离与文件篡改 | repository-policy.test.ts / release-package.test.ts |
| 浏览器登录→来源→混合样本导入→详情批注→保存查询→文件下载→创建项目/核对计数；五导航与三尺寸 | tests/browser/workbench.test.ts |

本轮在 Node `24.22.3`、仓库外临时构建的 PostgreSQL `16.6` 独立 loopback 实例和真实 Chromium 下验证（不替换已有 PG14 实例），无第三方收费请求。最终通过：12 项单元测试、13 项 PG/HTTP 测试（含父测试）、1 条浏览器任务流，均零失败、零跳过；lint、根与 Web typecheck、API/Web build、编译入口冷加载及发布包完整性检查通过。PG 断连用例使用 1,000 条约 10MiB 内容，确认游标销毁后无遗留空闲事务或等待队列；浏览器覆盖五导航、登录、混合导入、批注、保存查询、创建项目并核对命中数与文件下载，并保存 1440/768/390 截图。报告与截图仅放被忽略的 `output/validation/kernel/`。

历史 `0.9.1` 的 536 离线 / 44 PG 用例属于旧链证据，不作为新链验收。新旧首次迁移过程中出现的旧夹具 ID/重试假设差异不计为新链通过结果。

## 5. 下一步

1. 保持新内核边界与上述真实检查，旧层门禁禁止回流；基础项目概览继续明确使用内容节点口径。
2. R2 继续讨论联动、信号、批量 Hydrate 与新的双渠道；先完成唯一过滤及授权口径，再接新增渠道。
3. 按需对旧内部测试库盘点/备份并执行资产迁出，核对交付后再增加旧表删除迁移；生产 Compose、负载、安全与恢复证明完成前不开放。
4. R4 独立外挂尚未开始，不预建空壳，也不进入主线依赖、镜像或 CI。
