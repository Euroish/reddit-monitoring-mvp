# 主线架构规范（STD-100）

本文定义系统运行拓扑、Post-050 `20 → <= 24` 表节制演进约束、L1–L3 扩源路线与单机安全基线。实码状态与 V2 排期见[当前状态与规划](status.md)，契约路由见[数据与 API 契约](contracts.md)，产品两条工作流与度量边界见[产品规范](README.md)。

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
        └── 后台调度平面：5s 到期扫描 (LIMIT 32) + 6 协程并发 (hostCooldown=1500ms) + workerPool (max=4)
                       │
      PostgreSQL 16 (db, postgres:16-alpine, mem_limit=1350m, pg_trgm, LZ4 TOAST)
```

- **镜像构建陷阱**：[Dockerfile](../Dockerfile) 末段 stage 为 `AS proxy`（`caddy:2-alpine`），构建服务端必须显式传 **`--target runtime`**，构建静态反代传入 `--target proxy`。
- **刻意不做列表**：`MUST NOT` 引入 ORM、单实现 `*Repository`/`InMemory*`、Redis/BullMQ、Elasticsearch/ClickHouse、多 Node 容器拆分、容器内 Headless Chromium/Python，或首页同步加载重型全量图表包。

| ID | 等级 | 运行时与结构基线 | 验收出口 |
| --- | --- | --- | --- |
| ARC-01 | MUST | 后端锁定 Node 24+、TypeScript、Fastify 5、`@sinclair/typebox`（`removeAdditional: false`）、`pg`、`pg-query-stream`、PostgreSQL 16；**`[LIVE]` 网页解析依赖 `rss-parser`、`cheerio`、`sanitize-html`（`linkedom` + `@mozilla/readability` 属 `[V2]` Phase C 按需引入）**；构建复制 `src/storage/schema/*.sql` 至 `dist/` 并校验 SHA-256。 | 构建与编译态启动验收 |
| ARC-02 | MUST | Compose 内存配额锁定 `db: 1350m`、`app: 1536m`、`proxy: 128m` 与 `json-file` 日志轮转（`max-size: 10m, max-file: 3`），透传 `WORKER_CONCURRENCY`（默认 6）；优雅停机 `SIGTERM`/`SIGINT` 限 `15_000ms`；主线镜像零 Python/DuckDB/Chromium。 | Compose 配置与停机测试 |
| ARC-03 | MUST | 仅多实现采集边界保留 `ContentProvider` 接口；业务模块内部直写接收 `Pool \| PoolClient` 的命名 SQL 函数（写事务用 `PoolClient`）；`scripts/check-docs.ts` 守卫禁旧层导入、禁类封装、`<= 450` 行/文件与 `<= 220` 字/非模板行。 | `docs:check` 与 AST lint |

---

## 2. `[LIVE]` 入口地图与五模块所有权

| 模块路径 | 入口 | 独家表所有权与核心职责 |
| :--- | :--- | :--- |
| **`apps/api/src/`** | HTTP 与进程入口 | `app.ts`（`requestTimeout: 30_000`、`connectionTimeout: 10_000`、`onRequest` 全局限流 120/min、`preParsing` Default-Deny 鉴权、Swagger `/v1/openapi.json`、`/v1/capabilities`）、`server.ts`（`apiPool: 8` + `workerPool: 4` + 7 Providers + `AI_SYNC_ENABLED` 调度器）。 |
| **`src/modules/access/`** | `routes`、`sql` | `app_user`、`app_user_password`、`app_invite`、`app_audit_log`、`app_session`（浏览器 Cookie + 43 字符一次性 SHA-256 `machine` API Key）。 |
| **`src/modules/collection/`** | 源配置、调度、任务、配额、凭证 | `source`、`collection_source`、`source_collection_job`、`source_provider_budget`、`source_provider_usage`、`source_worker_heartbeat`、`source_provider_credential`、`plan_collection_policy`、`user_provider_usage`；含预览、OPML/JSON 导入、到期扫描与 6 协程 Worker。 |
| **`src/modules/content/`** | 批量写入、检索、资讯、文档、AI 情报 | `content`、`content_discovery`、`content_observation`、`public_content_search_document`、`doc_page` 以及 `054..056` 新增的 19 张 `ai_*` 表（全库共 `43` 张表）；唯一写入口 `commitContentBatch`、唯一过滤 `compileContentFilter`、48h 事件聚簇、分面、闭包树、流式导出、文档中心（`markdown`/外链/PDF 单附件）、AI 发布日历/注册表双轨 Diff/自动发现流水线（`AI_SYNC_ENABLED` 按源周期调度，默认关闭）与离线历史 Seed 导入/分页 Backfill。 |
| **`src/modules/projects/`** | `routes`、`sql` | `monitor_project`、`monitor_project_source`；项目三段词 `GROUPING SETS` 概览与显式 `kaix` 水合。 |
| **`src/modules/workspace/`** | `routes`、`sql` | `content_saved_query`、`content_annotation`（仅限浏览器会话隔离读写）。 |
| **`src/connectors/`** | 一等 Provider 边界 | `web/{http,sources}`、`reddit/{kaix,red-crawler,kaix.config}`、`x/{twitterapis,scrapebadger}`、`bluesky/bluesky-appview-content.connector`、`shared/content-provider.interface`（**零 `pg` 依赖**）。 |
| **`packages/contracts/src/` & `src/shared/` & `src/storage/`** | 契约与底层公共函数 | TypeBox 契约真源、`stable-id` / `language` 语言与通道识别、`db` 池/事务与 SQL 迁移运行器。 |

| ID | 等级 | 模块边界与不可变迁移规则 | 验收出口 |
| --- | --- | --- | --- |
| MOD-01 | MUST | 模块间 `MUST NOT` 越权写他方独占表；`src/connectors/`、`src/shared/` `MUST NOT` 导入 `pg` 连接；主干已合入的迁移不可改写、移动或删除；PR 按目标基线校验，结构变更追加顺延编号的前向迁移。 | `docs:check` 与 PG 迁移验证 |

---

## 3. 存储、检索引擎与 `[V2]` 内容价值复利（`20 → <= 24` 表上限）

### 3.1 `[LIVE]` `commitContentBatch` 与双字词 GIN 检索

- **4×`UNNEST` 短事务**：`content` 以 `(content_observed_at IS NOT NULL, COALESCE(content_observed_at, content_version_fetched_at), content_evidence_key COLLATE "C")` 决胜并自动识别 `language`；`public_content_search_document` 仅在 `changed=true` 时更新且正文截断于 **`MAX_INDEXED_BODY_CHARS = 1500`**（`050` 已物理移除 `normalized_title`/`normalized_text`）；`content_discovery` 维护发现关系；`content_observation` 仅在 `payload_hash` 异同时入库（零重写死元组）。
- **无痛冷裁剪兼容**：`contentTables`、`matchingNodes`（`src/modules/content/search.ts`）使用 **`LEFT JOIN public_content_search_document`**，`listAnnotations`（`src/modules/workspace/sql.ts`）不连搜索表。关键词检索时自然走 GIN 匹配，非关键词读取仍可读取内容、评论树、收藏与导出。搜索投影保留与归档须核对关键词查询及分析覆盖。

| ID | 等级 | 存储、索引与检索执行规则 | 验收出口 |
| --- | --- | --- | --- |
| SQL-01 | MUST | 批量入库固定 4 组 `UNNEST`；零变更重放 `MUST NOT` 重写 `public_content_search_document`、插入同哈希 `content_observation` 或虚增 `updated` 计数；任何投影保留策略调整都须核对关键词覆盖和历史样本可读性。 | 版本幂等与冷删可读性 PG 测试 |
| SQL-02 | MUST | 列表与分面 `MUST NOT` 全表 `COUNT(*)`；`>=3` 连续字母数字走 `gin_trgm_ops`，2 字中文/短代号（`算力`/`o3`）走 `public_search_bigrams(search_text)` GIN 索引并回表精确匹配原文；结构迁移与大索引使用独立长超时连接。 | `EXPLAIN` 索引计划验证 |

### 3.2 研发容量边界与增量设计

当前主干迁移到 `053` 共 **24 张表**，为本阶段单机发布预算。先通过已有发现、观测、专题及保存查询支撑投入产出验证。长期若发现状态归属、写入负载或独立可恢复性有明确需要，应先用设计决策记录数据量、替代方案、迁移、容量和回滚成本，再调整预算。

| 方向 | 实施边界 | 引入额外结构的依据 |
| --- | --- | --- |
| 社媒研究分析 | 以来源授权和时间窗为共同过滤，复用 `compileContentFilter`、专题范围、讨论串根与观测。展示有效样本分母及缺口，按来源与平台保留指标原单位。 | 压测证实现有 PG 索引或聚合无法满足明确工作流，再比较索引、按需物化和独立离线分析。 |
| 资讯与推荐 | 当前事件聚簇读时运行，共享无过滤窗口；CPU 密集排名有并发、候选窗和结果上限，超出显式降载。引入推荐后，候选仍按授权、来源质量与用户设定过滤，再按独立反馈和多样性重排。 | 先测候选量、延迟、主题偏斜与去重效果。确需持久关联时，先定义身份、可见性、时钟和版本，读时仍按权限选代表。 |
| 用户状态与推送 | 先使用现有收藏、保存查询和来源偏好建立少量可解释的用户状态，控制备份与删除边界；导入型推流、个性化阅读和外部通知分别验收。 | 通知的持久回执、退订与故障恢复需求得到验证后，评估既有结构承载能力。 |

---

### 帐户挑战候选决策（待预算审批）

邮箱验证和找回需要持久且可原子一次消费的挑战，拟由 Access 模块拥有 `app_auth_challenge`（+1 表）。注册验证可在用户创建前开始，重置须绑定已有账号及凭证版本。会话行只表示已授予的身份，邀请码只表示角色邀请。复用其中任一行承载挑战都会混合不同的授权与消费语义。

候选字段包括用途、用户或目标邮箱、预期凭证版本、唯一 token 摘要、绝对到期和消费时间。新增到期索引用于分批清理，写入量由发送额度限制，领取与账户状态变更在短事务内完成。回退先关闭公开注册和发信并保留数据，快照按现有加密备份策略验证恢复。当前安全分支新增 0 表，候选 +1 需在 AI 表预算与实际主干迁移确定后单独批准。MFA 存储另行评审。

## 4. 扩源、调度与单机安全基线

- **L1（主线零费直采）**：`feed`（动态放行公网 HTTPS，支持 OPML 批量导入与 `web_list`/`json_list`）+ `newsnow`（6 个内置 `webBoards` 可扩充 IT之家/少数派等 MIT getter，UTC 1h 桶）+ `bluesky_appview`；`[V2]` Phase C 按需补 `linkedom` + `@mozilla/readability` 提取摘要类 RSS 全文与出站链接。
- **L2（预算门控付费 API）**：`twitterapis` 批次 `from:u1 OR from:u2`（较单号省 ~95% 调用）+ `scrapebadger` 备源/批量刷新；Reddit 日常走 `.rss` 雷达，高热帖由用户按需触发 `POST /v1/projects/:id/hydrate`（`kaix`）。
- **L3（外部隔离 Sidecar · `stream_class` 架构修补）**：`[LIVE]` 默认流与趋势 `pullOnly = true` 会屏蔽 `delivery_mode='push'`；因此在 `[V2]` Phase C 接入外部 Sidecar（小红书、豆瓣、Telegram、Instagram 等强反爬源）前，`MUST` 为 `collection_source` 区分 **`stream_class` (`live \| archive \| adhoc`)**：L3 实时采集器推流源标为 **`live`**（进入默认首页流与趋势，解决推送隐形悖论），R4 `.zst` 标 **`archive`**、按题探索 `radar` 源标 **`adhoc`**；显式传 `deliveryMode` 时覆盖默认过滤。

| ID | 等级 | 调度、抗滥用与 SSRF 安全规则 | 验收出口 |
| --- | --- | --- | --- |
| RUN-01 | MUST | 进程内 Worker 运行 `WORKER_CONCURRENCY`（`[1, 12]`，默认 `6`）、5s 到期扫描（`LIMIT 32`）与同域 `1500ms` 冷却；Feed 遇 `304` 或无新增按 `1.5x` 指数退避（上限 12h），截断保持配置周期不空转；每小时清理各源最新 5 条以外且超 14 天的普通终结任务，保留幂等回执和未决付费状态；付费 `unknown` 永不重放。采集租约 180 秒覆盖最长 120 秒的同步 X 请求并预留本地处理时间。 | 并发冷却、清理与停发 E2E |
| SAFE-01 | MUST | `/v1/*` Default-Deny；`@fastify/rate-limit` 置于 `onRequest`（先于 `preParsing` `findActor` 保证 429 零查库）；`/v1/content/*` 仅 `GET/HEAD` 允许 `machine` `read` scope（任何写/AI 端点需管理员浏览器会话或独立作用域）；浏览器写操作校验同源 `Origin`；直连公网源站须限制边缘入口并验证来源；隧道模式只绑定回环。数据库禁暴露宿主机端口。 | `429` 零查库与 `POST /v1/content/*` 403 测试 |
| SAFE-02 | MUST | 连接池预算总计 `12`（`apiPool: 8` + `workerPool: 4`）；流式导出全局单槽、`REPEATABLE READ READ ONLY`、`35s` 空闲超时与 `X-Accel-Buffering: no`，断流即销毁 `QueryStream` 释放连接。 | 并发导出与断流测试 |
| SAFE-03 | MUST | 全部 Web 请求经 `src/connectors/web/http.ts`：拒绝非 HTTPS、带凭证/端口/裸 IP URL；DNS `resolve4`/`resolve6` 纳入 `[3000, 15000]ms` 总超时并要求 **`addresses.every(isPublicIp)`**；手动跟跳最多 3 跳且逐跳重验 DNS 与 Socket `lookup` 绑定；传输与解压上限 `2 MiB`。 | SSRF 与重定向单测 |

---

### AI 安全加固候选

注册表和归档回填借用同一套 HTTPS 公网 DNS 校验和固定连接地址。注册表重定向限于同源，归档重定向限于已批准的厂商域名。注册表和归档响应含解压分别限制为 16 MiB 和 2 MiB。可选 LLM 对管理员配置的 HTTPS 服务发起单次请求，禁止重定向，每进程至多 2 路。访问供应商前在 PostgreSQL 原子占用 UTC 日预算，同一内容的未知结果继续占用预算且不会自动重放。依赖实际父分支的自动同步、影子发布和历史导入开关保留原值。

## 5. 单机容量与 CI 门禁基线

- **Compose 实配**（`docker-compose.yml`）：`db: 1350m`、`app: 1536m`、`proxy: 128m`，容器日志 `json-file (10m×3)`；实际运行占用和版本见[生产快照](status.md)。
- **CI 门禁**：`npm run docs:check` → `npm run lint` → `npm run typecheck` → `npm run build` → `npm run test:unit` → 隔离 PG16 `test:postgres` + `smoke:compiled`。
