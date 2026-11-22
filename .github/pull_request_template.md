## 1. 变更摘要与影响域
- **变更目标**：
- **触碰模块 / 目录**：（例：`src/modules/ai/`、`apps/web/src/pages/`、`src/storage/schema/059_*.sql`）
- **新增/修改数据库表或迁移**：无 / `059_...`（说明锁表风险与索引影响）

## 2. 业务不变量核对（参考 `docs/invariants.md`）
- [ ] **鉴权与对象隔离（INV-001）**：新路由已明确访问级别，未向匿名/Viewer/Machine Key 意外放权
- [ ] **模块边界与表归属（INV-007 / INV-008）**：跨模块仅通过 `index.ts` 导入；未直接写入别家模块拥有的表
- [ ] **并发 / 幂等 / 迁移安全（INV-002..005）**：未改写已合入迁移；付费/配额/写入链路保持幂等
- [ ] **反漂移底线**：未为通过 CI 删除或跳过（`.skip`）既有测试，未擅自放宽 ESLint / dependency-cruiser / CI 门禁

## 3. 实跑验证证据
- [ ] `npm run lint`（`lint:policy` + `lint:api` + `lint:arch` + `lint:web`）
- [ ] `npm run typecheck`
- [ ] `npm run check:openapi`
- [ ] `npm run test:unit`
- [ ] `npm run build && npm run check:web-bundle`
- [ ] `npm run test:postgres` / `npm run test:browser`（如涉及 DB / 核心 UI）

## 4. 未验证项与回滚风险
- **未覆盖场景 / 已知限制**：
- **线上回滚说明**：
