/* View/controller source for PulseScope Product & Market Intelligence Platform. */
(function(root){
  'use strict';
  const C=root.BLUEPRINT_CATALOG,F=root.BlueprintFixtures;
  const parse=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
  const prefs=parse('iw-blueprint-v1-preferences',{}),saved=parse('iw-blueprint-v1-data',null);
  const api=new root.BlueprintMock(C,F,saved?.version===3?saved.state:null);
  const paths={search:'m21 21-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',overview:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',explore:'M4 4h16v16H4zM4 10h16M10 10v10',datasets:'m3 7 9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',analysis:'M4 20V10M10 20V4M16 20v-8M22 20H2',observations:'M3 12h4l3-8 4 16 3-8h4',compare:'M5 4v16M19 4v16M2 8h8m-3-3 3 3-3 3M14 16h8m-5-3-3 3 3 3',labels:'M20 13 11 22 2 13V3h10zM7 7h.01',research:'M5 3h14v19l-7-4-7 4z',sources:'M6 3h12v5H6zM6 16h12v5H6zM12 8v8M3 12h18',tasks:'M9 4h12M9 12h12M9 20h12M3 4l1 1 2-2M3 12l1 1 2-2M3 20l1 1 2-2',projects:'M3 6h7l2 2h9v12H3zM3 6V4h7l2 2',admin:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 12l3 3 5-6',account:'M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',legacy:'M3 5h18v15H3zM3 9h18M7 5v4',sun:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1',moon:'M20 15A8.5 8.5 0 0 1 9 4a8.5 8.5 0 1 0 11 11',globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18',chevron:'m9 5 7 7-7 7',down:'m6 9 6 6 6-6',close:'m6 6 12 12M6 18 18 6',plus:'M12 5v14M5 12h14',filter:'M3 5h18l-7 8v6l-4 2v-8z',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',arrow:'M5 12h14m-5-5 5 5-5 5',back:'M19 12H5m5-5-5 5 5 5',refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',check:'m5 12 4 4L19 6',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',more:'M5 12h.01M12 12h.01M19 12h.01',code:'m8 5-7 7 7 7m8-14 7 7-7 7M14 3l-4 18',play:'m7 3 14 9-14 9z',pause:'M7 4h3v16H7zM14 4h3v16h-3z',clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',info:'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',alert:'m12 3 10 18H2zM12 9v5M12 17h.01',file:'M5 2h10l4 4v16H5zM14 2v5h5M8 12h8M8 16h8',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M22 21v-2a4 4 0 0 0-3-3.8M16 3.1a4 4 0 0 1 0 7.8',menu:'M3 6h18M3 12h18M3 18h18',copy:'M9 9h12v12H9zM15 9V3H3v12h6',settings:'M4 7h16M7 4v6M4 17h16M16 14v6',logout:'M9 4H3v16h6M13 8l5 4-5 4M7 12h11',external:'M14 3h7v7M10 14 21 3M10 3H3v18h18v-7'};
  const app={catalog:C,fixtures:F,api,pages:{},actions:{},changes:{},forms:{},charts:{},chartQueue:[],ui:{page:'overview',lang:prefs.lang||'zh',theme:prefs.theme||'light',density:prefs.density||'comfortable',layout:prefs.layout||'standard',console:false,consoleTab:'scenarios',scenario:'normal',role:'owner',accountState:'active',projectRole:'manager',query:{},draft:{},data:{},loading:true,error:null,selected:new Set(),cursorStack:[],cursor:null,pageIndex:1,pageSize:12,filtersOpen:false,tab:{},detail:null,detailTab:'body',noteDraft:null,noteDirty:false,modal:null,apiId:'C01',apiSearch:'',traceIndex:0,railOpen:false,toasts:[]}};
  const ui=app.ui;
  app.t=(zh,en)=>ui.lang==='zh'?zh:en;
  app.l=value=>value&&typeof value==='object'?(value[ui.lang]||value.en||value.zh||''):String(value??'');
  app.esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  app.icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.file}"/></svg>`;
  app.num=n=>Number(n||0).toLocaleString(ui.lang==='zh'?'zh-CN':'en-US');
  app.date=(value,time=false)=>value?new Date(value).toLocaleString(ui.lang==='zh'?'zh-CN':'en-GB',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit',...(time?{hour:'2-digit',minute:'2-digit'}:{})})+' UTC':app.t('未知','Unknown');
  app.badge=(label,tone='')=>`<span class="badge ${tone}">${app.esc(label)}</span>`;
  app.btn=(label,action,icon='',extra='')=>`<button type="button" class="btn" data-action="${action}" ${extra}>${icon?app.icon(icon):''}${app.esc(label)}</button>`;
  app.ibtn=(label,action,icon,extra='')=>{const cls=extra.match(/class="([^"]*)"/)?.[1]||'';return `<button type="button" class="icon-button ${cls}" data-action="${action}" aria-label="${app.esc(label)}" title="${app.esc(label)}" ${extra.replace(/class="[^"]*"/,'')}>${app.icon(icon)}</button>`;};
  app.options=(items,value)=>items.map(x=>{const [v,label]=Array.isArray(x)?x:[x,x];return `<option value="${app.esc(v)}" ${String(value??'')===String(v)?'selected':''}>${app.esc(label)}</option>`;}).join('');
  app.field=(label,name,value='',type='text',extra='')=>`<label class="field">${app.esc(label)}<input name="${name}" type="${type}" value="${app.esc(type==='datetime-local'&&value?String(value).replace(/Z$/,'').slice(0,16):value)}" ${extra}/></label>`;
  app.select=(label,name,items,value='',extra='')=>`<label class="field">${app.esc(label)}<select name="${name}" ${extra}>${app.options(items,value)}</select></label>`;
  app.panel=(title,body,extra='',foot='')=>`<section class="panel"><header class="panel-head"><h2>${app.esc(title)}</h2>${extra}</header><div class="panel-body">${body}</div>${foot?`<footer class="panel-foot">${foot}</footer>`:''}</section>`;
  app.tabs=(page,items,current)=>`<div class="tabs" role="tablist" aria-label="${app.t('工作区标签','Workspace tabs')}">${items.map(([id,zh,en])=>`<button class="tab ${id===current?'active':''}" role="tab" aria-selected="${id===current}" data-action="tab" data-page="${page}" data-tab="${id}">${app.t(zh,en)}</button>`).join('')}</div>`;
  app.allowed=access=>{try{api.permission(access,'',{});return true;}catch{return false;}};
  app.roleName=()=>({owner:app.t('所有者','Owner'),admin:app.t('管理员','Admin'),viewer:app.t('研究成员','Viewer'),machine:app.t('机器身份','Machine'),anonymous:app.t('未登录','Signed out')})[ui.role];
  app.status=(value)=>{const zh={active:'运行中',paused:'已暂停',archived:'已归档',queued:'排队中',running:'执行中',retrying:'待重试',succeeded:'已完成',failed:'失败',cancelled:'已取消',complete:'已完成',pending:'待激活',disabled:'已禁用',available:'可用',removed:'已移除',deleted:'已删除',unknown:'未知'};const tone={active:'teal',succeeded:'teal',complete:'teal',running:'blue',queued:'blue',retrying:'amber',pending:'amber',failed:'red',disabled:'red',removed:'amber',deleted:'red'}[value]||'';return app.badge(ui.lang==='zh'?(zh[value]||value):value,tone);};
  app.recordTitle=item=>{if(!item)return app.t('无标题','Untitled');const local=F.records.find(x=>x.id===item.id);return item.kind==='comment'?app.t('评论：研究方法与数据边界','Comment: research method and data boundaries'):app.l(item.titleI18n||local?.titleI18n||item.title)||app.t('无标题','Untitled');};
  app.recordText=item=>item.text===null?app.t('源内容已移除或未保存正文。','Source text was removed or was not retained.'):item.text===''?app.t('这是已知为空正文的链接帖。','This link post has a known empty body.'):app.l(F.records.find(x=>x.id===item.id)?.bodyI18n||item.text);
  app.featureBadge=id=>{const f=C.features.find(x=>x.id===id);return f?app.badge(f.priority==='current'?app.t('已实现','Implemented'):f.priority,f.priority==='current'?'teal':''):'';};
  app.errorMessage=body=>{
    const code=body?.errorCode||body?.error?.code;
    const messages={unauthorized:['会话不可用，请重新登录。筛选与草稿仍保留。','Your session is unavailable. Sign in again; filters and drafts are retained.'],user_session_required:['此操作需要用户会话，机器身份没有个人工作区。','This action requires a user session; machine identities have no personal workspace.'],forbidden:['当前身份没有执行此操作的权限。','This identity cannot perform this action.'],project_forbidden:['当前项目角色没有编辑权限。系统角色与项目角色分别判断。','Your project role cannot edit here. System and project roles are separate.'],service_unavailable:['服务暂不可用，请稍后重试；当前筛选已保留。','The service is unavailable. Retry later; filters are retained.'],rate_limited:['请求受到限流，请等待 Retry-After 再重试。','Requests are rate-limited. Wait for Retry-After before retrying.'],personal_conflict:['记录版本已变化。保留草稿，载入最新版本后再合并。','The record changed. Keep your draft, reload the latest revision, then merge.'],configuration_conflict:['配置已被其他操作更新，请重新载入，草稿不会自动覆盖。','Configuration changed. Reload before saving; your draft will not overwrite it.'],external_requests_disabled:['采集网络已关闭，已有内容仍可检索。','Collection networking is off. Stored content is still searchable.'],provider_disabled:['该渠道当前不可采集，归档渠道仅支持读取。','This provider cannot collect now; archive providers are read-only.'],research_export_too_large:['完整样本超过条数或32MiB上限，未创建截断快照。','The full sample exceeds the row or 32MiB limit. No truncated snapshot was created.'],source_paused:['来源处于暂停状态，请先恢复，再创建采集任务。','Resume the paused source before collecting.'],source_busy:['此来源已有不同窗口或预算的活动任务。','This source has an active job with another window or budget.'],invalid_cursor:['续页游标与筛选不一致，返回第一页后重试。','The cursor does not match these filters. Return to page one.'],last_owner:['必须保留至少一名有效所有者。','At least one active owner must remain.'],self_change:['不能停用或降低自己的账户权限。','You cannot disable or demote your own account.'],recovery_budget:['恢复计划超过剩余请求预算，请缩小计划。','The recovery plan exceeds the remaining request budget.'],provider_timeout:['上游仍在超时，没有启动无限重试。','The provider is still timing out; no unbounded retry was started.'],invalid_window:['起点必须早于不包含在内的终点，分页预算也必须有效。','Start must be before the exclusive end, with a valid page budget.'],account_pending:['账户等待管理员激活，暂时无法登录。','An administrator must activate the pending account.'],account_disabled:['该账户已停用，已有会话不可继续使用。','This account is disabled and its sessions are unavailable.']};
    return messages[code]?app.t(...messages[code]):app.t('操作未完成，请核对输入与当前权限。','The action did not complete. Check the input and permissions.');
  };
  app.call=async(id,args={})=>{const result=await api.request(id,args);if(result.status>=400)throw {status:result.status,body:result.body};return result.body;};
  app.toast=(zh,en)=>{const id=Date.now()+Math.random();ui.toasts.push({id,text:app.t(zh,en)});app.renderToasts();setTimeout(()=>{ui.toasts=ui.toasts.filter(x=>x.id!==id);app.renderToasts();},4200);};
  app.renderToasts=()=>{const target=document.getElementById('toasts');if(target)target.innerHTML=ui.toasts.map(x=>`<div class="toast" role="status">${app.icon('check')}${app.esc(x.text)}</div>`).join('');};
  app.persist=()=>{try{localStorage.setItem('iw-blueprint-v1-data',JSON.stringify({version:3,state:api.state}));localStorage.setItem('iw-blueprint-v1-preferences',JSON.stringify({theme:ui.theme,lang:ui.lang,density:ui.density,layout:ui.layout}));}catch{ui.storageUnavailable=true;}};
  api.onChange=()=>{app.persist();if(ui.console)app.renderConsole();};
  app.exportFile=(name,value,format='json')=>{const content=format==='json'?JSON.stringify(value,null,2):value;const blob=new Blob([format==='csv'?'\ufeff'+content:content],{type:format==='csv'?'text/csv;charset=utf-8':'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);};
  app.csv=(response)=>{const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const safe=v=>typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:v;const meta={...response};delete meta.items;const keys=['platform','kind','externalId','title','text','publishedAt','observations'];return ['export_metadata,'+quote(JSON.stringify(meta)),keys.join(','),...(response.items||[]).map(x=>keys.map(k=>quote(safe(typeof x[k]==='object'?JSON.stringify(x[k]):x[k]))).join(','))].join('\r\n');};
  app.skeleton=()=>`<div class="panel" aria-busy="true" aria-label="${app.t('正在加载','Loading')}"><div class="panel-body muted">${app.icon('refresh')} ${app.t('正在读取当前分析范围…','Loading current analysis scope…')}</div>${Array.from({length:6},(_,i)=>`<div class="skeleton-row"><div class="skeleton"></div><div class="skeleton" style="width:${90-i*4}%"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`).join('')}</div>`;
  app.empty=(title,description,action='')=>`<div class="empty-state"><div class="empty-icon">${app.icon('search')}</div><h2>${app.esc(title)}</h2><p>${app.esc(description)}</p><div class="inline">${action}</div></div>`;
  app.errorPanel=()=>`<div class="panel">${app.empty(app.t('暂时无法显示此视图','This view is unavailable'),app.errorMessage(ui.error?.body),app.btn(app.t('重试','Retry'),'reload','refresh')+(ui.error?.status===401?app.btn(app.t('前往登录','Go to sign in'),'nav','account','data-page="account"'):''))}<div class="panel-foot">HTTP ${ui.error?.status||503} · ${app.esc(ui.error?.body?.errorCode||'service_unavailable')}</div></div>`;
  app.notice=()=>{
    if(ui.scenario==='partial')return `<div class="notice warning">${app.icon('info')}<span>${app.t('部分覆盖提示：当前样本数量不代表平台全量，未完成的时间窗不会推进高水位线。','Partial coverage: sample counts are not platform totals. Incomplete windows do not advance the watermark.')}</span></div>`;
    if(ui.scenario==='unindexed')return `<div class="notice warning">${app.icon('alert')}<span>${app.t('索引未完成：关键词查询当前仅覆盖已索引样本，请勿将其作为完整研究分母。','Indexing incomplete: keyword matches cover indexed records only and are not a complete denominator.')}</span></div>`;
    if(['offline','network-off'].includes(ui.scenario))return `<div class="notice">${app.icon('lock')}<span>${app.t('离线分析模式：外部网络采集已关闭，检索、批注与冻结快照均从本地样本库读取。','Offline mode: external collection is off; search, notes and frozen snapshots read from local storage.')}</span></div>`;
    return '';
  };

  /* Clean Chart Lifecycle Engine */
  app.registerChart=(id,specFn,svgFallback='',onClick=null)=>{
    app.chartQueue.push({id,specFn,onClick});
    return `<div id="${id}" class="echart-box" data-agent-chart="${id}">${svgFallback}</div>`;
  };
  app.mountCharts=()=>{
    if(!root.echarts||typeof root.echarts.init!=='function')return;
    const isDark=ui.theme==='dark';
    const textColor=isDark?'#a1a1aa':'#52525b';
    const inkColor=isDark?'#fafafa':'#09090b';
    const gridLine=isDark?'#222226':'#e4e4e7';
    const tooltipBg=isDark?'rgba(18,18,21,0.96)':'rgba(9,9,11,0.92)';
    for(const item of app.chartQueue){
      const el=document.getElementById(item.id);
      if(!el)continue;
      try{
        if(app.charts[item.id]){try{app.charts[item.id].dispose();}catch{}}
        el.innerHTML='';
        const chart=root.echarts.init(el,null,{renderer:'svg'});
        const spec=item.specFn({isDark,textColor,inkColor,gridLine,tooltipBg});
        chart.setOption(spec);
        if(item.onClick)chart.on('click',params=>item.onClick(params));
        app.charts[item.id]=chart;
      }catch{}
    }
  };
  if(typeof root.addEventListener==='function'){
    root.addEventListener('resize',()=>{for(const k of Object.keys(app.charts)){try{app.charts[k]?.resize();}catch{}}});
  }

  /* Task-Oriented Information Architecture */
  const hubs=[
    {id:'overview',group:'core',icon:'overview',zh:'情报总览',en:'Overview',pages:[['overview','情报总览','Overview']]},
    {id:'explore',group:'core',icon:'explore',zh:'证据工作台',en:'Evidence Workbench',pages:[['explore','分栏检索与阅读','Split-Pane Search'],['labels','样本编码','Coding & Labels'],['research','已保存与快照','Saved & Snapshots']]},
    {id:'compare',group:'core',icon:'compare',zh:'竞品矩阵',en:'Brand Matrix',pages:[['compare','品牌痛点矩阵','Brand Matrix'],['observations','跨时间观测','Observation History']]},
    {id:'analysis',group:'core',icon:'analysis',zh:'专题与简报',en:'Synthesis & Digest',pages:[['analysis','分布与结构化简报','Distribution & Digest'],['datasets','研究数据集','Datasets'],['projects','协作与复核','Team Review']]},
    {id:'sources',group:'ops',icon:'sources',zh:'信源与采集',en:'Sources & Jobs',pages:[['sources','信源目录','Source Directory'],['tasks','采集任务','Collection Jobs']]},
    {id:'admin',group:'ops',icon:'admin',zh:'系统与设置',en:'System & Settings',pages:[['admin','系统管理','Administration'],['account','账户会话','Account'],['legacy','旧版对照','Legacy View']]}
  ];
  app.currentHub=()=>hubs.find(h=>h.pages.some(p=>p[0]===ui.page))||hubs[0];

  app.agentContext=()=>({
    '@context':'https://schema.org',
    '@type':'Dataset',
    name:'PulseScope Product & Market Intelligence Workspace',
    activeModule:app.currentHub().id,
    activeView:ui.page,
    filters:ui.query,
    cohort:{
      topic:'PC Hardware & Consumer Electronics (2025-09 Baseline)',
      archiveScannedPosts:F.realAuditSummary?.corpusRecords||100000,
      workspaceRecords:api.state.records.length,
      brandMentions:F.realAuditSummary?.brandCounts||{}
    },
    visibleRecordIds:(ui.data?.list?.items||ui.data?.r?.items||ui.data?.items||[]).slice(0,12).map(x=>x.id)
  });

  const descriptions={
    overview:['聚焦 PC 硬件与消费电子品类，采用行内指标条、高价值讨论流与可钻取痛点矩阵呈现核心情报。','Inline metric ribbon, high-signal discussion feed and interactive brand pain-point matrix across PC hardware.'],
    explore:['Master-Detail 常驻分栏工作台：左侧高密度检索流（支持 J/K 快捷键），右侧无遮挡原文阅读与私有批注。','Master-Detail split-pane workbench: dense filterable evidence stream on the left, persistent primary-text & note reader on the right.'],
    datasets:['管理固定成员的研究数据集与版本变更记录，追踪样本来源与导入回执。','Manage fixed-membership research datasets, version histories and archive import receipts.'],
    analysis:['按社区、时间或渠道统计样本分布，并将当前发现导出为结构化分析简报或数据载荷。','Analyze sample distributions across communities or time, and export structured intelligence briefs.'],
    observations:['对比同一内容在不同时间点的观测快照，区分重复归档抓取与真实互动增长。','Compare multi-point observations for the same record to separate archive refreshes from genuine engagement growth.'],
    compare:['在同一评测基准下对比各品牌在“兼容性、故障率、选品性价比、售后服务”四维度的讨论浓度与代表帖证据。','Compare brands across standardized pain-point dimensions with direct click-through to primary evidence.'],
    labels:['分栏编码工作台：左侧勾选与批次赋码，右侧实时审阅原文上下文并校验版本冲突。','Split-pane coding workbench: assign pain-point and buyer-intent codes while inspecting full thread context on the right.'],
    research:['集中管理已保存的检索条件、个人分析笔记与不可变冻结快照。','Manage saved search queries, private analyst notes and immutable frozen sample snapshots.'],
    sources:['按需检索监控信源目录与渠道支持能力，管理信源启停状态。','Browse and filter monitored sources and provider capabilities on demand.'],
    tasks:['查看采集任务队列、请求预算消耗与超时窗口拆解恢复计划。','Monitor collection queues, request budgets and bounded window recovery plans.'],
    projects:['在团队内共享固定版本的数据集，协同维护编码手册与双人复核记录。','Share pinned dataset versions across a team with common codebooks and double-review workflows.'],
    admin:['管理用户账户、操作审计日志与数据库存储诊断。','Manage user accounts, audit trails and storage diagnostics.'],
    account:['查看当前登录身份、活跃会话与安全设置。','Review active user identity, sessions and security preferences.'],
    legacy:['查看旧版市场看板与历史数据表的只读对照视图。','Read-only reference view for legacy market boards and historical tables.']
  };

  app.pageHead=()=>{
    const page=C.pages.find(x=>x.id===ui.page),hub=app.currentHub();
    const subTabs=hub.pages.length>1?`<div class="hub-bar"><div class="hub-tabs" role="navigation" aria-label="${app.t('视图切换','View switcher')}">${hub.pages.map(([id,zh,en])=>`<button type="button" class="hub-tab ${ui.page===id?'active':''}" data-action="nav" data-page="${id}">${app.t(zh,en)}</button>`).join('')}</div></div>`:'';
    return `${subTabs}<div class="page-head"><div><h1>${app.esc(app.l(page?.name))}</h1><p>${app.t(...(descriptions[ui.page]||['','']))}</p></div><div class="head-actions">${app.pages[ui.page]?.head?.()||''}</div></div>`;
  };

  app.render=()=>{
    const focus=document.activeElement,focusId=focus?.id,selection=focus&&'selectionStart'in focus?focus.selectionStart:null;
    document.documentElement.dataset.theme=ui.theme;document.documentElement.lang=ui.lang==='zh'?'zh-CN':'en';document.body.className=`density-${ui.density} layout-${ui.layout}`;
    app.chartQueue=[];
    const page=C.pages.find(x=>x.id===ui.page),activeHub=app.currentHub();
    const coreHubs=hubs.filter(h=>h.group==='core'),opsHubs=hubs.filter(h=>h.group==='ops');
    const bodyHtml=ui.loading?app.skeleton():ui.error?app.errorPanel():app.pages[ui.page]?.render?.()||'';
    const isSplitView=ui.page==='explore'||ui.page==='labels';
    document.getElementById('root').innerHTML=`<div class="shell"><aside class="rail ${ui.railOpen?'open':''}" aria-label="${app.t('主导航','Main navigation')}"><div class="brand"><span class="brand-mark">${app.icon('overview')}</span><div><strong>PulseScope</strong><small>${app.t('跨境产品舆情工作台','Product Intelligence')}</small></div></div><nav class="nav"><div class="nav-group">${app.t('核心研究工作流','RESEARCH WORKBENCH')}</div>${coreHubs.map(h=>`<button class="nav-item ${activeHub.id===h.id?'active':''}" data-action="nav" data-page="${h.pages[0][0]}" aria-current="${activeHub.id===h.id?'page':'false'}">${app.icon(h.icon)}<span>${app.t(h.zh,h.en)}</span></button>`).join('')}<div class="nav-group">${app.t('数据获取与运维','OPERATIONS & SYSTEM')}</div>${opsHubs.map(h=>`<button class="nav-item ${activeHub.id===h.id?'active':''}" data-action="nav" data-page="${h.pages[0][0]}" aria-current="${activeHub.id===h.id?'page':'false'}">${app.icon(h.icon)}<span>${app.t(h.zh,h.en)}</span></button>`).join('')}</nav><div class="rail-footer"><span class="status-dot"></span><span class="mono">2025-09</span> ${app.t('固定基线','Cohort')}<br><span>${app.t('60 核心样本 / 100k 归档','60 Core / 100k Archive')}</span></div></aside><div class="workspace"><header class="topbar">${app.ibtn(app.t('打开导航','Open navigation'),'rail','menu','class="top-menu"')}<div class="crumb"><span class="crumb-workspace">${app.t(activeHub.zh,activeHub.en)} &nbsp;/&nbsp; </span><b>${app.esc(app.l(page?.name))}</b></div><div class="toolbar"><button class="quick-search" data-action="command" aria-label="${app.t('快速跳转','Quick jump')}">${app.icon('search')}<span>${app.t('跳转视图或搜索…','Jump to view…')}</span><kbd class="kbd">⌘K</kbd></button>${app.btn(app.t('JSON-LD','JSON-LD'),'agent-modal','code','class="btn small ghost"')}${app.ibtn(app.t('接口映射','API mapping'),'inspect-page','settings')}<button class="icon-button mono" data-action="language" title="${app.t('切换语言','Switch language')}">${ui.lang==='zh'?'EN':'中文'}</button>${app.ibtn(app.t('切换主题','Switch theme'),'theme',ui.theme==='light'?'moon':'sun')}<button class="avatar-button" data-action="nav" data-page="account" aria-label="${app.t('当前账户','Current account')}"><span class="avatar">${ui.role==='machine'?'MC':ui.role==='anonymous'?'—':ui.role==='viewer'?'JL':ui.role==='admin'?'SC':'AM'}</span><div>${app.roleName()}</div></button></div></header><main id="main" class="main" data-agent-hub="${activeHub.id}" data-agent-page="${ui.page}"><script id="agent-structured-context" type="application/ld+json">${JSON.stringify(app.agentContext())}<\/script>${app.pageHead()}${app.notice()}${bodyHtml}<footer class="footer-reference"><span>${app.t('统计口径：所有聚合分母均严格对应当前筛选范围；缺失或未知指标单独列示，不作补零处理。','Methodology: Denominators strictly match active filters; missing or unknown metrics are reported explicitly and never zero-filled.')}</span><span class="mono">PulseScope · 2025-09 Baseline</span></footer></main></div></div>${ui.detail&&!isSplitView?app.detailMarkup?.()||'':''}<button class="design-launcher" data-action="console">${app.icon('settings')}${app.t('调试器','Inspector')}<kbd class="kbd">Alt I</kbd></button>`;
    if(ui.console)app.renderConsole();else document.getElementById('console-root').innerHTML='';
    app.renderToasts();
    app.mountCharts();
    if(focusId){const replacement=document.getElementById(focusId);if(replacement){replacement.focus({preventScroll:true});if(selection!==null&&replacement.type!=='number'&&replacement.type!=='date')try{replacement.setSelectionRange(selection,selection);}catch{}}}
  };

  let loadVersion=0;
  app.load=async()=>{const version=++loadVersion;ui.loading=true;ui.error=null;app.render();try{const data=await app.pages[ui.page]?.load?.();if(version!==loadVersion)return;ui.data=data||{};ui.loading=false;app.render();}catch(error){if(version!==loadVersion)return;ui.error=error;ui.data={};ui.loading=false;app.render();}};
  app.navigate=(page,query)=>{ui.detailVersion=(ui.detailVersion||0)+1;ui.page=page;ui.detail=null;ui.noteDirty=false;ui.railOpen=false;ui.selected.clear();if(query){ui.query={...query};ui.draft={...query};ui.cursor=null;ui.cursorStack=[];ui.pageIndex=1;}const encoded=new URLSearchParams();if(page==='explore')for(const [k,v]of Object.entries(ui.query))if(v!==undefined&&v!=='')encoded.set(k,Array.isArray(v)?JSON.stringify(v):v);history.replaceState(null,'','#'+page+(encoded.size?'?'+encoded:''));app.load();};
  app.dialog=(name,title,html,onSubmit,width='')=>{ui.modal={name,title,html,onSubmit};const dialog=document.getElementById('dialog');dialog.className='dialog '+width;dialog.innerHTML=`<form data-form="${name}"><header class="dialog-head"><h2>${app.esc(app.t(...title))}</h2>${app.ibtn(app.t('关闭','Close'),'dialog-close','close')}</header><div class="dialog-body"><div id="dialog-error" role="alert"></div>${typeof html==='function'?html():html}</div></form>`;if(!dialog.open)dialog.showModal();};
  app.closeDialog=()=>{document.getElementById('dialog').close();ui.modal=null;};
  app.dialogError=error=>{const target=document.getElementById('dialog-error');if(target){target.className='form-error';target.textContent=app.errorMessage(error.body||{});}};
  app.confirm=(title,message,callback)=>app.dialog('confirm',title,()=>`<p class="mini-note">${app.esc(app.t(...message))}</p><div class="form-actions">${app.btn(app.t('取消','Cancel'),'dialog-close')}<button class="btn danger" type="submit">${app.t('确认操作','Confirm action')}</button></div>`,async()=>{await callback();if(app.ui.modal?.name==='confirm')app.closeDialog();});
  app.actions.nav=el=>app.navigate(el.dataset.page);
  app.actions.reload=()=>app.load();
  app.actions.rail=()=>{ui.railOpen=!ui.railOpen;app.render();};
  app.actions.theme=()=>{ui.theme=ui.theme==='light'?'dark':'light';app.persist();app.render();};
  app.actions.language=()=>{ui.lang=ui.lang==='zh'?'en':'zh';app.persist();app.render();if(ui.modal)app.closeDialog();};
  app.actions['dialog-close']=()=>app.closeDialog();
  app.actions.tab=el=>{ui.tab[el.dataset.page]=el.dataset.tab;app.load();};
  app.actions.console=()=>{ui.console=!ui.console;app.render();};
  app.actions['console-tab']=el=>{ui.consoleTab=el.dataset.tab;app.renderConsole();};
  app.actions['inspect-page']=()=>{ui.console=true;ui.consoleTab='coverage';app.renderConsole();};
  app.actions.scenario=el=>{ui.scenario=el.dataset.scenario;api.env.scenario=ui.scenario;ui.console=false;app.load();};
  app.actions['agent-modal']=()=>app.dialog('agent-schema',['结构化数据上下文与接口调用','Structured Data Context & API Access'],()=>{
    const ctx=app.agentContext();
    const curlExample=`# 1. 获取高价值讨论帖推荐\ncurl -X POST http://localhost:3000/v1/content/recommendations \\\n  -H "Content-Type: application/json" \\\n  -d '{"brands":["samsung","corsair","crucial","logitech"],"limit":6}'\n\n# 2. 获取跨品牌痛点对比矩阵\ncurl -X POST http://localhost:3000/v1/brands/matrix-compare \\\n  -H "Content-Type: application/json" \\\n  -d '{"brands":["samsung","corsair","crucial","logitech"],"dimensions":["compatibility","reliability","buying","support"]}'\n\n# 3. 导出结构化情报简报\ncurl -X POST http://localhost:3000/v1/agent/digest \\\n  -H "Content-Type: application/json" \\\n  -d '{"brands":["samsung","corsair","crucial","logitech"],"maxEvidence":5}'`;
    return `<p class="mini-note">${app.t('当前页面的筛选状态、统计口径与可见样本 ID 已同步生成标准结构化 JSON，可供自动化脚本、下游聚合器或分析工具直接读取。','Active filters, denominators and visible record IDs are serialized as structured JSON for downstream tools and automated pipelines.')}</p><div class="between" style="margin:12px 0"><strong>${app.t('当前视图结构化上下文 (JSON-LD)','Current View Context (JSON-LD)')}</strong>${app.btn(app.t('下载 JSON','Download JSON'),'agent-context-download','download')}</div><pre class="json">${app.esc(JSON.stringify(ctx,null,2))}</pre><div class="between" style="margin:14px 0 8px"><strong>${app.t('HTTP 接口调用示例','HTTP API Examples')}</strong></div><pre class="json">${app.esc(curlExample)}</pre>`;
  },()=>{},'wide');
  app.actions['agent-context-download']=()=>app.exportFile(`pulsescope-context-${ui.page}.json`,app.agentContext());
  app.changes.persona=el=>{ui.role=el.value;api.env.role=el.value;api.trace=[];ui.detail=null;ui.noteDraft=null;ui.noteDirty=false;ui.selected.clear();ui.console=false;app.load();};
  app.changes['account-state']=el=>{ui.accountState=el.value;api.env.status=el.value;api.trace=[];ui.detail=null;ui.console=false;app.load();};
  app.changes['project-role']=el=>{ui.projectRole=el.value;api.env.projectRole=el.value;app.load();};
  app.changes.density=el=>{ui.density=el.value;app.persist();app.render();};
  app.changes.layout=el=>{ui.layout=el.value;app.persist();app.render();};
  app.changes['local-operator']=el=>{api.env.localOperator=el.checked;app.renderConsole();};
  app.actions.command=()=>app.dialog('command',['快速跳转视图','Jump to View'],()=>`<div class="search-input">${app.icon('search')}<input id="command-input" placeholder="${app.t('输入视图名称…','Type a view name…')}" data-input="command-search" autocomplete="off" autofocus></div><div class="command-list" id="command-list">${app.commandItems('')}</div>`,()=>{});
  app.commandItems=query=>C.pages.filter(x=>app.l(x.name).toLowerCase().includes(query.toLowerCase())||x.id.includes(query.toLowerCase())).map(x=>`<button type="button" class="command-item" data-action="command-go" data-page="${x.id}">${app.icon(x.id)}<span>${app.esc(app.l(x.name))}</span><span class="faint mono" style="margin-left:auto">#${x.id}</span></button>`).join('');
  app.actions['command-go']=el=>{app.closeDialog();app.navigate(el.dataset.page);};
  app.actions['reset-demo']=()=>app.confirm(['重置本地演示状态','Reset local state'],['将清除浏览器缓存的模拟修改与界面偏好，恢复初始样本基线。','Clears cached simulation edits and preferences, restoring initial baseline records.'],()=>{try{localStorage.removeItem('iw-blueprint-v1-data');localStorage.removeItem('iw-blueprint-v1-preferences');}catch{}location.reload();});
  app.renderConsole=()=>{
    const tab=ui.consoleTab,endpoint=C.endpoints.find(x=>x.id===ui.apiId)||C.endpoints[0];
    const currentFeatures=C.features.filter(x=>x.page===ui.page),scenario=C.scenarios.find(x=>x.id===ui.scenario);
    const tabs=[['scenarios','身份与场景','Identity & states'],['interfaces','接口契约','API contracts'],['trace','请求记录','Request trace'],['coverage','功能映射','Feature mapping']];
    let body='';
    if(tab==='scenarios')body=`<p class="console-note">${app.t('用于验证不同角色权限、布局密度及异常边界状态（空数据、缺失字段、限流、离线等）。','Test role permissions, layout density and edge-case states (empty, missing fields, rate-limited, offline).')}</p><div class="form-grid">${app.select(app.t('模拟身份','Identity'),'persona',C.roles.map(x=>[x,x]),ui.role,'data-change="persona"')}${app.select(app.t('账户状态','Account status'),'account-state',C.accountStates.map(x=>[x,x]),ui.accountState,'data-change="account-state"')}${app.select(app.t('项目角色','Project role'),'project-role',C.projectRoles.map(x=>[x,x]),ui.projectRole,'data-change="project-role"')}${app.select(app.t('信息密度','Density'),'density',[['comfortable',app.t('标准 (40px)','Standard (40px)')],['compact',app.t('紧凑 (34px)','Compact (34px)')]],ui.density,'data-change="density"')}${app.select(app.t('布局模式','Layout'),'layout',[['standard',app.t('标准工作台','Standard')],['focus',app.t('隐藏侧栏','Focused')],['reading',app.t('宽屏阅读','Reading')]],ui.layout,'data-change="layout"')}<label class="check-label"><input type="checkbox" data-change="local-operator" ${api.env.localOperator?'checked':''}>${app.t('启用本地 CLI 操作员权限','Enable local CLI operator context')}</label></div><div class="between" style="margin-top:8px"><strong>${app.t('边界场景切换','System Scenarios')}</strong>${app.badge(app.l(scenario?.name),'blue')}</div><div class="scenario-grid" style="margin-top:8px">${C.scenarios.map(s=>`<button class="scenario-card ${ui.scenario===s.id?'active':''}" data-action="scenario" data-scenario="${s.id}">${app.esc(app.l(s.name))}</button>`).join('')}</div><div class="divider"></div><div class="between"><p class="mini-note">${app.t('当前样本库：60条核心记录 + 2025-09 归档统计基线。','Active dataset: 60 core records + 2025-09 archive baseline.')}</p>${app.btn(app.t('重置状态','Reset state'),'reset-demo','refresh')}</div>`;
    if(tab==='interfaces')body=`<p class="console-note">${app.t('浏览并直接调用模拟接口契约，验证请求参数与返回结构。','Inspect and execute mock API contracts to verify request parameters and response schemas.')}</p><div class="api-layout"><div><div class="search-input" style="margin-bottom:8px">${app.icon('search')}<input id="api-search" value="${app.esc(ui.apiSearch)}" data-input="api-search" placeholder="${app.t('搜索接口路径或编号','Search path or ID')}"></div><div class="api-list">${C.endpoints.filter(e=>(e.id+' '+e.path).toLowerCase().includes(ui.apiSearch.toLowerCase())).map(e=>`<button class="api-row ${e.id===ui.apiId?'active':''}" data-action="api-select" data-id="${e.id}"><span class="http-method">${e.method}</span> &nbsp; ${e.id} ${app.badge(e.status==='proposed'?app.t('规划','Planned'):e.status==='legacy'?app.t('旧版','Legacy'):app.t('已实现','Existing'),e.status==='proposed'?'purple':'')}<span class="path">${app.esc(e.path)}</span></button>`).join('')}</div></div><div><div class="inline">${app.badge(endpoint.id,'teal')}<strong class="mono">${endpoint.method} ${app.esc(endpoint.path)}</strong></div><p class="mini-note">${app.t('权限','Access')}: ${endpoint.access}<br>${app.t('返回结构','Response')}: ${app.esc(endpoint.response)}</p><label class="field">${app.t('请求参数 (JSON)','Request arguments (JSON)')}<textarea class="request-editor" id="api-request">${app.esc(JSON.stringify(app.defaultArgs(endpoint.id),null,2))}</textarea></label><div class="inline" style="margin-top:8px">${app.btn(app.t('发送请求','Send request'),'api-run','play')}</div><div class="data-box" style="margin-top:10px"><pre id="api-response">${app.esc(ui.apiResult?JSON.stringify(ui.apiResult,null,2):app.t('点击发送请求查看响应结果。','Click Send request to inspect response.'))}</pre></div></div></div>`;
    if(tab==='trace')body=`<p class="console-note">${app.t('记录当前会话触发的所有接口调用与耗时。','Logs all interface calls and latencies in the current session.')}</p><div class="api-layout"><div class="api-list">${api.trace.map((x,i)=>`<button class="api-row ${i===ui.traceIndex?'active':''}" data-action="trace-select" data-index="${i}"><span class="http-status">${x.status}</span> &nbsp; ${x.method} ${x.endpointId}<span class="path">${app.esc(x.path)}</span><span class="faint">${x.durationMs}ms · ${x.role}</span></button>`).join('')||`<div class="panel-body muted" style="padding:12px">${app.t('尚无请求。','No calls yet.')}</div>`}</div><div class="data-box"><pre class="json">${app.esc(JSON.stringify(api.trace[ui.traceIndex]||{},null,2))}</pre></div></div>`;
    if(tab==='coverage')body=`<p class="console-note">${app.t('当前视图关联的功能模块、服务层与数据表。','Feature modules, services and database tables backing the current view.')}</p>${currentFeatures.map(f=>`<section style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="between"><strong>${f.id} · ${app.esc(app.l(f.name))}</strong>${app.featureBadge(f.id)}</div><p class="mini-note">${app.esc(f.service)} → ${app.esc(f.tables.join(', '))}</p><div class="badge-row" style="margin-top:5px">${f.apis.map(id=>`<button class="chip" data-action="inspect-endpoint" data-id="${id}">${id} · ${app.esc(C.endpoints.find(x=>x.id===id).path)}</button>`).join('')}</div></section>`).join('')}`;
    document.getElementById('console-root').innerHTML=`<aside class="console" aria-label="${app.t('调试控制台','Inspector')}"><header class="console-head">${app.icon('settings')}<h2>${app.t('状态与接口调试器','State & API Inspector')}</h2>${app.ibtn(app.t('关闭','Close'),'console','close')}</header><div class="console-tabs">${app.tabs('console',tabs,tab)}</div><div class="console-body">${body}</div></aside>`;
  };
  const originalTab=app.actions.tab;app.actions.tab=el=>{if(el.dataset.page==='console'){ui.consoleTab=el.dataset.tab;app.renderConsole();}else originalTab(el);};
  app.actions['api-select']=el=>{ui.apiId=el.dataset.id;ui.apiResult=null;app.renderConsole();};
  app.actions['inspect-endpoint']=el=>{ui.apiId=el.dataset.id;ui.consoleTab='interfaces';app.renderConsole();};
  app.actions['trace-select']=el=>{ui.traceIndex=Number(el.dataset.index);app.renderConsole();};
  app.actions['api-run']=async()=>{let args;try{args=JSON.parse(document.getElementById('api-request').value);}catch{ui.apiResult={error:app.t('JSON格式无效','Invalid JSON')};app.renderConsole();return;}ui.apiResult=await api.request(ui.apiId,args);app.renderConsole();};
  app.defaultArgs=id=>{
    const record=api.state.records[0],source=api.state.sources[0],job=api.state.jobs[0],person=api.personal(),dataset=api.state.datasets[0],project=api.state.projects[0];
    const args={params:{id:record.id,provider:'arctic_shift',userId:F.users[2].id},query:{},body:{}};
    if(id.startsWith('S')||id==='J01')args.params.id=source.id;
    if(/^J0[3456]$/.test(id)||['N20','N21'].includes(id))args.params.id=job.id;
    if(['P03','P04'].includes(id))args.params.id=person.queries[0]?.id||F.uuid(700);
    if(['R03','R04','R05','R06'].includes(id))args.params.id=person.exports[0]?.id||F.uuid(701);
    if(['N05','N06','N07'].includes(id))args.params.id=dataset.id;
    if(['N24','N25','N26','N27','N28'].includes(id))args.params.id=project.id;
    if(['A07','A08','A09'].includes(id))args.params.id=F.users[2].id;
    if(id==='A12')args.params.id=F.uuid(951);
    const bodies={S02:{platform:'reddit',provider:'arctic_shift',target:{type:'community',community:'programming',query:'database'},contentKind:'post',label:'Demonstration source'},S03:{label:source.label,group:source.group,expectedRevision:source.revision},S04:{expectedRevision:source.revision},S05:{expectedRevision:source.revision},S06:{expectedRevision:source.revision},J01:{from:'2026-11-07T00:00:00Z',to:'2026-11-08T00:00:00Z',pageSize:25,maxPages:3},J08:{...api.state.budget,expectedRevision:api.state.budget.revision},P02:{name:'Prototype query',query:{query:'PostgreSQL',kind:'post',searchScope:'title'},expectedRevision:0},P03:{name:person.queries[0]?.name||'Updated query',query:{query:'PostgreSQL'},expectedRevision:person.queries[0]?.revision||1},P04:{expectedRevision:person.queries[0]?.revision||1},P07:{note:'Synthetic design note',favorite:true,expectedRevision:person.annotations[record.id]?.revision||0},P08:{expectedRevision:person.annotations[record.id]?.revision||1},R02:{name:'Prototype frozen sample',query:{query:'PostgreSQL',kind:'post',searchScope:'title'},maxRows:100},A01:{email:'viewer@prototype.invalid',password:'prototype-only',role:'viewer'},A04:{email:'new@prototype.invalid',password:'prototype-only',inviteCode:'DEMO-INVITE',displayName:'New demo user'},A06:{roleOnAccept:'viewer',maxUses:1},A07:{role:'viewer'},A08:{status:'disabled'},A10:{currentPassword:'prototype-only',newPassword:'prototype-new-only'},N04:{name:'New synthetic dataset',memberIds:api.state.records.slice(0,12).map(x=>x.id)},N07:{expectedRevision:dataset.revision,memberIds:dataset.memberIds.slice(0,12),reason:'Design-only version change'},N10:{selectedFileId:'registered-sample-001',sha256:'a'.repeat(64),kind:'post',from:'2026-09-01T00:00:00Z',to:'2026-10-01T00:00:00Z',maxRecords:1000},N11:{expectedSha256:'a'.repeat(64),confirmEvaluationScope:true},N12:{query:{kind:'post'},dimensions:['community'],metric:'reddit.score',unknownPolicy:'exclude-and-report'},N14:{contentIds:api.state.records.slice(0,5).map(x=>x.id),metric:'reddit.score'},N16:{name:'Method note',definition:'Synthetic coding definition',color:'teal'},N17:{contentIds:[record.id],add:['storage'],remove:[],expectedRevisions:{[record.id]:0}},N18:{left:{datasetId:api.state.datasets[0].id},right:{datasetId:api.state.datasets[1].id},operation:'intersection'},N20:{maxRequests:4,minWindowSeconds:3600,maxDepth:2},N21:{planId:api.state.plans[0]?.id||'choose-a-preview-first',expectedRevision:1,confirmBudget:true},N23:{name:'New research project'},N25:{role:'editor',expectedRevision:project.revision},N26:{datasetId:dataset.id,version:dataset.version,expectedRevision:project.revision,confirmSharing:true},N28:{datasetVersion:1,codebookVersion:1,reviewerAssignments:['Reviewer A','Reviewer B']},N29:{contentId:record.id,label:'storage',note:'Synthetic reviewer decision',expectedRevision:api.state.reviews[0]?.revision||1},N30:{datasetId:dataset.id,brands:['samsung','corsair','crucial','logitech'],limit:6},N31:{datasetId:dataset.id,brands:['samsung','corsair','crucial','logitech','razer','anker'],dimensions:['compatibility','reliability','buying','support'],metric:'reddit.score'},N32:{datasetId:dataset.id,brands:['samsung','corsair','crucial','logitech'],maxEvidence:5,format:'markdown'},CLI01:{apply:false,replay:true},UI01:{theme:ui.theme,language:ui.lang,density:ui.density}};
    if(bodies[id])args.body=bodies[id];if(id==='N11')args.params.id=api.state.previews[0]?.id||'create-preview-first';if(id==='N19')args.params.id=api.state.comparisons[0]?.id||'create-comparison-first';if(id==='N29')args.params.id=api.state.reviews[0]?.id||'create-review-first';return args;
  };
  app.start=()=>{
    if(saved?.version!==3){const p=api.personal();api.handle('P02',{}, {name:'PostgreSQL · title search',query:{query:'PostgreSQL',kind:'post',searchScope:'title'},expectedRevision:0},{});api.handle('P07',{}, {note:'Distinguish source observation time from local fetch time.',favorite:true,expectedRevision:0},{id:F.records[0].id});api.handle('R02',{}, {name:'Database discussions · fixed eight',query:{query:'PostgreSQL',kind:'post',searchScope:'title'},maxRows:100},{});}
    document.addEventListener('click',async event=>{const element=event.target.closest('[data-action]');if(!element||element.disabled)return;event.preventDefault();try{await app.actions[element.dataset.action]?.(element,event);}catch(error){if(document.getElementById('dialog').open)app.dialogError(error);else{ui.actionError=error;app.toast(app.errorMessage(error.body),app.errorMessage(error.body));}}});
    document.addEventListener('change',async event=>{const element=event.target;try{if(element.dataset.change)await app.changes[element.dataset.change]?.(element,event);if(element.dataset.draft)ui.draft[element.dataset.draft]=element.type==='checkbox'?element.checked:element.value;}catch(error){app.toast(app.errorMessage(error.body),app.errorMessage(error.body));}});
    document.addEventListener('input',event=>{const element=event.target;if(element.dataset.draft)ui.draft[element.dataset.draft]=element.value;if(element.dataset.input==='command-search')document.getElementById('command-list').innerHTML=app.commandItems(element.value);if(element.dataset.input==='api-search'){ui.apiSearch=element.value;const start=element.selectionStart;app.renderConsole();const target=document.getElementById('api-search');target.focus();target.setSelectionRange(start,start);}app.onInput?.(element);});
    document.addEventListener('submit',async event=>{if(!event.target.dataset.form)return;event.preventDefault();const data=Object.fromEntries(new FormData(event.target));const submit=event.target.querySelector('[type=submit]');if(submit)submit.disabled=true;try{if(ui.modal?.name===event.target.dataset.form)await ui.modal.onSubmit(data,event.target);else await app.forms[event.target.dataset.form]?.(data,event.target);}catch(error){app.dialogError(error);}finally{if(submit?.isConnected)submit.disabled=false;}});
    document.addEventListener('keydown',event=>{
      const tag=document.activeElement?.tagName;
      const inField=tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT';
      if(!inField&&(ui.page==='explore'||ui.page==='labels')&&(event.key==='j'||event.key==='k')&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        const items=ui.data?.list?.items||ui.data?.items||[];
        if(items.length){
          event.preventDefault();
          const curId=ui.detail?.content?.id||items[0].id;
          const idx=Math.max(0,items.findIndex(x=>x.id===curId));
          const nextIdx=event.key==='j'?Math.min(items.length-1,idx+1):Math.max(0,idx-1);
          app.actions.detail?.({dataset:{id:items[nextIdx].id,tab:ui.detailTab||'body'}});
          return;
        }
      }
      if(event.key==='Tab'&&ui.detail&&ui.page!=='explore'&&ui.page!=='labels'&&!ui.console&&!document.getElementById('dialog').open){const items=document.querySelector('.detail-drawer')?.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled])');if(items?.length){const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();app.actions.command();}
      if(event.altKey&&event.key.toLowerCase()==='i'){event.preventDefault();app.actions.console();}
      if(event.key==='Escape'&&!document.getElementById('dialog').open){if(ui.console){ui.console=false;app.render();}else if(ui.detail){app.actions['detail-close']?.();}else if(ui.railOpen){ui.railOpen=false;app.render();}}
    });
    document.getElementById('dialog').addEventListener('cancel',()=>{ui.modal=null;});
    const restoreRoute=()=>{const [page,query]=location.hash.slice(1).split('?');if(C.pages.some(x=>x.id===page))ui.page=page;if(query){ui.query=Object.fromEntries(new URLSearchParams(query));if(typeof ui.query.exclusions==='string'){try{ui.query.exclusions=JSON.parse(ui.query.exclusions);}catch{ui.query.exclusions=ui.query.exclusions.split(',');}if(!Array.isArray(ui.query.exclusions))ui.query.exclusions=[];}ui.draft={...ui.query};}app.load();};window.addEventListener('hashchange',restoreRoute);restoreRoute();
  };
  root.BlueprintApp=app;
})(globalThis);
