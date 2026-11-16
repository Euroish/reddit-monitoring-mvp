# 实现状态

核对：2026-11-16。此次工作基线为main@90dbe9a；运行中服务仍为3551900旧构建，未部署本次源码。文档目标见[产品与架构](README.md)，当前行为以下表为准。

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

- 现行核心文档收敛为四份；新增专项[来源替换与清理规格](research/source_replacement_and_twitterapi_io_removal_spec.md)固化`twitterapi_io`全量实删与`TwitterAPIs`+`ScrapeBadger`+Apify低价Reddit切换方案，原审查/研究/历史从Git固定快照追溯。
- 采纳逻辑来源、稳定证据、异步run恢复、导出代理背压/局部idle预算；仍按R1–R3主线、R4外挂实施。
- lint限制文档/目标模块文件，检查规则编号、旧层依赖、空壳class及私有配置入Git；不是已实现五模块。
- 源码移除kaix的$0.01事件帽、45s Actor超时、512MiB强制内存和禁代理；不改变单页/响应大小等现有处理上限。运行中旧构建未换版。
- 本机kaix日/月requests/resources均设为当前接口最大100000000、spacing=0；未启动任务/worker，外部收费请求0。
- 仓库外credentials.env已建，权限600，密钥仍为空。当前服务配置未检到Apify/TwitterAPIs key；TwitterAPIs key只能预留，不能当成已接通。

## 验证

lint（含Web ESLint）、typecheck通过；kaix/发布包/仓库规则专项9/9通过，规则夹具覆盖合法布局与10项独立违规；私有配置入口验证通过且未输出值。未执行新架构PG/浏览器/真实来源/部署验收。

11-13既有部署为/opt/reddit-monitoring-releases/main-3551900-20261113T073415Z，私有配置在/etc/reddit-monitoring；本次读取配置存在性并更新kaix配额，不重启/部署。原工作区未提交修改保持不动。

历史来源、性能与发布证据见[90dbe9a快照](https://github.com/Euroish/reddit-monitoring-mvp/tree/90dbe9a/docs)。未测吞吐、上游报告和历史通过数不作为本版验收。
