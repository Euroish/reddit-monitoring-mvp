import {
  Bell,
  BookOpen,
  Bookmark,
  Calendar,
  ChevronDown,
  Database,
  ExternalLink,
  Flame,
  Grid,
  HelpCircle,
  Key,
  Layers,
  LogOut,
  Palette,
  Plus,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  TrendingUp,
  User,
} from 'lucide-react';

/** Numbered callout marker used inside the schematic screenshots. */
function Mark({ n, x, y }: { n: number; x: string; y: string }) {
  return (
    <span className="gm-mark" style={{ left: x, top: y }} aria-hidden="true">
      {n}
    </span>
  );
}

const RAIL = [
  { icon: BookOpen, on: true, tip: '信息流' },
  { icon: Grid, on: false, tip: '监测总览' },
  { icon: Layers, on: false, tip: '内容检索' },
  { icon: Database, on: false, tip: '来源' },
  { icon: Bookmark, on: false, tip: '工作区' },
];

const SIDE_FEED = [
  { icon: BookOpen, label: '今日精选', on: true },
  { icon: Flame, label: '48 小时热度', on: false },
  { icon: Calendar, label: '08:00 日报', on: false },
];

const SIDE_MONITOR = [
  { icon: Grid, label: '项目总览', on: false },
  { icon: TrendingUp, label: '趋势雷达', on: false },
  { icon: Layers, label: '平台构成', on: false },
];

/** Figure 1 — the four regions of the workbench. */
export function FigureWorkbenchMap() {
  return (
    <div className="gm-shot">
      <div className="gm-app">
        <div className="gm-rail">
          <span className="gm-logo">SL</span>
          {RAIL.map((r) => (
            <span key={r.tip} className={`gm-railbtn ${r.on ? 'on' : ''}`} title={r.tip}>
              <r.icon size={12} />
            </span>
          ))}
          <span className="gm-railsp" />
          <span className="gm-railbtn"><Palette size={12} /></span>
          <span className="gm-railbtn"><Sparkles size={12} /></span>
          <span className="gm-railbtn"><HelpCircle size={12} /></span>
        </div>

        <div className="gm-side">
          <div className="gm-proj">
            <span className="gm-ava">痛</span>
            <span className="gm-projtxt">
              <b>支付体验痛点</b>
              <small>4 个来源 · rev 6</small>
            </span>
            <ChevronDown size={9} />
          </div>
          <div className="gm-cmd">
            <Search size={9} />
            <span>搜索或跳转…</span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </div>
          <p className="gm-navlabel">信息流</p>
          {SIDE_FEED.map((n) => (
            <div key={n.label} className={`gm-nav ${n.on ? 'on' : ''}`}>
              <n.icon size={9} />
              <span>{n.label}</span>
            </div>
          ))}
          <p className="gm-navlabel">监测</p>
          {SIDE_MONITOR.map((n) => (
            <div key={n.label} className="gm-nav">
              <n.icon size={9} />
              <span>{n.label}</span>
            </div>
          ))}
          <div className="gm-quota">
            <div className="gm-quotatop"><span>今日采集资源配额</span><b>38%</b></div>
            <div className="gm-bar"><i style={{ width: '38%' }} /></div>
            <div className="gm-quotameta"><span>760 / 2.0K</span><span>治理</span></div>
          </div>
          <div className="gm-user">
            <span className="gm-ava gm-ava--sm">OW</span>
            <span className="gm-projtxt"><b>owner</b><small>owner@localhost</small></span>
          </div>
        </div>

        <div className="gm-main">
          <div className="gm-top">
            <div className="gm-searchbar"><Search size={9} /><span>搜索讨论、项目，或按 Ctrl+K 快速跳转…</span></div>
            <div className="gm-pills">
              <span className="gm-pill">矿物青</span>
              <span className="gm-pill">EN</span>
              <span className="gm-pill">Live · owner</span>
              <span className="gm-pill gm-pill--cta"><Plus size={9} />新建</span>
              <span className="gm-pill gm-pill--icon"><Bell size={9} /></span>
              <span className="gm-avatar">OW</span>
            </div>
          </div>
          <div className="gm-body">
            <div className="gm-h1">今日精选 <em>128 条报道</em></div>
            <div className="gm-sub">跨来源多源印证去重信息流 · 已存样本口径 (stored_sample)</div>
            <div className="gm-filters">
              <span className="gm-chip on">精选信息流</span>
              <span className="gm-chip">48h 热度榜</span>
              <span className="gm-chip">08:00 日报</span>
              <span className="gm-chip">全部类型</span>
              <span className="gm-chip">T1</span>
              <span className="gm-chip">中文</span>
            </div>
            {[
              { tier: 'T1', ch: 'AI 一手与研发', title: '我们迁移到新推理栈后，账单里出现了三笔看不懂的调用', meta: '3 源印证 · 286 热度 · 2 小时前', pain: true },
              { tier: 'T1.5', ch: '工程与基础', title: 'Self-hosted 队列在峰值下丢消息，附排查过程与配置片段', meta: '2 源印证 · 174 热度 · 5 小时前', pain: false },
            ].map((s) => (
              <div key={s.title} className="gm-card">
                <div className="gm-cardhd">
                  <span className={`gm-tier ${s.pain ? 'pain' : ''}`}>{s.tier}</span>
                  <span className="gm-chan">{s.ch}</span>
                </div>
                <div className="gm-title">{s.title}</div>
                <div className="gm-meta">{s.meta}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Mark n={1} x="-8px" y="96px" />
      <Mark n={2} x="96px" y="-9px" />
      <Mark n={3} x="calc(100% - 44px)" y="-9px" />
      <Mark n={4} x="calc(100% - 44px)" y="calc(100% - 40px)" />
    </div>
  );
}

/** Figure 2 — the avatar menu with the new guide entry. */
export function FigureAvatarMenu() {
  return (
    <div className="gm-shot gm-shot--menu">
      <div className="gm-top gm-top--solo">
        <div className="gm-searchbar"><Search size={9} /><span>搜索讨论、项目…</span></div>
        <div className="gm-pills">
          <span className="gm-pill">矿物青</span>
          <span className="gm-pill">EN</span>
          <span className="gm-pill">产品介绍</span>
          <span className="gm-pill gm-pill--cta"><Plus size={9} />新建</span>
          <span className="gm-avatar gm-avatar--on">OW</span>
        </div>
      </div>
      <div className="gm-pop" style={{ right: '96px', top: '52px' }}>
        <div className="gm-pophd">
          <span className="gm-ava gm-ava--sm">OW</span>
          <span className="gm-projtxt"><b>owner@localhost</b><small>owner · browser</small></span>
        </div>
        <div className="gm-popitem gm-popitem--new">
          <BookOpen size={11} />
          <span>产品使用说明</span>
          <em>新增</em>
        </div>
        <div className="gm-popitem"><User size={11} /><span>账户与权限</span></div>
        <div className="gm-popitem"><Key size={11} /><span>机器 API 密钥</span></div>
        <div className="gm-popitem"><Palette size={11} /><span>切换皮肤配色 (17 套)</span></div>
        <div className="gm-popitem"><Sparkles size={11} /><span>切换品牌标志 (30 套)</span></div>
        <div className="gm-popdiv" />
        <div className="gm-popitem"><ExternalLink size={11} /><span>产品介绍页</span></div>
        <div className="gm-popitem gm-popitem--danger"><LogOut size={11} /><span>退出登录</span></div>
      </div>
      <Mark n={1} x="calc(100% - 40px)" y="-8px" />
      <Mark n={2} x="calc(100% - 284px)" y="96px" />
    </div>
  );
}

/** Figure 3 — anatomy of one story card. */
export function FigureStoryCard() {
  return (
    <div className="gm-shot gm-shot--card">
      <div className="gm-card gm-card--big">
        <div className="gm-cardhd">
          <span className="gm-tier pain">T1</span>
          <span className="gm-chan">AI 一手与研发</span>
          <span className="gm-newflag">新上榜</span>
        </div>
        <div className="gm-title gm-title--big">迁移到新推理栈后，账单里出现了三笔看不懂的调用</div>
        <div className="gm-snippet">
          正文摘要：升级后的第一周成本上涨 41%，但控制台只给出汇总数字。贴出了逐日账单与调用量对照，并追问是否可以按
          endpoint 拆分明细……
        </div>
        <div className="gm-cardft">
          <span className="gm-evidence">3 源印证</span>
          <span>286 热度</span>
          <span>2 小时前</span>
          <span className="gm-spacer" />
          <span className="gm-minibtn">收藏</span>
          <span className="gm-minibtn gm-minibtn--solid">阅读详情</span>
          <span className="gm-minibtn">打开原文</span>
        </div>
      </div>
    </div>
  );
}

/** Figure 4 — the project creation form. */
export function FigureProjectForm() {
  return (
    <div className="gm-shot gm-shot--form">
      <div className="gm-panel">
        <div className="gm-panelhd">
          <b>新建监测项目</b>
          <span className="gm-badge">创建后可随时修改</span>
        </div>
        <div className="gm-field">
          <label>项目名称</label>
          <div className="gm-input"><span>支付体验痛点</span><i /></div>
          <small>出现在侧边栏与分享链接里，建议写成「主题 · 目的」。</small>
        </div>
        <div className="gm-field">
          <label>绑定来源 <em>可多选</em></label>
          <div className="gm-multisel">
            <span className="gm-srcchip on">r/ExperiencedDevs</span>
            <span className="gm-srcchip on">r/smallbusiness</span>
            <span className="gm-srcchip on">Bluesky · devrel</span>
            <span className="gm-srcchip">Hacker News 订阅</span>
          </div>
        </div>
        <div className="gm-field">
          <label>固化词组 <em>三段式</em></label>
          <div className="gm-three">
            <div className="gm-term">
              <span className="gm-termtag">allTerms</span>
              <span>全部命中 AND</span>
              <code>billing, invoice</code>
            </div>
            <div className="gm-term">
              <span className="gm-termtag">anyTerms</span>
              <span>任意命中 OR</span>
              <code>涨价, 账单, 扣费</code>
            </div>
            <div className="gm-term">
              <span className="gm-termtag">exclusions</span>
              <span>排除词</span>
              <code>招聘, 广告</code>
            </div>
          </div>
        </div>
        <div className="gm-toggle"><span className="gm-switch on" /><span>讨论树感知（按讨论根去重，避免同帖多楼重复计数）</span></div>
        <div className="gm-formft"><span className="gm-minibtn">取消</span><span className="gm-minibtn gm-minibtn--solid">创建项目</span></div>
      </div>
    </div>
  );
}

/** Figure 5 — the monitoring overview board. */
export function FigureOverview() {
  return (
    <div className="gm-shot gm-shot--board">
      <div className="gm-crumb">工作台 / 监测项目 / 支付体验痛点</div>
      <div className="gm-boardhd">
        <div>
          <div className="gm-h1">监测总览 <span className="gm-live">运行中</span></div>
          <div className="gm-sub">4 个绑定来源 · rev 6 · 口径 stored_sample</div>
        </div>
        <div className="gm-pills">
          <span className="gm-pill">分享</span>
          <span className="gm-pill">导出 CSV</span>
          <span className="gm-pill gm-pill--cta"><Plus size={9} />新建监测</span>
        </div>
      </div>
      <div className="gm-toolbar">
        <span className="gm-chip">近 7 天</span>
        <span className="gm-chip on">近 30 天</span>
        <span className="gm-chip">近 90 天</span>
        <span className="gm-divider" />
        <span className="gm-chip">平台 · 全部 4</span>
        <span className="gm-chip">信号 · 全部</span>
        <span className="gm-chip">全部类型</span>
        <span className="gm-spacer" />
        <span className="gm-synced">UTC 聚合口径 · 已同步</span>
      </div>
      <div className="gm-kpis">
        {[
          { k: '命中内容', v: '1,284', d: '+18%' },
          { k: '去重讨论根', v: '612', d: '+9%' },
          { k: '痛点信号', v: '207', d: '+24%' },
        ].map((c) => (
          <div key={c.k} className="gm-kpi">
            <span>{c.k}</span>
            <b>{c.v}</b>
            <em>{c.d} 环比</em>
          </div>
        ))}
      </div>
      <div className="gm-chart">
        <svg viewBox="0 0 640 150" preserveAspectRatio="none" className="gm-svg">
          <defs>
            <linearGradient id="gdFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--wb-teal)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--wb-teal)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <line key={i} x1="0" x2="640" y1={18 + i * 36} y2={18 + i * 36} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" />
          ))}
          <path
            d="M0,120 L64,112 L128,118 L192,96 L256,86 L320,74 L384,84 L448,62 L512,54 L576,40 L640,34 L640,150 L0,150 Z"
            fill="url(#gdFill)"
          />
          <path
            d="M0,120 L64,112 L128,118 L192,96 L256,86 L320,74 L384,84 L448,62 L512,54 L576,40 L640,34"
            fill="none"
            stroke="var(--wb-teal)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M0,138 L64,134 L128,136 L192,126 L256,122 L320,116 L384,120 L448,110 L512,104 L576,96 L640,92"
            fill="none"
            stroke="var(--wb-purple)"
            strokeWidth="1.6"
            strokeDasharray="5 4"
          />
        </svg>
        <div className="gm-chartx">
          {['11/01', '11/06', '11/11', '11/16', '11/21'].map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="gm-chartlegend">
          <span><i className="dot teal" />命中内容</span>
          <span><i className="dot purple" />痛点信号</span>
        </div>
      </div>
    </div>
  );
}

/** Figure 6 — content search with three-part terms. */
export function FigureSearch() {
  const rows = [
    { t: 'T1', s: '迁移到新推理栈后，账单里出现了三笔看不懂的调用', m: '痛点 · 286 热度 · r/ExperiencedDevs' },
    { t: 'T1.5', s: '发票金额与用量对不上，客服只给了模板回复', m: '痛点 · 164 热度 · r/smallbusiness' },
    { t: 'T2', s: '季度预算评审：我们如何把云成本压回 30%', m: '中性 · 98 热度 · Bluesky' },
  ];
  return (
    <div className="gm-shot gm-shot--search">
      <div className="gm-searchbig">
        <Search size={11} />
        <span className="gm-q">
          <code>+billing +invoice</code>
          <code>-招聘 -广告</code>
          <code>涨价</code>
        </span>
        <span className="gm-minibtn gm-minibtn--solid">检索</span>
      </div>
      <div className="gm-filters gm-filters--wrap">
        <span className="gm-chip on">匹配：标题 + 正文</span>
        <span className="gm-chip">平台 · 全部</span>
        <span className="gm-chip">信号 · 痛点</span>
        <span className="gm-chip">形态 · 全部</span>
        <span className="gm-chip">近 30 天（UTC）</span>
        <span className="gm-chip">来源 · 全部已授权</span>
        <span className="gm-spacer" />
        <span className="gm-pill">导出当前筛选口径</span>
        <span className="gm-pill">保存查询</span>
      </div>
      <div className="gm-list">
        {rows.map((r) => (
          <div key={r.s} className="gm-row">
            <span className={`gm-tier ${r.m.startsWith('痛点') ? 'pain' : ''}`}>{r.t}</span>
            <span className="gm-rowtxt"><b>{r.s}</b><small>{r.m}</small></span>
            <span className="gm-rowgo">详情</span>
          </div>
        ))}
      </div>
      <div className="gm-footnote">仍有更多匹配样本 · nextCursor 已就绪，可继续加载</div>
    </div>
  );
}

/** Figure 7 — the discussion tree with the three reading views. */
export function FigureThreadTree() {
  return (
    <div className="gm-shot gm-shot--tree">
      <div className="gm-treehd">
        <span className="gm-chip">热评 top</span>
        <span className="gm-chip on">仅命中 matches</span>
        <span className="gm-chip">楼主 OP</span>
        <span className="gm-spacer" />
        <span className="gm-synced">父链 6 跳 · 0 处缺失</span>
      </div>
      <div className="gm-tree">
        <div className="gm-node lvl0">
          <span className="gm-nodebd">OP</span>
          <div><b>楼主：升级后成本涨了 41%，但控制台只给汇总数字</b><small>痛点命中 · 286 热度</small></div>
        </div>
        <div className="gm-node lvl1 gm-node--hit">
          <span className="gm-nodebd gm-nodebd--hit">热评</span>
          <div><b>「按 endpoint 拆分的明细在账单导出里，只是要手动开」</b><small>命中 billing · 88 热度</small></div>
        </div>
        <div className="gm-node lvl2">
          <span className="gm-nodebd">回复</span>
          <div><b>试过了，导出的是汇总行，没有 endpoint 维度</b><small>连续 2 层追问</small></div>
        </div>
        <div className="gm-node lvl1">
          <span className="gm-nodebd">热评</span>
          <div><b>我们改成批处理 + 缓存后账单下降 27%，附配置</b><small>中性 · 62 热度</small></div>
        </div>
        <div className="gm-node lvl1 gm-node--missing">
          <span className="gm-nodebd gm-nodebd--warn">父链缺失</span>
          <div><b>（该评论的上一级已被删除，系统显式标注而非静默丢弃）</b><small>1 处父链缺失</small></div>
        </div>
      </div>
    </div>
  );
}

/** Figure 8 — sources, jobs and quotas. */
export function FigureSources() {
  return (
    <div className="gm-shot gm-shot--sources">
      <div className="gm-tabs">
        <span className="on">来源中心</span>
        <span>采集任务</span>
        <span>渠道配额与策略</span>
      </div>
      <div className="gm-srcrow">
        <span className="gm-dot--state" />
        <span className="gm-rowtxt">
          <b>r/ExperiencedDevs</b>
          <small>订阅 · 主渠道 reddit_feed · 每日 6 次</small>
        </span>
        <span className="gm-tag">运行中</span>
        <span className="gm-tag gm-tag--ghost">已纳入推流</span>
        <span className="gm-minibtn">立即采集</span>
      </div>
      <div className="gm-srcrow">
        <span className="gm-dot--state gm-dot--state--warn" />
        <span className="gm-rowtxt">
          <b>Bluesky · devrel 列表</b>
          <small>网页列表 · 备用渠道 bluesky_public</small>
        </span>
        <span className="gm-tag gm-tag--warn">待确认</span>
        <span className="gm-minibtn">查看任务</span>
      </div>
      <div className="gm-split">
        <div className="gm-box">
          <div className="gm-boxhd"><b>渠道配额</b><span className="gm-badge">UTC 零点重置</span></div>
          <div className="gm-meter">
            <span>日额度</span>
            <div className="gm-bar"><i style={{ width: '64%' }} /></div>
            <em>640 / 1,000</em>
          </div>
          <div className="gm-meter">
            <span>月额度</span>
            <div className="gm-bar gm-bar--alt"><i style={{ width: '41%' }} /></div>
            <em>12.3K / 30K</em>
          </div>
        </div>
        <div className="gm-box">
          <div className="gm-boxhd"><b>服务商凭证</b><ShieldCheck size={11} /></div>
          <div className="gm-credrow"><span>Apify</span><span className="gm-tag">已配置 · 热生效</span></div>
          <div className="gm-credrow"><span>TwitterAPIs</span><span className="gm-tag gm-tag--ghost">未配置</span></div>
          <div className="gm-credrow"><span>ScrapeBadger</span><span className="gm-tag">已配置</span></div>
        </div>
      </div>
    </div>
  );
}

/** Figure 9 — settings tabs and a machine key card. */
export function FigureSettings() {
  return (
    <div className="gm-shot gm-shot--settings">
      <div className="gm-tabs gm-tabs--five">
        <span className="on">当前账户与角色</span>
        <span>第三方采集密钥</span>
        <span>成员与权限</span>
        <span>机器 API 密钥</span>
        <span>品牌标识与皮肤</span>
      </div>
      <div className="gm-box">
        <div className="gm-boxhd"><b>机器 API 密钥</b><span className="gm-badge">43 位明文仅创建时展示一次</span></div>
        <div className="gm-keyline">
          <span>密钥名称</span>
          <code>bi-export-sync</code>
          <span>有效期</span>
          <code>30 天</code>
        </div>
        <div className="gm-scopes">
          <span className="gm-tag on">read</span>
          <span className="gm-tag on">export</span>
          <span className="gm-tag on">ingest</span>
          <span className="gm-tag">collect</span>
          <span className="gm-tag">sources:write</span>
          <span className="gm-tag">projects:write</span>
        </div>
        <div className="gm-token">
          <span>sfl_9dT2xQm4Kp7vRb1sJc8NwYhLz3GfE6uA0iXo5Bq</span>
          <span className="gm-minibtn">复制</span>
        </div>
      </div>
    </div>
  );
}

/** Small inline screenshot: keyboard shortcut card. */
export function FigureShortcuts() {
  const rows: Array<[string, string]> = [
    ['打开命令面板 / 快速跳转', 'Ctrl K'],
    ['展开或收起次级边栏', '['],
    ['关闭当前浮层或面板', 'Esc'],
    ['切换界面皮肤', '顶栏色板按钮'],
    ['切换中英文', '顶栏 EN / 中文'],
  ];
  return (
    <div className="gm-shot gm-shot--keys">
      {rows.map(([k, v]) => (
        <div key={k} className="gm-keyrow">
          <span>{k}</span>
          <kbd>{v}</kbd>
        </div>
      ))}
      <div className="gm-keyfoot"><Sliders size={10} /><span>小提示：单栏笔记本屏建议收起边栏，主内容能多显示约 3 条报道。</span></div>
    </div>
  );
}
