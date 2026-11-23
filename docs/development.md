# 开发流程、CI 门禁与生产运维手册

本文为团队单主干协作、CI 验证分流、本地隔离测试、Docker 多阶段构建及单机 4 GB 生产运维的唯一操作手册。架构与边界约束见 [architecture.md](architecture.md) 与 [invariants.md](invariants.md)。

---

## 1. 单主干协作与冲突治理

仓库仅设唯一常驻主干 **`main`**（不设常驻 `develop`/`prod` 分支）；发版打 **`vX.Y.Z`** 不可变 Tag（预演 `vX.Y.Z-rc.1`），触发 `.github/workflows/release.yml` 完整验真并推送 `ghcr.io` 的 `runtime` 与 `proxy` 镜像。

| 分支类型 | 切出基准与规则 | 生命周期与合入要求 |
| :--- | :--- | :--- |
| **`feat/<模块>-<短名>`** | 从最新 `origin/main` 切出（允许整域垂直交付，不设僵化行数上限） | `<= 3` 天；`CI Gate` 绿灯 + `.github/CODEOWNERS` 审查后 `Squash and Merge` |
| **`fix/<短名>`** | 从最新 `origin/main` 切出 | `<= 1` 天；附带复现/回归测试，同上合入后删除 |

```sh
git fetch origin && git switch -c feat/<module>-<topic> origin/main
git diff --stat origin/main...HEAD
```

- **四大高冲突热区同步约定**：修改 **`src/storage/schema/*.sql`**（已合入迁移严禁改动，撞号顺延）、**`packages/contracts/src/`**（禁止前端复制平行副本）、**`apps/api/src/{app,route-policy}.ts` / `apps/web/src/App.tsx`**（保持薄装配）、**`docs/`** 前，若 `origin/main` 已前移须先 `rebase/merge` 并重跑完整本地门禁；未就绪 PR 一律保持 **Draft**。

### 1.1 变更准入与工程质量

**集成资格取决于工程质量、明确收益、风险控制与可验证的依赖。编号和创建时间仅用于追踪，不形成优先权或接收承诺。独立且就绪的方案可先集成，其他候选继续修订、暂存或关闭。**

PR 是供项目选择的候选方案。完成开发、付出工时、提交较早、作者身份、Agent 自评和 CI 全绿，均不是必须接收的理由。需求不适合项目、实现降低整体代码健康或维护成本不合理，可以不接收，即使功能能运行、测试全绿。该规则适用于前后端、文档与治理变更，也适用于生效时尚未合入的候选方案。

#### 实现与审查协议

Agent 不得把首次实现直接当作完成；交付前必须进行以下可复核的不同检查，不能以重复运行测试代替阅读代码，也不要求无意义地重复检查未变更部分：

1. **影响分析**：确认需求、不变量和非目标；从真实入口追踪调用方、状态所有者、持久化和消费者。列出与主干及在途变更重叠的契约、迁移、鉴权和写入口，不按 PR 编号推断依赖。
2. **最小实现**：优先已有原语和清晰的数据流。一个状态只保留一个权威来源；从其他状态可计算的值不另存并同步。新增模块、依赖、缓存、接口或后台作业必须有当前需求和故障/维护收益，避免平行契约、转发包装和推测性框架。
3. **实现后审查**：完整阅读 diff 及相关上下文，按旧输入、乱序/重复/并发输入和失败路径追踪外部可见行为。检查正确性、授权/隐私、资源上界、事务、异步生命周期、错误可见性、可测试性和文档一致性。验证所有调用者而非只看新代码。
4. **简化复核**：另以维护者视角检查实现是否存在重复规则、冗余状态/参数/查询、无职责包装、深层条件和不必要依赖。可安全合并则合并；有区别的业务语义保留。不能以搬文件、压行数、共享万能组件或删除测试来声称降低复杂度。
5. **兼容与组合验证**：以证据选择更健康的设计，让相互重叠的候选适配已选定契约；先提交的实现没有设计所有权。验证旧客户端/数据与新契约、迁移顺序、部署版本偏差和组合失败路径。已合入迁移不可改写；这与保留所有历史实现是两回事。
6. **交付检查**：提供复杂度前后对照、简化结果或保留理由、实际验证命令及未收口项。找到缺陷后，修复根因并检查相同调用路径的同类实例；不得机械增加无行为断言的测试来凑数量。

暂未启用的有效能力、已批准的扩展契约和运行时注册入口需要追踪使用方式和兼容承诺，不能仅凭静态未引用删除。简化应减少实现和理解负担，保留产品能力；需要退役的功能须另有明确决策与迁移方案。

#### 工程质量检查面

| 维度 | 必须检查的具体问题 |
| :--- | :--- |
| 数据与状态 | 是否重复存储可派生值、双向同步或多处维护同一业务规则；是否可用稳定 ID、共享 Schema 或数据库约束消除漂移 |
| 模块与抽象 | 是否高内聚、单向依赖、经公开门面访问；抽象是否隐藏真实复杂度，而非增加跳转、通用参数或单实现包装 |
| 算法与数据库 | 热路径的时间/空间复杂度、嵌套查找、重复遍历、N+1、排序/分页上界、索引与扫描、JSONB 解包、锁范围、写放大和保留策略 |
| 异步与故障 | 请求取消、过期响应、重试幂等、租约/事务边界、未知计费、超时和并发限额；失败是否可见且可恢复 |
| 安全与隐私 | 默认拒绝、对象/来源/批次授权、输入与输出边界、敏感信息、SSRF、日志及前端包泄漏；禁止靠前端隐藏代替授权 |
| 前端与可访问性 | 状态归属、派生数据、Effect 的外部同步职责、加载/空/错/权限状态、响应式、键盘/焦点和真实用户任务；不重复服务端业务策略 |
| 测试与维护 | 测试能否在目标行为损坏时失败；边界/旧数据/并发与回归是否覆盖；测试自身是否清晰，无无意义 mock、重复场景或被删除的断言 |
| 运行与演进 | 部署/回退、资源预算、配置缺失、可观测性、数据兼容、依赖升级成本和文档契约；优化结论是否有可复现的基线 |

#### 复杂度增量门禁

`npm run check:complexity -- <base SHA>` 使用已有 ESLint 的 `complexity` 规则对变更的生产 TS/TSX 与基准提交比较，接入 `CI Gate`，不采信 inline 抑制。新增超 25 的函数诊断被拒绝；同文件既有超限诊断只能维持或降低，不得增加数量/复杂度。匿名函数按诊断身份的排序多重集对比，因此此门禁是防恶化的近似指标，不证明某个具体匿名函数或整体设计已经达标。25 是本项目增量保护阈值，不是行业通用质量分数。

不得重命名、跨文件搬移、拆成无职责薄包装或压缩条件来规避指标。Agent 仍须审查调用深度、状态数量、耦合、数据流和算法/SQL 成本；可读且必要的复杂性应有清晰边界与验证，不追求代码行数或函数数量的机械最小化。

#### 准入必须有的证据

| 审查面 | 必须回答 | 阻断条件示例 |
| :--- | :--- | :--- |
| 价值与范围 | 解决哪个用户/系统问题；需求依据、验收任务与不做清单是什么 | 无明确收益；未获确认的产品方向；把不相关改动捆绑交付 |
| 真实依赖 | 独立则填「无」；有依赖则列 PR、具体契约/迁移/代码与不满足时的失败场景 | 用编号、提交先后、同文件改动或同事关系代替技术依赖 |
| 设计与复杂度 | 现有能力为何不足；更简单方案；新增耦合/状态/抽象/依赖与后续维护成本 | 平行契约、重复状态、无当前需求的通用框架、无收益的复杂度或边界倒置 |
| 简化与兼容复核 | 实现后发现/合并的重复规则、复杂度前后对照、保留理由与新旧/组合验证 | 只写自查通过；把所有重叠实现原样保留再加适配层；删掉有效能力冒充精简 |
| 验证与真实性 | 对应提交的实跑命令、结果、复现、回归与未覆盖项；能否从原始证据核验 | 捏造执行、性能或生产事实；测试只证明 mock；删除失败断言以求绿灯 |
| 风险与回退 | 旧数据/旧调用方/权限/并发/付费/资源影响；失败及回退办法 | 未论证迁移兼容、权限泄漏、未知付费重放、无法恢复的数据风险 |
| 前端业务验收 | 实际渲染证据、核心任务完成情况；桌面/窄屏、键盘及受影响的加载/空/错/权限状态 | 截图漂亮但任务不通；静态假成功/假指标；重复交互/契约；已有功能回退 |

前端必须依据 [交互规范](design.md) 审查信息层级、可用性、可访问性、状态与真实 API 联动。截图不能代替交互与业务验收，构建通过不能证明 UI 可用。无视觉/交互影响的前端逻辑变更可说明不适用原因并提供行为测试；纯文档等低风险变更按实际范围提供证据，不要求制造无关测试。

#### 自动门禁与独立审查分工

- `.github/pull_request_template.md` 在创建 PR 时提示准入规则；`scripts/check-pr-quality.mjs` 接入现有必过 `CI Gate`，拒绝 Draft、`quality:hold`、缺失/重复章节、空模板及明显占位文本；改 `apps/web/src/` 时要求界面证据章节。描述编辑、Ready/Draft 转换和标签变更都会重新校验。
- **脚本仅检查证据是否提交，不证明证据真实、依赖已满足或设计合理。** 不使用 LLM 分数、行数、截图数量或作者自评替代质量判断。填写完整不等于批准；CI 全绿仍可 Request changes 或拒绝接收。
- 独立审查人依据实际 diff、完整调用路径、数据写读者和相应证据，明确给出批准、请求修改或不接收的决定。作者自查、Agent 建议和 GitHub 批准是不同事实；不得伪造或相互替代。改代码后旧批准按分支保护作废并重新审查。
- 维护者发现尚未解决的价值/设计/证据问题时，可添加 `quality:hold` 明确阻断 CI；新增标签须写明具体问题与解除条件。作者修复后申请复核，维护者在评论说明解除依据后移除。Agent 不得自行移除标签、忽略评审或修改门禁绕过阻断。
- `AGENTS.md`、本节、PR 模板、检查脚本、CI 与 CODEOWNERS 都属于受保护治理面；其变更同样接受独立审查。CI 不执行 PR 描述中的命令，使用只读权限解析事件 JSON，不引入持写凭证执行不可信代码的 `pull_request_target` 流程。

#### 决策与沟通规范

- **可修复且仍有价值**：Request changes；缺少验证或目标未定则回 Draft。作者负责修复，审查者不承担代写或收拾的默认义务；无关 PR 照常推进。
- **不适合项目、被更简单实现取代或已失去价值**：说明依据后关闭，不因交付投入而降低接收标准。可以保留讨论和可复用结论，无需把全部代码带入主干。
- **满足标准**：维护者按价值、风险及真实依赖安排合入。追踪编号不得替代技术依赖和验收结论。真实冲突需同步与验证，不等于较早方案拥有设计优先权；已合入迁移仍必须保持不可变。
- **不确定**：明确缺少哪项证据及如何验证，暂缓该 PR；不得臆造缺陷或用「感觉复杂/不喜欢」作阻断依据，也不得把 CI 绿灯当消除不确定性的证据。
- 审查意见分为 **Blocker**（必须解决，引用规则/需求、文件或复现场景、影响和验收办法）、**Suggestion/Nit**（非阻断改进）。不以个人审美或追求完美拖延已改善代码健康的改动；对审查意见有异议时回到需求/契约/实测证据，由维护者记录取舍，以可复核的工程结论记录决策。
- 中性表述示例：`Blocker：该组件复制了共享契约，字段变更会造成双端漂移。请改用 packages/contracts，并用旧调用方回归验证。` 只评价实现及影响，不评价作者能力、动机或身份；审查者也必须接受反证。

#### 交付状态与集成核验

创建/更新 PR、建议合入、执行合入前，Agent 必须重读本节，核实当前 head、差异、真实依赖、检查结果与未解决讨论，并按当前任务授权执行。候选 PR、已合入主干和已部署是三个不同状态，报告须明确区分；未收口项和失败检查不得隐去。

#### 实践依据与适用范围

- [Google 小型自包含变更](https://google.github.io/eng-practices/review/developer/small-cls.html)：按可独立理解、验证和回退的目标控制变更，不照搬行数指标。
- [Microsoft VS Code 贡献指南](https://github.com/microsoft/vscode-wiki/blob/main/How-to-Contribute.md)：相关问题聚焦、测试随变更、避免无关格式化，新增平台 API 需承担维护成本。
- [React 状态结构](https://react.dev/learn/choosing-the-state-structure)：避免矛盾、冗余、重复和过度嵌套状态，派生值直接计算。

- [Google 审查标准](https://google.github.io/eng-practices/review/reviewer/standard.html)：持续改善整体代码健康，不要求完美，也不接受明确恶化代码健康的改动；功能不符合项目需要时可以拒绝。
- [Google 审查关注点](https://google.github.io/eng-practices/review/reviewer/looking-for.html)：设计、功能、复杂度、测试和实际 UI 体验；警惕过度设计。
- [Google 审查评论](https://google.github.io/eng-practices/review/reviewer/comments.html)：解释原因、评价代码而非作者，区分阻断与非阻断建议。
- [Kubernetes PR 流程](https://www.kubernetes.dev/docs/guide/pull-requests/)：就绪、测试、审查/批准和 hold 分开；无关改动拆分，拒绝投机性通用化。本项目借鉴原则，不照搬其机器人、组织规模或贡献身份政策。
- [GitHub 分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)：必过检查、独立审批、旧批准失效与未解决讨论。自动化资格不等于产品接收决定。


---

## 2. CI 分层门禁与测试组织

`.github/workflows/verify.yml` 经 `scripts/ci-scope.mjs` 按变更路径精确分流，所有 PR 最终收敛至单一必过 **`CI Gate`**（周级安全/依赖/镜像全量巡检见 `.github/workflows/security-scheduled.yml`）：

| 变更范围 | 自动触发门禁 |
| :--- | :--- |
| 纯文档（`docs/**`、`README.md`、`AGENTS.md`） | `lint:policy`（断链/锚点/退役路径/迁移不可变；`docs/` 允许图片/示意图资产）+ `Gitleaks` 密钥扫描 |
| 纯后端代码（`src/**`、`apps/api/**`、`tests/{unit,integration}/**`） | `lint:arch`（`depcruise` + 表写归属）+ `lint:api`（ESLint）+ `tsc` + `check:openapi` + `test:unit` + `test:postgres` + `smoke:compiled`（**不再拖慢触发旧前端 Chromium E2E**） |
| 新增 SQL 迁移 | 自动运行 **`Squawk`** 锁表与索引并发风险扫描 + PG16 集成验证 |
| 前端 / 浏览器 / 契约 / 合入主干 | 前端改动及 `run-e2e` 标签或 `push` 到 `main` 时触发 `lint:web` + `build:web` + `check:web-bundle`（仅查密钥泄漏）+ Chromium `test:browser`；改 `packages/contracts/` 双端联动校验；改 `Dockerfile`/`compose`/`deploy/` 触发容器构建校验 |
| PR 治理防弱化 | `scripts/check-governance-diff.mjs`（新增 `.only(` 直接阻断，改动门禁/加 `.skip`/`eslint-disable` 高亮审计） |

**测试分层原则**：纯算法/解析/规范化进 `tests/unit/*.test.ts`；路由契约与鉴权用 Fastify `inject()`；SQL/事务/并发/幂等使用隔离 `postgres:16-alpine` 运行 `tests/integration/*-postgres.test.ts`；多端交互与可用性进 `tests/browser/*.test.ts`。

---

## 3. 本地开发、PG16 测试与常用 CLI

环境依赖 **Node 24+** 与 **PostgreSQL 16**（`test:postgres` 强校验回环地址与 `source_validation_*` 库名）：

```sh
npm ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts
npm run lint                  # 串联 lint:policy + lint:api + lint:arch + lint:web
npm run typecheck             # 服务端 tsc + 前端 apps/web tsc
npm run check:openapi         # 零库启动验证 OpenAPI 3.x 与 100% 声明式鉴权
npm run test:unit             # 全量单元测试
npm run build && npm run check:web-bundle   # 编译前后端、同步 SQL/历史资产并扫描前端包密钥泄漏
```

使用一次性隔离 `postgres:16-alpine` 容器跑真实 PG16 集成测试与编译冒烟：

```sh
docker run -d --rm --name pg16-dev-test -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=source_validation_v2 postgres:16-alpine
export TEST_SOURCE_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/source_validation_v2"
npm run test:postgres && npm run smoke:compiled
docker stop pg16-dev-test
```

- **离线 AI 历史数据工具**：`npm run ai:history:validate|plan|apply|backfill`（详见 `data/ai/history/README.md`）。
- **离线批量触发采集**：`npm run collect:batch -- output/collect-plan.json`（配 `COLLECT_API_URL` 与限定作用域 Machine Key 加 `--apply` 提交）。

---

### PR #32 迁移兼容与 Worker 边界

- 主干已合入 `059_project_batches_and_ownership.sql`、`060_batch_visibility_and_field_policy.sql`，文件名及 SHA-256 必须保持不变；PR #32 已合入，V2 迁移编号为 `061–064`，同样受不可变约束。回归覆盖 `058 → 064`、保有项目/批次的 `060 → 064` 及幂等重跑。
- 曾应用旧 PR #32 `059–062` 的开发库不能直接套用新编号。可丢弃的测试库重建；需保留数据的库先备份、核实 `schema_migration` 文件名与哈希，再单独制定台账转换方案。禁止清空台账或关闭校验来绕过升级。
- `WorkerHooks.onProjectBatchCommitted` 在内容事务内执行，关联失败回滚整页；`onSourceContentCommitted` 在提交后执行，回算/自动水合失败独立记录，不能触发已提交采集重放。
- 批次累计数按实际新增 membership 增量维护；历史批次即使任务已清理也阻止来源物理删除，改为归档。

## 4. Docker 多阶段构建与单机 Compose

[Dockerfile](../Dockerfile) 依次定义 `build` -> `runtime` -> **`proxy`（默认末段目标）**。打包生产镜像必须显式指定 `--target` 并传入同一提交 SHA 标签：

```sh
docker build --target runtime --label org.opencontainers.image.revision=$(git rev-parse HEAD) -t monitoring-unified:<tag> .
docker build --target proxy   --label org.opencontainers.image.revision=$(git rev-parse HEAD) -t monitoring-unified-web:<tag> .
```

本地三服务联调可配置 `POSTGRES_PASSWORD`、`SESSION_SECRET`（`>=32` 字符）、`APP_ORIGIN=https://localhost:8443`、`SITE_ADDRESS=https://localhost`、`HTTPS_PORT=8443`、`TLS_CONFIG='tls internal'` 后执行：

```sh
docker compose -p monitoring-local up --build -d --wait
curl --insecure https://localhost:8443/readyz
```

---

## 5. 生产安全配置与运维规程

### 5.1 仓外环境模板与采集网关

真实密钥仅存于仓外受限文件（生产 `/etc/reddit-monitoring/unified.env`，权限 `600`），严禁写入 Git 或 `VITE_*`：

```dotenv
NODE_ENV=production
SOURCE_NETWORK_ENABLED=true
# 留空 = 开启全 DNS 公网 IP 校验下动态 HTTPS 抓取；非空 = 逗号分隔白名单
FEED_ALLOWED_URLS=
WORKER_CONCURRENCY=6
CREDENTIALS_MASTER_KEY=
APIFY_API_TOKEN=
TWITTERAPIS_API_KEY=
SCRAPEBADGER_API_KEY=
PUBLIC_READ_ENABLED=true
PUBLIC_REGISTRATION_ENABLED=false
AI_SYNC_ENABLED=false
```

- **渠道约束**：`WORKER_CONCURRENCY` 范围 `[1, 12]`（默认 `6` + `1500ms` 同域冷却）；`twitterapis` 单页自动钳制 `<= 20`；`scrapebadger` `POST /v1/sources/:id/refresh` 支持 `1..20` ID 批刷；`kaix` 水合每次限 `<= 30` 根帖 × `50` 评论。若使用私有独立 Apify 转发网关（[deploy/apify-relay.compose.yml](../deploy/apify-relay.compose.yml)），将 `APIFY_RELAY_ORIGIN` 指向内网转发容器并在主应用留空 `APIFY_API_TOKEN`。

### 5.2 边缘代理、Tunnel 与宿主机防护

- **代理信任与缓存头**：`Caddy`（[deploy/Caddyfile](../deploy/Caddyfile)）强制 `/api/*` `Cache-Control: no-store` 与防 iframe 头；`Fastify` 仅通过 `TRUST_PROXY_ADDRESS` 信任 `proxy_transport` 内网网段上的 Caddy（单 IP），冲突时可用 `PROXY_TRANSPORT_IP` / `PROXY_TRANSPORT_SUBNET` / `APP_TRANSPORT_IP` 覆盖。
- **零公网端口 Tunnel**：`docker compose -f docker-compose.yml -f deploy/tunnel.compose.yml up -d --wait` 通过受保护 `CLOUDFLARED_TOKEN_FILE` 接入，公网存活探针走 `/healthz`。
- **宿主机防火墙提醒**：Docker `-p 443:443` 会直接写入 `iptables nat` 绕过 `ufw`；公网暴露必须在 Caddy 启用 Cloudflare mTLS 并在 **`DOCKER-USER`** 链限制仅放行 Cloudflare 回源网段，或保持 `PROXY_BIND=127.0.0.1` 纯走隧道；`db` 禁宿主机端口映射；建议配 `2 GiB /swapfile`（`vm.swappiness=10`）与 `journald` `SystemMaxUse=100M`。

### 5.3 账户安全、MFA 与主密钥轮换运维

- **开放邮件注册/找回**：默认关闭；需配置 HTTPS `APP_ORIGIN`、已验域 Resend 与 Cloudflare Turnstile 密钥（`AUTH_EMAIL_ENABLED=true`）方生效。
- **管理员 TOTP MFA**：配置 32 字节 base64url `AUTH_MFA_ENCRYPTION_KEY`，先离线执行 `node dist/src/modules/access/mfa-cli.js --enroll <user-id>` 为所有管理员完成登记后再开 `AUTH_MFA_REQUIRED=true`；遗失验证器时由运维核验后执行 `--recover <user-id>`（同时废弃旧会话、挑战与恢复码）。
- **密码哈希平滑升版（`scrypt v1 -> v2`）**：先上线支持双读的镜像（保持 `AUTH_SCRYPT_V2_WRITE_ENABLED=false`），压测确认登录 p95 无虞后再开启渐进重哈希；开启期间双版本 KDF 均不降回只读 v1 的旧镜像。
- **服务商凭证主密钥轮换**：备份并停 Worker 后传入旧 `CREDENTIALS_MASTER_KEY` 与新 `NEXT_CREDENTIALS_MASTER_KEY`，依次执行 `node dist/src/modules/collection/credential-rotation.js --check` 与 `--apply` 短事务重加密后切换环境变量启动。

### 5.4 备份恢复与只读巡检

```sh
npm run db:backup -- --file output/backups/<unique-name>.dump
npm run db:restore -- --file output/backups/<unique-name>.dump --target info_workbench_restore_check
```

> 切记在部署前于隔离恢复库演练新迁移、前后端冒烟及回退兼容性；生产切换后核对两个容器镜像的 `org.opencontainers.image.revision` 与 `/readyz`。

**生产只读巡检命令与 SQL**：

```sh
docker compose --env-file /etc/reddit-monitoring/unified.env -f /opt/reddit-monitoring/compose.yml -p monitoring-unified ps
```

```sql
-- 1. 库体积与 Top 12 表/索引膨胀巡检
SELECT now(), pg_size_pretty(pg_database_size(current_database())) AS db_size;
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_sz,
       n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12;

-- 2. 来源健康异常排查
SELECT label, feed_lane, primary_provider,
       (health->>'lastDurationMs')::numeric AS last_ms,
       (health->>'lastTruncated')::boolean AS truncated,
       (health->>'consecutiveFailures')::int AS failures,
       health->>'lastError' AS last_error
FROM collection_source
WHERE state = 'active'
  AND ((health->>'lastTruncated')::boolean IS TRUE OR COALESCE((health->>'consecutiveFailures')::int, 0) > 0)
ORDER BY failures DESC, last_ms DESC NULLS LAST;

-- 3. 渠道日配额消耗核对
SELECT u.provider, u.day, u.requests, b.daily_requests, u.resources_reserved, b.daily_resources
FROM source_provider_usage u JOIN source_provider_budget b USING (provider)
WHERE u.day >= (now() AT TIME ZONE 'UTC')::date - 1
ORDER BY u.day DESC, u.provider;
```

- **自动清理策略**：普通采集任务每小时清理各源最新 5 条外且超 14 天的终结记录（永久保留带 `request_key` / `ingest_key` 幂等回执与未决付费状态）；`feed_user_seen`（14 天）与 `feed_user_event`（30 天）随清理任务滚动裁剪，控制 60 GB 磁盘空间稳态运行。
