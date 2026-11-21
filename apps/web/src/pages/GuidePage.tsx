import { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/guide.css';
import { ChevronLeft, ChevronRight, Info, AlertTriangle, ExternalLink, Check, Search } from 'lucide-react';
import { SiftlineLogo } from '../components/BrandMark';
import { useTheme } from '../components/themeContext';
import {
  FigureWorkbenchMap,
  FigureAvatarMenu,
  FigureStoryCard,
  FigureProjectForm,
  FigureOverview,
  FigureSearch,
  FigureThreadTree,
  FigureSources,
  FigureSettings,
  FigureShortcuts,
} from '../components/GuideFigures';

interface GuidePageProps {
  isAuthenticated: boolean;
  onNavigate: (path: string) => void;
  onOpenAuth: () => void;
}

const SECTIONS = [
  { id: 'start', num: '01', label: '开始使用' },
  { id: 'tour', num: '02', label: '认识工作台' },
  { id: 'feed', num: '03', label: '阅读信息流' },
  { id: 'project', num: '04', label: '创建监测项目' },
  { id: 'overview', num: '05', label: '读懂监测总览' },
  { id: 'search', num: '06', label: '内容检索与讨论树' },
  { id: 'sources', num: '07', label: '来源与采集调度' },
  { id: 'workspace', num: '08', label: '个人工作区' },
  { id: 'account', num: '09', label: '账户、权限与机器密钥' },
  { id: 'faq', num: '10', label: '常见问题' },
];

function Section({
  id,
  num,
  title,
  lede,
  children,
}: {
  id: string;
  num: string;
  title: string;
  lede?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="gd-sec" id={id}>
      <p className="gd-eyebrow">
        <span>{num}</span>
        {title}
      </p>
      <h2 className="gd-h2">{title}</h2>
      {lede && <p className="gd-lede">{lede}</p>}
      {children}
    </section>
  );
}

function Figure({ index, caption, children }: { index: number; caption: React.ReactNode; children: React.ReactNode }) {
  return (
    <figure className="gd-fig">
      <div className="gd-figbody">{children}</div>
      <figcaption className="gd-figcap">
        <span className="gd-figcap-num">图 {index}</span>
        <div className="gd-figcap-txt">{caption}</div>
      </figcaption>
    </figure>
  );
}

function Callout({ kind = 'tip', title, children }: { kind?: 'tip' | 'note'; title: string; children: React.ReactNode }) {
  return (
    <div className={`gd-callout gd-callout--${kind}`}>
      <span className="gd-callout-ic">{kind === 'tip' ? <Info size={14} /> : <AlertTriangle size={14} />}</span>
      <div>
        <b>{title}</b>
        <div className="gd-callout-bd">{children}</div>
      </div>
    </div>
  );
}

function Steps({ items }: { items: Array<{ title: string; body?: React.ReactNode }> }) {
  return (
    <ol className="gd-steps">
      {items.map((s, i) => (
        <li key={s.title}>
          <span className="gd-stepnum">{i + 1}</span>
          <div>
            <b>{s.title}</b>
            {s.body && <p>{s.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function GuidePage({ isAuthenticated, onNavigate, onOpenAuth }: GuidePageProps) {
  const { palette } = useTheme();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(SECTIONS[0].id);
  const [helpful, setHelpful] = useState<'yes' | 'no' | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top;
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top - top <= 140) current = s.id;
      }
      setActive(current);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener('scroll', onScroll);
  }, []);

  const jump = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const go = useCallback(
    (path: string) => {
      if (!isAuthenticated && path !== '/') {
        onOpenAuth();
        return;
      }
      onNavigate(path);
    },
    [isAuthenticated, onNavigate, onOpenAuth],
  );

  const filtered = query.trim()
    ? SECTIONS.filter((s) => s.label.includes(query.trim()))
    : SECTIONS;

  const paletteName = palette.nameZh.split(' × ')[0];

  return (
    <div className="gd-root" ref={scrollRef} style={{ background: 'var(--wb-bg)' }}>
      <header className="gd-top">
        <div className="gd-top-l">
          <button type="button" className="gd-brand" onClick={() => onNavigate('/')} aria-label="SIFTLINE">
            <SiftlineLogo size={22} showWordmark={false} />
            <span className="gd-brandtxt">
              <b>SIFTLINE</b>
              <small>使用手册</small>
            </span>
          </button>
        </div>
        <div className="gd-top-r">
          <label className="gd-topsearch">
            <Search size={13} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="在本手册中查找主题"
              aria-label="在本手册中查找主题"
            />
          </label>
          <button type="button" className="gd-toplink" onClick={() => onNavigate('/product')}>
            产品介绍
          </button>
          <button
            type="button"
            className="gd-topbtn"
            onClick={() => {
              if (isAuthenticated) onNavigate('/projects');
              else onOpenAuth();
            }}
          >
            {isAuthenticated ? '返回工作台' : '登录工作台'}
          </button>
        </div>
      </header>

      <div className="gd-layout">
        <aside className="gd-toc" aria-label="目录">
          <p className="gd-toc-title">本手册内容</p>
          <nav>
            {filtered.length === 0 && <p className="gd-toc-empty">没有匹配的章节</p>}
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`gd-tocitem ${active === s.id ? 'on' : ''}`}
                onClick={() => {
                  setQuery('');
                  jump(s.id);
                }}
              >
                <span>{s.num}</span>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="gd-tocfoot">
            <span className="gd-dotlive" />
            适用于 Web 工作台 · 1.0
            <br />
            当前皮肤：{paletteName}
          </div>
        </aside>

        <main className="gd-doc">
          <div className="gd-hero">
            <p className="gd-eyebrow gd-eyebrow--plain">SIFTLINE 使用手册</p>
            <h1 className="gd-h1">欢迎使用 SIFTLINE</h1>
            <p className="gd-hero-lede">
              SIFTLINE 把 Reddit、Bluesky 等平台的公开讨论，整理成一条可回溯的信息流；
              当你需要连续盯住某个话题时，再把它固化成「监测项目」，每天自动收集、去重、按信号排序。
            </p>
            <p className="gd-hero-lede gd-hero-lede--soft">
              这份手册按你真实的操作顺序写：从登录开始，到做出第一份能交给同事的结论。全部读完约 12 分钟，也可以直接跳到你需要的那一节。
            </p>
            <div className="gd-hero-actions">
              <button type="button" className="gd-btn gd-btn--primary" onClick={() => jump('start')}>
                从头开始
                <ChevronRight size={14} />
              </button>
              <button type="button" className="gd-btn" onClick={() => jump('faq')}>
                我遇到问题了
              </button>
            </div>
            <div className="gd-hero-meta">
              <span>无需安装客户端</span>
              <span>支持 owner / admin / viewer 三种角色</span>
              <span>界面支持 17 套皮肤与中英双语</span>
            </div>
          </div>

          <Section
            id="start"
            num="01"
            title="开始使用"
            lede="第一次打开 SIFTLINE，你只需要一个账号。登录之后所有功能都在同一个工作台里，不需要安装任何客户端，也不需要配置浏览器插件。"
          >
            <Steps
              items={[
                {
                  title: '打开管理员给你的网址',
                  body: '地址通常形如 https://你的域名。浏览器会直接显示「今日精选」信息流；如果先看到一张登录面板，说明这套部署要求登录后才能阅读内容，属于正常现象。',
                },
                {
                  title: '点击右上角的「登录」',
                  body: '在顶栏最右侧。若你是被同事邀请加入，切到「注册」并粘贴那串 72 位一次性邀请码——邀请码用一次即失效，过期需要重新索取。',
                },
                {
                  title: '输入邮箱与密码，按「登录」',
                  body: '登录成功后，顶栏右侧会出现你的头像缩写（例如 OW）和一个绿色的「Live · 角色」标记，左下角也会出现你的邮箱。',
                },
                {
                  title: '确认你的角色',
                  body: '角色决定你能改什么。不确定时，点头像 →「账户与权限」，第一张卡片就是你的当前会话身份。',
                },
              ]}
            />

            <div className="gd-table-wrap">
              <table className="gd-table">
                <thead>
                  <tr>
                    <th>角色</th>
                    <th>你可以做什么</th>
                    <th>受限的部分</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>owner</code></td>
                    <td>全部读写与治理权限，可邀请 admin 与 viewer</td>
                    <td>—</td>
                  </tr>
                  <tr>
                    <td><code>admin</code></td>
                    <td>除 owner 专属操作外基本等同，可管理来源、配额与成员</td>
                    <td>不能邀请 admin，不能改动 owner</td>
                  </tr>
                  <tr>
                    <td><code>viewer</code></td>
                    <td>阅读全部内容；个人工作区（保存查询、批注）完全可读写</td>
                    <td>项目与来源的增改删被锁定，看不到配额治理</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <Callout kind="tip" title="看不到内容，先检查登录状态">
              私有部署模式（未开放匿名阅读）下，未登录时任何页面都只显示登录面板，且不会展示任何数据。这是有意设计，不是故障。
            </Callout>
          </Section>

          <Section
            id="tour"
            num="02"
            title="认识工作台"
            lede="工作台由四块固定区域组成。位置不会变，记住一次就够用；下面的示意图标出了它们各自负责什么。"
          >
            <Figure
              index={1}
              caption={
                <>
                  工作台全貌。<b>①</b> 图标栏 <b>②</b> 次级导航 <b>③</b> 顶栏 <b>④</b> 主内容区。
                </>
              }
            >
              <FigureWorkbenchMap />
            </Figure>

            <div className="gd-marks">
              <div>
                <b><span>1</span>图标栏</b>
                <p>六个常用目的地：信息流、监测总览、内容检索、来源、个人工作区、设置。最下面是皮肤、品牌标志与快捷键帮助。屏幕不够宽时，用这里收起次级导航。</p>
              </div>
              <div>
                <b><span>2</span>次级导航</b>
                <p>最上方是项目切换器（当前在监测哪个项目），下面是 Ctrl+K 搜索入口，导航按「信息流 / 监测 / 研究 / 数据接入」分组，底部是今日配额条与账户入口。</p>
              </div>
              <div>
                <b><span>3</span>顶栏</b>
                <p>全局搜索、皮肤、语言、产品介绍、当前会话角色、新建、通知铃与头像。所有「跨页面的动作」都在这一行。</p>
              </div>
              <div>
                <b><span>4</span>主内容区</b>
                <p>当前页面的全部内容。所有详情都用右侧抽屉展开，不会把你带离列表，阅读位置不会丢。</p>
              </div>
            </div>

            <h3 className="gd-h3">找回你想要的页面</h3>
            <p className="gd-p">
              记不住路径时按 <span className="gd-kbd">Ctrl</span> <span className="gd-kbd">K</span> 打开命令面板，输入「检索」「配额」「皮肤」「日报」等任意词就能直接跳转。它同时也是一份功能清单——不确定产品能做什么时，打开它从上往下看一遍最快。
            </p>
            <p className="gd-p">
              窄屏笔记本建议按 <span className="gd-kbd">[</span> 收起次级导航，主内容区大约能多显示三条报道；再按一次恢复。
            </p>

            <h3 className="gd-h3">你的账户菜单</h3>
            <p className="gd-p">
              点击顶栏右上角的头像缩写，会展开账户菜单。这次我们在「账户与权限」上方新增了「产品使用说明」——无论你走到哪一页，都能从这里一键回到这份手册。
            </p>

            <Figure
              index={2}
              caption={
                <>
                  <b>①</b> 头像缩写，点击展开菜单；<b>②</b> 新增的「产品使用说明」入口，位于「账户与权限」与「机器 API 密钥」之上。
                </>
              }
            >
              <FigureAvatarMenu />
            </Figure>

            <p className="gd-p">
              菜单里其余项目分别对应：账户与权限（你的会话身份与角色）、机器 API 密钥（给程序用的密钥）、切换皮肤配色与品牌标志（外观）、产品介绍页（对外介绍）、退出登录。
            </p>
          </Section>

          <Section
            id="feed"
            num="03"
            title="阅读信息流"
            lede="「今日精选」是登录后的默认首页。它把多个平台上同一件事的讨论合并成一条，按可核查程度与新鲜度排序——你看到的每一条，都能点回原文核对。"
          >
            <h3 className="gd-h3">三种看法</h3>
            <div className="gd-cards3">
              <div className="gd-minicard">
                <b>今日精选</b>
                <p>当日事件流。适合每天花十分钟扫一遍，知道今天发生了什么。</p>
              </div>
              <div className="gd-minicard">
                <b>48 小时热度</b>
                <p>按 48 小时内多源报道密度与时间衰减排序。适合找「正在升温」的话题，而不是最热的旧闻。</p>
              </div>
              <div className="gd-minicard">
                <b>08:00 日报</b>
                <p>按日归档的事件摘要，可以按日回溯。补看昨天漏掉的内容从这里进。</p>
              </div>
            </div>

            <h3 className="gd-h3">收窄到你关心的部分</h3>
            <p className="gd-p">
              信息流上方有两排筛选条件，从左到右依次是：内容语言（全部 / 中文 / EN）、来源等级（全部等级 / T1 / T1.5 / T2）、八个话题频道，以及右上角的阅读密度（舒适 / 紧凑）。
            </p>
            <p className="gd-p">
              来源等级表示可核查程度：<b>T1</b> 是一手当事人或原始发布，<b>T1.5</b> 是准一手（有细节但经过转述），<b>T2</b> 是二手汇总。写结论时优先引用 T1，用它给观点打底。
            </p>
            <p className="gd-p">
              筛选条件可以叠加，右侧会显示当前命中的条数。想回到全部内容，点「重置筛选」；只想清掉来源等级，点「清除来源筛选」。
            </p>

            <h3 className="gd-h3">读懂一张卡片</h3>
            <Figure
              index={3}
              caption={
                <>
                  一条报道的完整结构。<b>①</b> 来源等级 <b>②</b> 频道 <b>③</b> 标题 <b>④</b> 多源印证与热度 <b>⑤</b> 收藏并写批注 <b>⑥</b> 打开原文。
                </>
              }
            >
              <FigureStoryCard />
            </Figure>

            <p className="gd-p">
              点标题会从右侧滑出阅读抽屉，里面是正文、多源印证列表与原文链接。抽屉顶部还有两个动作：<b>复制 Markdown</b> 会把标题、来源、链接整理成一段可直接粘贴的文本，写周报时很省事；<b>收藏</b> 之后可以写研究批注（最多 2000 字），保存后会出现在个人工作区。
            </p>

            <Callout kind="note" title="口径：已存样本（stored_sample）">
              信息流只展示已经入库的样本，不做预测、不补全、不用模型生成缺失数字。热度与排序都能回溯到具体来源条目——所以你可能会觉得「条数比想象中少」，那是因为它宁可不显示，也不编造。
            </Callout>

            <Callout kind="tip" title="只有标题或摘要？">
              部分来源平台不提供正文抓取，这时卡片会提示「该条记录仅包含标题或摘要」。点「打开原文」回到讨论现场查看完整内容。
            </Callout>
          </Section>

          <Section
            id="project"
            num="04"
            title="创建第一个监测项目"
            lede="随手刷信息流适合「看看今天发生了什么」；如果你要连续几周盯住一个话题，就把它做成监测项目——系统每天替你收集、去重、按信号排序。"
          >
            <p className="gd-p">
              判断标准很简单：当你有<b>明确的关键词</b>（例如「账单」「扣费」）和<b>明确的目的</b>（例如「找出付费流程里的抱怨」），就该建项目；如果只是想了解行业动态，留在信息流里就够了。
            </p>

            <Steps
              items={[
                {
                  title: '命名',
                  body: '在侧边栏顶部的项目切换器里点「新建监测项目」，或用顶栏的「+ 新建」→「监测项目」。名称建议写成「主题 · 目的」，例如「支付体验痛点」。',
                },
                {
                  title: '绑定来源（可多选）',
                  body: '来源决定数据从哪儿来。至少选一个；不同平台的讨论风格差异很大，通常 3–5 个来源就够看清一件事。',
                },
                {
                  title: '写固化词组（三段式）',
                  body: 'allTerms 是「都必须出现」，anyTerms 是「出现任意一个即可」，exclusions 是排除词。例：allTerms = billing, invoice；anyTerms = 涨价, 账单, 扣费；exclusions = 招聘, 广告。',
                },
                {
                  title: '保存，等第一次采集',
                  body: '项目会立刻出现在侧边栏。下一次采集任务跑完后，总览页开始出数；想马上看结果，可以去来源页对该来源点「立即采集」。',
                },
              ]}
            />

            <Figure
              index={4}
              caption={
                <>
                  新建项目表单。<b>①</b> 名称 <b>②</b> 绑定来源 <b>③</b> 三段式词组 <b>④</b> 讨论树感知开关。
                </>
              }
            >
              <FigureProjectForm />
            </Figure>

            <p className="gd-p">
              <b>讨论树感知</b>（thread_aware）默认开启：统计时按「讨论根」去重，同一帖子下面的一百条回复不会被算成一百件事。它让趋势更接近「有多少件事在发生」，代价是各日数字不能直接相加，这一点我们会在下一节重复提醒一次。
            </p>

            <Callout kind="tip" title="词组先宽后窄">
              不要一开始就写十个词。先用两三个词看结果长什么样，再逐步加排除词把噪音削掉——这比反复推倒重来快得多。
            </Callout>

            <Callout kind="note" title="新建项目不会立刻有数据">
              项目需要至少一次成功采集才会有内容。自建部署默认关闭外网采集（SOURCE_NETWORK_ENABLED=false），这种情况下项目会一直是空的——这不是词组写错了。
            </Callout>
          </Section>

          <Section
            id="overview"
            num="05"
            title="读懂监测总览"
            lede="项目页只回答三个问题：有多少人在谈、谈的是不是痛点、主要在哪里谈。"
          >
            <h3 className="gd-h3">先选时间窗，再看数字</h3>
            <p className="gd-p">
              顶部工具栏先选近 7 天 / 近 30 天 / 近 90 天，再按平台、信号、内容类型收窄。时间轴按 UTC 日分桶，对应北京时间每天早上 8 点换日——如果你在早上七八点看数据觉得「今天还没动」，那是正常的。
            </p>

            <Figure
              index={5}
              caption={
                <>
                  监测总览。<b>①</b> 导出口径与分享 <b>②</b> 时间窗与筛选 <b>③</b> 三个核心数字 <b>④</b> 趋势曲线。
                </>
              }
            >
              <FigureOverview />
            </Figure>

            <div className="gd-cards3">
              <div className="gd-minicard">
                <b>命中内容</b>
                <p>符合词组的所有条目，包含同一帖子下面的多层回复。数字大，但容易被一条热帖撑高。</p>
              </div>
              <div className="gd-minicard">
                <b>去重讨论根</b>
                <p>按讨论根去重后的数量，更接近「有多少件独立的事」，判断真实规模时优先看它。</p>
              </div>
              <div className="gd-minicard">
                <b>痛点信号</b>
                <p>被判为抱怨、阻碍或求助的条目。最先读这一栏——它离真实需求和产品机会最近。</p>
              </div>
            </div>

            <h3 className="gd-h3">三个视图，回答三种问题</h3>
            <p className="gd-p">
              <b>趋势雷达</b>是多维图谱，看信号随时间怎么变、哪一类在涨；<b>平台构成</b>给各平台占比，回答「这个话题主要在哪儿发酵」；<b>渠道归因</b>看讨论从哪个渠道进来、在哪儿被放大。三者共用同一套筛选条件，切换视图不会丢口径。
            </p>

            <h3 className="gd-h3">把结果带出去</h3>
            <p className="gd-p">
              「导出 CSV」按当前筛选口径导出，「分享」生成只读视图链接——分享出去的是筛选指纹与统计口径，不会带上你个人批注的草稿。「新建监测」则是并列再开一个项目。
            </p>

            <Callout kind="note" title="数字对不上是正常的，原因有两条">
              一、发布时间未知的内容（day=null，例如部分推流导入）不计入 UTC 日时间轴，所以趋势图的总和可能小于内容库里的条数；
              二、开启讨论树感知后，各日的去重锚点数不能直接相加当作期间总数。所有对外引用都请带上口径说明。
            </Callout>
          </Section>

          <Section
            id="search"
            num="06"
            title="内容检索与讨论树"
            lede="检索是「带着问题找证据」，比信息流更精确，也更适合把结论写下来。"
          >
            <h3 className="gd-h3">查询怎么写</h3>
            <p className="gd-p">
              检索框支持三段式布尔词组：<code>+词</code> 表示必须出现，<code>-词</code> 表示排除，裸词表示出现任意一个即可。中文按双字切分，所以「算力」这样的词能命中；短代码如 <code>o3</code> 也能直接搜。
            </p>

            <Figure
              index={6}
              caption={
                <>
                  检索页。<b>①</b> 三段式查询 <b>②</b> 匹配范围、平台、信号、日期与来源 <b>③</b> 点「详情」从右侧抽屉展开。
                </>
              }
            >
              <FigureSearch />
            </Figure>

            <p className="gd-p">
              匹配范围可选标题、正文或两者；日期是 UTC 半开区间，最长 90 天；来源范围默认「全部已授权来源」，也可以只挑一两个做对照。结果右上角可以「导出当前筛选口径」——流式导出，五万条以内不需要等待打包。
            </p>

            <h3 className="gd-h3">用讨论树读完一段争论</h3>
            <p className="gd-p">
              点「详情」打开抽屉后，上方有三个视图：<b>热评 top</b> 先看主干争论结构；<b>仅命中</b> 只保留词组命中的节点，用来确认这段讨论到底是不是在讲你要的事；<b>楼主 OP</b> 回到原帖补充说明。顺序建议就按这三个来。
            </p>

            <Figure
              index={7}
              caption={
                <>
                  讨论树。<b>①</b> 三个阅读视图 <b>②</b> 父链缺失会被显式标注，而不是静默丢弃或错接。
                </>
              }
            >
              <FigureThreadTree />
            </Figure>

            <p className="gd-p">
              如果上一级评论在源平台被删除，节点上会明确写「父链缺失」，而不是悄悄把它接到别的父节点上。看到这个标记时，把它当作「讨论链在这里断了一层」的提示，不要据此推断原意。
            </p>

            <Callout kind="tip" title="把一次性检索变成固定动作">
              结果右上角「保存查询」，给它起个名字（例如「账单波动痛点 · 近30天」），下次在个人工作区一键重跑。周报的固定口径就是这样攒出来的。
            </Callout>
          </Section>

          <Section
            id="sources"
            num="07"
            title="来源与采集调度"
            lede="来源决定数据的边界。来源页分三个标签：来源中心、采集任务、渠道配额与策略。"
          >
            <h3 className="gd-h3">新建来源的五种方式</h3>
            <div className="gd-list">
              <div><b>订阅（RSS / Atom）</b><p>填一个 HTTPS 地址即可。系统会做 SSRF 校验，只允许公开可访问的地址。</p></div>
              <div><b>网页列表（web_list）</b><p>给一个列表页地址加选择器，适合没有接口但有固定版式的站点。</p></div>
              <div><b>JSON 接口（json_list）</b><p>给一个返回数组的接口地址，适合自建数据源。</p></div>
              <div><b>批量导入</b><p>上传 OPML 或 JSON 文件，一次导入多条订阅，重复的会被自动跳过。</p></div>
              <div><b>手工推流</b><p>外部采集器用带 ingest 作用域的机器密钥，把数据推进来。这条路径专为重型或强反爬采集准备，与主站隔离运行。</p></div>
            </div>

            <Figure
              index={8}
              caption={
                <>
                  来源页。<b>①</b> 三个标签 <b>②</b> 单个来源的状态、主备渠道与推流标记 <b>③</b> 日 / 月双额度与服务商凭证。
                </>
              }
            >
              <FigureSources />
            </Figure>

            <h3 className="gd-h3">采集任务</h3>
            <p className="gd-p">
              「采集任务」标签里能看到每个任务的排队、运行、失败状态，可以取消排队、重试、断点续跑。任务失败时先看拦截原因：多数情况是额度用尽、凭证未配置，或触发了防重封锁。
            </p>

            <h3 className="gd-h3">配额与护栏</h3>
            <p className="gd-p">
              配额分日、月两道，按 UTC 零点重置。额度为 0 时不会发起任何请求。付费渠道出现「已启动但未确认」的任务时，系统会封锁该来源的自动采集，需要管理员确认后解除——这是为了防止同一批请求被重复计费。看到侧边栏配额条变色或通知铃出现红点，先去「渠道配额与策略」看一眼。
            </p>

            <h3 className="gd-h3">服务商凭证</h3>
            <p className="gd-p">
              Apify、TwitterAPIs、ScrapeBadger 的密钥统一在「第三方采集密钥」里配置，加密存放，保存后即时生效。密钥只存在于服务端，浏览器端不落盘、不写入 localStorage；浏览器一律走同源会话 Cookie。
            </p>
          </Section>

          <Section
            id="workspace"
            num="08"
            title="个人工作区"
            lede="工作区只放两样东西：你保存的查询，和你写过批注的收藏。"
          >
            <div className="gd-cards3">
              <div className="gd-minicard">
                <b>保存的查询</b>
                <p>带名字的检索口径，一键重跑，结果直接回到检索页。适合周报、月报的固定统计。</p>
              </div>
              <div className="gd-minicard">
                <b>批注与收藏</b>
                <p>标星即收藏，写字即批注，最多 2000 字。两人同时改同一条会触发冲突提示，本地草稿会保留。</p>
              </div>
              <div className="gd-minicard">
                <b>角色说明</b>
                <p>即使你是 viewer，个人工作区也完全可读写——这里放的是你自己的研究笔记，不涉及团队治理。</p>
              </div>
            </div>

            <p className="gd-p">
              工作区是结论的落点。建议每天只做一件小事：把当天读到的三到五条证据加上一句判断存进来。一周之后，你就有一份可以交给同事的观察，而不是一堆散落的链接。
            </p>

            <Callout kind="tip" title="换设备不会丢">
              保存的查询与批注都存在服务端，换电脑或换浏览器登录同一账号即可看到；浏览器缓存只影响界面皮肤这类展示偏好。
            </Callout>
          </Section>

          <Section
            id="account"
            num="09"
            title="账户、权限与机器密钥"
            lede="设置页有五个标签，对应五件不同的事。日常最常用的两个是「成员与权限」和「机器 API 密钥」。"
          >
            <div className="gd-table-wrap">
              <table className="gd-table">
                <thead>
                  <tr>
                    <th>标签</th>
                    <th>用来做什么</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>当前账户与角色</td><td>查看你的会话身份、角色、权益层级（free / pro）与会话 ID</td></tr>
                  <tr><td>第三方采集密钥</td><td>配置 Apify / TwitterAPIs / ScrapeBadger 服务商密钥</td></tr>
                  <tr><td>成员与权限</td><td>签发一次性邀请码，查看成员列表与角色边界</td></tr>
                  <tr><td>机器 API 密钥</td><td>给程序和 AI Agent 用的密钥，按作用域授权</td></tr>
                  <tr><td>品牌标识与皮肤</td><td>30 套品牌标志、17 套配色皮肤与自定义调色</td></tr>
                </tbody>
              </table>
            </div>

            <h3 className="gd-h3">邀请同事加入</h3>
            <p className="gd-p">
              进「成员与权限」→「生成一次性邀请码」，可以设 1–90 天有效。72 位邀请码只能用一次，过期需要重新生成。权限边界：owner 能邀请 admin 与 viewer，admin 只能邀请 viewer。
            </p>

            <h3 className="gd-h3">机器 API 密钥：让程序替你取数</h3>
            <Steps
              items={[
                {
                  title: '进「机器 API 密钥」，填名称与有效期',
                  body: '有效期 1–90 天，建议按用途命名，例如 bi-export-sync、weekly-agent。',
                },
                {
                  title: '勾选作用域',
                  body: 'read 读内容、export 导出、ingest 推流写入、collect 触发采集、sources:write 改来源、projects:write 改项目。选了 ingest 就必须至少绑定一个来源，避免误写。',
                },
                {
                  title: '生成后立刻复制',
                  body: '43 位明文只显示这一次，服务端只存 SHA-256 哈希。关掉弹窗就再也看不到，丢了只能吊销重建。',
                },
                {
                  title: '在程序里用 Authorization 头调用',
                  body: '请求头写 Authorization: Bearer <密钥>，接口基址是 <你的域名>/api/v1。浏览器端不需要密钥，那是同源会话的事。',
                },
              ]}
            />

            <pre className="gd-code">{`curl "https://your-host/api/v1/content/stories?limit=20" \\
  -H "Authorization: Bearer $SIFTLINE_KEY"`}</pre>

            <Figure
              index={9}
              caption={
                <>
                  设置页。<b>①</b> 五个标签 <b>②</b> 密钥名称与有效期 <b>③</b> 作用域与一次性明文。
                </>
              }
            >
              <FigureSettings />
            </Figure>

            <Callout kind="note" title="密钥是「程序身份」，不是个人密码">
              不要把它写进前端代码、浏览器 localStorage、截图或聊天记录。一旦外泄，立刻在列表里吊销——吊销即时生效，旧密钥的请求会立刻被拒绝。
            </Callout>
          </Section>

          <Section
            id="faq"
            num="10"
            title="常见问题"
            lede="下面这些都是真实会遇到的情况，按「先排查什么」的顺序写。"
          >
            <div className="gd-faq">
              <div>
                <b>信息流是空的，怎么办？</b>
                <p>按顺序查三件事：一、筛选是否叠得太窄，点「重置筛选」；二、来源是否在运行（来源页看状态）；三、是否需要登录。自建部署如果关闭了外网采集，也不会有新数据进来。</p>
              </div>
              <div>
                <b>「已存样本口径」到底是什么意思？</b>
                <p>只用已经入库的样本计算，不估算、不插值、不生成缺失值。所以它宁可比你以为的少，也不会出现无出处的数字。</p>
              </div>
              <div>
                <b>趋势图的数字和「命中内容」对不上？</b>
                <p>两个原因：发布时间未知的条目不计入 UTC 日轴；开启讨论树感知后按讨论根去重。引用时请一并带上口径说明。</p>
              </div>
              <div>
                <b>为什么我不能新建项目？</b>
                <p>你是 viewer。viewer 可以读全部内容、可以写个人工作区，但项目与来源的增改删被锁定。需要改动时找 owner 或 admin 提权。</p>
              </div>
              <div>
                <b>采集被「封锁」了怎么办？</b>
                <p>说明该来源有付费渠道任务处于「已启动未确认」状态。等管理员核对后解除即可；连续点「立即采集」不会更快，反而可能触发防重封锁。</p>
              </div>
              <div>
                <b>讨论树提示「父链缺失」？</b>
                <p>上一级评论在源平台被删除了。系统把它标出来，而不是接到错误的父节点上。读到这类节点时，不要据此推断上下文。</p>
              </div>
              <div>
                <b>密钥丢了或者泄露了？</b>
                <p>进「机器 API 密钥」列表，吊销旧密钥，再新建一个。旧密钥立即失效，不需要重启服务。</p>
              </div>
              <div>
                <b>中文搜不到英文词？</b>
                <p>检索按字面切分，不做翻译。中英混排时把两种写法都放进 anyTerms，例如「账单 / billing / invoice」。</p>
              </div>
            </div>

            <h3 className="gd-h3">快捷键</h3>
            <Figure index={10} caption="常用的五个动作，键盘比鼠标快。">
              <FigureShortcuts />
            </Figure>
          </Section>

          <div className="gd-related">
            <p className="gd-eyebrow gd-eyebrow--plain">另请参阅</p>
            <div className="gd-related-grid">
              <button type="button" className="gd-relcard" onClick={() => onNavigate('/product')}>
                <b>产品介绍</b>
                <span>产品定位、能力边界与三种使用场景</span>
                <ChevronRight size={14} />
              </button>
              <button type="button" className="gd-relcard" onClick={() => go('/settings')}>
                <b>账户与权限</b>
                <span>会话身份、角色矩阵与成员邀请</span>
                <ChevronRight size={14} />
              </button>
              <button type="button" className="gd-relcard" onClick={() => go('/sources?tab=budgets')}>
                <b>渠道配额与策略</b>
                <span>日 / 月额度、采集护栏与服务商凭证</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="gd-feedback">
            <b>这篇文档有帮助吗？</b>
            {helpful ? (
              <span className="gd-thanks">
                <Check size={14} />
                谢谢反馈，我们会按这个方向继续补。
              </span>
            ) : (
              <div className="gd-fb-actions">
                <button type="button" onClick={() => setHelpful('yes')}>有帮助</button>
                <button type="button" onClick={() => setHelpful('no')}>还需要说明</button>
              </div>
            )}
          </div>

          <div className="gd-footnav">
            <button type="button" className="gd-btn" onClick={() => jump('start')}>
              <ChevronLeft size={14} />
              回到开头
            </button>
            <button type="button" className="gd-btn gd-btn--primary" onClick={() => (isAuthenticated ? onNavigate('/projects') : onOpenAuth())}>
              {isAuthenticated ? '进入工作台' : '登录后开始'}
              <ExternalLink size={13} />
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
