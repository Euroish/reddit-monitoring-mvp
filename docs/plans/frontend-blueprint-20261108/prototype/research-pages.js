/* Research workspace views: De-cardified Linear + Readwise Reader + Hex analytical workbench.
   - Rule 1: 100vh Master-Detail Split-Pane Workbench on explore & labels
   - Rule 2: Zero Box-in-Box (hairline dividers, unclamped editorial reader)
   - Rule 3: Compact Inline Metric Ribbon + elevated Brand × Pain-Point Matrix on overview
   - Rule 4: Monochrome-First micro-badges (color reserved for status/alert dots)
   - Rule 5: 13px typography, 40px dense rows, tabular numerals & 2px indigo active row bar */
(function(){'use strict';const a=BlueprintApp,u=a.ui,t=a.t,l=a.l,e=a.esc,b=a.btn,ic=a.icon;
const json=x=>`<pre class="json">${e(JSON.stringify(x,null,2))}</pre>`;
const stat=(label,value,note='',delta='',tone='')=>`<div class="stat" data-agent-metric="${e(label)}"><div class="stat-top"><span class="stat-label">${e(label)}</span><strong>${a.num(value)}</strong>${delta?`<span class="stat-delta ${tone}">${e(delta)}</span>`:''}</div>${note?`<span class="stat-note" title="${e(note)}">${e(note)}</span>`:''}</div>`;
const note=(zh,en)=>`<p class="mini-note">${t(zh,en)}</p>`;
const nav=(page,zh,en)=>b(t(zh,en),'nav','arrow',`data-page="${page}"`);
const table=(headers,rows)=>`<div class="table-scroll"><table class="data-table"><thead><tr>${headers.map((x,i)=>`<th class="${i===headers.length-1&&headers.length>=4?' numeric':''}">${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const qargs=()=>Object.fromEntries(Object.entries(u.query).filter(([,v])=>v!==''&&v!==undefined));
const proposedScope=()=>!!(u.query.datasetId||u.query.community||u.query.tag||u.query.purpose||u.query.brand||u.query.dimension);
const params=id=>({params:{id}});
const submit=()=>`<button class="btn primary" type="submit">${t('确认保存','Save changes')}</button>`;
a.parts={json,stat,note,table,nav,params,submit};

function barChart(groups,action='drill-community'){
  if(!groups||!groups.length)return note('当前范围内暂无分布数据。','No distribution data in current scope.');
  const max=Math.max(1,...groups.map(x=>x.count));
  return `<div class="bar-chart">${groups.slice(0,10).map(x=>`<button class="bar-row" data-action="${action}" data-key="${e(x.key)}" title="${e(x.key)}: ${x.count}"><span class="bar-label">${e(x.key)}</span><span class="bar-track"><span class="bar-fill" style="width:${x.count/max*100}%"></span></span><strong>${a.num(x.count)}</strong></button>`).join('')}</div>`;
}
a.parts.barChart=barChart;

function svgTrendFallback(daily,ema){
  if(!daily.length)return note('当前范围内暂无日序列数据。','No daily series in current scope.');
  const max=Math.max(1,...daily.map(d=>d.count),...ema);
  const w=560,h=195,padL=30,padR=12,padT=14,padB=26,iw=w-padL-padR,ih=h-padT-padB;
  const step=iw/Math.max(1,daily.length);
  const pts=ema.map((v,i)=>`${(padL+i*step+step/2).toFixed(1)},${(padT+ih-(v/max)*ih).toFixed(1)}`).join(' ');
  const areaPts=`${(padL+step/2).toFixed(1)},${padT+ih} ${pts} ${(padL+(daily.length-1)*step+step/2).toFixed(1)},${padT+ih}`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t('讨论量与移动均线趋势','Discussion volume and moving average')}"><line class="gridline" x1="${padL}" y1="${padT}" x2="${w-padR}" y2="${padT}"/><line class="gridline" x1="${padL}" y1="${padT+ih/2}" x2="${w-padR}" y2="${padT+ih/2}"/><line class="gridline" x1="${padL}" y1="${padT+ih}" x2="${w-padR}" y2="${padT+ih}"/><polygon class="area-fill" points="${areaPts}"/><polyline class="trend-line" points="${pts}"/>${daily.map((d,i)=>{const bh=Math.max(3,(d.count/max)*ih),bx=padL+i*step+step*0.22,by=padT+ih-bh,bw=Math.max(7,step*0.56);return `<g><rect class="bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" data-action="drill-day" data-key="${e(d.day)}"><title>${e(d.day)}: ${d.count}</title></rect><text x="${(bx+bw/2).toFixed(1)}" y="${h-7}" text-anchor="middle">${e(d.day.slice(5))}</text></g>`;}).join('')}</svg>`;
}

const shortDimLabel=(id,lang)=>{
  const map={
    compatibility:lang==='zh'?'兼容性适配':'Compatibility',
    reliability:lang==='zh'?'故障与固件':'Reliability & Bug',
    buying:lang==='zh'?'选品性价比':'Value & Buying',
    support:lang==='zh'?'售后与质保':'Warranty & RMA'
  };
  return map[id]||id;
};

/* Rule 4 & Rule 5: Monochrome-First Tags, 40px Dense Rows, Tabular Numerals & Active Row Bar */
function recordTable(items,selectable=true){
  const activeId=u.detail?.content?.id||items[0]?.id;
  return table([selectable?t('选择','Sel'):'#',t('讨论主题与证据标签','Evidence thread & classification'),t('社区','Subreddit'),t('发布 UTC','Published'),t('得分','Score')],items.map((x,i)=>{
    const local=a.fixtures.records.find(r=>r.id===x.id);
    const brList=local?._brands||x.platformDetails?.extensions?.['research.brands']||[];
    const brs=brList.map(br=>a.badge(br.toUpperCase())).join('');
    const dm=local?._dimension||x.platformDetails?.extensions?.['research.dimension']||'';
    const dmObj=a.fixtures.dimensions?.find(d=>d.id===dm);
    const isRowActive=(u.page==='explore'||u.page==='labels')&&activeId===x.id;
    const isSelected=u.selected.has(x.id);
    const availBadge=x.availability==='available'?'':a.status(x.availability);
    return `<tr class="${isRowActive?'is-active ':''}${isSelected?'selected':''}" data-agent-entity="content-record" data-agent-id="${e(x.id)}" data-agent-brands="${e(brList.join(','))}" data-agent-dimension="${e(dm)}"><td class="table-check">${selectable?`<input type="checkbox" aria-label="${e(t('选择记录','Select record')+' '+(i+1))}" data-change="record-select" value="${x.id}" ${isSelected?'checked':''}>`:`<span class="mono faint">${i+1}</span>`}</td><td class="text-col"><button class="table-title" data-action="detail" data-id="${x.id}">${e(a.recordTitle(x))}</button><div class="cell-sub">${availBadge}<span class="mono">${x.kind}</span><span>· ${x.observations.length} ${t('观测','obs')}</span>${brs}${dmObj?a.badge(shortDimLabel(dmObj.id,u.lang)):''}${u.page==='labels'?(u.data.assignments?.[x.id]||[]).map(id=>a.badge(l(u.data.labels.find(y=>y.id===id)?.name||id),'teal')).join(''):''}</div></td><td class="mono muted nowrap">r/${e(x.platformDetails.community)}</td><td class="mono muted nowrap">${a.date(x.publishedAt)}</td><td class="numeric">${x.observations[0]?.metrics['reddit.score']??t('未知','—')}</td></tr>`;
  }));
}
a.parts.recordTable=recordTable;

/* Compact Interactive Matrix Table Helper (Shared between Overview & Compare) */
function renderCompactMatrix(mx,dims,brands,maxRows=6){
  const targetBrands=brands.slice(0,maxRows);
  const matrixRows=targetBrands.map(br=>{
    const row=mx?.matrix?.[br]||{total:0,avgMetric:null,byDimension:{}};
    const cells=dims.map(dm=>{
      const cell=row.byDimension?.[dm.id]||{count:0,avgMetric:null},ev=mx?.topEvidenceByCell?.[`${br}:${dm.id}`];
      const evTitle=ev?a.recordTitle(ev):'';
      return `<td style="padding:0"><button type="button" class="matrix-cell" data-action="drill-cell" data-brand="${br}" data-dimension="${dm.id}" data-agent-entity="matrix-cell" data-agent-brand="${br}" data-agent-dimension="${dm.id}"><div class="between"><strong>${cell.count} <span class="faint" style="font-weight:400;font-size:11px">${t('帖','p')}</span></strong><span class="mono faint">${t('均分','μ')} ${cell.avgMetric??'—'}</span></div>${evTitle?`<div class="cell-sub" style="margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px">${e(String(evTitle).slice(0,30))}…</div>`:''}</button></td>`;
    }).join('');
    return `<tr><td><strong class="mono">${e(br.toUpperCase())}</strong><div class="cell-sub"><span class="mono">${row.total} ${t('条','rec')}</span> · <span>μ ${row.avgMetric??'—'}</span></div></td>${cells}</tr>`;
  });
  return table([t('品牌 / 样本量','Brand / Cohort'),...dims.map(dm=>shortDimLabel(dm.id,u.lang))],matrixRows);
}

a.pages.overview={
  head:()=>b(t('竞品痛点对比','Brand Matrix'),'nav','compare','data-page="compare"')+b(t('结构化简报','Intelligence Digest'),'nav','file','data-page="analysis"')+nav('explore','进入分栏证据库','Open Split-Pane Reader'),
  load:async()=>{const [w,r,rec,mx]=await Promise.all([a.call('C03'),a.call('C01',{query:{limit:5}}),a.call('N30',{body:{limit:4}}),a.call('N31',{body:{}})]);return {w,r,rec,mx};},
  render:()=>{
    const {w,r,rec,mx}=u.data,audit=a.fixtures.realAuditSummary;
    const daily=w.stats.daily||[];
    const ema=[];
    daily.forEach((d,i)=>{const prev=i===0?d.count:ema[i-1];ema.push(Number((d.count*0.45+prev*0.55).toFixed(2)));});

    const trendChartHtml=daily.length?a.registerChart('chart-overview-trend',({isDark,textColor,gridLine,tooltipBg})=>({
      tooltip:{trigger:'axis',backgroundColor:tooltipBg,borderColor:gridLine,textStyle:{color:'#f3f4f6',fontSize:11.5}},
      legend:{data:[t('日讨论量','Daily Volume'),t('7日移动均线 (EMA)','7-Day EMA')],top:0,right:4,itemWidth:10,itemHeight:6,textStyle:{color:textColor,fontSize:11}},
      grid:{top:28,left:30,right:12,bottom:22},
      xAxis:{type:'category',data:daily.map(x=>x.day),axisLabel:{color:textColor,fontSize:10.5,formatter:v=>v.slice(5)},axisLine:{lineStyle:{color:gridLine}},axisTick:{show:false}},
      yAxis:{type:'value',splitLine:{lineStyle:{color:gridLine,type:'dashed'}},axisLabel:{color:textColor,fontSize:10.5}},
      series:[
        {name:t('日讨论量','Daily Volume'),type:'bar',data:daily.map(x=>x.count),barMaxWidth:16,itemStyle:{color:isDark?'#27272a':'#d4d4d8',borderRadius:[2,2,0,0]},emphasis:{itemStyle:{color:isDark?'#6366f1':'#4f46e5'}}},
        {name:t('7日移动均线 (EMA)','7-Day EMA'),type:'line',smooth:true,data:ema,symbol:'circle',symbolSize:4,itemStyle:{color:isDark?'#6366f1':'#4f46e5'},lineStyle:{width:2,color:isDark?'#6366f1':'#4f46e5'}}
      ]
    }),svgTrendFallback(daily,ema),params=>{if(params?.name)a.navigate('explore',{from:params.name+'T00:00:00Z',to:new Date(Date.parse(params.name)+86400000).toISOString()});}):note('当前范围内暂无日序列数据。','No daily series in current scope.');

    const brands=(mx?.brands||['samsung','corsair','crucial','logitech','razer','anker']);
    const dims=a.fixtures.dimensions||[];
    const dimColors=['#4f46e5','#71717a','#0d9488','#d97706'];
    const brandBars=Object.entries(audit?.brandCounts||{}).slice(0,6).map(([key,count])=>({key:key.toUpperCase(),count}));

    const brandChartHtml=a.registerChart('chart-overview-brands',({textColor,gridLine,tooltipBg})=>({
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:tooltipBg,borderColor:gridLine,textStyle:{color:'#f3f4f6',fontSize:11.5}},
      legend:{data:dims.map(d=>shortDimLabel(d.id,u.lang)),top:0,right:4,itemWidth:8,itemHeight:8,textStyle:{color:textColor,fontSize:11}},
      grid:{top:28,left:70,right:16,bottom:20},
      xAxis:{type:'value',splitLine:{lineStyle:{color:gridLine,type:'dashed'}},axisLabel:{color:textColor,fontSize:10.5}},
      yAxis:{type:'category',inverse:true,data:brands.map(b=>b.toUpperCase()),axisLabel:{color:textColor,fontSize:11,fontWeight:600},axisLine:{lineStyle:{color:gridLine}},axisTick:{show:false}},
      series:dims.map((dm,idx)=>({
        name:shortDimLabel(dm.id,u.lang),
        type:'bar',
        stack:'total',
        barMaxWidth:14,
        itemStyle:{color:dimColors[idx%dimColors.length]},
        data:brands.map(br=>mx?.matrix?.[br]?.byDimension?.[dm.id]?.count||0)
      }))
    }),barChart(brandBars,'drill-brand'),params=>{if(params?.name)a.navigate('explore',{brand:params.name.toLowerCase()});});

    const recCards=(rec?.items||[]).map(item=>`<article class="rec-card" data-agent-entity="recommended-thread" data-agent-id="${e(item.content.id)}" data-agent-score="${item.recommendationScore}" data-agent-brands="${e(item.matchedBrands.join(','))}"><div><div class="between"><span class="rec-score">${t('信号分','SIG')} ${item.recommendationScore}</span><span class="badge-row">${item.matchedBrands.map(br=>a.badge(br.toUpperCase())).join('')}${item.matchedDimensions.map(dm=>a.badge(shortDimLabel(dm,u.lang))).join('')}</span></div><button class="table-title" style="margin-top:6px" data-action="detail" data-id="${item.content.id}">${e(a.recordTitle(item.content))}</button><div class="cell-sub" style="margin-top:4px"><span class="mono">r/${e(item.content.platformDetails.community)}</span><span>· ${t('得分','Score')} ${item.content.observations[0]?.metrics?.['reddit.score']??'—'}</span><span>· ${t('评论','Comments')} ${item.content.observations[0]?.metrics?.['reddit.num_comments']??'—'}</span></div></div><div class="between" style="padding-top:6px"><span class="mini-note" style="margin:0">${e(item.reasons.join(' · '))}</span>${b(t('审阅原文','Inspect'),'detail','file',`class="btn small ghost" data-id="${item.content.id}"`)}</div></article>`).join('');

    return `<div class="stat-strip">${stat(t('工作集样本','Workspace Cohort'),w.stats.total,t('源自 2025-09 归档 100k 帖抽样','Sampled from 100k Sept archive'),t('基线','Baseline'))}${stat(t('核心硬件社区命中','Hardware Hits'),audit?.cohortBrandHits||216,t('buildapc 135 · Android 62 · tech 10','buildapc 135 · Android 62 · tech 10'),t('47%','47%'),'teal')}${stat(t('高密度线索','High-Signal Leads'),rec?.items?.length||0,t('过滤外链与删帖','Filtered for text density'))}${stat(t('已建索引','Indexed Coverage'),w.stats.searchCoverage.indexed,t('支持即时多维快筛','Ready for instant filter'))}</div>`+
    `<div class="columns" style="margin-bottom:8px"><div>${a.panel(t('高价值讨论线索流（按相关性 × 信息密度 × 互动分位排序）','High-Signal Discussion Feed (Relevance × Density × Engagement)'),`<div class="rec-grid">${recCards||note('当前范围内暂无可推荐长文。','No recommended threads in current scope.')}</div>`,nav('explore','在分栏阅读器中打开全部','Open all in Split-Pane Reader'))}</div><div>${a.panel(t('品牌 × 痛点可点击证据矩阵（点击单元格直接钻取证据）','Interactive Brand × Pain-Point Matrix (Click cell to drill down)'),renderCompactMatrix(mx,dims,brands,4),b(t('展开完整 6 品牌对比视图','Full 6-brand matrix'),'nav','compare','class="btn small ghost" data-page="compare"'))}</div></div>`+
    `<div class="echart-row">${a.panel(t('讨论量与 7 日移动均线 (UTC)','Discussion Volume & 7-Day EMA (UTC)'),trendChartHtml,`<small>${t('点击柱体筛选单日样本','Click bar to filter by day')}</small>`,t('柱体为单日入库主帖与评论数，折线为 7 日指数平滑趋势；未知发布时间不计入日序列。','Bars show daily record counts; line tracks 7-day EMA. Unknown dates excluded.'))}${a.panel(t('各品牌痛点维度分布构成','Brand Pain-Point Breakdown'),brandChartHtml,`<small>${t('点击品牌筛选对应证据','Click brand to filter records')}</small>`,t('按“兼容性适配、故障与固件、选品性价比、售后与质保”拆解品牌讨论结构。','Breaks down brand mentions across compatibility, firmware issues, value and support.'))}</div>`+
    `<div class="columns"><div>${a.panel(t('近期入库研究样本','Recent Research Records'),recordTable(r.items,false),nav('explore','检索全部样本','View all records'))}</div><div>${a.panel(t('九月 100,000 帖归档基线 · 品牌总提及分布','Sept 100k Archive Baseline · Brand Mentions'),barChart(brandBars,'drill-brand')+note('基于 2025-09 原始归档样本扫描统计；点击任意品牌可筛选当前工作集中的对应证据。','Derived from the 2025-09 100k archive audit; click any brand to filter workspace evidence.'))}${a.panel(t('标准研究工作流','Research Workflows'),`<div class="workflow-list">${[['explore','01','按品牌与痛点维度筛选并常驻审阅原始证据','Filter & inspect primary evidence in Split-Pane Reader'],['compare','02','跨品牌四维痛点矩阵与代表帖对比','Compare brands across pain-point matrix'],['analysis','03','导出结构化分析简报与数据集','Export structured intelligence digest'],['research','04','冻结样本快照以固定复现口径','Freeze snapshot for reproducible reference']].map(([page,n,zh,en])=>`<button class="workflow-step" data-action="nav" data-page="${page}"><span class="step-number">${n}</span><strong>${t(zh,en)}</strong>${ic('arrow')}</button>`).join('')}</div>`)}</div></div>`;
  }
};
a.actions['drill-day']=el=>{const day=el.dataset.key;a.navigate('explore',{from:day+'T00:00:00Z',to:new Date(Date.parse(day)+86400000).toISOString()});};
a.actions['drill-provider']=el=>a.navigate('explore',{provider:el.dataset.key});
a.actions['drill-community']=el=>a.navigate('explore',{datasetId:u.data.datasets?.[0]?.id||a.fixtures.datasets[0].id,community:el.dataset.key});
a.actions['drill-brand']=el=>a.navigate('explore',{brand:el.dataset.key.toLowerCase()});
a.actions['drill-cell']=el=>a.navigate('explore',{brand:el.dataset.brand,dimension:el.dataset.dimension});

/* Default Inline Reader Preview when u.detail is null on Split-Pane views */
function inlinePreviewMarkup(fallbackItem){
  if(!fallbackItem)return `<aside class="detail-drawer" aria-label="${t('证据阅读器','Evidence reader')}"><div class="drawer-body">${a.empty(t('未选择样本记录','No record selected'),t('在左侧列表中点击任意讨论帖，或使用键盘 J / K 键快速上下切换审阅。','Click any record in the left list or press J / K to step through threads.'))}</div></aside>`;
  const local=a.fixtures.records.find(r=>r.id===fallbackItem.id)||fallbackItem;
  const brList=local._brands||fallbackItem.platformDetails?.extensions?.['research.brands']||[];
  const dm=local._dimension||fallbackItem.platformDetails?.extensions?.['research.dimension']||'';
  return `<aside class="detail-drawer" role="region" aria-label="${t('常驻证据阅读器','Split-pane evidence reader')}"><header class="drawer-head"><strong>${t('证据原文与观测详情','Primary Evidence & Observations')}</strong><div class="inline"><span class="kbd" title="${t('键盘上下切换','Keyboard navigation')}">J / K</span>${b(t('加载完整批注与引用','Load annotations & refs'),'detail','file',`class="btn small" data-id="${fallbackItem.id}"`)}</div></header><div class="tabs">${[['body','原文内容','Text'],['observations','观测快照','Observations'],['references','上下文关联','References'],['note','研究批注','Analyst Note']].map(([id,zh,en])=>`<button class="tab ${id==='body'?'active':''}" data-action="detail" data-id="${fallbackItem.id}" data-tab="${id}">${t(zh,en)}</button>`).join('')}</div><div class="drawer-body"><div class="badge-row">${a.status(fallbackItem.availability)}${a.badge(fallbackItem.kind)}${a.badge('r/'+fallbackItem.platformDetails.community)}${brList.map(br=>a.badge(br.toUpperCase())).join('')}${dm?a.badge(shortDimLabel(dm,u.lang)):''}</div><h2 class="detail-title" style="margin-top:8px">${e(a.recordTitle(fallbackItem))}</h2><div class="meta-line">${e(fallbackItem.author?.displayName||fallbackItem.author?.externalId||t('未知作者','Unknown author'))} · ${a.date(fallbackItem.publishedAt,true)}</div><div class="readtext expanded">${e(a.recordText(fallbackItem))}</div><div class="detail-section"><h3>${t('最新观测指标快照','Latest Observation Metrics')}</h3><div class="metric-grid">${Object.entries(fallbackItem.observations?.[0]?.metrics||{}).map(([key,v])=>`<div><small>${e(key.replace('reddit.',''))}</small><strong>${v===null?t('未知','—'):e(v)}</strong></div>`).join('')}</div></div>${note('常驻分栏阅读模式：点击左侧任意行或按 J/K 键即可无缝切换原文；点击上方标签页可编写私有研究批注或核对父子引用链。','Split-pane reading mode: click any row on the left or press J/K to switch threads without modal popups.')}</div></aside>`;
}

/* Rule 1: Explore & Labels use 100vh Master-Detail Split-Pane Layout */
a.pages.explore={
  head:()=>b(t('保存检索条件','Save query'),'query-save','star')+b(t('导出结果','Export'),'live-export','download')+b(t('冻结当前样本','Freeze sample'),'freeze','lock'),
  load:async()=>{let q=qargs(),stats,list;const sources=await a.call('N01',{query:{limit:50}});if(proposedScope()){const ds=q.datasetId||a.fixtures.datasets[0].id;[list,stats]=await Promise.all([a.call('N06',{params:{id:ds},query:{...q,limit:u.pageSize,cursor:u.cursor||undefined}}),a.call('N12',{body:{datasetId:ds,query:q,dimensions:['community']}})]);}else [list,stats]=await Promise.all([a.call('C01',{query:{...q,limit:u.pageSize,cursor:u.cursor||undefined}}),a.call('C02',{query:q})]);return {list,stats,sources:sources.items};},
  render:()=>{
    const {list,stats,sources}=u.data,q=u.draft;const total=stats.total??stats.denominator;
    const brandChips=(a.fixtures.brands||[]).map(br=>`<button type="button" class="chip ${u.query.brand===br.id?'active':''}" data-action="quick-brand" data-brand="${br.id}">${e(br.name)}</button>`).join('');
    const dimChips=(a.fixtures.dimensions||[]).map(dm=>`<button type="button" class="chip ${u.query.dimension===dm.id?'active':''}" data-action="quick-dim" data-dim="${dm.id}">${e(shortDimLabel(dm.id,u.lang))}</button>`).join('');
    const readerPaneHtml=u.detail?detailView(true):inlinePreviewMarkup(list.items[0]);
    return `<form data-form="search"><div class="querybar"><div class="search-input">${ic('search')}<input id="content-query" name="query" data-draft="query" value="${e(q.query??u.query.query??'')}" placeholder="${t('输入品牌、型号或问题关键词（如 PostgreSQL, Samsung, 990 Pro, 啸叫）…','Search brands, models or issues (e.g., PostgreSQL, Samsung, 990 Pro, coil whine)…')}" aria-label="${t('检索关键词','Search keywords')}"></div><button class="btn primary" type="submit">${t('检索','Search')}</button>${b(t('高级筛选','Filters'),'filters','filter')}${b(t('重置','Reset'),'search-clear','close','class="btn ghost"')}</div><div class="scope-bar"><span><strong>${t('品牌','Brand')}:</strong></span>${brandChips}<span style="margin-left:8px"><strong>${t('痛点','Dimension')}:</strong></span>${dimChips}<span style="margin-left:auto" class="mono faint">${a.num(total)} ${t('条匹配','matches')} · <kbd class="kbd">J</kbd>/<kbd class="kbd">K</kbd> ${t('切换','nav')}</span></div><div class="filter-area ${u.filtersOpen?'':'hidden'}"><div class="form-grid">${a.select(t('检索模式','Search mode'),'searchMode',[['literal',t('字面子串','Literal substring')],['terms',t('全部词项 AND','All terms AND')],['phrase',t('规范化短语','Normalized phrase')]],q.searchMode||u.query.searchMode||'literal')}${a.select(t('字段范围','Search fields'),'searchScope',[['title_text',t('标题与正文','Title & text')],['title',t('仅标题','Title only')],['text',t('仅正文','Text only')]],q.searchScope||u.query.searchScope||'title_text')}${a.select(t('内容种类','Content kind'),'kind',[['',t('全部','All')],['post',t('帖子','Posts')],['comment',t('评论','Comments')]],q.kind||u.query.kind)}${a.select(t('来源渠道','Provider'),'provider',[['',t('全部渠道','All providers')],['arctic_shift','Arctic Shift API'],['arctic_shift_dump',t('九月归档','September archive')]],q.provider||u.query.provider)}${a.select(t('监控来源','Source'),'sourceId',[['',t('全部来源','All sources')],...sources.map(s=>[s.id,s.label])],q.sourceId||u.query.sourceId)}${a.field(t('作者','Author'),'author',q.author||u.query.author||'')}${a.field(t('起点 UTC（包含）','From UTC (inclusive)'),'from',q.from||u.query.from||'','datetime-local')}${a.field(t('终点 UTC（不包含）','To UTC (exclusive)'),'to',q.to||u.query.to||'','datetime-local')}${a.field(t('排除词（逗号分隔）','Exclusions (comma separated)'),'exclusions',(q.exclusions||u.query.exclusions||[]).join?.(',')||'')}${a.field(t('语言','Language'),'language',q.language||u.query.language||'')}${a.field(t('指标键','Metric key'),'metricKey',q.metricKey||u.query.metricKey||'')}${a.field(t('最小指标值','Minimum metric'),'minMetric',q.minMetric??u.query.minMetric??'','number')}${a.field(t('最大指标值','Maximum metric'),'maxMetric',q.maxMetric??u.query.maxMetric??'','number')}${a.field(t('来源分组','Source group'),'sourceGroup',q.sourceGroup||u.query.sourceGroup||'')}${a.select(t('排序','Sort'),'sort',[['published_desc',t('最新在前','Newest first')],['published_asc',t('最早在前','Oldest first')]],q.sort||u.query.sort)}</div></div></form>${u.selected.size?`<div class="bulkbar"><strong>${u.selected.size} ${t('条已选','selected')}</strong>${b(t('保存为数据集','Create dataset'),'dataset-from-selection','plus')}${b(t('批量赋码','Code selection'),'labels-selection','labels')}</div>`:''}<div class="workbench-split"><div class="workbench-list-pane"><div class="tabletools"><span>${t('样本明细流（点击行在右侧常驻审阅）','Evidence Stream (Click row to inspect in right pane)')}</span><span class="mono faint">${t('第','P')}${u.pageIndex} · ${a.num(total)} ${t('条','items')}</span></div><div class="workbench-list-scroll">${list.items.length?recordTable(list.items):a.empty(t('当前筛选条件下无匹配记录','No records match current filters'),t('请尝试放宽日期范围、切换品牌标签或清除关键词。','Try broadening the date range, switching brand filters or clearing keywords.'),b(t('重置筛选','Reset filters'),'search-clear','refresh'))}</div><div class="pager"><span>${t('游标分页与当前过滤条件严格绑定','Cursor bound to active filters')}</span><div class="inline">${b(t('上一页','Prev'),'page-prev','back',u.pageIndex===1?'disabled':'')}${b(t('下一页','Next'),'page-next','arrow',!list.nextCursor?'disabled':'')}</div></div></div><div class="workbench-reader-pane">${readerPaneHtml}</div></div>`;
  }
};
a.actions['quick-brand']=el=>{const br=el.dataset.brand;if(u.query.brand===br)delete u.query.brand;else u.query.brand=br;u.cursor=null;u.cursorStack=[];u.pageIndex=1;a.load();};
a.actions['quick-dim']=el=>{const dm=el.dataset.dim;if(u.query.dimension===dm)delete u.query.dimension;else u.query.dimension=dm;u.cursor=null;u.cursorStack=[];u.pageIndex=1;a.load();};
a.forms.search=async data=>{const clean={};for(const [k,v]of Object.entries(data))if(v!==''){clean[k]=k==='exclusions'?v.split(',').map(s=>s.trim()).filter(Boolean):['minMetric','maxMetric'].includes(k)?Number(v):['from','to'].includes(k)?new Date(v.endsWith('Z')?v:v+'Z').toISOString():v;}for(const k of ['datasetId','community','tag','purpose','brand','dimension'])if(u.query[k])clean[k]=u.query[k];u.query=clean;u.draft={...clean};u.cursor=null;u.cursorStack=[];u.pageIndex=1;u.selected.clear();await a.load();};
a.actions.filters=()=>{u.filtersOpen=!u.filtersOpen;a.render();};a.actions['search-clear']=()=>{u.query={};u.draft={};u.cursor=null;u.cursorStack=[];u.pageIndex=1;a.load();};
a.actions['page-next']=()=>{u.cursorStack.push(u.cursor);u.cursor=u.data.list.nextCursor;u.pageIndex++;a.load();};a.actions['page-prev']=()=>{u.cursor=u.cursorStack.pop()||null;u.pageIndex--;a.load();};
a.changes['record-select']=el=>{el.checked?u.selected.add(el.value):u.selected.delete(el.value);a.render();};
a.actions.detail=async el=>{const token=u.detailVersion=(u.detailVersion||0)+1,page=u.page;const id=el.dataset.id,initialTab=el.dataset.tab||'body',[detail,annotation]=await Promise.all([a.call('C04',params(id)),a.allowed('personal-session')?a.call('P06',params(id)):Promise.resolve({annotation:null})]);if(u.detailVersion!==token||u.page!==page)return;u.detailReturnId=id;u.detail={...detail,annotation:annotation.annotation};u.detailTab=initialTab;u.noteDraft=annotation.annotation?.note||'';u.noteDirty=false;if(u.modal)a.closeDialog();a.render();if(page!=='explore'&&page!=='labels')document.querySelector('.detail-drawer [data-action=detail-close]')?.focus();};
a.closeDetail=()=>{const id=u.detailReturnId;u.detail=null;u.noteDirty=false;a.render();document.querySelector('[data-action=detail][data-id="'+id+'"]')?.focus();};
a.actions['detail-close']=()=>{if(u.noteDirty)a.confirm(['放弃未保存草稿？','Discard unsaved note?'],['关闭面板将丢失当前未保存的批注内容。','Closing the panel discards your unsaved note.'],()=>a.closeDetail());else a.closeDetail();};
a.actions['detail-tab']=el=>{u.detailTab=el.dataset.tab;a.render();};

function detailView(inlineSplit=false){
  const d=u.detail,x=d.content,an=d.annotation;
  let body='';
  if(u.detailTab==='body')body=`<div class="badge-row">${a.status(x.availability)}${a.badge(x.kind)}${a.badge('r/'+x.platformDetails.community,'blue')}</div><h2 class="detail-title" style="margin-top:8px">${e(a.recordTitle(x))}</h2><div class="meta-line">${e(x.author?.displayName||x.author?.externalId||t('未知作者','Unknown author'))} · ${a.date(x.publishedAt,true)}</div><div class="readtext expanded">${e(a.recordText(x))}</div>${b(u.longRead?t('紧凑视图','Compact text'):t('完整排版','Full typography'),'read-expand','file','class="btn small ghost"')}${x.media?.length?'<div class="detail-section"><h3>'+t('媒体附件元数据','Stored media metadata')+'</h3>'+x.media.map((m,i)=>b(t('查看媒体说明','Inspect media metadata')+' '+(i+1),'media-preview','file','data-index="'+i+'"')).join('')+'</div>':''}<div class="divider"></div>${note('仅展示已归档文本，不自动请求外部图片或视频链接；已删除、已移除与空正文状态分别标记。','Displays stored text only without fetching external media; removed, deleted and empty bodies remain distinct.')}`;
  if(u.detailTab==='observations')body=d.content.observations.map(o=>a.panel(o.provider,`<dl class="key-values"><dt>${t('源平台观测时间','Source observed at')}</dt><dd>${a.date(o.sourceObservedAt,true)}</dd><dt>${t('本系统取回时间','Fetched at')}</dt><dd>${a.date(o.fetchedAt,true)}</dd></dl><div class="metric-grid">${Object.entries(o.metrics).map(([key,v])=>'<div><small>'+e(key.replace('reddit.',''))+'</small><strong>'+(v===null?t('未知','Unknown'):e(v))+'</strong></div>').join('')}</div><details style="margin-top:10px"><summary class="mono muted">${t('查看原始观测记录','Inspect raw observation')}</summary>${json(o)}</details>`)).join('')+nav('observations','进入跨时间观测对比','Compare observation history');
  if(u.detailTab==='references')body=`${note('仅展示已入库的上下游关联节点（最多 20 条）；未入库的父帖保持缺失标记，不伪造完整讨论树。','Shows stored references only (up to 20); unstored parent nodes remain marked as absent.')}<div class="detail-section"><h3>${t('引用与父节点','References & parents')}</h3>${d.references.map(r=>r.content?b(a.recordTitle(r.content),'detail','file',`data-id="${r.content.id}"`):`<p>${a.badge(t('父帖未入库','Parent not stored'),'amber')} <span class="mono">${e(r.reference.externalId)}</span></p>`).join('')||note('无关联父节点。','No stored parent references.')}</div><div class="detail-section"><h3>${t('已入库回复','Stored replies')}</h3>${d.children.map(c=>b(a.recordTitle(c),'detail','file',`data-id="${c.id}"`)).join('')||note('无已入库回复。','No stored replies.')} ${d.relatedTruncated?a.badge(t('展示已截断','Truncated'),'amber'):''}</div>`;
  if(u.detailTab==='note')body=a.allowed('personal-session')?`<form data-form="note"><label class="field">${t('研究批注（上限 2000 字符）','Analyst note (max 2,000 chars)')}<textarea id="note-text" name="note" maxlength="2000" rows="8" data-input="note">${e(u.noteDraft)}</textarea></label><label class="check-label"><input type="checkbox" name="favorite" ${an?.favorite?'checked':''}>${t('加入重点收藏','Bookmark this record')}</label>${note('批注仅当前账户可见；若发生版本冲突，系统将保留当前草稿并提示重载。','Notes are private to your account; version conflicts preserve your draft before reloading.')}<div class="inline" style="margin-top:10px">${submit()}${b(t('重载最新版本','Reload latest revision'),'note-reload','refresh')}${an?b(t('删除批注','Delete note'),'note-delete','close'):''}</div><p id="note-feedback" role="status"></p></form>`:a.empty(t('需要个人账户会话','User session required'),t('机器调用身份不包含个人批注与收藏空间。','Machine identities do not have private notes or bookmarks.'));
  const inner=`<aside class="detail-drawer" role="${inlineSplit?'region':'dialog'}" ${inlineSplit?'':'aria-modal="true"'} aria-label="${t('证据详情与批注','Evidence detail & notes')}"><header class="drawer-head"><strong>${t('证据原文与观测详情','Primary Evidence & Observations')}</strong><div class="inline"><span class="mono faint">#${e(x.externalId)}</span>${a.ibtn(t('关闭','Close'),'detail-close','close')}</div></header><div class="tabs">${[['body','原文内容','Text'],['observations','观测快照','Observations'],['references','上下文关联','References'],['note','研究批注','Analyst Note']].map(([id,zh,en])=>`<button class="tab ${u.detailTab===id?'active':''}" data-action="detail-tab" data-tab="${id}">${t(zh,en)}</button>`).join('')}</div><div class="drawer-body">${body}</div></aside>`;
  return inlineSplit?inner:`<div class="drawer-backdrop">${inner}</div>`;
}
a.detailMarkup=()=>detailView(false);
const originalRender=a.render;a.render=function(){originalRender();if(u.detail&&u.page!=='explore'&&u.page!=='labels'&&!document.querySelector('.detail-drawer'))document.getElementById('root').insertAdjacentHTML('beforeend',detailView(false));};
a.onInput=el=>{if(el.dataset.input==='note'){u.noteDraft=el.value;u.noteDirty=true;}};
a.actions['media-preview']=el=>{const media=u.detail.content.media[Number(el.dataset.index)];a.dialog('media',['媒体附件元数据','Media Metadata'],()=>note('仅展示已保存的媒体类型与原始链接说明，不自动加载外部资源。','Displays stored media type and link metadata without loading external assets.')+json(media),()=>{});};
a.actions['read-expand']=()=>{u.longRead=!u.longRead;a.render();};
a.forms.note=async data=>{const d=u.detail;try{const r=await a.call('P07',{...params(d.content.id),body:{note:u.noteDraft,favorite:data.favorite==='on',expectedRevision:d.annotation?.revision||0}});d.annotation=r.annotation;u.noteDirty=false;document.getElementById('note-feedback').textContent=t('批注已保存。','Note saved.');}catch(err){document.getElementById('note-feedback').textContent=a.errorMessage(err.body);}};
a.actions['note-reload']=async()=>{const r=await a.call('P06',params(u.detail.content.id));u.detail.annotation=r.annotation;a.render();};
a.actions['note-delete']=()=>a.confirm(['删除研究批注','Delete analyst note'],['仅移除当前账户对该记录的批注与收藏，不影响原始样本。','Removes your private note and bookmark only; the record remains intact.'],async()=>{await a.call('P08',{...params(u.detail.content.id),body:{expectedRevision:u.detail.annotation.revision}});u.detail.annotation=null;u.noteDraft='';u.noteDirty=false;a.render();});
a.actions['query-save']=()=>{if(proposedScope()){a.toast('扩展筛选范围请直接创建版本化数据集。','Create a versioned dataset for extended filter scopes.');return;}a.dialog('save-query',['保存检索条件','Save Search Query'],()=>a.field(t('查询名称','Query name'),'name','', 'text','required')+submit(),async data=>{await a.call('P02',{body:{name:data.name,query:qargs(),expectedRevision:0}});a.closeDialog();a.toast('检索条件已保存。','Search query saved.');});};
a.actions.freeze=()=>{if(proposedScope()){a.actions['dataset-from-selection']();return;}a.dialog('freeze',['冻结研究样本快照','Freeze Sample Snapshot'],()=>note('将当前筛选命中的完整样本集合固化为不可变快照（上限 20,000 条 / 32MiB），用于后续复现与引用。','Freezes matching records into an immutable snapshot (up to 20,000 rows / 32MiB) for reproducible citation.')+a.field(t('快照名称','Snapshot name'),'name',t('数据库与存储故障排查样本','Database & storage issue cohort'),'text','required')+submit(),async data=>{await a.call('R02',{body:{name:data.name,query:qargs(),maxRows:20000}});a.closeDialog();a.navigate('research');u.tab.research='frozen';a.load();});};
a.actions['live-export']=()=>{if(proposedScope()){a.toast('当前扩展范围请通过数据集版本导出。','Export extended scopes via dataset versions.');return;}a.dialog('export',['导出当前检索结果','Export Search Results'],()=>a.select(t('导出格式','Format'),'format',[['json','JSON'],['csv','CSV']],'json')+a.field(t('单次导出行数上限（1–2000）','Row cap (1–2000)'),'maxItems',2000,'number','min="1" max="2000" required')+note('即时导出反映当前时刻的动态结果；如需长期固定分母，请使用“冻结当前样本”。','Live export reflects current dynamic matches; use "Freeze sample" for an immutable denominator.')+submit(),async data=>{const r=await a.call('C05',{query:{...qargs(),maxItems:Number(data.maxItems)}});a.exportFile('pulsescope-export.'+data.format,data.format==='csv'?a.csv(r):r,data.format);a.closeDialog();});};
a.actions['dataset-from-selection']=()=>a.dialog('new-dataset',['创建固定成员数据集','Create Fixed-Membership Dataset'],()=>a.field(t('数据集名称','Dataset name'),'name',t('硬件选品痛点专题集','Hardware pain-point cohort'),'text','required')+note('将已勾选记录（或当前筛选范围内的全部记录）保存为固定版本的数据集。','Saves selected records (or all records matching active filters) as a versioned dataset.')+submit(),async data=>{await a.call('N04',{body:{name:data.name,...(u.selected.size?{memberIds:[...u.selected]}:{query:qargs()})}});a.closeDialog();u.selected.clear();a.navigate('datasets');});
a.actions['labels-selection']=()=>{const selected=[...u.selected];a.navigate('labels');u.selected=new Set(selected);a.render();};

a.pages.analysis={
  head:()=>b(t('导出 JSON 载荷','Export JSON'),'agent-export-json','download')+b(t('导出 Markdown 简报','Export Brief'),'agent-export-md','file'),
  load:async()=>{const ds=await a.call('N03');const targetDs=u.analysisDataset||ds.datasets[0]?.id;const [r,digest]=await Promise.all([a.call('N12',{body:{datasetId:targetDs,dimensions:[u.dimension||'community'],metric:'reddit.score',unknownPolicy:'exclude-and-report'}}),a.call('N32',{body:{datasetId:targetDs,brands:['samsung','corsair','crucial','logitech'],maxEvidence:5}})]);return {...r,datasets:ds.datasets,digest};},
  render:()=>{
    const r=u.data,dg=r.digest,groups=r.groups||[];
    const distChartHtml=groups.length?a.registerChart('chart-analysis-dist',({isDark,textColor,gridLine,tooltipBg})=>({
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:tooltipBg,borderColor:gridLine,textStyle:{color:'#f3f4f6',fontSize:11.5}},
      grid:{top:12,left:105,right:36,bottom:20},
      xAxis:{type:'value',splitLine:{lineStyle:{color:gridLine,type:'dashed'}},axisLabel:{color:textColor,fontSize:10.5}},
      yAxis:{type:'category',inverse:true,data:groups.slice(0,10).map(g=>g.key),axisLabel:{color:textColor,fontSize:11.5},axisLine:{lineStyle:{color:gridLine}},axisTick:{show:false}},
      series:[{
        name:t('样本数','Records'),
        type:'bar',
        barMaxWidth:15,
        itemStyle:{color:isDark?'#6366f1':'#4f46e5',borderRadius:[0,2,2,0]},
        label:{show:true,position:'right',color:textColor,fontSize:11},
        data:groups.slice(0,10).map(g=>g.count)
      }]
    }),barChart(groups,(u.dimension||'community')==='community'?'drill-community':'aggregate-group'),params=>{if(params?.name&&(u.dimension||'community')==='community')a.navigate('explore',{datasetId:u.analysisDataset||r.datasets[0]?.id,community:params.name});}):a.empty(t('当前维度无分布数据','No distribution data'),t('当前场景或筛选下没有可聚合的样本记录。','No records available to aggregate in the current state.'));

    return `<div class="scopebar">${a.select(t('目标研究数据集','Dataset'),'dataset',r.datasets.map(x=>[x.id,l(x.name)]),u.analysisDataset||r.datasets[0]?.id,'data-change="analysis-dataset"')}${a.select(t('分组统计维度','Group by'),'dimension',[['community',t('所属社区','Community')],['day',t('发布日期 (UTC)','UTC Date')],['provider',t('来源渠道（可重叠）','Provider (overlapping)')],['purpose',t('抽样层级','Sampling tier')],['availability',t('内容状态','Availability')]],u.dimension||'community','data-change="analysis-dimension"')}${b(u.chartTable?t('切换为图表','View chart'):t('切换为表格','View table'),'chart-toggle','analysis')}</div><div class="stat-strip">${stat(t('数据集总样本数','Cohort Denominator'),r.denominator,t('固定版本成员','Pinned version'))}${stat(t('有效指标样本','Known Score'),r.metric.known,t('含有效得分','Valid score'))}${stat(t('缺失指标样本','Unknown Metric'),r.metric.unknown,t('不作补零处理','Never zero-filled'))}${stat(t('正文缺失样本','Missing Body'),r.missing.text,t('已移除或外链帖','Removed or link-only'))}</div>`+
    `<div class="columns"><div>${a.panel(t('样本维度分布','Sample Distribution'),u.chartTable?table([t('分组项','Group'),t('样本条数','Count')],groups.map(x=>`<tr><td>${e(x.key)}</td><td class="numeric">${x.count}</td></tr>`)):distChartHtml,`<small>${r.overlap?t('多渠道可重叠计数','Overlapping provider counts'):t('互斥分组计数','Mutually exclusive groups')}</small>`,t('当按社区分组时，点击任意条形可直接钻取对应社区的样本明细。','When grouped by community, click any bar to inspect matching records.'))}</div><div>${a.panel(t('结构化情报简报预览','Structured Intelligence Digest'),`<p class="mini-note" style="margin-top:0">${t('汇总当前数据集内的品牌提及热度、首要痛点维度与代表性主帖，支持一键导出为 Markdown 简报或标准 JSON 载荷。','Summarizes brand mention volume, primary pain points and top threads into exportable Markdown briefs or JSON payloads.')}</p><div class="badge-row" style="margin:8px 0 10px">${(dg?.brandSignals||[]).map(s=>a.badge(`${s.brand.toUpperCase()} · ${s.mentionCount} (${shortDimLabel(s.topPainPoint,u.lang)})`)).join('')}</div><pre class="json" data-agent-entity="digest-markdown">${e(dg?.markdownBrief||'')}</pre><details style="margin-top:10px"><summary class="mono muted">${t('查看结构化 JSON 载荷（含原始证据 ID）','Inspect structured JSON payload (with evidence IDs)')}</summary>${json(dg?.jsonPayload||{})}</details>`,`<small>${t('含可验证证据索引','With traceable evidence IDs')}</small>`)}</div></div>`;
  }
};
a.changes['analysis-dataset']=el=>{u.analysisDataset=el.value;a.load();};a.changes['analysis-dimension']=el=>{u.dimension=el.value;a.load();};a.actions['chart-toggle']=()=>{u.chartTable=!u.chartTable;a.render();};a.actions['aggregate-group']=()=>a.dialog('aggregate',['分组统计明细','Aggregate Breakdown'],()=>json(u.data),()=>{});
a.actions['agent-export-json']=()=>a.exportFile('intelligence-digest.json',u.data.digest?.jsonPayload||{});
a.actions['agent-export-md']=()=>a.exportFile('intelligence-brief.md',u.data.digest?.markdownBrief||'','csv');

a.pages.observations={head:()=>'',load:()=>a.call('N14',{body:{contentIds:a.fixtures.records.slice(0,5).map(x=>x.id),metric:u.observationMetric||'reddit.score'}}),render:()=>`<div class="scopebar">${a.select(t('对比指标','Metric'),'metric',[['reddit.score',t('社区得分 (Score)','Reddit score')],['reddit.num_comments',t('评论数 (Comments)','Comment count')]],u.observationMetric||'reddit.score','data-change="observation-metric"')}</div>${a.panel(t('多时间点观测快照与差值核对','Multi-Point Observation Snapshots & Delta Check'),table([t('内容标题','Content'),t('早期观测','Earlier'),t('近期观测','Later'),t('差值','Delta'),t('差值属性判定','Classification'),''],u.data.pairs.map((p,i)=>`<tr><td>${e(a.recordTitle(a.fixtures.records[i]))}</td><td class="mono">${p.from??'—'}<div class="cell-sub">${a.date(p.fromAt)}</div></td><td class="mono">${p.to??'—'}<div class="cell-sub">${a.date(p.toAt)}</div></td><td class="numeric">${p.delta??'—'}</td><td>${a.badge(p.comparable?t('跨时间指标变化','Cross-time difference'):p.reason==='same_snapshot_not_growth'?t('同一快照重取（非增长）','Same snapshot, not growth'):t('指标缺失','Unknown metric'),p.comparable?'teal':'amber')}</td><td>${b(t('时间线','Timeline'),'history','clock',`data-id="${p.contentId}"`)}</td></tr>`)), '',t('严格区分“上游源观测时间”与“本地取回时间”：对同一归档快照的重复导入不会计为互动增长。','Separates upstream source observation time from local fetch time; repeated archive imports are never counted as engagement growth.'))}`};
a.changes['observation-metric']=el=>{u.observationMetric=el.value;a.load();};a.actions.history=async el=>{const r=await a.call('N13',params(el.dataset.id));a.dialog('history',['观测快照时间线','Observation Timeline'],()=>r.observations.map(o=>`<div class="time-rail"><strong>${o.provider}</strong><p>${t('源观测时间','Source time')}: ${a.date(o.sourceObservedAt,true)}</p><p>${t('本地取回时间','Fetched')}: ${a.date(o.fetchedAt,true)}</p>${json(o.metrics)}</div>`).join('')+(r.conflicts.length?json(r.conflicts):''),()=>{});};
a.pages.datasets={head:()=>b(t('新建数据集','New dataset'),'dataset-from-selection','plus'),load:async()=>{const [d,r]=await Promise.all([a.call('N03'),a.call('N08')]);return {datasets:d.datasets,runs:r.runs};},render:()=>`${a.tabs('datasets',[['members','研究数据集','Research datasets'],['imports','归档导入记录','Import receipts']],u.tab.datasets||'members')}${(u.tab.datasets||'members')==='members'?a.panel(t('固定成员数据集与版本','Fixed-Membership Datasets & Versions'),table([t('数据集名称','Dataset'),t('样本数','Records'),t('当前版本','Version'),t('共享范围','Visibility'),''],u.data.datasets.map(d=>`<tr><td><strong>${e(l(d.name))}</strong><div class="cell-sub">${e(l(d.description))}</div></td><td class="numeric">${d.total}</td><td class="mono">v${d.version}</td><td>${a.badge(d.shared?t('项目共享','Shared'):t('仅自己可见','Private'))}</td><td>${b(t('检索成员','Explore'),'dataset-open','file',`data-id="${d.id}"`)}${b(t('血缘与版本','Lineage'),'dataset-lineage','code',`data-id="${d.id}"`)}${b(t('发布新版本','New version'),'dataset-version','plus',`data-id="${d.id}"`)}</td></tr>`))):a.panel(t('离线归档筛选导入与幂等回执','Registered Archive Imports & Idempotent Receipts'),`<div class="notice">${t('离线归档导入仅接受预先登记的受控文件标识与 SHA-256 校验，不支持通过前端上传任意本地路径。','Archive imports accept pre-registered file identifiers and SHA-256 checksums only; arbitrary file paths are rejected.')}</div><div class="inline" style="margin-bottom:12px">${b(t('预检已登记归档集','Preview registered archive'),'import-preview','file')}${b(t('模拟 CLI dry-run','Simulate CLI dry run'),'cli-preview','code')}</div>`+table([t('导入批次','Run'),t('状态','Status'),t('入库条数','Committed'),''],u.data.runs.map(r=>`<tr><td>${e(r.name)}</td><td>${a.status(r.status)}</td><td class="numeric">${r.recordsCommitted}</td><td>${b(t('查看回执','Receipt'),'import-receipt','file',`data-id="${r.id}"`)}</td></tr>`)))}`};
a.actions['dataset-open']=el=>a.navigate('explore',{datasetId:el.dataset.id});a.actions['dataset-lineage']=async el=>{const r=await a.call('N05',params(el.dataset.id));a.dialog('lineage',['数据集血缘与版本详情','Dataset Lineage & Version'],()=>json(r),()=>{});};
a.actions['dataset-version']=async el=>{const {dataset:d}=await a.call('N05',params(el.dataset.id));a.dialog('version',['发布数据集新版本','Publish New Dataset Version'],()=>a.field(t('版本变更说明','Change reason'),'reason',t('收敛至前 12 条核心样本以验证版本复现','Narrow to first 12 core records to verify version reproducibility'),'text','required')+note('新版本将固定选定成员列表；历史版本仍可按版本号读取，确保过往分析报告的分母不变。','Publishes a new pinned membership version while preserving historical versions for reproducibility.')+submit(),async data=>{await a.call('N07',{...params(d.id),body:{expectedRevision:d.revision,memberIds:d.memberIds.slice(0,12),reason:data.reason}});a.closeDialog();a.load();});};
a.actions['import-preview']=async()=>{const r=await a.call('N10',a.defaultArgs('N10'));a.dialog('import-apply',['归档导入预检结果','Archive Import Preflight'],()=>json(r)+note('幂等重放校验：60 条既有样本将更新观测回执，不会产生重复内容身份。','Idempotent replay check: 60 existing records will reconcile without creating duplicate identities.')+submit(),async()=>{await a.call('N11',{params:{id:r.previewId},body:{expectedSha256:'a'.repeat(64),confirmEvaluationScope:true}});a.closeDialog();a.load();});};
a.actions['import-receipt']=async el=>{const r=await a.call('N09',params(el.dataset.id));a.dialog('receipt',['归档导入回执','Import Receipt'],()=>json(r),()=>{});};a.actions['cli-preview']=async()=>{const r=await a.call('CLI01',{body:{apply:false,replay:true}});a.dialog('cli',['CLI 导入预检模拟','CLI Preflight Simulation'],()=>json(r),()=>{});};

a.pages.compare={
  head:()=>nav('explore','进入分栏证据阅读器','Open Split-Pane Reader'),
  load:async()=>{const [d,mx]=await Promise.all([a.call('N03'),a.call('N31',{body:{datasetId:u.leftDataset||a.fixtures.datasets[0].id}})]);return {datasets:d.datasets,mx,...(u.comparisonId?await a.call('N19',params(u.comparisonId)):{})};},
  render:()=>{
    const d=u.data,c=d.comparison,mx=d.mx,dims=a.fixtures.dimensions||[],brands=mx?.brands||[];
    const heatData=[];
    let maxCell=1;
    brands.forEach((br,bi)=>{
      dims.forEach((dm,di)=>{
        const cnt=mx?.matrix?.[br]?.byDimension?.[dm.id]?.count||0;
        if(cnt>maxCell)maxCell=cnt;
        heatData.push([di,bi,cnt]);
      });
    });

    const heatmapChartHtml=a.registerChart('chart-compare-heatmap',({isDark,textColor,gridLine,tooltipBg})=>({
      tooltip:{position:'top',backgroundColor:tooltipBg,borderColor:gridLine,textStyle:{color:'#f3f4f6',fontSize:11.5},formatter:p=>{
        const br=brands[p.value[1]],dm=dims[p.value[0]];
        const avg=mx?.matrix?.[br]?.byDimension?.[dm?.id]?.avgMetric;
        return `<strong>${br?.toUpperCase()} · ${shortDimLabel(dm?.id,u.lang)}</strong><br/>${t('讨论样本','Records')}: ${p.value[2]} ${t('条','posts')}<br/>${t('平均互动分','Avg Score')}: ${avg??'—'}`;
      }},
      grid:{top:10,left:76,right:16,bottom:42},
      xAxis:{type:'category',data:dims.map(dm=>shortDimLabel(dm.id,u.lang)),splitArea:{show:false},axisLabel:{color:textColor,fontSize:11},axisLine:{lineStyle:{color:gridLine}},axisTick:{show:false}},
      yAxis:{type:'category',inverse:true,data:brands.map(br=>br.toUpperCase()),splitArea:{show:false},axisLabel:{color:textColor,fontSize:11,fontWeight:600},axisLine:{lineStyle:{color:gridLine}},axisTick:{show:false}},
      visualMap:{min:0,max:maxCell,calculable:false,orient:'horizontal',left:'center',bottom:0,itemWidth:10,itemHeight:72,text:[t('高浓度','High'),t('低','Low')],textStyle:{color:textColor,fontSize:10.5},inRange:{color:isDark?['#18181b','#27272a','#4338ca','#6366f1']:['#f4f4f5','#e0e7ff','#818cf8','#4f46e5']}},
      series:[{
        name:t('讨论浓度','Mention Density'),
        type:'heatmap',
        data:heatData,
        label:{show:true,color:isDark?'#fafafa':'#09090b',fontWeight:600,fontSize:11.5},
        itemStyle:{borderColor:isDark?'#121215':'#ffffff',borderWidth:2,borderRadius:3}
      }]
    }),barChart(brands.map(br=>({key:br.toUpperCase(),count:mx?.matrix?.[br]?.total||0})),'drill-brand'),params=>{
      if(Array.isArray(params?.value)){
        const dm=dims[params.value[0]]?.id,br=brands[params.value[1]];
        if(br&&dm)a.navigate('explore',{brand:br,dimension:dm});
      }
    });

    const dimColors=['#4f46e5','#71717a','#0d9488','#d97706'];
    const profileChartHtml=a.registerChart('chart-compare-profile',({isDark,textColor,gridLine,tooltipBg})=>({
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:tooltipBg,borderColor:gridLine,textStyle:{color:'#f3f4f6',fontSize:11.5}},
      legend:{data:[...dims.map(dm=>shortDimLabel(dm.id,u.lang)),t('平均互动得分','Avg Score')],top:0,right:4,itemWidth:8,itemHeight:8,textStyle:{color:textColor,fontSize:10.5}},
      grid:{top:30,left:36,right:38,bottom:22},
      xAxis:{type:'category',data:brands.map(b=>b.toUpperCase()),axisLabel:{color:textColor,fontSize:11,fontWeight:600},axisLine:{lineStyle:{color:gridLine}},axisTick:{show:false}},
      yAxis:[
        {type:'value',name:t('条数','Posts'),nameTextStyle:{color:textColor,fontSize:10.5},splitLine:{lineStyle:{color:gridLine,type:'dashed'}},axisLabel:{color:textColor,fontSize:10.5}},
        {type:'value',name:t('均分','Avg'),nameTextStyle:{color:textColor,fontSize:10.5},splitLine:{show:false},axisLabel:{color:textColor,fontSize:10.5}}
      ],
      series:[
        ...dims.map((dm,idx)=>({
          name:shortDimLabel(dm.id,u.lang),
          type:'bar',
          stack:'brand_dims',
          barMaxWidth:20,
          itemStyle:{color:dimColors[idx%dimColors.length]},
          data:brands.map(br=>mx?.matrix?.[br]?.byDimension?.[dm.id]?.count||0)
        })),
        {
          name:t('平均互动得分','Avg Score'),
          type:'line',
          yAxisIndex:1,
          smooth:true,
          symbol:'circle',
          symbolSize:5,
          itemStyle:{color:isDark?'#14b8a6':'#0d9488'},
          lineStyle:{width:2,color:isDark?'#14b8a6':'#0d9488'},
          data:brands.map(br=>mx?.matrix?.[br]?.avgMetric??0)
        }
      ]
    }),barChart(dims.map(dm=>({key:shortDimLabel(dm.id,u.lang),count:brands.reduce((acc,br)=>acc+(mx?.matrix?.[br]?.byDimension?.[dm.id]?.count||0),0)})),'drill-brand'),params=>{
      if(params?.name)a.navigate('explore',{brand:params.name.toLowerCase()});
    });

    return a.panel(t('品牌 × 痛点维度代表性证据矩阵（主交互区：点击任意单元格直接穿透至分栏原文阅读器）','Primary Evidence Matrix by Brand & Pain-Point (Click any cell to open matching threads in Split-Pane Reader)'),renderCompactMatrix(mx,dims,brands,6)+note('每个单元格展示该品牌在对应痛点维度下的样本条数、平均互动分 (μ) 及最高分代表帖标题；点击直接进入分栏阅读工作台。','Each cell shows record count, mean score (μ) and top thread title; click to inspect matching threads in the Split-Pane Reader.'))+
    `<div class="echart-row">${a.panel(t('品牌 × 痛点维度讨论浓度热力图','Brand × Pain-Point Concentration Heatmap'),heatmapChartHtml,`<small>${t('点击热力块筛选对应证据','Click cell to filter evidence')}</small>`)}${a.panel(t('各品牌痛点结构与平均互动强度对比','Brand Pain-Point Structure & Average Engagement'),profileChartHtml,`<small>${t('堆叠柱：痛点条数 · 折线：平均得分','Bars: Mentions · Line: Avg Score')}</small>`)}</div>`+
    `<form data-form="compare" style="margin-top:16px"><div class="scopebar">${a.select(t('对比范围 A','Scope A'),'left',d.datasets.map(x=>[x.id,l(x.name)]),u.leftDataset||d.datasets[0]?.id)}${ic('compare')}${a.select(t('对比范围 B','Scope B'),'right',d.datasets.map(x=>[x.id,l(x.name)]),u.rightDataset||d.datasets[1]?.id)}<button class="btn primary" type="submit">${t('计算集合交并差','Compute Set Overlap')}</button>${b(t('互换范围','Swap'),'compare-swap','refresh')}</div></form>${c?`<div class="stat-strip">${stat(t('范围 A 样本数','Scope A Total'),c.leftTotal)}${stat(t('范围 B 样本数','Scope B Total'),c.rightTotal)}${stat(t('共同包含 (A ∩ B)','Intersection (A ∩ B)'),c.intersection)}${stat(t('合并去重 (A ∪ B)','Union (A ∪ B)'),c.union)}</div>${a.panel(t('数据集集合交并差结果','Dataset Scope Overlap & Differences'),`<div class="comparison-set"><div class="set-left"><strong>${t('仅在 A 中 (A − B)','Only in A (A − B)')}</strong><b>${c.leftOnly}</b></div><div class="set-intersection"><strong>${t('共同样本 (A ∩ B)','Shared (A ∩ B)')}</strong><b>${c.intersection}</b></div><div class="set-right"><strong>${t('仅在 B 中 (B − A)','Only in B (B − A)')}</strong><b>${c.rightOnly}</b></div></div>`+note('集合交并差严格按规范化内容身份（platform + kind + externalId）去重计算，不受重复观测快照影响。','Intersections and differences are computed over canonical content identities rather than observation count.'),b(t('导出对比结果','Export comparison'),'compare-download','download'))}`:a.panel(t('数据集范围集合对比','Dataset Scope Overlap Comparison'),a.empty(t('尚未执行集合交并差计算','No scope comparison run yet'),t('选择上方两个数据集并点击“计算集合交并差”，可核对不同专题集或时间窗之间的重合样本与独有样本。','Select two datasets above and click "Compute Set Overlap" to inspect shared and unique records.')))}`;
  }
};
a.forms.compare=async d=>{u.leftDataset=d.left;u.rightDataset=d.right;const r=await a.call('N18',{body:{left:{datasetId:d.left},right:{datasetId:d.right},operation:'intersection'}});u.comparisonId=r.comparisonId;a.load();};a.actions['compare-swap']=()=>{const temp=u.leftDataset||u.data.datasets[0]?.id;u.leftDataset=u.rightDataset||u.data.datasets[1]?.id;u.rightDataset=temp;a.render();};a.actions['compare-download']=()=>a.exportFile('scope-comparison.json',u.data.comparison);

a.pages.labels={
  head:()=>b(t('新建编码标签','New label'),'label-new','plus'),
  load:async()=>{const [r,c]=await Promise.all([a.call('N15'),a.call('C01',{query:{limit:12}})]);return {...r,items:c.items};},
  render:()=>{
    const readerPaneHtml=u.detail?detailView(true):inlinePreviewMarkup(u.data.items?.[0]);
    return `<div class="scopebar"><div class="badge-row"><strong>${t('编码体系','Codebook')}:</strong>${u.data.labels.map(x=>`<span class="chip"><strong>${e(l(x.name))}</strong> · <span class="faint">${e(l(x.definition))}</span></span>`).join('')}</div><div class="inline">${a.select(t('选择标签','Select label'),'label',u.data.labels.map(x=>[x.id,l(x.name)]),u.labelId||u.data.labels[0]?.id,'data-change="label-id"')}${b(t('对已选赋码','Apply label'),'labels-apply','labels')}${b(t('移除标签','Remove label'),'labels-remove','close')}<span class="mono faint">${u.selected.size} ${t('已选','sel')}</span></div></div>`+
    (u.labelResult?`<div class="notice">${t('已更新','Updated')}: ${u.labelResult.updated.length} · ${t('版本冲突','Conflicts')}: ${u.labelResult.conflicts.length} <details style="margin-left:auto"><summary class="mono">${t('查看回执','Receipt')}</summary>${json(u.labelResult)}</details></div>`:'')+
    `<div class="workbench-split"><div class="workbench-list-pane"><div class="tabletools"><span>${t('待编码研究样本（勾选后批量赋码，点击标题在右侧审阅原文）','Records for Coding (Select to batch-code, click title to read on right)')}</span><span class="mono faint"><kbd class="kbd">J</kbd>/<kbd class="kbd">K</kbd></span></div><div class="workbench-list-scroll">${recordTable(u.data.items)}</div></div><div class="workbench-reader-pane">${readerPaneHtml}</div></div>`;
  }
};
a.changes['label-id']=el=>{u.labelId=el.value;};a.actions['label-new']=()=>a.dialog('label',['新建研究编码标签','Create Coding Label'],()=>a.field(t('标签名称','Label name'),'name','','text','required')+a.field(t('判定标准说明','Coding definition'),'definition')+submit(),async d=>{await a.call('N16',{body:{...d,color:'teal'}});a.closeDialog();a.load();});
async function applyLabel(remove){if(!u.selected.size){a.toast('请先勾选至少一条样本记录。','Select at least one record first.');return;}const id=u.labelId||u.data.labels[0].id;u.labelResult=await a.call('N17',{body:{contentIds:[...u.selected],add:remove?[]:[id],remove:remove?[id]:[],expectedRevisions:Object.fromEntries([...u.selected].map(id=>[id,u.data.revisions[id]||0]))}});a.load();}a.actions['labels-apply']=()=>applyLabel(false);a.actions['labels-remove']=()=>applyLabel(true);
a.pages.research={head:()=>nav('explore','返回分栏检索','Back to Split-Pane Search'),load:async()=>{const tab=u.tab.research||'queries';return tab==='queries'?await a.call('P01'):tab==='notes'?await a.call('P05'):await a.call('R01');},render:()=>{const tab=u.tab.research||'queries',d=u.data;return a.tabs('research',[['queries','已保存检索条件','Saved Queries'],['notes','研究批注与收藏','Notes & Bookmarks'],['frozen','不可变冻结快照','Frozen Snapshots']],tab)+(tab==='queries'?a.panel(t('动态检索条件（重新打开时按最新样本库计算）','Saved Filter Definitions (Evaluated dynamically on reopen)'),table([t('名称','Name'),t('修订版','Rev'),t('过滤参数','Filter Parameters'),''],d.queries.map(x=>`<tr><td><strong>${e(l(x.name))}</strong></td><td class="mono">v${x.revision}</td><td><code class="mono">${e(JSON.stringify(x.query))}</code></td><td>${b(t('应用筛选','Apply'),'query-open','arrow',`data-id="${x.id}"`)}${b(t('重命名','Rename'),'query-edit','file',`data-id="${x.id}"`)}${b(t('删除','Delete'),'query-delete','close',`data-id="${x.id}"`)}</td></tr>`))):tab==='notes'?a.panel(t('个人研究批注与重点收藏','Private Analyst Notes & Bookmarks'),table([t('关联内容','Record'),t('批注内容','Note'),t('修订版','Rev'),''],d.items.map(x=>`<tr><td>${e(a.recordTitle(x.content))} ${x.annotation.favorite?ic('star'):''}</td><td>${e(x.annotation.note)}</td><td class="mono">v${x.annotation.revision}</td><td>${b(t('查看与编辑','Inspect & edit'),'detail','file',`data-id="${x.content.id}"`)}</td></tr>`))):a.panel(t('不可变冻结样本快照（固定成员与来源清单）','Immutable Frozen Snapshots (Fixed membership & manifest)'),table([t('快照名称','Snapshot Name'),t('固定样本数','Frozen Count'),t('创建时间','Created At'),''],d.exports.map(x=>`<tr><td><strong>${e(l(x.name))}</strong></td><td class="numeric">${x.total}</td><td class="mono">${a.date(x.createdAt,true)}</td><td>${b(t('元数据清单','Manifest'),'frozen-manifest','code',`data-id="${x.id}"`)}${b(t('查看成员','Members'),'frozen-page','file',`data-id="${x.id}"`)}${b(t('导出文件','Download'),'frozen-download','download',`data-id="${x.id}"`)}${b(t('删除','Delete'),'frozen-delete','close',`data-id="${x.id}"`)}</td></tr>`))));}};
a.actions['query-open']=el=>{const q=u.data.queries.find(x=>x.id===el.dataset.id);a.navigate('explore',q.query);};a.actions['query-edit']=el=>{const q=u.data.queries.find(x=>x.id===el.dataset.id);a.dialog('rename',['重命名检索条件','Rename Saved Query'],()=>a.field(t('名称','Name'),'name',l(q.name),'text','required')+submit(),async d=>{await a.call('P03',{...params(q.id),body:{name:d.name,query:q.query,expectedRevision:q.revision}});a.closeDialog();a.load();});};a.actions['query-delete']=el=>{const q=u.data.queries.find(x=>x.id===el.dataset.id);a.confirm(['删除已保存检索条件','Delete saved query'],['仅删除该快捷筛选条件，不影响任何样本数据或冻结快照。','Deletes the saved filter definition only; records and snapshots remain untouched.'],async()=>{await a.call('P04',{...params(q.id),body:{expectedRevision:q.revision}});a.load();});};
a.actions['frozen-manifest']=async el=>{const r=await a.call('R03',params(el.dataset.id));a.dialog('manifest',['冻结快照元数据清单','Frozen Snapshot Manifest'],()=>json(r.researchExport.manifest),()=>{});};a.actions['frozen-page']=async el=>{const r=await a.call('R05',{...params(el.dataset.id),query:{limit:100}});a.dialog('members',['冻结快照成员列表','Frozen Snapshot Members'],()=>recordTable(r.items,false)+note('冻结快照内的记录内容与指标在创建时刻已固化，不受后续增量更新影响。','Frozen snapshot members and metrics are immutable as of creation time.'),()=>{},'wide');};a.actions['frozen-download']=el=>a.dialog('frozen-download',['导出冻结快照文件','Download Frozen Snapshot'],()=>a.select(t('文件格式','Format'),'format',[['json','JSON'],['csv','CSV']],'json')+note('导出文件包含完整的快照元数据清单（Manifest）与全部固化成员。','Includes the complete provenance manifest and all frozen member records.')+submit(),async d=>{const r=await a.call('R06',{...params(el.dataset.id),query:{limit:100,format:d.format}});a.exportFile('frozen-snapshot.'+d.format,d.format==='csv'?a.csv(r):r,d.format);a.closeDialog();});a.actions['frozen-delete']=el=>a.confirm(['删除冻结快照','Delete frozen snapshot'],['仅移除该快照副本，不会删除公共样本库中的原始记录。','Removes this snapshot copy only; shared repository records remain intact.'],async()=>{await a.call('R04',params(el.dataset.id));a.load();});
})();
