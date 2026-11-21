import type { MouseEvent } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { useI18n } from '../i18n/translations';
import { SiftlineLogo } from './BrandMark';
import '../styles/editorial-footer.css';

interface EditorialFooterProps {
  onNavigate: (path: string) => void;
  onOpenWorkbench: (targetPath?: string) => void;
}

const workbenchPath = '/projects';

export function EditorialFooter({ onNavigate, onOpenWorkbench }: EditorialFooterProps) {
  const { lang, setLang, t } = useI18n();
  const groups = [
    {
      title: t('Explore', '探索'),
      links: [
        { path: '/', label: t('Information Feed', '信息流') },
        { path: '/ai', label: t('AI News', 'AI 资讯') },
        { path: '/product', label: t('Product Overview', '产品介绍') },
      ],
    },
    {
      title: t('Product & Resources', '产品与资源'),
      links: [
        { path: workbenchPath, label: t('Workbench', '工作台') },
        { path: '/docs', label: t('Documentation', '文档中心') },
        { path: '/guide', label: t('Product Guide', '产品指南') },
      ],
    },
    {
      title: t('Transparency & Support', '透明与支持'),
      links: [
        {
          path: '/docs',
          label: t('Data Sources & Coverage', '数据来源与口径'),
          title: t('See “Reading the feed” in the product guide', '参阅置顶产品使用说明中的「阅读信息流」'),
        },
        { path: '/guide', label: t('User Instructions', '使用说明') },
      ],
    },
  ];

  function follow(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (path === workbenchPath) {
      onOpenWorkbench(path);
    } else {
      onNavigate(path);
    }
  }

  return (
    <footer className="ef-footer" lang={lang === 'zh' ? 'zh-Hans' : 'en'}>
      <section className="ef-cta" aria-labelledby="ef-cta-title">
        <div className="ef-inner">
          <p className="ef-eyebrow" lang="en">SIFTLINE · SIGNAL INTELLIGENCE</p>
          <h2 id="ef-cta-title">{t('Make every important change traceable.', '让每一次重要变化，都有迹可循。')}</h2>
          <p className="ef-lede">
            {t(
              'From real-time discussions to model releases, connect what matters with sources you can trust.',
              '从实时讨论到模型发布，连接值得关注的信息与可信来源。',
            )}
          </p>
          <div className="ef-actions">
            <a className="ef-action ef-action-primary" href={workbenchPath} onClick={(event) => follow(event, workbenchPath)}>
              {t('Open Workbench', '打开工作台')} <ArrowRight aria-hidden="true" size={20} />
            </a>
            <a className="ef-action" href="/ai" onClick={(event) => follow(event, '/ai')}>
              {t('Explore AI News', '探索 AI 资讯')} <ArrowRight aria-hidden="true" size={20} />
            </a>
          </div>
        </div>
      </section>

      <div className="ef-links-surface">
        <div className="ef-inner">
          <nav className="ef-links-grid" aria-label={t('Footer navigation', '页脚导航')}>
            <div className="ef-brand">
              <SiftlineLogo size={34} fontSize={32} />
              <p>
                {t(
                  'SIFTLINE connects the public information feed, AI news, and a research workbench in one place to discover signals.',
                  'SIFTLINE 将公开信息流、AI 资讯与研究工作台连接为统一的信号发现体验。',
                )}
              </p>
            </div>
            {groups.map(({ title, links }) => (
              <div className="ef-link-group" key={title}>
                <h3>{title}</h3>
                <ul>
                  {links.map(({ label, path, title: hint }) => (
                    <li key={path}>
                      <a href={path} title={hint} onClick={(event) => follow(event, path)}>{label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="ef-legal">
            <small>© {new Date().getFullYear()} SIFTLINE</small>
            <div className="ef-language">
              <select
                aria-label={t('Language', '语言')}
                value={lang}
                onChange={(event) => setLang(event.target.value === 'en' ? 'en' : 'zh')}
              >
                <option value="zh" lang="zh-Hans">简体中文</option>
                <option value="en" lang="en">English</option>
              </select>
              <ChevronDown aria-hidden="true" size={16} />
            </div>
          </div>
        </div>
      </div>

      <div className="ef-wordmark-band" lang="en">
        <p className="ef-wordmark" aria-hidden="true">SIFTLINE</p>
        <p className="ef-tagline">DISCOVER WHAT MATTERS.</p>
      </div>
    </footer>
  );
}
