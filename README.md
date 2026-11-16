# 多源讨论研究工作台

项目化监测Reddit/X与精选资讯：发现 → 筛选信号 → 按需补评论 → 证据研究 → 留档。

## 文档

- [产品与架构](docs/README.md)：需求、交互、模块与复杂度规则。
- [数据与API契约](docs/contracts.md)：身份、任务、查询、授权与文件。
- [开发与交付](docs/development.md)：私有密钥、命令、迁移与R1–R4。
- [实现状态](docs/status.md)：已实现、缺口与检查证据。

当前仍为0.9.1/node:http旧主链，新架构尚未实现。Git推送不部署服务。

```sh
npm ci
npm --prefix apps/web ci
npm run lint
npm run typecheck
```

密钥不要发到对话或提交Git；填写方式见开发说明。Agent先读[AGENTS.md](AGENTS.md)。
