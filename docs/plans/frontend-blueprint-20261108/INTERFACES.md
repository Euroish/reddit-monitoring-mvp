# 接口核对与设计目录

本文件由 build.py 从 data/catalog.json 生成。existing/legacy 路由的行号、摘录和源码摘要可供复查；proposed 只是契约建议。模拟器返回用于交互设计，不替代 TypeScript DTO 或线上兼容性测试。

## 身份与返回约定

`authenticated` = 有效会话或bearer；`personal-session` = 当前人类用户私有；`ops-write` = owner/admin/授权machine；`admin-session` = owner/admin会话；`owner-guarded` = 还需执行账户目标保护；`local-operator` = 独立本地操作员；project-* = P2独立项目权限。

正常：列表/详情200，创建通常201，入队202；400输入/游标，401会话，403权限，404不可见对象，409修订冲突/守卫，413样本上限，422上游超时，429限流，503不可用。不同现有路由的错误封装不完全统一，不把模拟器统一封装当作现有实现。

## 请求链示例

检索 C01/C02 → C04 → P06/P07（expectedRevision）→ R02 → R03/R05/R06；采集 S01能力 → J01 → worker → J03/J07；研究数据集 N03/N05/N06 → N12/N18（拟新增）。每个接口可在原型“模拟接口”选项卡编辑JSON请求并观察返回与错误。

## C01 · GET /v1/content

- 状态：`implemented`；权限：`authenticated`；功能：F04, F30。
- 请求：`ContentQuery`。
- 返回：`ContentListResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L21)；核对行 21；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "GET", path: /^\/v1\/content$/, action: "content", write: false },
```

## C02 · GET /v1/content/stats

- 状态：`implemented`；权限：`authenticated`；功能：F05。
- 请求：`ContentQuery`。
- 返回：`ContentStatsResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L22)；核对行 22；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "GET", path: /^\/v1\/content\/stats$/, action: "stats", write: false },
```

## C03 · GET /v1/content/workbench

- 状态：`implemented`；权限：`authenticated`；功能：F05, F30。
- 请求：`ContentQuery`。
- 返回：`ContentWorkbenchResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L23)；核对行 23；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "GET", path: /^\/v1\/content\/workbench$/, action: "workbench", write: false },
```

## C04 · GET /v1/content/:id

- 状态：`implemented`；权限：`authenticated`；功能：F06, F07, F08, F29, F35。
- 请求：`id`。
- 返回：`ContentDetailResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L25)；核对行 25；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method:"GET",path:/^\/v1\/content\/([^/]+)$/,action:"detail",write:false },
```

## C05 · GET /v1/content/export

- 状态：`implemented`；权限：`authenticated`；功能：F11。
- 请求：`ContentQuery + format + maxItems(1..2000)`。
- 返回：`ContentExportResponse | CSV metadata + rows`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L24)；核对行 24；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "GET", path: /^\/v1\/content\/export$/, action: "export", write: false },
```

## S01 · GET /v1/sources

- 状态：`implemented`；权限：`authenticated`；功能：F13。
- 请求：`none; no current pagination`。
- 返回：`SourceListResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L7)；核对行 7；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "GET", path: /^\/v1\/sources$/, action: "sources", write: false },
```

## S02 · POST /v1/sources

- 状态：`implemented`；权限：`ops-write`；功能：F13。
- 请求：`CreateCollectionSourceRequest`。
- 返回：`CollectionSourceResponse (201)`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L8)；核对行 8；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "POST", path: /^\/v1\/sources$/, action: "create", write: true },
```

## S03 · PATCH /v1/sources/:id

- 状态：`implemented`；权限：`ops-write`；功能：F13, F14。
- 请求：`UpdateCollectionSourceRequest`。
- 返回：`CollectionSourceResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L9)；核对行 9；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "PATCH", path: /^\/v1\/sources\/([^/]+)$/, action: "update", write: true },
```

## S04 · POST /v1/sources/:id/pause

- 状态：`implemented`；权限：`ops-write`；功能：F14。
- 请求：`expectedRevision?`。
- 返回：`CollectionSourceResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L10)；核对行 10；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "POST", path: /^\/v1\/sources\/([^/]+)\/pause$/, action: "pause", write: true },
```

## S05 · POST /v1/sources/:id/resume

- 状态：`implemented`；权限：`ops-write`；功能：F14。
- 请求：`expectedRevision?`。
- 返回：`CollectionSourceResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L11)；核对行 11；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "POST", path: /^\/v1\/sources\/([^/]+)\/resume$/, action: "resume", write: true },
```

## S06 · POST /v1/sources/:id/archive

- 状态：`implemented`；权限：`ops-write`；功能：F14。
- 请求：`expectedRevision?`。
- 返回：`CollectionSourceResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L12)；核对行 12；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "POST", path: /^\/v1\/sources\/([^/]+)\/archive$/, action: "archive", write: true },
```

## J01 · POST /v1/sources/:id/collect

- 状态：`implemented`；权限：`ops-write`；功能：F15。
- 请求：`StartSourceCollectionRequest`。
- 返回：`SourceJobResponse (202)`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L13)；核对行 13；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "POST", path: /^\/v1\/sources\/([^/]+)\/collect$/, action: "collect", write: true },
```

## J02 · GET /v1/source-jobs

- 状态：`implemented`；权限：`authenticated`；功能：F15。
- 请求：`sourceId? status? limit<=50`。
- 返回：`SourceJobsResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L14)；核对行 14；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "GET", path: /^\/v1\/source-jobs$/, action: "jobs", write: false },
```

## J03 · GET /v1/source-jobs/:id

- 状态：`implemented`；权限：`authenticated`；功能：F15。
- 请求：`id`。
- 返回：`SourceJobResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L15)；核对行 15；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "GET", path: /^\/v1\/source-jobs\/([^/]+)$/, action: "job", write: false },
```

## J04 · POST /v1/source-jobs/:id/retry

- 状态：`implemented`；权限：`ops-write`；功能：F16。
- 请求：`id`。
- 返回：`SourceJobResponse (202)`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L16)；核对行 16；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "POST", path: /^\/v1\/source-jobs\/([^/]+)\/retry$/, action: "retry", write: true },
```

## J05 · POST /v1/source-jobs/:id/continue

- 状态：`implemented`；权限：`ops-write`；功能：F16。
- 请求：`id`。
- 返回：`SourceJobResponse (202)`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L17)；核对行 17；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "POST", path: /^\/v1\/source-jobs\/([^/]+)\/continue$/, action: "continue", write: true },
```

## J06 · POST /v1/source-jobs/:id/cancel

- 状态：`implemented`；权限：`ops-write`；功能：F16。
- 请求：`id`。
- 返回：`SourceJobResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L18)；核对行 18；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "POST", path: /^\/v1\/source-jobs\/([^/]+)\/cancel$/, action: "cancel", write: true },
```

## J07 · GET /v1/source-ops

- 状态：`implemented`；权限：`authenticated`；功能：F17。
- 请求：`none`。
- 返回：`SourceOpsResponse`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L19)；核对行 19；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "GET", path: /^\/v1\/source-ops$/, action: "ops", write: false },
```

## J08 · PUT /v1/source-provider-budgets/:provider

- 状态：`implemented`；权限：`ops-write`；功能：F17。
- 请求：`SourceProviderBudgetRequest`。
- 返回：`ok/requestId/budget`。
- 源码：[定位](../../../apps/api/src/source-content-routes.ts#L20)；核对行 20；SHA256 `cbeabd7eaeb1e8ccd96c8c4b42b1903e481ae0426be7bf6359e3314975d7d12a`。

```text
{ method: "PUT", path: /^\/v1\/source-provider-budgets\/([^/]+)$/, action: "budget", write: true },
```

## P01 · GET /v1/content-saved-queries

- 状态：`implemented`；权限：`personal-session`；功能：F09。
- 请求：`limit/cursor`。
- 返回：`ContentSavedQueryListResponse`。
- 源码：[定位](../../../apps/api/src/content-personal-routes.ts#L6)；核对行 6；SHA256 `7fef6b1796f61fe23774fa9bc12d1c393ee721f3e53a7eb3fb8d9a05280a71fd`。

```text
{method:"GET",path:/^\/v1\/content-saved-queries$/,action:"queries",write:false,personal:true},
```

## P02 · POST /v1/content-saved-queries

- 状态：`implemented`；权限：`personal-session`；功能：F09。
- 请求：`SaveContentQueryRequest expectedRevision=0`。
- 返回：`SaveContentQueryResponse (201)`。
- 源码：[定位](../../../apps/api/src/content-personal-routes.ts#L7)；核对行 7；SHA256 `7fef6b1796f61fe23774fa9bc12d1c393ee721f3e53a7eb3fb8d9a05280a71fd`。

```text
{method:"POST",path:/^\/v1\/content-saved-queries$/,action:"createQuery",write:true,personal:true},
```

## P03 · PATCH /v1/content-saved-queries/:id

- 状态：`implemented`；权限：`personal-session`；功能：F09。
- 请求：`SaveContentQueryRequest current revision`。
- 返回：`SaveContentQueryResponse`。
- 源码：[定位](../../../apps/api/src/content-personal-routes.ts#L8)；核对行 8；SHA256 `7fef6b1796f61fe23774fa9bc12d1c393ee721f3e53a7eb3fb8d9a05280a71fd`。

```text
{method:"PATCH",path:/^\/v1\/content-saved-queries\/([^/]+)$/,action:"updateQuery",write:true,personal:true},
```

## P04 · DELETE /v1/content-saved-queries/:id

- 状态：`implemented`；权限：`personal-session`；功能：F09。
- 请求：`{expectedRevision}`。
- 返回：`{deleted:true}`。
- 源码：[定位](../../../apps/api/src/content-personal-routes.ts#L9)；核对行 9；SHA256 `7fef6b1796f61fe23774fa9bc12d1c393ee721f3e53a7eb3fb8d9a05280a71fd`。

```text
{method:"DELETE",path:/^\/v1\/content-saved-queries\/([^/]+)$/,action:"deleteQuery",write:true,personal:true},
```

## P05 · GET /v1/content-annotations

- 状态：`implemented`；权限：`personal-session`；功能：F10。
- 请求：`favoriteOnly? limit/cursor`。
- 返回：`ContentAnnotationListResponse`。
- 源码：[定位](../../../apps/api/src/content-personal-routes.ts#L10)；核对行 10；SHA256 `7fef6b1796f61fe23774fa9bc12d1c393ee721f3e53a7eb3fb8d9a05280a71fd`。

```text
{method:"GET",path:/^\/v1\/content-annotations$/,action:"annotations",write:false,personal:true},
```

## P06 · GET /v1/content/:id/annotation

- 状态：`implemented`；权限：`personal-session`；功能：F10。
- 请求：`id`。
- 返回：`ContentAnnotationResponse`。
- 源码：[定位](../../../apps/api/src/content-personal-routes.ts#L11)；核对行 11；SHA256 `7fef6b1796f61fe23774fa9bc12d1c393ee721f3e53a7eb3fb8d9a05280a71fd`。

```text
{method:"GET",path:/^\/v1\/content\/([^/]+)\/annotation$/,action:"annotation",write:false,personal:true},
```

## P07 · PUT /v1/content/:id/annotation

- 状态：`implemented`；权限：`personal-session`；功能：F10。
- 请求：`UpdateContentAnnotationRequest`。
- 返回：`ContentAnnotationResponse`。
- 源码：[定位](../../../apps/api/src/content-personal-routes.ts#L12)；核对行 12；SHA256 `7fef6b1796f61fe23774fa9bc12d1c393ee721f3e53a7eb3fb8d9a05280a71fd`。

```text
{method:"PUT",path:/^\/v1\/content\/([^/]+)\/annotation$/,action:"saveAnnotation",write:true,personal:true},
```

## P08 · DELETE /v1/content/:id/annotation

- 状态：`implemented`；权限：`personal-session`；功能：F10。
- 请求：`{expectedRevision}`。
- 返回：`{deleted:true}`。
- 源码：[定位](../../../apps/api/src/content-personal-routes.ts#L13)；核对行 13；SHA256 `7fef6b1796f61fe23774fa9bc12d1c393ee721f3e53a7eb3fb8d9a05280a71fd`。

```text
{method:"DELETE",path:/^\/v1\/content\/([^/]+)\/annotation$/,action:"deleteAnnotation",write:true,personal:true},
```

## R01 · GET /v1/research-exports

- 状态：`implemented`；权限：`personal-session`；功能：F12。
- 请求：`limit/cursor`。
- 返回：`ResearchExportListResponse`。
- 源码：[定位](../../../apps/api/src/research-export-routes.ts#L8)；核对行 8；SHA256 `99f2692bf24791ae246987d238e20f9089de61c10e6f4cfbf7851e8a03231ca2`。

```text
{ method: "GET", path: /^\/v1\/research-exports$/, action: "list", write: false, personal: true },
```

## R02 · POST /v1/research-exports

- 状态：`implemented`；权限：`personal-session`；功能：F12。
- 请求：`CreateResearchExportRequest maxRows<=20000`。
- 返回：`ResearchExportResponse (201)`。
- 源码：[定位](../../../apps/api/src/research-export-routes.ts#L9)；核对行 9；SHA256 `99f2692bf24791ae246987d238e20f9089de61c10e6f4cfbf7851e8a03231ca2`。

```text
{ method: "POST", path: /^\/v1\/research-exports$/, action: "create", write: true, personal: true },
```

## R03 · GET /v1/research-exports/:id

- 状态：`implemented`；权限：`personal-session`；功能：F12。
- 请求：`id`。
- 返回：`ResearchExportResponse`。
- 源码：[定位](../../../apps/api/src/research-export-routes.ts#L10)；核对行 10；SHA256 `99f2692bf24791ae246987d238e20f9089de61c10e6f4cfbf7851e8a03231ca2`。

```text
{ method: "GET", path: /^\/v1\/research-exports\/([^/]+)$/, action: "get", write: false, personal: true },
```

## R04 · DELETE /v1/research-exports/:id

- 状态：`implemented`；权限：`personal-session`；功能：F12。
- 请求：`id`。
- 返回：`{deleted:true}`。
- 源码：[定位](../../../apps/api/src/research-export-routes.ts#L11)；核对行 11；SHA256 `99f2692bf24791ae246987d238e20f9089de61c10e6f4cfbf7851e8a03231ca2`。

```text
{ method: "DELETE", path: /^\/v1\/research-exports\/([^/]+)$/, action: "delete", write: true, personal: true },
```

## R05 · GET /v1/research-exports/:id/content

- 状态：`implemented`；权限：`personal-session`；功能：F12。
- 请求：`limit<=100/cursor`。
- 返回：`ResearchExportPageResponse`。
- 源码：[定位](../../../apps/api/src/research-export-routes.ts#L12)；核对行 12；SHA256 `99f2692bf24791ae246987d238e20f9089de61c10e6f4cfbf7851e8a03231ca2`。

```text
{ method: "GET", path: /^\/v1\/research-exports\/([^/]+)\/content$/, action: "content", write: false, personal: true },
```

## R06 · GET /v1/research-exports/:id/export

- 状态：`implemented`；权限：`personal-session`；功能：F12。
- 请求：`format=json|csv limit<=100/cursor`。
- 返回：`ResearchExportPageResponse | CSV`。
- 源码：[定位](../../../apps/api/src/research-export-routes.ts#L13)；核对行 13；SHA256 `99f2692bf24791ae246987d238e20f9089de61c10e6f4cfbf7851e8a03231ca2`。

```text
{ method: "GET", path: /^\/v1\/research-exports\/([^/]+)\/export$/, action: "export", write: false, personal: true },
```

## A01 · POST /auth/login

- 状态：`implemented`；权限：`public`；功能：F02。
- 请求：`email/password`。
- 返回：`AuthLoginResponse + session cookie`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1354)；核对行 1354；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (authRateLimiter && req.method === "POST" && (pathname === "/auth/login" || pathname === "/auth/register")) {
```

## A02 · POST /auth/logout

- 状态：`implemented`；权限：`personal-session`；功能：F02。
- 请求：`none`。
- 返回：`AuthLogoutResponse + clear cookie`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1492)；核对行 1492；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "POST" && pathname === "/auth/logout") {
```

## A03 · GET /auth/me

- 状态：`implemented`；权限：`personal-session`；功能：F02。
- 请求：`session`。
- 返回：`AuthMeResponse`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1722)；核对行 1722；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/auth/me") {
```

## A04 · POST /auth/register

- 状态：`implemented`；权限：`public`；功能：F02, F20。
- 请求：`email/password/displayName/inviteCode`。
- 返回：`RegisterAppUserResponse; pending activation`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1354)；核对行 1354；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (authRateLimiter && req.method === "POST" && (pathname === "/auth/login" || pathname === "/auth/register")) {
```

## A05 · GET /auth/users

- 状态：`implemented`；权限：`auth-admin`；功能：F19。
- 请求：`none`。
- 返回：`ListAppUsersResponse`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1604)；核对行 1604；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/auth/users") {
```

## A06 · POST /auth/invites

- 状态：`implemented`；权限：`auth-admin`；功能：F20。
- 请求：`roleOnAccept/maxUses/expiresAt`。
- 返回：`CreateInviteResponse`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1631)；核对行 1631；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "POST" && pathname === "/auth/invites") {
```

## A07 · POST /auth/users/:id/role

- 状态：`implemented`；权限：`owner-guarded`；功能：F19。
- 请求：`role`。
- 返回：`UpdateAppUserRoleResponse`。
- 源码：[定位](../../../apps/api/src/auth-account-routes.ts#L75)；核对行 75；SHA256 `9c649b46454216e43e0e4a1d678655abb6642165f95d2c2edeea155ee992b405`。

```text
const user = match[2] === "role" ? await service.changeRole(accessActor, userId, body.role as AppUser["role"]) : await service.changeStatus(accessActor, userId, match[2] === "activate" ? "active" : body.status as AppUser["status"]);
```

## A08 · POST /auth/users/:id/status

- 状态：`implemented`；权限：`owner-guarded`；功能：F19。
- 请求：`status:pending|active|disabled`。
- 返回：`UpdateAppUserStatusResponse`。
- 源码：[定位](../../../apps/api/src/auth-account-routes.ts#L75)；核对行 75；SHA256 `9c649b46454216e43e0e4a1d678655abb6642165f95d2c2edeea155ee992b405`。

```text
const user = match[2] === "role" ? await service.changeRole(accessActor, userId, body.role as AppUser["role"]) : await service.changeStatus(accessActor, userId, match[2] === "activate" ? "active" : body.status as AppUser["status"]);
```

## A09 · POST /auth/users/:id/activate

- 状态：`implemented`；权限：`owner-guarded`；功能：F19。
- 请求：`none`。
- 返回：`UpdateAppUserStatusResponse`。
- 源码：[定位](../../../apps/api/src/auth-account-routes.ts#L75)；核对行 75；SHA256 `9c649b46454216e43e0e4a1d678655abb6642165f95d2c2edeea155ee992b405`。

```text
const user = match[2] === "role" ? await service.changeRole(accessActor, userId, body.role as AppUser["role"]) : await service.changeStatus(accessActor, userId, match[2] === "activate" ? "active" : body.status as AppUser["status"]);
```

## A10 · POST /auth/password

- 状态：`implemented`；权限：`personal-session`；功能：F03。
- 请求：`currentPassword/newPassword`。
- 返回：`AuthPasswordChangeResponse reauthenticate=true`。
- 源码：[定位](../../../apps/api/src/auth-account-routes.ts#L51)；核对行 51；SHA256 `9c649b46454216e43e0e4a1d678655abb6642165f95d2c2edeea155ee992b405`。

```text
await service.changePassword(actor.userId, { currentPassword: body.currentPassword as string, newPassword: body.newPassword as string });
```

## A11 · GET /auth/sessions

- 状态：`implemented`；权限：`personal-session`；功能：F03。
- 请求：`none`。
- 返回：`AuthSessionsResponse`。
- 源码：[定位](../../../apps/api/src/auth-account-routes.ts#L56)；核对行 56；SHA256 `9c649b46454216e43e0e4a1d678655abb6642165f95d2c2edeea155ee992b405`。

```text
const payload: AuthSessionsResponse = { ok: true, requestId, sessions: await service.listSessions(actor.userId, input.currentSessionId) };
```

## A12 · DELETE /auth/sessions/:id

- 状态：`implemented`；权限：`personal-session`；功能：F03。
- 请求：`id`。
- 返回：`AuthSessionRevokeResponse`。
- 源码：[定位](../../../apps/api/src/auth-account-routes.ts#L66)；核对行 66；SHA256 `9c649b46454216e43e0e4a1d678655abb6642165f95d2c2edeea155ee992b405`。

```text
if (!await service.revokeSession(actor.userId, id)) return fail(404, "session_not_found", "Session not found");
```

## A13 · POST /auth/sessions/revoke-all

- 状态：`implemented`；权限：`personal-session`；功能：F03。
- 请求：`none`。
- 返回：`AuthSessionRevokeResponse currentSessionRevoked=true`。
- 源码：[定位](../../../apps/api/src/auth-account-routes.ts#L60)；核对行 60；SHA256 `9c649b46454216e43e0e4a1d678655abb6642165f95d2c2edeea155ee992b405`。

```text
await service.revokeAllSessions(actor.userId);
```

## O01 · GET /v1/ops/audit

- 状态：`implemented`；权限：`admin-session`；功能：F21。
- 请求：`limit/cursor/actorId/action/outcome`。
- 返回：`ListAppAuditResponse`。
- 源码：[定位](../../../apps/api/src/auth-account-routes.ts#L29)；核对行 29；SHA256 `9c649b46454216e43e0e4a1d678655abb6642165f95d2c2edeea155ee992b405`。

```text
if (url.pathname === "/v1/ops/audit") {
```

## O02 · GET /healthz

- 状态：`implemented`；权限：`public`；功能：F22。
- 请求：`none`。
- 返回：`ok/status`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1393)；核对行 1393；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/healthz") {
```

## O03 · GET /readyz

- 状态：`implemented`；权限：`public`；功能：F22。
- 请求：`none`。
- 返回：`readiness; 503 when not ready`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1770)；核对行 1770；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && (pathname === "/readyz" || pathname === "/v1/ops/readyz")) {
```

## O04 · GET /v1/ops/readyz

- 状态：`implemented`；权限：`admin-session`；功能：F22。
- 请求：`none`。
- 返回：`readiness/observability; diagnostic HTTP200 possible when not ready`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1219)；核对行 1219；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname === "/v1/ops/readyz" ||
```

## O05 · GET /v1/ops/storage

- 状态：`implemented`；权限：`admin-session`；功能：F22。
- 请求：`none`。
- 返回：`storage measurements/retention estimates`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1836)；核对行 1836；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/v1/ops/storage") {
```

## L01 · GET /v1/workbench/market

- 状态：`legacy`；权限：`authenticated`；功能：F24。
- 请求：`windowHours/bucket/limit`。
- 返回：`legacy market view`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2971)；核对行 2971；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/v1/workbench/market") {
```

Old Reddit model; not a public-content analysis substitute.

## L02 · GET /v1/trends/market

- 状态：`legacy`；权限：`authenticated`；功能：F24。
- 请求：`windowHours/bucket/limit`。
- 返回：`legacy market trend`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L3631)；核对行 3631；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/v1/trends/market") {
```

Old Reddit model; not a public-content analysis substitute.

## L03 · GET /v1/workbench/target/:subreddit

- 状态：`legacy`；权限：`authenticated`；功能：F24。
- 请求：`windowHours`。
- 返回：`legacy target view`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L3010)；核对行 3010；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname.startsWith("/v1/workbench/target/")) {
```

Old Reddit model; not a public-content analysis substitute.

## L04 · GET /v1/trends/subreddit/:subreddit

- 状态：`legacy`；权限：`authenticated`；功能：F24。
- 请求：`windowHours/bucket`。
- 返回：`legacy target trend`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L3535)；核对行 3535；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname.startsWith("/v1/trends/subreddit/")) {
```

Old Reddit model; not a public-content analysis substitute.

## L05 · GET /v1/workbench/compare

- 状态：`legacy`；权限：`authenticated`；功能：F26。
- 请求：`targets/windowHours`。
- 返回：`legacy compare data`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2934)；核对行 2934；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/v1/workbench/compare") {
```

Old Reddit model; not a public-content analysis substitute.

## L06 · GET /v1/workbench/saved-views

- 状态：`legacy`；权限：`personal-session`；功能：F26。
- 请求：`none`。
- 返回：`saved legacy views`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2827)；核对行 2827；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (pathname === "/v1/workbench/saved-views") {
```

Old Reddit model; not a public-content analysis substitute.

## L07 · POST /v1/workbench/saved-views

- 状态：`legacy`；权限：`personal-session`；功能：F26。
- 请求：`name/kind/state`。
- 返回：`saved legacy view`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2827)；核对行 2827；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (pathname === "/v1/workbench/saved-views") {
```

Old Reddit model; not a public-content analysis substitute.

## L09 · POST /v1/keyword-queries

- 状态：`legacy`；权限：`ops-write`；功能：F25。
- 请求：`query/scope`。
- 返回：`legacy query session`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2617)；核对行 2617；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "POST" && pathname === "/v1/keyword-queries") {
```

Old Reddit model; not a public-content analysis substitute.

## L10 · GET /v1/keyword-queries/:id

- 状态：`legacy`；权限：`authenticated`；功能：F25。
- 请求：`id`。
- 返回：`legacy query results`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2691)；核对行 2691；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname.startsWith("/v1/keyword-queries/")) {
```

Old Reddit model; not a public-content analysis substitute.

## L11 · GET /v1/trends/keywords/:query/daily

- 状态：`legacy`；权限：`authenticated`；功能：F25。
- 请求：`id/window`。
- 返回：`legacy keyword trend`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2756)；核对行 2756；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname.startsWith("/v1/trends/keywords/") &&
```

Old Reddit model; not a public-content analysis substitute.

## L12 · POST /v1/runs/reddit-phase1

- 状态：`legacy`；权限：`ops-write`；功能：F25。
- 请求：`bounded run options`。
- 返回：`legacy run report`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2408)；核对行 2408；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "POST" && pathname === "/v1/runs/reddit-phase1") {
```

Old Reddit model; not a public-content analysis substitute.

## L13 · GET /v1/targets/subreddit

- 状态：`legacy`；权限：`admin-session`；功能：F27。
- 请求：`none`。
- 返回：`target list`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1924)；核对行 1924；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/v1/targets/subreddit") {
```

Old Reddit model; not a public-content analysis substitute.

## L14 · POST /v1/targets/subreddit

- 状态：`legacy`；权限：`ops-write`；功能：F27。
- 请求：`target settings`。
- 返回：`created target`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1878)；核对行 1878；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "POST" && pathname === "/v1/targets/subreddit") {
```

Old Reddit model; not a public-content analysis substitute.

## L15 · PATCH /v1/targets/subreddit/:id

- 状态：`legacy`；权限：`ops-write`；功能：F27。
- 请求：`changes/expectedRevision`。
- 返回：`updated target`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L1982)；核对行 1982；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "PATCH" && pathname.startsWith("/v1/targets/subreddit/")) {
```

Old Reddit model; not a public-content analysis substitute.

## L16 · POST /v1/targets/subreddit/bulk-update

- 状态：`legacy`；权限：`ops-write`；功能：F27。
- 请求：`ids/changes`。
- 返回：`bulk result`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2039)；核对行 2039；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "POST" && pathname === "/v1/targets/subreddit/bulk-update") {
```

Old Reddit model; not a public-content analysis substitute.

## L17 · GET /v1/ops/collection/settings

- 状态：`legacy`；权限：`admin-session`；功能：F27。
- 请求：`none`。
- 返回：`legacy collection settings`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2111)；核对行 2111；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/v1/ops/collection/settings") {
```

Old Reddit model; not a public-content analysis substitute.

## L18 · PATCH /v1/ops/collection/settings

- 状态：`legacy`；权限：`ops-write`；功能：F27。
- 请求：`settings/expectedRevision`。
- 返回：`updated settings`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2140)；核对行 2140；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "PATCH" && pathname === "/v1/ops/collection/settings") {
```

Old Reddit model; not a public-content analysis substitute.

## L19 · POST /v1/ops/collection/run-now

- 状态：`legacy`；权限：`ops-write`；功能：F27。
- 请求：`bounded window`。
- 返回：`run summary`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2178)；核对行 2178；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "POST" && pathname === "/v1/ops/collection/run-now") {
```

Old Reddit model; not a public-content analysis substitute.

## L20 · GET /v1/ops/maintenance/preview

- 状态：`legacy`；权限：`admin-session`；功能：F23。
- 请求：`retentionDays`。
- 返回：`prune preview`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2268)；核对行 2268；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
if (req.method === "GET" && pathname === "/v1/ops/maintenance/preview") {
```

Old Reddit model; not a public-content analysis substitute.

## L21 · POST /v1/ops/maintenance/prune/raw-events

- 状态：`legacy`；权限：`ops-write`；功能：F23。
- 请求：`retentionDays/limit`。
- 返回：`bounded deletion counts`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L771)；核对行 771；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname === "/v1/ops/maintenance/prune/raw-events" ||
```

Old Reddit model; not a public-content analysis substitute.

## L22 · POST /v1/ops/maintenance/prune/metrics-snapshots

- 状态：`legacy`；权限：`ops-write`；功能：F23。
- 请求：`retentionDays/limit`。
- 返回：`bounded deletion counts`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L772)；核对行 772；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname === "/v1/ops/maintenance/prune/metrics-snapshots" ||
```

Old Reddit model; not a public-content analysis substitute.

## L23 · POST /v1/ops/maintenance/prune/post-engagement-windows

- 状态：`legacy`；权限：`ops-write`；功能：F23。
- 请求：`retentionDays/limit`。
- 返回：`bounded deletion counts`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L773)；核对行 773；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname === "/v1/ops/maintenance/prune/post-engagement-windows" ||
```

Old Reddit model; not a public-content analysis substitute.

## L24 · GET /v1/trends/subreddit/:subreddit/daily

- 状态：`legacy`；权限：`authenticated`；功能：F24。
- 请求：`window/range; see original handler`。
- 返回：`legacy daily series`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L2757)；核对行 2757；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname.endsWith("/daily")
```

Old Reddit model; not a public-content analysis substitute.

## L25 · GET /v1/trends/subreddit/:subreddit/drivers

- 状态：`legacy`；权限：`authenticated`；功能：F24。
- 请求：`window/range; see original handler`。
- 返回：`legacy driver breakdown`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L3248)；核对行 3248；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname.endsWith("/drivers")
```

Old Reddit model; not a public-content analysis substitute.

## L26 · GET /v1/trends/subreddit/:subreddit/anomalies

- 状态：`legacy`；权限：`authenticated`；功能：F24。
- 请求：`window/range; see original handler`。
- 返回：`legacy anomalies`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L3169)；核对行 3169；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname.endsWith("/anomalies")
```

Old Reddit model; not a public-content analysis substitute.

## L27 · GET /v1/trends/subreddit/:subreddit/anomalies/incidents

- 状态：`legacy`；权限：`authenticated`；功能：F24。
- 请求：`window/range; see original handler`。
- 返回：`legacy incident lifecycle`。
- 源码：[定位](../../../apps/api/src/create-api-server.ts#L3090)；核对行 3090；SHA256 `41c0dcd310d93068947677494adf4c54ce9d251b2239163436f8812d03c6a2ac`。

```text
pathname.endsWith("/anomalies/incidents")
```

Old Reddit model; not a public-content analysis substitute.

## N01 · GET /v1/source-options

- 状态：`proposed`；权限：`authenticated`；功能：F28。
- 请求：`query/platform/provider/limit<=50/cursor`。
- 返回：`{items:[{id,label,platform,provider,state}],nextCursor,totalEstimate}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N02 · GET /v1/sources/search

- 状态：`proposed`；权限：`authenticated`；功能：F28。
- 请求：`query/state/provider/limit<=50/cursor`。
- 返回：`{sources,capabilities,nextCursor,total}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N03 · GET /v1/datasets

- 状态：`proposed`；权限：`authenticated`；功能：F31。
- 请求：`query/limit/cursor`。
- 返回：`{datasets,nextCursor}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N04 · POST /v1/datasets

- 状态：`proposed`；权限：`personal-session`；功能：F31。
- 请求：`name/description/query or immutable memberIds/version`。
- 返回：`{dataset:{id,name,version,total,scope,revision}}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N05 · GET /v1/datasets/:id

- 状态：`proposed`；权限：`authenticated`；功能：F31。
- 请求：`id/version; access-checked`。
- 返回：`{dataset,lineage,purposeCounts,coverage}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N06 · GET /v1/datasets/:id/members

- 状态：`proposed`；权限：`authenticated`；功能：F31。
- 请求：`version/purpose/query/limit/cursor`。
- 返回：`{items,total,nextCursor,denominator,datasetVersion}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N07 · POST /v1/datasets/:id/versions

- 状态：`proposed`；权限：`personal-session`；功能：F31。
- 请求：`memberIds/purpose/reason/expectedRevision`。
- 返回：`{version,total,excluded,sha256}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N08 · GET /v1/import-runs

- 状态：`proposed`；权限：`ops-write`；功能：F31。
- 请求：`state/limit/cursor`。
- 返回：`{runs,nextCursor}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N09 · GET /v1/import-runs/:id

- 状态：`proposed`；权限：`ops-write`；功能：F31。
- 请求：`id`。
- 返回：`{run,batches,provenance,checks,recovery}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N10 · POST /v1/import-previews

- 状态：`proposed`；权限：`ops-write`；功能：F31。
- 请求：`registered selectedFileId + SHA256 + kind/window/cap`。
- 返回：`{previewId,valid,counts,diagnostics,expiresAt}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N11 · POST /v1/import-previews/:id/apply

- 状态：`proposed`；权限：`ops-write`；功能：F31。
- 请求：`previewId/expectedSha256/confirmEvaluationScope`。
- 返回：`{jobId,state:queued} (202); never arbitrary local paths`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N12 · POST /v1/content/aggregate

- 状态：`proposed`；权限：`authenticated`；功能：F32。
- 请求：`query/datasetVersion/dimensions/metric/bins/unknownPolicy`。
- 返回：`{denominator,groups,missing,overlap,queryFingerprint,asOf}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N13 · GET /v1/content/:id/observations

- 状态：`proposed`；权限：`authenticated`；功能：F33。
- 请求：`sourceId?/limit/cursor`。
- 返回：`{observations,nextCursor,canonicalSelection,conflicts}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N14 · POST /v1/observation-comparisons

- 状态：`proposed`；权限：`authenticated`；功能：F33。
- 请求：`contentIds/metric/sourceTimeBounds/comparability`。
- 返回：`{pairs,excludedReasons,units,notRealTimeGrowth}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N15 · GET /v1/research-labels

- 状态：`proposed`；权限：`personal-session`；功能：F34。
- 请求：`projectId?/limit`。
- 返回：`{labels,assignments,revisions,codebookVersion}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N16 · POST /v1/research-labels

- 状态：`proposed`；权限：`personal-session`；功能：F34。
- 请求：`name/color/definition`。
- 返回：`{label,revision}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N17 · POST /v1/content-labels/batch

- 状态：`proposed`；权限：`personal-session`；功能：F34。
- 请求：`contentIds/add/remove/expectedRevisions`。
- 返回：`{updated,conflicts,rejected,revisions}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N18 · POST /v1/research-comparisons

- 状态：`proposed`；权限：`personal-session`；功能：F36。
- 请求：`left/right frozen-or-versioned scope/operation`。
- 返回：`{comparisonId,denominators,intersection,union,leftOnly,rightOnly,warnings}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N19 · GET /v1/research-comparisons/:id

- 状态：`proposed`；权限：`personal-session`；功能：F36。
- 请求：`id`。
- 返回：`{comparison,groups,asOf,coverage}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N20 · POST /v1/source-jobs/:id/recovery-preview

- 状态：`proposed`；权限：`ops-write`；功能：F37。
- 请求：`minWindowSeconds/maxRequests/maxDepth`。
- 返回：`{plan,children,requestUpperBound,willAdvanceWatermark:false}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N21 · POST /v1/source-jobs/:id/recovery-apply

- 状态：`proposed`；权限：`ops-write`；功能：F37。
- 请求：`planId/expectedRevision/confirmBudget`。
- 返回：`{job,children,coverage:partial} (202)`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N22 · GET /v1/projects

- 状态：`proposed`；权限：`personal-session`；功能：F38。
- 请求：`limit/cursor`。
- 返回：`{projects,nextCursor}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N23 · POST /v1/projects

- 状态：`proposed`；权限：`personal-session`；功能：F38。
- 请求：`name/description`。
- 返回：`{project,role:manager}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N24 · GET /v1/projects/:id

- 状态：`proposed`；权限：`personal-session`；功能：F38。
- 请求：`membership required`。
- 返回：`{project,datasets,members,permissionSummary}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N25 · PUT /v1/projects/:id/members/:userId

- 状态：`proposed`；权限：`project-manager`；功能：F38。
- 请求：`role:reader|editor|manager/expectedRevision`。
- 返回：`{member,revision,auditId}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N26 · POST /v1/projects/:id/datasets

- 状态：`proposed`；权限：`project-editor`；功能：F38。
- 请求：`datasetId/version/expectedRevision`。
- 返回：`{attachment,revision}; explicit visibility check`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N27 · GET /v1/projects/:id/codebooks

- 状态：`proposed`；权限：`personal-session`；功能：F39。
- 请求：`project membership`。
- 返回：`{codebooks,versions}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N28 · POST /v1/projects/:id/reviews

- 状态：`proposed`；权限：`project-editor`；功能：F39。
- 请求：`datasetVersion/codebookVersion/reviewerAssignments`。
- 返回：`{review,revision,state}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N29 · PATCH /v1/reviews/:id

- 状态：`proposed`；权限：`project-editor`；功能：F39。
- 请求：`contentId/label/note/expectedRevision`。
- 返回：`{review,conflicts,revision}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N30 · POST /v1/content/recommendations

- 状态：`proposed`；权限：`authenticated`；功能：F05。
- 请求：`query/datasetId?/brands?/dimensions?/limit<=20`。
- 返回：`{items:[{content,recommendationScore,reasons,matchedBrands,matchedDimensions}],denominator,formulaVersion}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N31 · POST /v1/brands/matrix-compare

- 状态：`proposed`；权限：`authenticated`；功能：F36。
- 请求：`datasetId?/brands/dimensions/metric`。
- 返回：`{brands,dimensions,matrix,topEvidenceByCell,denominator,warnings}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## N32 · POST /v1/agent/digest

- 状态：`proposed`；权限：`authenticated`；功能：F32。
- 请求：`datasetId?/brands/window/maxEvidence<=10/format`。
- 返回：`{digestId,generatedAt,summaryMetrics,brandSignals,topRecommendations,markdownBrief,jsonPayload,evidenceLinks}`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。

Design contract only. Not registered in current API; simulate locally.

## CLI01 · CLI archive:import

- 状态：`implemented`；权限：`local-operator`；功能：F18。
- 请求：`immutable JSONL/manifest + explicit evaluation DB + --apply`。
- 返回：`dry-run/applied/pending/failed + SHA256 + receipts`。
- 源码：`scripts/import-reddit-archive.ts`（历史快照文件，当前源码不存在）；核对行 18；SHA256 `71a7d52be0d5edcf82c366a613635eece6ce8bc34c4e3df137961dd9aeda31e1`。

```text
async function main(){
```

## UI01 · LOCAL theme/language/layout

- 状态：`design`；权限：`client`；功能：F01, F30, F35。
- 请求：`theme/language/density/layout`。
- 返回：`persisted prototype preferences; no server API`。
- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。
