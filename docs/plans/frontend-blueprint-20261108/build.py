"""Build the offline design package. Run from any cwd; no third-party packages."""
from pathlib import Path
import json, hashlib, html, textwrap
BASE=Path(__file__).resolve().parent
CAT=json.loads((BASE/'data/catalog.json').read_text(encoding='utf-8'))
esc=lambda x:html.escape(str(x))
def write(path,text):
    p=BASE/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8',newline='\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def script(text):return '<script>'+text.replace('</script','<\\/script')+'</script>'
def shell(title,body,css='',js=''):
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' https://cdn.jsdelivr.net; style-src \'unsafe-inline\'; img-src data: blob:; font-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>'+esc(title)+'</title><style>'+css+'</style><script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script></head><body>'+body+script(js)+'</body></html>'
css='\n'.join((BASE/'prototype'/f).read_text(encoding='utf-8') for f in ['styles.css','pages.css'])
js='window.BLUEPRINT_CATALOG='+json.dumps(CAT,ensure_ascii=False)+';\n'+'\n'.join((BASE/'prototype'/f).read_text(encoding='utf-8') for f in ['fixtures.js','mock-api.js','app.js','research-pages.js','operations-pages.js'])+'\nBlueprintApp.start();'
write('prototype/index.html','<!-- PulseScope · Cross-Border Product Intelligence & Agent Radar Platform. -->\n'+shell('PulseScope · 跨境产品舆情与 Agent 情报平台','<div id="root"></div><div id="console-root"></div><div class="toast-container" id="toasts" aria-live="polite"></div><dialog id="dialog" class="dialog"></dialog>',css,js))

STYLE='''*{box-sizing:border-box}body{margin:0;background:#f4f6f7;color:#202f38;font:14px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}header,main{max-width:1240px;margin:auto;padding:30px}header{border-bottom:1px solid #d9e0e3}h1{font-size:30px;letter-spacing:-1px;margin:15px 0}h2{font-size:20px}p{color:#5d6e78}a{color:#08665b}button,input,select{font:inherit;padding:9px 12px;border:1px solid #cad4d8;border-radius:5px;background:inherit;color:inherit}button{cursor:pointer}nav{display:flex;gap:15px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:320px 1fr;gap:25px}.card{padding:24px;border:1px solid #d9e0e3;border-radius:8px;background:#fff;margin:16px 0}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}.cards .card{margin:0}.badge{font-size:11px;border:1px solid #9cbab5;color:#08665b;border-radius:4px;padding:3px 7px}#list{display:grid;gap:7px;max-height:75vh;overflow:auto}#list button{text-align:left;background:#fff}#list button.active{border-color:#08665b;background:#e6f1ed}svg{width:100%;height:auto;display:block}pre{font:11px/1.8 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:#edf1f3}table{width:100%;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #d9e0e3;text-align:left}small{color:#5d6e78}body.dark{background:#121c22;color:#e0eaed}.dark .card,.dark #list button{background:#1b2930;border-color:#34464f}.dark p,.dark small{color:#a2b4bf}.dark a{color:#78d9c4}.dark #list button.active{background:#24453f;border-color:#78d9c4}.dark pre{background:#142229}.dark .badge{color:#78d9c4}a:focus-visible,button:focus-visible{outline:2px solid #178576;outline-offset:3px}@media(max-width:800px){.grid,.cards{grid-template-columns:1fr}header,main{padding:20px}#list{max-height:250px}}'''

def feature_svg(f,lang='zh'):
    eps=[x for x in CAT['endpoints'] if x['id'] in f['apis']]
    rows=[('UI',f['name'][lang]),('ACCESS',', '.join(sorted(set(x['access'] for x in eps))) or 'client-local'),('INTERFACES',', '.join(x['id'] for x in eps)),('APPLICATION',f['service']),('STORAGE',', '.join(f['tables']))]
    def wrapped(s,width=49):return textwrap.wrap(s,width=width) or ['—']
    out=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 590" role="img" aria-label="'+esc(f['id']+' dependency map')+'"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8" fill="#397d73"/></marker></defs><rect width="1000" height="590" rx="12" fill="#f5f8f8"/><text x="35" y="38" font-family="sans-serif" font-size="20" fill="#173f39">'+esc(f['id']+' · '+f['name'][lang])+'</text>']
    for i,(label,value) in enumerate(rows):
        y=66+i*94
        if i:out.append(f'<path d="M500 {y-22} V{y-4}" stroke="#397d73" stroke-width="2" marker-end="url(#arrow)"/>')
        lines=wrapped(value)
        out.append(f'<rect x="100" y="{y}" width="800" height="72" rx="6" fill="white" stroke="#8caaa4" '+('stroke-dasharray="5 4"' if f['status']=='proposed' else '')+'/>')
        out.append(f'<text x="122" y="{y+23}" font-family="sans-serif" font-size="11" fill="#55776f">{label}</text>')
        for j,line in enumerate(lines[:2]):out.append(f'<text x="285" y="{y+29+j*23}" font-family="sans-serif" font-size="14" fill="#183f38">{esc(line)}</text>')
    out.append('<text x="35" y="567" font-family="sans-serif" font-size="12" fill="#55776f">'+esc('Dependencies: '+(', '.join(f['dependencies']) or 'none')+' | '+f['priority']+' / '+f['status']+' | full contracts in catalog.json')+'</text></svg>')
    return ''.join(out)
for f in CAT['features']:write('diagrams/features/'+f['id']+'.svg',feature_svg(f))
flows={
 'search-freeze':[('User filters','ContentQuery / stored scope'),('GET C01 + C02','same filters / cursor binding'),('C04 detail + P07 note','stored evidence / private revision'),('POST R02','complete sample / caps / transaction'),('R03 + R05 + R06','manifest / immutable members / download')],
 'collection-merge':[('S02 source + J01 job','capability / auth / bounded window'),('Worker claims lease','provider budget / checkpoint'),('Connector normalizes','platform + kind + external ID'),('Shared write transaction','content / discovery / observation / search projection'),('Commit page then progress','partial is not exhausted / replay idempotent')],
 'access-control':[('Actor identity','session human / machine bearer / local operator'),('Global access policy','public read / ops write / admin session'),('Personal ownership','queries / notes / frozen exports'),('Proposed project role','reader / editor / manager; no global bypass'),('Guarded revision write','409 draft retained / last owner protected')],
 'job-lifecycle':[('queued → running','claim lease / bounded requests'),('page committed','checkpoint + identity dedup'),('queued / retrying','transient error / delay / budget guard'),('succeeded / failed / cancelled','exhausted differs from max-page stop'),('continue / recovery preview','current J05; proposed N20 → N21 bounded children')]
}
for key,rows in flows.items():
    f={'id':key,'name':{'zh':key,'en':key},'apis':[],'service':'','tables':[],'dependencies':[],'status':'implemented','priority':'flow'}
    f['name']['en']={'search-freeze':'Stored search to reproducible evidence','collection-merge':'Collection, identity merge and committed progress','access-control':'Actor, resource and revision guards','job-lifecycle':'Bounded collection and explicit recovery'}[key]
    svg=feature_svg(f,'en')
    # Reuse identical, verified node geometry; replace only the five row labels.
    old=[('UI',key),('ACCESS','client-local'),('INTERFACES',''),('APPLICATION',''),('STORAGE','')]
    for (label,value),(n,v) in zip(old,rows):
        svg=svg.replace('>'+label+'</text>','>'+esc(n)+'</text>',1)
        target=esc(value) if value else '—';svg=svg.replace('>'+target+'</text>','>'+esc(v)+'</text>',1)
    write('diagrams/'+key+'.svg',svg)
atlas_js='const SVGS='+json.dumps({f['id']:{lang:feature_svg(f,lang) for lang in ['zh','en']} for f in CAT['features']},ensure_ascii=False)+';const C='+json.dumps(CAT,ensure_ascii=False)+''';let lang='zh',selected='F01';const E=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function render(){document.documentElement.lang=lang==='zh'?'zh-CN':'en';const q=document.querySelector('#search').value.toLowerCase(),p=document.querySelector('#priority').value;document.querySelector('#list').innerHTML=C.features.filter(f=>(!p||f.priority===p)&&(f.id+' '+f.name.zh+' '+f.name.en+' '+f.apis.join(' ')).toLowerCase().includes(q)).map(f=>'<button data-id="'+f.id+'" class="'+(selected===f.id?'active':'')+'">'+f.id+' · '+E(f.name[lang])+'<br><small>'+f.priority+' / '+f.status+'</small></button>').join('');const f=C.features.find(x=>x.id===selected),apis=C.endpoints.filter(x=>f.apis.includes(x.id));document.querySelector('#detail').innerHTML='<span class="badge">'+f.priority+' / '+f.status+'</span><h2>'+E(f.name[lang])+'</h2>'+SVGS[f.id][lang]+'<p>'+E(f.note)+'</p><p>Dependencies: '+E(f.dependencies.join(', ')||'none')+'</p><p>'+E(f.service)+' → '+E(f.tables.join(', '))+'</p>'+apis.map(x=>'<details class="card"><summary>'+x.id+' · '+x.method+' '+E(x.path)+'</summary><p>'+x.status+' · '+x.access+'</p><pre>'+E(JSON.stringify(x,null,2))+'</pre></details>').join('')+'<p><a href="features/'+f.id+'.svg" download>SVG ↓</a> · <a href="../prototype/index.html#'+f.page+'">'+(lang==='zh'?'打开对应原型页面':'Open prototype page')+'</a></p>';}document.addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b){selected=b.dataset.id;render();}if(e.target.id==='theme')document.body.classList.toggle('dark');if(e.target.id==='language'){lang=lang==='zh'?'en':'zh';render();}});document.querySelector('#search').addEventListener('input',render);document.querySelector('#priority').addEventListener('change',render);render();'''
write('diagrams/index.html',shell('功能依赖图集 · Feature dependency atlas','<header><nav><a href="../index.html">设计包 / Package</a><a href="system.html">总体架构 / System</a><button id="language">中 / EN</button><button id="theme">浅 / 深 · Light / Dark</button></nav><h1>功能依赖图集 · Dependency atlas</h1><p>39个功能组 · 实线为当前映射，虚线为拟新增契约。旧模型单独标注。 / Existing, legacy and proposed contracts remain distinct.</p><nav>'+''.join(f'<a href="{k}.svg">{k}</a>' for k in flows)+'</nav></header><main class="grid"><aside><input id="search" placeholder="搜索功能 / Find feature" aria-label="Find feature"><select id="priority" aria-label="Priority"><option value="">全部 / All</option>'+''.join(f'<option>{p}</option>' for p in ['current','P0','P1','P2'])+'</select><div id="list"></div></aside><section id="detail"></section></main>',STYLE,atlas_js))
write('index.html',shell('前端重构与功能扩展蓝本','<header><span class="badge">DESIGN PACKAGE · 2026-11-08 baseline / 2026-11-09 review</span><h1>信息研究工作台：前端与接口蓝本</h1><p>Research-first workspace · 39功能组 / 111接口 / 14工作区 / 15场景</p><nav><button onclick="document.body.classList.toggle(\'dark\')">浅色 / 深色</button><a href="README.md">核心说明</a><a href="INTERFACES.md">接口核对</a><a href="DESIGN.md">设计说明</a><a href="ACCEPTANCE.md">验证与使用</a></nav></header><main><div class="cards"><section class="card"><span class="badge">01 · INTERACTIVE</span><h2>交互前端原型</h2><p>合成数据、模拟账户、版本冲突、预算边界、主题与语言切换。独立设计演示，未连接真实服务。</p><a href="prototype/index.html">进入工作台 →</a></section><section class="card"><span class="badge">02 · DEPENDENCIES</span><h2>功能与接口图集</h2><p>按功能、优先级浏览UI、权限、接口、服务和存储依赖。提供39份SVG和关键流程。</p><a href="diagrams/index.html">浏览依赖图集 →</a></section><section class="card"><span class="badge">03 · ARCHITECTURE</span><h2>整体运行框架</h2><p>浏览器、API、worker、connector、PostgreSQL与归档CLI的职责及调用边界。</p><a href="diagrams/system.html">查看运行架构 →</a></section></div><section class="card"><h2>先确认事实，再讨论方案</h2><p>当前工作树 + 既有接口为实现证据；P0/P1/P2为设计建议。未合入分支成果单列。原型工作集只有60条合成内容，不代表当前数据库全量或性能验收。</p><p>在原型右下角打开“演示控制台”，可切换身份/账户状态/系统场景，执行模拟接口并查看请求记录。原型不会导入数据、发送邮件、发起外部采集或修改真实账户。</p><a href="data/catalog.json">机器可读目录 catalog.json</a></section></main>',STYLE))

# Full authored inventory: generated from one canonical feature/interface map.
md=['# 接口核对与设计目录','', '本文件由 build.py 从 data/catalog.json 生成。existing/legacy 路由的行号、摘录和源码摘要可供复查；proposed 只是契约建议。模拟器返回用于交互设计，不替代 TypeScript DTO 或线上兼容性测试。','', '## 身份与返回约定','', '`authenticated` = 有效会话或bearer；`personal-session` = 当前人类用户私有；`ops-write` = owner/admin/授权machine；`admin-session` = owner/admin会话；`owner-guarded` = 还需执行账户目标保护；`local-operator` = 独立本地操作员；project-* = P2独立项目权限。','', '正常：列表/详情200，创建通常201，入队202；400输入/游标，401会话，403权限，404不可见对象，409修订冲突/守卫，413样本上限，422上游超时，429限流，503不可用。不同现有路由的错误封装不完全统一，不把模拟器统一封装当作现有实现。','', '## 请求链示例','', '检索 C01/C02 → C04 → P06/P07（expectedRevision）→ R02 → R03/R05/R06；采集 S01能力 → J01 → worker → J03/J07；研究数据集 N03/N05/N06 → N12/N18（拟新增）。每个接口可在原型“模拟接口”选项卡编辑JSON请求并观察返回与错误。','']
for x in CAT['endpoints']:
    md += [f"## {x['id']} · {x['method']} {x['path']}",'',f"- 状态：`{x['status']}`；权限：`{x['access']}`；功能：{', '.join(x['features'])}。",f"- 请求：`{x['request']}`。",f"- 返回：`{x['response']}`。"]
    ev=x.get('evidence')
    if ev:md += [f"- 源码：[定位]({Path('../../..',ev['file']).as_posix()}#L{ev['line']})；核对行 {ev['line']}；SHA256 `{ev['sha256']}`。",'','```text',ev['excerpt'],'```']
    else:md += ['- 设计契约：尚无正式路由；实施前补 DTO、迁移、权限、索引及集成验证。']
    if x.get('notes'):md += ['',x['notes']]
    md += ['']
write('INTERFACES.md','\n'.join(md))
# Refresh the canonical core-document matrix without replacing authored decisions.
readme=(BASE/'README.md').read_text(encoding='utf-8')
start='<!-- FEATURE_MATRIX -->'
end='<!-- /FEATURE_MATRIX -->'
rows=['| 功能 | 优先级 / 状态 | 工作区 | 接口 | 依赖 |','| --- | --- | --- | --- | --- |']
for f in CAT['features']:
    rows.append('| ['+f['id']+' '+f['name']['zh']+'](diagrams/features/'+f['id']+'.svg) | '+f['priority']+' / '+f['status']+' | '+f['page']+' | '+', '.join(f['apis'])+' | '+(', '.join(f['dependencies']) or '—')+' |')
head,tail=readme.split(start,1)
if end in tail:tail=tail.split(end,1)[1]
write('README.md',head+start+'\n\n'+'\n'.join(rows)+'\n\n'+end+tail)

# Do not embed execution screenshots, logs or source data. Manifest inventories only this package.
files=[]
for p in sorted(BASE.rglob('*')):
    if p.is_file() and p.name!='package-manifest.json' and '__pycache__' not in p.parts:files.append({'path':p.relative_to(BASE).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
write('package-manifest.json',json.dumps({'formatVersion':1,'sourceRevision':CAT['sourceRevision'],'sourceTreeDirty':True,'purpose':'offline-design-package-not-production','files':files},ensure_ascii=False,indent=2)+'\n')
print('Built standalone prototype, 39 feature SVGs, 4 flows, atlas, hub, interface inventory and manifest.')
