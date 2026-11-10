"""Rebuild the inspectable design catalog from current routes and authored P0–P2 decisions.
No network, database access or application mutation. Run from repository root.
"""
from pathlib import Path
import json,re,hashlib,subprocess

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
def pair(zh,en):return {'zh':zh,'en':en}
def dump(name,obj):
    p=BASE/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

endpoints=[]
def endpoint(id,method,path,status,access,request,response,source=None,needle=None,feature=None,notes=''):
    evidence=None
    if source:
        text=(ROOT/source).read_text(encoding='utf-8');lines=text.splitlines()
        found=next((i+1 for i,line in enumerate(lines) if (needle or path) in line),None)
        if not found:raise ValueError(f'No evidence for {id}: {needle or path} in {source}')
        evidence={'file':source,'line':found,'excerpt':lines[found-1].strip(),'sha256':hashlib.sha256((ROOT/source).read_bytes()).hexdigest()}
    item={'id':id,'method':method,'path':path,'status':status,'access':access,'request':request,'response':response,'evidence':evidence,'feature':feature,'notes':notes}
    endpoints.append(item);return id

SOURCE='apps/api/src/source-content-routes.ts';PERSONAL='apps/api/src/content-personal-routes.ts';RESEARCH='apps/api/src/research-export-routes.ts';SERVER='apps/api/src/create-api-server.ts';ACCOUNT='apps/api/src/auth-account-routes.ts'
read='authenticated';write='ops-write';personal='personal-session';admin='admin-session';authadmin='auth-admin';public='public';owner='owner-guarded'
actual=[
('C01','GET','/v1/content','content',read,'ContentQuery','ContentListResponse'),
('C02','GET','/v1/content/stats','stats',read,'ContentQuery','ContentStatsResponse'),
('C03','GET','/v1/content/workbench','workbench',read,'ContentQuery','ContentWorkbenchResponse'),
('C04','GET','/v1/content/:id','detail',read,'id','ContentDetailResponse'),
('C05','GET','/v1/content/export','export',read,'ContentQuery + format + maxItems(1..2000)','ContentExportResponse | CSV metadata + rows'),
('S01','GET','/v1/sources','sources',read,'none; no current pagination','SourceListResponse'),
('S02','POST','/v1/sources','create',write,'CreateCollectionSourceRequest','CollectionSourceResponse (201)'),
('S03','PATCH','/v1/sources/:id','update',write,'UpdateCollectionSourceRequest','CollectionSourceResponse'),
('S04','POST','/v1/sources/:id/pause','pause',write,'expectedRevision?','CollectionSourceResponse'),
('S05','POST','/v1/sources/:id/resume','resume',write,'expectedRevision?','CollectionSourceResponse'),
('S06','POST','/v1/sources/:id/archive','archive',write,'expectedRevision?','CollectionSourceResponse'),
('J01','POST','/v1/sources/:id/collect','collect',write,'StartSourceCollectionRequest','SourceJobResponse (202)'),
('J02','GET','/v1/source-jobs','jobs',read,'sourceId? status? limit<=50','SourceJobsResponse'),
('J03','GET','/v1/source-jobs/:id','job',read,'id','SourceJobResponse'),
('J04','POST','/v1/source-jobs/:id/retry','retry',write,'id','SourceJobResponse (202)'),
('J05','POST','/v1/source-jobs/:id/continue','continue',write,'id','SourceJobResponse (202)'),
('J06','POST','/v1/source-jobs/:id/cancel','cancel',write,'id','SourceJobResponse'),
('J07','GET','/v1/source-ops','ops',read,'none','SourceOpsResponse'),
('J08','PUT','/v1/source-provider-budgets/:provider','budget',write,'SourceProviderBudgetRequest','ok/requestId/budget'),
]
for id,method,path,action,access,request,response in actual:
    line=next(line for line in (ROOT/SOURCE).read_text().splitlines() if re.search(r'action\s*:\s*["\']'+action+r'["\']',line) and 'method' in line)
    endpoint(id,method,path,'implemented',access,request,response,SOURCE,line.strip())
personal_rows=[('P01','GET','/v1/content-saved-queries','queries','limit/cursor','ContentSavedQueryListResponse'),('P02','POST','/v1/content-saved-queries','createQuery','SaveContentQueryRequest expectedRevision=0','SaveContentQueryResponse (201)'),('P03','PATCH','/v1/content-saved-queries/:id','updateQuery','SaveContentQueryRequest current revision','SaveContentQueryResponse'),('P04','DELETE','/v1/content-saved-queries/:id','deleteQuery','{expectedRevision}','{deleted:true}'),('P05','GET','/v1/content-annotations','annotations','favoriteOnly? limit/cursor','ContentAnnotationListResponse'),('P06','GET','/v1/content/:id/annotation','annotation','id','ContentAnnotationResponse'),('P07','PUT','/v1/content/:id/annotation','saveAnnotation','UpdateContentAnnotationRequest','ContentAnnotationResponse'),('P08','DELETE','/v1/content/:id/annotation','deleteAnnotation','{expectedRevision}','{deleted:true}')]
for id,method,path,action,request,response in personal_rows:
    line=next(line for line in (ROOT/PERSONAL).read_text().splitlines() if f'action:"{action}"' in line and 'method' in line)
    endpoint(id,method,path,'implemented',personal,request,response,PERSONAL,line.strip())
for id,method,path,action,request,response in [('R01','GET','/v1/research-exports','list','limit/cursor','ResearchExportListResponse'),('R02','POST','/v1/research-exports','create','CreateResearchExportRequest maxRows<=20000','ResearchExportResponse (201)'),('R03','GET','/v1/research-exports/:id','get','id','ResearchExportResponse'),('R04','DELETE','/v1/research-exports/:id','delete','id','{deleted:true}'),('R05','GET','/v1/research-exports/:id/content','content','limit<=100/cursor','ResearchExportPageResponse'),('R06','GET','/v1/research-exports/:id/export','export','format=json|csv limit<=100/cursor','ResearchExportPageResponse | CSV')]:
    line=next(line for line in (ROOT/RESEARCH).read_text().splitlines() if f'action: "{action}"' in line and 'method' in line)
    endpoint(id,method,path,'implemented',personal,request,response,RESEARCH,line.strip())
auth_rows=[('A01','POST','/auth/login',public,'email/password','AuthLoginResponse + session cookie',SERVER,'pathname === "/auth/login"'),('A02','POST','/auth/logout',personal,'none','AuthLogoutResponse + clear cookie',SERVER,'pathname === "/auth/logout"'),('A03','GET','/auth/me',personal,'session','AuthMeResponse',SERVER,'pathname === "/auth/me"'),('A04','POST','/auth/register',public,'email/password/displayName/inviteCode','RegisterAppUserResponse; pending activation',SERVER,'pathname === "/auth/register"'),('A05','GET','/auth/users',authadmin,'none','ListAppUsersResponse',SERVER,'req.method === "GET" && pathname === "/auth/users"'),('A06','POST','/auth/invites',authadmin,'roleOnAccept/maxUses/expiresAt','CreateInviteResponse',SERVER,'req.method === "POST" && pathname === "/auth/invites"'),('A07','POST','/auth/users/:id/role',owner,'role','UpdateAppUserRoleResponse',ACCOUNT,'service.changeRole'),('A08','POST','/auth/users/:id/status',owner,'status:pending|active|disabled','UpdateAppUserStatusResponse',ACCOUNT,'service.changeStatus'),('A09','POST','/auth/users/:id/activate',owner,'none','UpdateAppUserStatusResponse',ACCOUNT,'"active"'),('A10','POST','/auth/password',personal,'currentPassword/newPassword','AuthPasswordChangeResponse reauthenticate=true',ACCOUNT,'service.changePassword'),('A11','GET','/auth/sessions',personal,'none','AuthSessionsResponse',ACCOUNT,'service.listSessions'),('A12','DELETE','/auth/sessions/:id',personal,'id','AuthSessionRevokeResponse',ACCOUNT,'service.revokeSession'),('A13','POST','/auth/sessions/revoke-all',personal,'none','AuthSessionRevokeResponse currentSessionRevoked=true',ACCOUNT,'service.revokeAllSessions'),('O01','GET','/v1/ops/audit',admin,'limit/cursor/actorId/action/outcome','ListAppAuditResponse',ACCOUNT,'url.pathname === "/v1/ops/audit"'),('O02','GET','/healthz',public,'none','ok/status',SERVER,'pathname === "/healthz"'),('O03','GET','/readyz',public,'none','readiness; 503 when not ready',SERVER,'pathname === "/readyz"'),('O04','GET','/v1/ops/readyz',admin,'none','readiness/observability; diagnostic HTTP200 possible when not ready',SERVER,'pathname === "/v1/ops/readyz"'),('O05','GET','/v1/ops/storage',admin,'none','storage measurements/retention estimates',SERVER,'req.method === "GET" && pathname === "/v1/ops/storage"')]
for id,method,path,access,request,response,source,needle in auth_rows:endpoint(id,method,path,'implemented',access,request,response,source,needle)
legacy=[('L01','GET','/v1/workbench/market',read,'windowHours/bucket/limit','legacy market view','pathname === "/v1/workbench/market"'),('L02','GET','/v1/trends/market',read,'windowHours/bucket/limit','legacy market trend','pathname === "/v1/trends/market"'),('L03','GET','/v1/workbench/target/:subreddit',read,'windowHours','legacy target view','pathname.startsWith("/v1/workbench/target/")'),('L04','GET','/v1/trends/subreddit/:subreddit',read,'windowHours/bucket','legacy target trend','req.method === "GET" && pathname.startsWith("/v1/trends/subreddit/")'),('L05','GET','/v1/workbench/compare',read,'targets/windowHours','legacy compare data','pathname === "/v1/workbench/compare"'),('L06','GET','/v1/workbench/saved-views',personal,'none','saved legacy views','pathname === "/v1/workbench/saved-views"'),('L07','POST','/v1/workbench/saved-views',personal,'name/kind/state','saved legacy view','pathname === "/v1/workbench/saved-views"'),('L08','DELETE','/v1/workbench/saved-views/:id',personal,'id','deleted','pathname === "/v1/workbench/saved-views"'),('L09','POST','/v1/keyword-queries',write,'query/scope','legacy query session','req.method === "POST" && pathname === "/v1/keyword-queries"'),('L10','GET','/v1/keyword-queries/:id',read,'id','legacy query results','req.method === "GET" && pathname.startsWith("/v1/keyword-queries/")'),('L11','GET','/v1/trends/keywords/:id',read,'id/window','legacy keyword trend','pathname.startsWith("/v1/trends/keywords/")'),('L12','POST','/v1/runs/reddit-phase1',write,'bounded run options','legacy run report','req.method === "POST" && pathname === "/v1/runs/reddit-phase1"'),('L13','GET','/v1/targets/subreddit',admin,'none','target list','req.method === "GET" && pathname === "/v1/targets/subreddit"'),('L14','POST','/v1/targets/subreddit',write,'target settings','created target','req.method === "POST" && pathname === "/v1/targets/subreddit"'),('L15','PATCH','/v1/targets/subreddit/:id',write,'changes/expectedRevision','updated target','req.method === "PATCH" && pathname.startsWith("/v1/targets/subreddit/")'),('L16','POST','/v1/targets/subreddit/bulk-update',write,'ids/changes','bulk result','req.method === "POST" && pathname === "/v1/targets/subreddit/bulk-update"'),('L17','GET','/v1/ops/collection/settings',admin,'none','legacy collection settings','req.method === "GET" && pathname === "/v1/ops/collection/settings"'),('L18','PATCH','/v1/ops/collection/settings',write,'settings/expectedRevision','updated settings','req.method === "PATCH" && pathname === "/v1/ops/collection/settings"'),('L19','POST','/v1/ops/collection/run-now',write,'bounded window','run summary','req.method === "POST" && pathname === "/v1/ops/collection/run-now"'),('L20','GET','/v1/ops/maintenance/preview',admin,'retentionDays','prune preview','req.method === "GET" && pathname === "/v1/ops/maintenance/preview"')]
for suffix in ['raw-events','metrics-snapshots','post-engagement-windows']:
    legacy.append((f'L{len(legacy)+1:02}','POST','/v1/ops/maintenance/prune/'+suffix,write,'retentionDays/limit','bounded deletion counts','pathname === "/v1/ops/maintenance/prune/'+suffix+'"'))
legacy=[row for row in legacy if row[0]!='L08'] # No DELETE saved-view route exists in this checkout.
legacy=[(id,method,('/v1/trends/keywords/:query/daily' if id=='L11' else path),access,request,response,needle) for id,method,path,access,request,response,needle in legacy]
for id,suffix,response in [('L24','daily','legacy daily series'),('L25','drivers','legacy driver breakdown'),('L26','anomalies','legacy anomalies'),('L27','anomalies/incidents','legacy incident lifecycle')]:
    legacy.append((id,'GET','/v1/trends/subreddit/:subreddit/'+suffix,read,'window/range; see original handler',response,'pathname.endsWith("/'+suffix+'")'))
for id,method,path,access,request,response,needle in legacy:endpoint(id,method,path,'legacy',access,request,response,SERVER,needle,notes='Old Reddit model; not a public-content analysis substitute.')

proposed=[
('N01','GET','/v1/source-options',read,'query/platform/provider/limit<=50/cursor','{items:[{id,label,platform,provider,state}],nextCursor,totalEstimate}'),
('N02','GET','/v1/sources/search',read,'query/state/provider/limit<=50/cursor','{sources,capabilities,nextCursor,total}'),
('N03','GET','/v1/datasets',read,'query/limit/cursor','{datasets,nextCursor}'),
('N04','POST','/v1/datasets',personal,'name/description/query or immutable memberIds/version','{dataset:{id,name,version,total,scope,revision}}'),
('N05','GET','/v1/datasets/:id',read,'id/version; access-checked','{dataset,lineage,purposeCounts,coverage}'),
('N06','GET','/v1/datasets/:id/members',read,'version/purpose/query/limit/cursor','{items,total,nextCursor,denominator,datasetVersion}'),
('N07','POST','/v1/datasets/:id/versions',personal,'memberIds/purpose/reason/expectedRevision','{version,total,excluded,sha256}'),
('N08','GET','/v1/import-runs',write,'state/limit/cursor','{runs,nextCursor}'),
('N09','GET','/v1/import-runs/:id',write,'id','{run,batches,provenance,checks,recovery}'),
('N10','POST','/v1/import-previews',write,'registered selectedFileId + SHA256 + kind/window/cap','{previewId,valid,counts,diagnostics,expiresAt}'),
('N11','POST','/v1/import-previews/:id/apply',write,'previewId/expectedSha256/confirmEvaluationScope','{jobId,state:queued} (202); never arbitrary local paths'),
('N12','POST','/v1/content/aggregate',read,'query/datasetVersion/dimensions/metric/bins/unknownPolicy','{denominator,groups,missing,overlap,queryFingerprint,asOf}'),
('N13','GET','/v1/content/:id/observations',read,'sourceId?/limit/cursor','{observations,nextCursor,canonicalSelection,conflicts}'),
('N14','POST','/v1/observation-comparisons',read,'contentIds/metric/sourceTimeBounds/comparability','{pairs,excludedReasons,units,notRealTimeGrowth}'),
('N15','GET','/v1/research-labels',personal,'projectId?/limit','{labels,assignments,revisions,codebookVersion}'),
('N16','POST','/v1/research-labels',personal,'name/color/definition','{label,revision}'),
('N17','POST','/v1/content-labels/batch',personal,'contentIds/add/remove/expectedRevisions','{updated,conflicts,rejected,revisions}'),
('N18','POST','/v1/research-comparisons',personal,'left/right frozen-or-versioned scope/operation','{comparisonId,denominators,intersection,union,leftOnly,rightOnly,warnings}'),
('N19','GET','/v1/research-comparisons/:id',personal,'id','{comparison,groups,asOf,coverage}'),
('N20','POST','/v1/source-jobs/:id/recovery-preview',write,'minWindowSeconds/maxRequests/maxDepth','{plan,children,requestUpperBound,willAdvanceWatermark:false}'),
('N21','POST','/v1/source-jobs/:id/recovery-apply',write,'planId/expectedRevision/confirmBudget','{job,children,coverage:partial} (202)'),
('N22','GET','/v1/projects',personal,'limit/cursor','{projects,nextCursor}'),
('N23','POST','/v1/projects',personal,'name/description','{project,role:manager}'),
('N24','GET','/v1/projects/:id',personal,'membership required','{project,datasets,members,permissionSummary}'),
('N25','PUT','/v1/projects/:id/members/:userId', 'project-manager','role:reader|editor|manager/expectedRevision','{member,revision,auditId}'),
('N26','POST','/v1/projects/:id/datasets', 'project-editor','datasetId/version/expectedRevision','{attachment,revision}; explicit visibility check'),
('N27','GET','/v1/projects/:id/codebooks',personal,'project membership','{codebooks,versions}'),
('N28','POST','/v1/projects/:id/reviews','project-editor','datasetVersion/codebookVersion/reviewerAssignments','{review,revision,state}'),
('N29','PATCH','/v1/reviews/:id','project-editor','contentId/label/note/expectedRevision','{review,conflicts,revision}'),
('N30','POST','/v1/content/recommendations',read,'query/datasetId?/brands?/dimensions?/limit<=20','{items:[{content,recommendationScore,reasons,matchedBrands,matchedDimensions}],denominator,formulaVersion}'),
('N31','POST','/v1/brands/matrix-compare',read,'datasetId?/brands/dimensions/metric','{brands,dimensions,matrix,topEvidenceByCell,denominator,warnings}'),
('N32','POST','/v1/agent/digest',read,'datasetId?/brands/window/maxEvidence<=10/format','{digestId,generatedAt,summaryMetrics,brandSignals,topRecommendations,markdownBrief,jsonPayload,evidenceLinks}'),
]
for id,method,path,access,request,response in proposed:endpoint(id,method,path,'proposed',access,request,response,notes='Design contract only. Not registered in current API; simulate locally.')
endpoint('CLI01','CLI','archive:import','implemented','local-operator','immutable JSONL/manifest + explicit evaluation DB + --apply','dry-run/applied/pending/failed + SHA256 + receipts','scripts/import-reddit-archive.ts','async function main')
endpoint('UI01','LOCAL','theme/language/layout','design','client','theme/language/density/layout','persisted prototype preferences; no server API')

features=[]
def feature(id,zh,en,priority,status,page,apis,service,tables,dependencies=(),note=''):
    features.append({'id':id,'name':pair(zh,en),'priority':priority,'status':status,'page':page,'apis':apis.split(','),'service':service,'tables':tables.split(','),'dependencies':list(dependencies),'note':note})
rows=[
('F01','工作台外壳、主题与中英文','Workspace, theme and bilingual UI','P0','partial','overview','UI01','Client preferences','localStorage',(), 'Current app has bilingual text; new themes/layouts are design-only.'),
('F02','登录、邀请注册与账户状态','Sign-in, invited registration and account state','current','implemented','account','A01,A02,A03,A04','Auth use cases / session token service','app_user,app_session,app_invite',()),
('F03','密码、会话与撤销','Password and session security','current','implemented','account','A10,A11,A12,A13','AccountSecurityService','app_user,app_session',('F02',)),
('F04','已存内容检索、筛选与分页','Stored-content search, filters and cursor paging','current','implemented','explore','C01','SourceContentService / repository query','content,public_content_search_document',('F02',)),
('F05','同口径统计、趋势与优质推荐','Scoped statistics, trends and smart recommendations','current','implemented','overview','C02,C03,N30','contentWorkbench / contentStats / recommendation scorer','content,content_observation,public_content_search_document',('F04',),'Combines implemented C02/C03 stats with proposed N30 explainable content recommendation & Agent digest preview.'),
('F06','详情、作者、正文与媒体','Content, author, text and media detail','current','implemented','explore','C04','contentDetail','content,content_discovery,collection_source',('F04',)),
('F07','已存父链与有界回复','Stored references and bounded replies','current','implemented','explore','C04','identity lookup / relatedChildren','content',('F06',),'Each reference/reply list capped at 20; missing nodes never fetched on read.'),
('F08','跨渠道身份合并与独立观测','Cross-provider identity and observations','current','implemented','observations','C04','writeCollectedContent / canonical selection','content,content_discovery,content_observation',('F06',)),
('F09','个人保存查询及版本冲突','Personal saved queries and revision conflicts','current','implemented','research','P01,P02,P03,P04','ContentPersonalService','content_saved_query',('F02','F04')),
('F10','个人收藏、注释与隔离','Personal favorites, notes and isolation','current','implemented','research','P05,P06,P07,P08','ContentPersonalService','content_annotation',('F02','F06')),
('F11','即时有界导出与续页','Bounded live exports and continuation','current','implemented','explore','C05','contentExport / contentExportCsv','content,content_observation',('F04',),'Max 2000 per file; not a frozen multi-page snapshot.'),
('F12','冻结研究样本、manifest及分段','Frozen research, manifest and segments','current','implemented','research','R01,R02,R03,R04,R05,R06','ResearchExportService / RR snapshot','research_export,research_export_member',('F04','F02'),'Max 20000 rows/32MiB; each segment <=100. Personal sessions only.'),
('F13','来源注册、配置与能力','Source identity, configuration and capability','current','implemented','sources','S01,S02,S03','SourceContentService / provider registry','collection_source',('F02',)),
('F14','来源生命周期、计划与成熟刷新','Lifecycle, schedule and maturity refresh','current','implemented','sources','S03,S04,S05,S06','SourceContentService / scheduler','collection_source,source_collection_job',('F13',)),
('F15','有界采集、预算与租约','Bounded collection, budget and lease','current','implemented','tasks','J01,J02,J03','workOnce / connector / page transaction','source_collection_job,source_provider_usage,content',('F13','F14')),
('F16','任务取消、重试与继续','Cancel, retry and continue tasks','current','implemented','tasks','J04,J05,J06','SourceContentService / fenced repository','source_collection_job',('F15',)),
('F17','Worker、队列与独立provider预算','Workers, queue and provider budgets','current','implemented','tasks','J07,J08','sourceOps / reserveUsage / heartbeat','source_worker_heartbeat,source_provider_budget,source_provider_usage',('F15',)),
('F18','离线抽样与归档导入回执','Offline sampling and archive receipts','current','implemented','datasets','CLI01','preflightArchive / PostgresArchiveImportRepository','archive_import_run,archive_import_batch,content',('F08',),'CLI exists; browser upload/preview APIs are proposed separately.'),
('F19','用户角色、启用与Owner保护','User access, activation and owner safeguards','current','implemented','admin','A05,A07,A08,A09','AccountSecurityService / updateAccess','app_user,app_session',('F02',)),
('F20','邀请码与待激活注册','Invitations and pending registration','current','implemented','admin','A06,A04','create invite / register use cases','app_invite,app_user',('F19',)),
('F21','操作审计','Operation audit','current','implemented','admin','O01','audit repository','app_audit',('F19',),'Owner/admin session required; machine denied.'),
('F22','健康、就绪与存储诊断','Health, readiness and storage diagnostics','current','implemented','admin','O02,O03,O04,O05','readiness / storage policy','operational measurements',('F19',)),
('F23','保留预览与有界清理','Retention preview and bounded prune','current','legacy','admin','L20,L21,L22,L23','legacy retention use cases','raw_event,metrics_snapshot,post_engagement_window',('F22',),'Legacy tables only; no public-content retention contract yet.'),
('F24','旧市场、榜单与目标详情','Legacy markets, boards and targets','current','legacy','legacy','L01,L02,L03,L04,L24,L25,L26,L27','legacy trend read models','legacy trend tables',('F02',),'Not backed by imported public content.'),
('F25','旧关键词会话与Phase1运行','Legacy keyword sessions and Phase 1','current','legacy','legacy','L09,L10,L11,L12','legacy keyword/session/run use cases','keyword_query_session,legacy trend tables',('F24',)),
('F26','旧对比与保存视图','Legacy compare and saved views','current','legacy','legacy','L05,L06,L07','saved-view and compare routes','workbench_saved_view',('F24',)),
('F27','旧目标批量管理与调度设置','Legacy target management and collection settings','current','legacy','legacy','L13,L14,L15,L16,L17,L18,L19','legacy target / collection settings','subreddit_target,collection_settings',('F24',)),
('F28','来源分页检索及精简选项','Paged source directory and lean options','P0','proposed','sources','N01,N02','Proposed source directory query','collection_source',('F13',),'Existing GET sources is unpaged; these new routes are proposals.'),
('F29','详情关联来源批量读取','Batch related-source detail reads','P0','branch-ready','explore','C04','Reuse dev/root E0 detail use case','content,content_discovery,collection_source',('F06',),'Contract unchanged; E0 exists on unmerged branch. Review and integrate, do not rebuild.'),
('F30','明确刷新、错误、分母和交互层次','Explicit refresh, errors, denominator and hierarchy','P0','proposed','explore','C01,C03,UI01','Client query lifecycle / accessible states','none',('F04','F05'),'Do not present stale totals as newly applied filters.'),
('F31','数据集、批次、成员与导入预览','Datasets, batches, membership and import preview','P1','proposed','datasets','N03,N04,N05,N06,N07,N08,N09,N10,N11','Proposed dataset and registered-file import use cases','dataset,dataset_version,dataset_member,archive_import_run',('F18','F12'),'Dataset tables and browser APIs do not exist; source group is not member classification.'),
('F32','社区日期聚合、品牌痛点与Agent简报','Community/time aggregation, brand dimensions and Agent digest','P1','proposed','analysis','N12,N32','Proposed bounded aggregation & Agent structured digest read model','content,content_observation,dataset_member',('F31','F05'),'Preserve denominator, unknowns and provider overlaps; provides structured Agent JSON/Markdown digest with traceable evidence IDs.'),
('F33','观测时间线、差异及冲突提示','Observation timeline, differences and conflicts','P1','proposed','observations','N13,N14','Proposed observation history / comparison','content_observation,content',('F08',)),
('F34','研究标签与批量归类','Research labels and batch coding','P1','proposed','labels','N15,N16,N17','Proposed personal label service','research_label,content_label',('F10','F31')),
('F35','长文阅读与移动高级筛选','Long-form reading and mobile filter hierarchy','P1','proposed','explore','C04,UI01','Client reading layout','none',('F06','F30')),
('F36','多品牌维度对比矩阵与结果集A/B对比','Multi-brand dimension matrix & result-set A/B comparison','P2','proposed','compare','N18,N19,N31','Proposed brand-dimension evidence matrix & scope comparison service','research_comparison,dataset_version,research_export_member',('F12','F31','F32')),
('F37','诊断、缩窗计划与有界恢复','Diagnostics, split plans and bounded recovery','P2','proposed','tasks','N20,N21','Proposed recovery planner; reuse queue/lease/budget','source_collection_job,recovery_plan',('F15','F16','F17'),'Plan first; preserve incomplete coverage and checkpoint. Never unlimited retries.'),
('F38','项目、数据集共享与权限','Projects, dataset sharing and permissions','P2','proposed','projects','N22,N23,N24,N25,N26','Proposed project membership service','project,project_member,project_dataset',('F19','F31'),'Project reader/editor/manager are proposed project roles, not current global roles.'),
('F39','代码本、多人与复核分歧','Codebooks, review assignments and disagreements','P2','proposed','projects','N27,N28,N29','Proposed review/codebook service','codebook,review,review_annotation',('F34','F38'),'Optional research workflow; no human gold or agreement score claimed.'),
]
for row in rows:feature(*row)
known={e['id'] for e in endpoints}
for f in features:
    assert set(f['apis'])<=known
    for id in f['apis']:
        next(e for e in endpoints if e['id']==id).setdefault('features',[]).append(f['id'])
assert len(known)==len(endpoints)
assert all(e.get('features') for e in endpoints)
pages=[('overview','情报总览与推荐','Intelligence & recommendations'),('explore','探索与证据库','Explore & evidence'),('datasets','数据集与归档','Datasets & archives'),('analysis','趋势与Agent雷达','Trends & Agent radar'),('observations','观测与快照变化','Observations & changes'),('compare','竞品多维对比','Brand & scope compare'),('labels','痛点与意图编码','Pain-point & intent coding'),('research','个人研究与冻结','Saved & frozen assets'),('sources','来源目录','Sources'),('tasks','采集与运行','Collection & runs'),('projects','项目协作','Projects'),('admin','系统管理','Administration'),('account','账户与会话','Account & sessions'),('legacy','旧版研究入口','Legacy workspace')]
scenarios=[('normal','正常结果','Successful results'),('loading','加载与刷新','Loading & refresh'),('empty','空数据库','Empty database'),('no-results','零命中','No matches'),('error','服务不可用503','Service unavailable 503'),('timeout','上游超时422','Upstream timeout 422'),('rate-limit','限流429','Rate limit 429'),('conflict','版本冲突409','Revision conflict 409'),('partial','覆盖不完整','Partial coverage'),('unindexed','索引不完整','Partial search index'),('network-off','采集网络关闭','Collection network off'),('capped','导出超限413','Export limit 413'),('missing','删除/缺失内容','Removed/missing content'),('expired','会话过期401','Expired session 401'),('offline','离线检索/采集分离','Offline reads vs collection')]
catalog={'version':'frontend-blueprint-v1','date':'2026-11-08','sourceRevision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'sourceDirty':True,'scope':'current local branch + proposed P0-P2; no production implementation','features':features,'endpoints':endpoints,'pages':[{'id':id,'name':pair(zh,en)} for id,zh,en in pages],'scenarios':[{'id':id,'name':pair(zh,en)} for id,zh,en in scenarios],'roles':['owner','admin','viewer','machine','anonymous'],'accountStates':['active','pending','disabled'],'projectRoles':['reader','editor','manager'],'baselineReference':{'date':'2026-11-08','content':128177,'observations':128182,'sources':37028,'note':'Historical measured local context, never a live prototype count.'}}
dump('data/catalog.json',catalog)
print(json.dumps({'features':len(features),'endpoints':len(endpoints),'implemented':sum(e['status']=='implemented' for e in endpoints),'proposed':len(proposed),'pages':len(pages),'scenarios':len(scenarios)},ensure_ascii=False))
