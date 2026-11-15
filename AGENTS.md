# Agent 开发入口

开始任务先读 [文档入口](docs/README.md)、[当前状态](docs/status.md)；涉及代码再读 [架构](docs/architecture.md)、[数据与接口契约](docs/contracts.md) 和 [开发说明](docs/development.md)；涉及界面再读 [交互设计](docs/design.md)。正式项目文档只放在 `docs/`，根目录 README 仅作入口。

- 用户当前明确指令优先。`docs/README.md` 记录产品决策，`docs/status.md` 记录实现状态；源码、数据库迁移、实际检查结果证明当前行为。
- 文档与代码不一致时，指出差异并在本次任务范围内修正。计划不能当成已实现功能；历史 Git 内容不能当成当前要求。
- 当前方向是多平台信息获取、聚合与可视化；Reddit 已接入 Arctic Shift，后续来源按研究与开发路线逐项验证。不要恢复旧的 Reddit-only 范围锁定或默认爬取绕过方案。
- 本仓库不要求默认 skill，也不引用历史 prompt；工具与 skill 按用户当前任务和运行环境的明确要求使用。
- 修改前检查 `git status`、相关代码和测试，保留其他人的工作。只实现本次需求，不因路线图存在而自动实现全部平台。
- 使用当前环境中的独立工作目录/分支，先检查分支、远端和已有修改；共享对象库时串行修改 refs，不改他人 worktree、身份或凭证。逐路径提交，不用 reset/clean/stash 覆盖工作。远端写入按用户当前授权执行，不强制推送；历史 Windows 路径或任务限制不作为跨环境规则。
- 主线是远端单机Fastify/PostgreSQL/在线connector/React；只新增两张项目表。Python/DuckDB/.zst属于未来独立外挂，只通过鉴权HTTP推流，不进主线依赖、数据库、构建、发布或CI。删除归档发布/数据集/冻结目标，不在重建时恢复。
- 新数据源先明确平台/provider/目标、内容身份、观测时间与指标能力；在线页和推流共用集合写入/版本/投影规则，沿 connector → 落库 → 分析 → API → UI 打通。只保留外部多实现ContentProvider；内部命名SQL函数直接接收Pool/PoolClient，禁止单实现Repository、InMemory数据库镜像和空壳service。
- 以人类/agent完成同一任务为交付单位：创建项目→看概览→钻取证据→保存/下载；同schema/filter/权限/错误，不能让UI拼出另一套业务或给agent开放DB旁路。默认页面只显示下一步有用信息，不堆内部协议说明。
- 变更应有相称的验证：纯函数单测 + 一套真实PostgreSQL/HTTP E2E；删除InMemory双跑，不删除权限/事务/幂等关键断言换通过。区分离线检查、真实数据源检查和部署检查；失败、未执行和阻塞如实记录。
- 数据库变更新增迁移，不改已应用 SQL。密钥、token、原始数据和运行报告不进 Git，生成物放 `output/`。
- 功能、接口、命令或产品决策变化时，更新对应文档原有段落。替换过时信息，不追加重复交接稿、日报或第二套规则。
- 文档职责和路径以 docs/README.md 为准；历史阶段记录放 docs/history/，候选证据放 docs/research/，未来设计放 docs/plans/。调整路径时同步内部链接、scripts/check-docs.ts 与发布允许清单；提交前运行 npm run docs:check。
- 代码以人类可读、少职责/少重复扫描为准；禁止压行、多层三元、机械文件/LOC配额。routes/sql默认就够，真实需要才加worker/search/规则文件。边界校验一次、SQL参数化/约束保护数据；不重复内部typeof防御。根README≤60行，正式细则只在对应docs文档维护。
