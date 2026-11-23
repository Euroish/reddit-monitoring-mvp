# PR30 与 PR32 集成方案

复核基线为主干 4b053696、PR30 1e6e780 和 PR32 cd4954ca。PR31 已合入，PR30、PR32 为独立 Draft，两个分支的共同祖先均为 4b053696。以下内容保留作后续排序参考。按负责人最新决定，本轮以当前 main 与 PR31 兼容为验收基线，PR32 的提交顺序及迁移处置另行协调。

| 重叠文件 | 边界与集成责任 |
| --- | --- |
| apps/api/src/app.ts | API 维护者组合项目/采集注入与 feed、intelligence 注册。 |
| apps/api/src/route-policy.ts | Access 维护者逐路由合并声明、浏览器限制和机器 scope。 |
| apps/api/src/server.ts | 运行时维护者接入项目关联与情报回算两个具名事件。 |
| docs/contracts.md | 产品与契约维护者分别标注已注册接口和未来产品线。 |
| packages/contracts/src/collection.ts | 契约维护者组合新 SourceTarget 选项、feedLane、qualityGrade 与研究预检；保留旧输入兼容。 |
| scripts/check-table-ownership.ts | 架构维护者合并批次、项目关系、Feed 和情报表所有权与读取边界。 |
| src/modules/collection/index.ts | 采集维护者保留现有公开门面，逐项审查新增出口。 |
| src/modules/collection/routes.ts | 采集维护者逐路由整合来源状态操作、研究预检和任务，核对 PATCH 语义。 |
| src/modules/collection/sql.ts | 采集维护者并入可选来源字段，更新保留缺省字段。 |
| src/modules/collection/worker.ts | 保留 LISTEN/NOTIFY，事务内项目批次关联和提交后情报通知分开。 |
| src/modules/content/index.ts | 内容维护者保留公开门面，核对下游 Feed/情报只读调用。 |
| src/modules/content/queries.ts | 内容维护者检查批次来源交集、内容筛选及新分面。 |
| src/modules/content/sql.ts | 内容维护者保留统一写入口、幂等及新增字段兼容。 |

## 迁移和顺序

PR30 的 059_project_batches_and_ownership 与 060_batch_visibility_and_field_policy，分别与 PR32 的 059_content_enrichment_and_source_lanes、060_feed_personalization_and_seen 编号冲突。PR32 另有 061_social_intelligence_monitors_and_rollups。迁移器会拒绝重复编号。PR30 的两份历史文件保持原哈希。先完成 PR30 用户验收和独立评审，维护者批准合并后，PR32 再以新主干为基准。仅在确认 PR32 三份迁移均未用于需保留台账时，根据实际空闲编号安排 061/062/063，验证 060 台账向前迁移和重跑。若任何需保留台账曾应用 PR32 版本，数据库负责人必须先为每个台账制定前向升级与校验方案。PR32 的批量归档与预算初值分别核对变更行、审批影响和回退脚本。生产和其他团队的台账由环境负责人补齐。

## Worker 与查询边界

建议将位置参数替换为具名事件。PR30 的 onProjectBatchCommitted(client, info) 留在事务内，失败使入库关联回滚。PR32 的 onSourceContentChanged(sourceId) 在事务提交后执行，回算故障独立记录，不能使已经提交的数据触发付费任务重放。PR32 当前按内容变更触发，应保留每次提交的触发语义。两个事件分别测试成功、重复、异常和优雅停止。

批次作用域通过 collection 提供的参数化只读条件执行。允许的 discovery 来源必须与批次来源相同，Viewer 限共享或本人，机器范围再与 allowedSourceIds 求交。collection 拥有批次表，projects 拥有关联表，content 继续拥有内容写入。联合验证依赖规则、声明式路由、参数绑定、跨来源不可见和九域表归属。

PR30 的来源编辑只发送明确变更的字段。PR32 的 feedLane、qualityGrade、扩展目标和 Feed/Intelligence 接口保持单独评审。
