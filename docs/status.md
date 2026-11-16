# 实现状态

核对：2026-11-16。此次文档对齐基线为main@9760006；已知部署仍为3551900旧构建，本轮未部署或重查现网。文档目标见[产品与架构](README.md)，当前行为以下表为准。

## 已有与缺口

| 范围 | 已有 | 待重构 |
| --- | --- | --- |
| API/Web | node:http、React/Vite、账户/来源/内容/个人研究 | Fastify、项目/五导航、机器scope、OpenAPI/capabilities |
| 数据 | PostgreSQL、42项迁移（末040）、页事务、租约/预算 | 逻辑来源、集合写、确定性正文版本/观测幂等、单投影/统一统计 |
| kaix | search/账号/社区/帖子评论、固定build0.2.25、收费未知不自动重发 | 单页仍1–100、搜索不带评论、post丢根帖、布尔query误筛、同源单kind；混合树/批量postUrls未实现 |
| kaix运行恢复 | 旧代码等待60s后仅接受SUCCEEDED | RUNNING会失败但云端run可继续计费；runId/datasetId尚未结构化持久化，重试前须查Apify；R1改异步续读 |
| 其他来源 | TwitterAPI.io（已决废弃待实删）与Bluesky基础adapter；Arctic Shift旧在线代码仍在 | TwitterAPIs/ScrapeBadger/red_crawler/NewsNow/feed未实现；TwitterAPI.io与Arctic Shift按R1–R3实删（见[来源替换与清理规格](research/source_replacement_and_twitterapi_io_removal_spec.md)） |
| 查询/文件 | 旧过滤/详情/批注、数组导出与RR冻结 | 三段词/信号/联动三视图/同口径统计、流式文件；冻结先迁出再删 |

## 本次完成

- 四份核心文档吸收来源替换设计：TwitterAPIs主源、ScrapeBadger备源/批量ID补全、red_crawler补评论搜索/有界树；[来源专项](research/source_replacement_and_twitterapi_io_removal_spec.md)只保留供应商字段、采购证据与清理定位。
- 契约补齐能力差异、付费GET不重放、空页/重复cursor止损、账户档位限流、请求级积分与新预算默认关闭；开发说明统一安全退役顺序，删除专项中可误取消在途任务的SQL范本。R1–R3/R4边界不变，未编写新adapter或执行退役。
- lint限制文档/目标模块文件，检查规则编号、旧层依赖、空壳class及私有配置入Git；不是已实现五模块。
- 源码移除kaix的$0.01事件帽、45s Actor超时、512MiB强制内存和禁代理；不改变单页/响应大小等现有处理上限。运行中旧构建未换版。
- 前轮已将本机kaix日/月requests/resources设为100000000、spacing=0；本轮不改配额/数据库，不新增收费调用或后台采集。
- 仓库外credentials.env中的Apify/TwitterAPIs凭证已由用户填写，权限600；两家上游小样本已通，不等于运行中服务已加载或TwitterAPIs adapter已实现。

## 验证

本轮lint（含Web ESLint）、typecheck、kaix/发布包/仓库规则专项9/9及diff检查通过；文档门禁覆盖7份允许文档、54条唯一规则及本地链接/锚点。未运行全量离线/PG/浏览器或部署检查。

11-16按用户授权直连上游，以OpenAI搜索：kaix固定build0.2.25成功取20帖（1个Actor run），TwitterAPIs HTTP 200取20推文（1次搜索）；各20个独立ID，未抓评论/翻页/入业务库。报告留在原reddit-review-rules工作目录的output/validation/provider-smoke-2026-11-16T07-25-31-593Z/，原始数据和密钥不进Git。这只证明一次上游可用；ScrapeBadger/red_crawler、新架构PG/HTTP/浏览器、完整账单/持续覆盖与部署仍未验收。

11-13既有部署为/opt/reddit-monitoring-releases/main-3551900-20261113T073415Z，私有配置在/etc/reddit-monitoring；本轮只改文档，不读出密钥、不重启/部署。原工作区未提交修改保持不动。

历史来源、性能与发布证据见[90dbe9a快照](https://github.com/Euroish/reddit-monitoring-mvp/tree/90dbe9a/docs)。未测吞吐、上游报告和历史通过数不作为本版验收。
