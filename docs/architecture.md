# 主线架构规范（STD-100）

本文定义系统运行拓扑、模块化依赖边界、Postgres 迁移安全演进、L1–L3 扩源路线与单机安全基线。实码状态与 V2 排期见[当前状态与规划](status.md)，契约路由见[数据与 API 契约](contracts.md)，产品两条工作流与度量边界见[产品规范](README.md)。

---

## 0. 微内核总览与开源借鉴约束

在 **4 vCPU / 3.8 GiB RAM / 58 GiB 系统盘** 约束下，系统只吸收成熟开源生态的最小高收益机制：

| 参考来源 | 采纳机制 | 拒绝复杂度（适配当前单机容量） |
| :--- | :--- | :--- |
| **`miniflux/v2`** | 持久自适应调度、同域冷却、真 `ETag`/`304` 与 URL 去追踪参数 | 独立 Go 守护进程（合入 Node Worker） |
| **`newsnext/newsnow`** | 零依赖纯函数热榜 getter（6 个已落地 `webBoards`） | 独立 `h3` 服务端与 SQLite 缓存 |
| **`KKKKhazix/AIHOT`** | `T1`/`T1_5`/`T2` 分级、`T1` 一手代表选举、48h/6h 热度与 08:00 日报 | 3 Node 容器、105 迁移与入库串行 6 次 LLM |
| **`Folo` / `Karakeep`** | 多模态冷静流、`[V2]` 阅读状态、`read`/`archived`/`muted` 与按需阅读器/摘要 | 常驻 Next.js SSR + Meilisearch + Puppeteer |
| **`Vane` / `Ground News`** | 卡片内 16px 来源权威分布微条、`[V2]` 正交按题探索与 `keepKPerHostname` | 外部向量库与无头浏览器集群 |

---

## 1. `[LIVE]` 运行时拓扑与刻意不做列表

```text
Web 浏览器 / 移动 Web / 外部 Agent / [V2] L3 外部 Sidecar / R4 plugins/zst-archive
                       │  HTTPS，经边缘隧道或受限源站入口
                 Caddy 2 (proxy, mem_limit=128m, deploy/Caddyfile)
                       │  Docker 内部网络（proxy 可选；宿主机仅绑 127.0.0.1 或零暴露端口）
        Fastify 5 单容器应用 (app, mem_limit=1536m, Dockerfile --target runtime)
        ├── HTTP 读平面：onRequest @fastify/rate-limit -> preParsing 鉴权 -> apiPool (max=8)
        └── 后台调度平面：PG LISTEN/NOTIFY (`collection_jobs_ready`) + 自适应调度扫描 (LIMIT 32, provider_readiness CTE) + 6 协程并发 (hostCooldown=1500ms) + workerPool (max=4)
                       │
      PostgreSQL 16 (db, postgres:16-alpine, mem_limit=1350m, pg_trgm, LZ4 TOAST)
```

- **镜像构建陷阱**：[Dockerfile](../Dockerfile) 末段 stage 为 `AS proxy`（`caddy:2-alpine`），构建服务端必须显式传 **`--target runtime`**，构建静态反代传入 `--target proxy`。
- **刻意不做列表**：`MUST NOT` 引入 ORM、单实现 `*Repository`/`InMemory*`、Redis/BullMQ、Elasticsearch/ClickHouse、多 Node 容器拆分、容器内 Headless Chromium/Python，或首页同步加载重型全量图表包。

| ID | 等级 | 运行时与结构基线 | 验收出口 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 后端锁定 Node 24+、TypeScript、Fastify 5、`@sinclair/typebox`（`removeAdditional: false`）、`pg`、`pg-query-stream`、PostgreSQL 16；**`[LIVE]` 网页解析依赖 `rss-parser`、`cheerio`、`sanitize-html`（`linkedom` + `@mozilla/readability` 属 `[V2]` Phase C 按需引入）**；构建复制 `src/storage/schema/*.sql` 至 `dist/` 并校验 SHA-256。 | 构建与编译态启动验收 |
| ARC-02 | MUST | Compose 内存配额锁定 `db: 1350m`、`app: 1536m`、`proxy: 128m` 与 `json-file` 日志轮转（`max-size: 10m, max-file: 3`），透传 `WORKER_CONCURRENCY`（默认 6）；优雅停机 `SIGTERM`/`SIGINT` 限 `15_000ms`；主线镜像零 Python/DuckDB/Chromium。 | Compose 配置与停机测试 |
| ARC-03 | MUST | 仅多实现采集边界保留 `ContentProvider` 接口；业务模块内部直写接收 `Pool \| PoolClient` 的命名 SQL 函数（写事务用 `PoolClient`）；允许按独立业务域新增 `src/modules/<domain>/` 与子目录，由 `eslint.config.mjs`（异步安全、禁 `*Repository`/`InMemory*` 与 ORM）与 `.dependency-cruiser.cjs`（零循环依赖、跨模块隔离、前后端解耦）强制守门。 | `lint:api`、`lint:arch` 与 `lint:policy` |

---

## 2. `[LIVE]` 入口地图、严格 DAG 依赖与 9 域 55 表所有权

| 模块路径 | DAG 依赖（仅允许 `index.ts` 门面） | 独家写表所有权与跨模块读契约 |
| :--- | :--- | :--- |
| **`apps/api/src/`** | 引 `src/modules/*/index`、`src/platform/*` | `app.ts`（`onRoute` 强制全路由声明 `config.auth` 否则启动失败；`preParsing` 对无声明路由 Fail-Closed；`onRequest` 全局限流 120/min；`apiPool: 8`）、`server.ts`（`workerPool: 4` + 7 Providers + `AI_SYNC_ENABLED`）。 |
| **`src/platform/ & src/shared/`** | 零 `src/modules/` 与 `apps/` 依赖 | `route-auth.ts`（声明式权限类型）、`pg-notify.ts`（通道白名单 `LISTEN/NOTIFY` 连接器）、`shared/{errors,canonical,ids,language}`（零 `pg` 依赖叶子工具）。 |
| **`src/modules/access/`** | **严格叶子域**（零跨模块依赖） | 独家读写 8 张表：`app_user`、`app_user_password`、`app_invite`、`app_audit_log`、`app_session`、`app_auth_challenge`、`app_auth_mfa`、`app_auth_mfa_login`。通过 `writeAuditLog` 与用户查询门面服务下游。 |
| **`src/modules/docs/`** | **严格叶子域**（零跨模块依赖） | 独家读写 1 张表：`doc_page`（产品文档中心：`markdown` / 外链 / inline PDF 单附件，乐观锁 `revision`）。 |
| **`src/modules/content/`** | **严格叶子域**（经 `resolveProjectScope` 注入专题范围） | 独家写 5 张表：`content`、`content_discovery`、`content_observation`、`content_author_profile`、`public_content_search_document`（含可插拔 `enrich.ts` 与 `feed`/`intelligence` 只读门面）。唯一内容写入口 `commitContentBatch`（6 小时复用时间戳写放大节流）；通过 `queries.ts`/`index.ts` 暴露只读查询与 `summarizeScopedContent`。契约许可跨读 `collection` 的 `source` 与 `collection_source` 可见性边界。 |
| **`src/modules/collection/`** | `access/index`、`content/index` | 独家读写 9 张表：`source`、`collection_source`、`source_collection_job`、`source_provider_budget`、`source_provider_usage`、`source_worker_heartbeat`、`source_provider_credential`、`plan_collection_policy`、`user_provider_usage`。含预览、OPML/JSON 导入、`provider_readiness` CTE 到期扫描与 `LISTEN/NOTIFY` 协程 Worker。 |
| **`src/modules/feed/`** | `content/index` | 独家读写 4 张表：`feed_user_seen`、`feed_user_event`、`feed_user_affinity`、`feed_user_preference`。提供防茧房 4 池混排、Plackett-Luce 采样、滑动窗口打散与跨平台热榜 `/v1/feed/*`。 |
| **`src/modules/intelligence/`** | `content/index`、`collection/index` | 独家读写 4 张表：`intel_monitor`、`intel_monitor_source`、`intel_monitor_target`、`intel_rollup_bucket`。提供关键词 SoV/GEO、KOL 批量整合、Subreddit 矩阵分析与 20k/天预算预估 `/v1/intelligence/*`。 |
| **`src/modules/projects/`** | `content/index`、`collection/index` | 独家读写 2 张表：`monitor_project`、`monitor_project_source`。`projectOverview` 委托 `content` 的 `summarizeScopedContent`；`POST /v1/projects/:id/hydrate` 锁定项目后委托 `enqueueHydrationForScope`。 |
| **`src/modules/workspace/`** | `content/index` | 独家读写 2 张表：`content_saved_query`、`content_annotation`（严格浏览器会话隔离，标注经 `loadAnnotatedContentByIds` / `isContentVisibleToActor` 校验可见性）。 |
| **`src/modules/ai/`** | `content/index` | 独家读写 19 张 `ai_*` 表（`054..056`）；经 `listAiFirsthandArticles`、`searchAiOfficialArticlesByTerm`（复用搜索索引）与 `listAiOfficialFeedUpdates` 获取官方资讯，零裸 SQL 跨表直查。 |
| **`src/connectors/`** | 零 `pg`/`storage`/`modules` 依赖 | `web/{http,sources}`、`reddit/{kaix,red-crawler,kaix.config}`、`x/{twitterapis,scrapebadger}`、`bluesky/bluesky-appview-content.connector`、`shared/content-provider.interface`。 |
| **`packages/contracts/src/`** | **纯叶子契约**（按域拆分） | `common`、`access`、`content`、`collection`、`feed`、`intelligence`、`projects`、`content-stories`、`product-docs`、`ai-catalog`（`source-content.ts` 仅作兼容 Barrel）。 |

> 注：`schema_migration` 由引导器 `src/storage/` 独家维护，合计 55 张公有表（`8+1+5+9+4+4+2+2+19+1 = 55`）。全模块写归属零白名单共享，跨模块读仅允许契约声明的 `source` 与 `collection_source`。

| ID | 等级 | 模块边界与不可变迁移规则 | 验收出口 |
| --- | --- | --- | --- |
| MOD-01 | MUST | 跨模块依赖必须严格遵循单向 DAG 并只经 `index.ts` 公开门面；禁止跨模块导入 `routes.ts` 或 `workspace`；每张表在 `src/modules/` 仅有一个写主（零共享写白名单），除 `source`/`collection_source`（仅供 `content` 读）外严禁跨模块 `FROM/JOIN` 读表（`scripts/check-table-ownership.ts`）；`src/connectors/`、`src/shared/` 禁导 `pg` 与 `src/storage/`；全路由 `MUST` 显式声明 `config.auth`。主干已合入迁移不可改写、移动或删除。 | `lint:policy`、`lint:arch`、`check:openapi`、`Squawk` |

## 3. 存储、检索引擎与 `[V2]` 内容价值复利

### 3.1 `[LIVE]` `commitContentBatch` 与双字词 GIN 检索

- **4×`UNNEST` 短事务**：`content` 以 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")` 决胜并自动识别 `language`；`public_content_search_document` 仅在 `changed=true` 时更新且正文截断于 **`MAX_INDEXED_BODY_CHARS = 1500`**（`050` 已物理移除 `normalized_title`/`normalized_text`）；`content_discovery` 维护发现关系；`content_observation` 仅在 `payload_hash` 异同时入库（零重写死元组）。
- **无痛冷裁剪兼容**：`contentTables`、`matchingNodes`（`src/modules/content/search.ts`）使用 **`LEFT JOIN public_content_search_document`**，`listAnnotations`（`src/modules/workspace/sql.ts`）不连搜索表。关键词检索时自然走 GIN 匹配，非关键词读取仍可读取内容、评论树、收藏与导出。搜索投影保留与归档须核对关键词查询及分析覆盖。

| ID | 等级 | 存储、索引与检索执行规则 | 验收出口 |
| --- | --- | --- | --- |
| SQL-01 | MUST | 批量入库固定 4 组 `UNNEST`；零变更重放 `MUST NOT` 重写 `public_content_search_document`、插入同哈希 `content_observation` 或虚增 `updated` 计数；任何投影保留策略调整都须核对关键词覆盖和历史样本可读性。 | 版本幂等与冷删可读性 PG 测试 |
| SQL-02 | MUST | 列表与分面 `MUST NOT` 全表 `COUNT(*)`；`>=3` 连续字母数字走 `gin_trgm_ops`，2 字中文/短代号（`算力`/`o3`）走 `public_search_bigrams(search_text)` GIN 索引并回表精确匹配原文；结构迁移与大索引使用独立长超时连接。 | `EXPLAIN` 索引计划验证 |

### 3.2 研发容量边界与增量设计

当前分支迁移到 `061` 共 **55 张表**（不再设置僵化的表数上限）。新增表须遵循三项工程纪律：① 确认独立数据所有权与生命周期（单表唯一写归属由 `scripts/check-table-ownership.ts` 自动守门，避免向 JSONB 塞异构结构，也避免无谓拆表）；② 新增 SQL 通过 `Squawk` 锁安全检查、PG16 回滚验收与 `.github/CODEOWNERS` 审查；③ 评估单机 4 GB / 60 GB 下的索引体积、写入放大与清理策略。

| 方向 | 实施边界 | 引入额外结构的依据 |
| --- | --- | --- |
| 社媒研究分析 | 以来源授权和时间窗为共同过滤，复用 `compileContentFilter`、专题范围、讨论串根与观测。展示有效样本分母及缺口，按来源与平台保留指标原单位。 | 压测证实现有 PG 索引或聚合无法满足明确工作流，再比较索引、按需物化和独立离线分析。 |
| 资讯与推荐 | 当前事件聚簇读时运行，共享无过滤窗口；CPU 密集排名有并发、候选窗和结果上限，超出显式降载。引入推荐后，候选仍按授权、来源质量与用户设定过滤，再按独立反馈和多样性重排。 | 先测候选量、延迟、主题偏斜与去重效果。确需持久关联时，先定义身份、可见性、时钟和版本，读时仍按权限选代表。 |
| 用户状态与推送 | 先使用现有收藏、保存查询和来源偏好建立少量可解释的用户状态，控制备份与删除边界；导入型推流、个性化阅读和外部通知分别验收。 | 通知的持久回执、退订与故障恢复需求得到验证后，评估既有结构承载能力。 |

---

### 账户挑战与管理员 MFA（`057..058`）

迁移 `057` 新增 Access 的 `app_auth_challenge`（+1 表），保存邮箱挑战摘要、用途、到期时间、消费时间与账号凭证版本或邀请码绑定。验证成功前没有账号和会话。邀请消费、账号激活和密码写入在同一短事务完成。

迁移 `058` 新增 `app_auth_mfa` 与 `app_auth_mfa_login`（+2 表），分别存独立密钥加密的 TOTP、恢复码摘要与短期预认证挑战。MFA 校验按账号行序列化，已用 TOTP 时间步和恢复码不可再用。挑战表按时间和归属建索引，邮件额度为全站 100 次/滚动 24 小时、每邮箱 3 次/24 小时且相邻至少 2 分钟，清理每批上限 500。MFA 只在管理员登录、验证码校验或显式轮换时写入。当前 `main` 迁移至 `058` 合计 **46 表**，后续 `059+` 由迁移不可变校验、`Squawk` 与 `CODEOWNERS` 联合把关。

## 4. 扩源、调度与单机安全基线

- **L1（主线零费直采）**：`feed`（动态放行公网 HTTPS，支持 OPML 批量导入与 `web_list`/`json_list`）+ `newsnow`（6 个内置 `webBoards` 可扩充 IT之家/少数派等 MIT getter，UTC 1h 桶）+ `bluesky_appview`；`[V2]` Phase C 按需补 `linkedom` + `@mozilla/readability` 提取摘要类 RSS 全文与出站链接。
- **L2（预算门控付费 API）**：`twitterapis` 批次 `from:u1 OR from:u2`（较单号省 ~95% 调用）+ `scrapebadger` 备源/批量刷新；Reddit 日常走 `.rss` 雷达，高热帖由用户按需触发 `POST /v1/projects/:id/hydrate`（`kaix`）。
- **L3（外部隔离 Sidecar · `stream_class` 架构修补）**：`[LIVE]` 默认流与趋势 `pullOnly = true` 会屏蔽 `delivery_mode='push'`；因此在 `[V2]` Phase C 接入外部 Sidecar（小红书、豆瓣、Telegram、Instagram 等强反爬源）前，`MUST` 为 `collection_source` 区分 **`stream_class` (`live \| archive \| adhoc`)**：L3 实时采集器推流源标为 **`live`**（进入默认首页流与趋势，解决推送隐形悖论），R4 `.zst` 标 **`archive`**、按题探索 `radar` 源标 **`adhoc`**；显式传 `deliveryMode` 时覆盖默认过滤。

| ID | 等级 | 调度、抗滥用与 SSRF 安全规则 | 验收出口 |
| --- | --- | --- | --- |
| RUN-01 | MUST | 进程内 Worker 运行 `WORKER_CONCURRENCY`（`[1, 12]`，默认 `6`）、`LISTEN/NOTIFY`（`collection_jobs_ready`）唤醒加自适应休眠（最长 `15s`）与 5s `provider_readiness` CTE 到期扫描（`LIMIT 32`）与同域 `1500ms` 冷却；Feed 遇 `304` 或无新增按 `1.5x` 指数退避（上限 12h），截断保持配置周期不空转；每小时清理各源最新 5 条以外且超 14 天的普通终结任务，保留幂等回执和未决付费状态；付费 `unknown` 永不重放。采集租约 180 秒覆盖最长 120 秒的同步 X 请求并预留本地处理时间。 | 并发冷却、清理与停发 E2E |
| SAFE-01 | MUST | `/v1/*` Default-Deny；`@fastify/rate-limit` 置于 `onRequest`（先于 `preParsing` `findActor` 保证 429 零查库）；`/v1/content/*` 仅 `GET/HEAD` 允许 `machine` `read` scope（任何写/AI 端点需管理员浏览器会话或独立作用域）；浏览器写操作校验同源 `Origin`；直连公网源站须限制边缘入口并验证来源；隧道模式只绑定回环。数据库禁暴露宿主机端口。 | `429` 零查库与 `POST /v1/content/*` 403 测试 |
| SAFE-02 | MUST | 连接池预算总计 `12`（`apiPool: 8` + `workerPool: 4`）；流式导出全局单槽、`REPEATABLE READ READ ONLY`、`35s` 空闲超时与 `X-Accel-Buffering: no`，断流即销毁 `QueryStream` 释放连接。 | 并发导出与断流测试 |
| SAFE-03 | MUST | 全部 Web 请求经 `src/connectors/web/http.ts`：拒绝非 HTTPS、带凭证/端口/裸 IP URL；DNS `resolve4`/`resolve6` 纳入 `[3000, 15000]ms` 总超时并要求 **`addresses.every(isPublicIp)`**；手动跟跳最多 3 跳且逐跳重验 DNS 与 Socket `lookup` 绑定；传输与解压上限 `2 MiB`。 | SSRF 与重定向单测 |

---

### AI 安全加固候选

注册表和归档回填借用同一套 HTTPS 公网 DNS 校验和固定连接地址。注册表重定向限于同源，归档重定向限于已批准的厂商域名。注册表和归档响应含解压分别限制为 16 MiB 和 2 MiB。可选 LLM 对管理员配置的 HTTPS 服务发起单次请求，禁止重定向，每进程至多 2 路。访问供应商前在 PostgreSQL 原子占用 UTC 日预算，同一内容的未知结果继续占用预算且不会自动重放。依赖实际父分支的自动同步、影子发布和历史导入开关保留原值。

## 5. 单机容量与 CI 门禁基线

- **Compose 实配**（`docker-compose.yml`）：`db: 1350m`、`app: 1536m`、`proxy: 128m`，容器日志 `json-file (10m×3)`；实际运行占用和版本见[生产快照](status.md)。
- **CI 门禁**：四层路径分流流水线（`.github/workflows/verify.yml`）→ 单一必过 **`CI Gate`**（`policy-and-secrets`、`api-quality`、`web-quality`、`sql-lint`、`ci-lint`、`pg-integration`、按需/主干 `browser-e2e` 与 `docker-dryrun`），辅以周级安全巡检（`.github/workflows/security-scheduled.yml`）。
