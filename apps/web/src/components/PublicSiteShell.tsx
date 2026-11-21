import React, { useState } from 'react';
import { ArrowUpRight, Globe, LogIn, Menu, RefreshCw, User, X } from 'lucide-react';
import type { Actor } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { SiftlineLogo } from './BrandMark';

export type PublicRoute = '/' | '/product' | '/ai' | '/docs' | '__not_found__';

interface PublicSiteShellProps {
  actor: Actor | null;
  route: PublicRoute;
  onNavigate: (path: string) => void;
  onOpenAuth: (tab?: 'login' | 'register', reason?: string, pendingTarget?: string) => void;
  onSwitchAccount: () => void;
  onOpenWorkbench: (targetPath?: string) => void;
  switchingAccount?: boolean;
  children: React.ReactNode;
}

export function PublicSiteShell({
  actor,
  route,
  onNavigate,
  onOpenAuth,
  onSwitchAccount,
  onOpenWorkbench,
  switchingAccount = false,
  children,
}: PublicSiteShellProps) {
  const { lang, setLang, t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: Array<{ path: Exclude<PublicRoute, '__not_found__'> | '/content'; label: string }> = [
    { path: '/', label: t('Stories', '信息流') },
    { path: '/content', label: t('Research', '研究分析') },
    { path: '/product', label: t('Product', '产品介绍') },
    { path: '/ai', label: t('AI News', 'AI 资讯') },
    { path: '/docs', label: t('Docs', '文档') },
  ];

  const go = (path: string) => {
    setMobileOpen(false);
    onNavigate(path);
  };

  return (
    <div className="ps-root">
      <header className="ps-header">
        <div className="ps-header-inner">
          <button
            type="button"
            className="ps-brand"
            onClick={() => go('/')}
            aria-label={t('SIFTLINE Home', 'SIFTLINE 首页')}
          >
            <SiftlineLogo size={28} fontSize={20} />
          </button>

          <nav className="ps-nav" aria-label={t('Public navigation', '公开导航')}>
            {navItems.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`ps-nav-link ${route === item.path ? 'is-active' : ''}`}
                aria-current={route === item.path ? 'page' : undefined}
                onClick={() => go(item.path)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ps-actions">
            <button
              type="button"
              className="ps-lang-btn"
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
              title={t('Switch Language', '切换语言')}
            >
              <Globe size={13} />
              <span>{lang === 'en' ? '中文' : 'English'}</span>
            </button>

            {actor ? (
              <>
                <span className="ps-account-chip" title={`${actor.email} (${actor.role})`}>
                  <User size={12} />
                  <span>{actor.email}</span>
                </span>
                <button
                  type="button"
                  className="sr-btn sr-btn--outline sr-btn--sm"
                  disabled={switchingAccount}
                  onClick={onSwitchAccount}
                >
                  <RefreshCw size={12} />
                  <span>{switchingAccount ? t('Switching...', '切换中…') : t('Switch Account', '切换账号')}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="sr-btn sr-btn--outline sr-btn--sm"
                onClick={() => onOpenAuth('login', undefined, '/projects')}
              >
                <LogIn size={13} />
                <span>{t('Sign In', '登录')}</span>
              </button>
            )}

            <button
              type="button"
              className="sr-btn sr-btn--dark sr-btn--sm"
              onClick={() => onOpenWorkbench('/projects')}
            >
              <span>{t('Open Workbench', '打开工作台')}</span>
              <ArrowUpRight size={13} />
            </button>
          </div>

          <button
            type="button"
            className="ps-mobile-toggle"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={t('Toggle menu', '展开菜单')}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <div className={`ps-mobile-menu ${mobileOpen ? 'is-open' : ''}`}>
          <nav className="ps-mobile-nav" aria-label={t('Mobile navigation', '移动端公开导航')}>
            {navItems.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`ps-nav-link ${route === item.path ? 'is-active' : ''}`}
                aria-current={route === item.path ? 'page' : undefined}
                onClick={() => go(item.path)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ps-mobile-actions">
            <button
              type="button"
              className="ps-lang-btn"
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            >
              <Globe size={13} />
              <span>{lang === 'en' ? '中文' : 'English'}</span>
            </button>
            {actor ? (
              <button
                type="button"
                className="sr-btn sr-btn--outline sr-btn--sm"
                disabled={switchingAccount}
                onClick={() => {
                  setMobileOpen(false);
                  onSwitchAccount();
                }}
              >
                {t('Switch Account', '切换账号')} ({actor.email.split('@')[0]})
              </button>
            ) : (
              <button
                type="button"
                className="sr-btn sr-btn--outline sr-btn--sm"
                onClick={() => {
                  setMobileOpen(false);
                  onOpenAuth('login', undefined, '/projects');
                }}
              >
                {t('Sign In', '登录')}
              </button>
            )}
            <button
              type="button"
              className="sr-btn sr-btn--dark sr-btn--sm"
              onClick={() => {
                setMobileOpen(false);
                onOpenWorkbench('/projects');
              }}
            >
              {t('Open Workbench', '打开工作台')}
            </button>
          </div>
        </div>
      </header>

      <main className="ps-main">{children}</main>

      <footer className="ps-footer">
        <div className="ps-footer-inner">
          <div className="ps-footer-brand">
            <SiftlineLogo size={24} fontSize={18} />
            <p>
              {t(
                'Research social conversations and follow stories from trusted sources, with evidence you can trace.',
                '研究社媒讨论、追踪可信信源的资讯，并回到原始证据。',
              )}
            </p>
          </div>

          <div className="ps-footer-col">
            <h4>{t('Public Site', '公开站点')}</h4>
            <ul>
              <li><button type="button" onClick={() => go('/')}>{t('Information Home', '公开信息首页')}</button></li>
              <li><button type="button" onClick={() => go('/product')}>{t('Product Overview', '产品介绍')}</button></li>
              <li><button type="button" onClick={() => go('/ai')}>{t('AI News (Upcoming)', 'AI 资讯（即将上线）')}</button></li>
              <li><button type="button" onClick={() => go('/docs')}>{t('Documentation', '公开文档')}</button></li>
            </ul>
          </div>

          <div className="ps-footer-col">
            <h4>{t('Workbench', '专业工作台')}</h4>
            <ul>
              <li><button type="button" onClick={() => go('/app/feed')}>{t('Full Stories Feed', '完整信息流 (/app/feed)')}</button></li>
              <li><button type="button" onClick={() => go('/content')}>{t('Content Explorer', '内容检索与分面')}</button></li>
              <li><button type="button" onClick={() => onOpenWorkbench('/projects')}>{t('Monitoring Projects', '专题监测总览')}</button></li>
              <li><button type="button" onClick={() => onOpenWorkbench('/sources')}>{t('Sources & Quotas', '来源与采集管理')}</button></li>
            </ul>
          </div>

          <div className="ps-footer-col">
            <h4>{t('Data Integrity', '数据与口径')}</h4>
            <ul>
              <li><button type="button" onClick={() => go('/docs#coverage')}>{t('Coverage: stored_sample', '样本口径：stored_sample')}</button></li>
              <li><button type="button" onClick={() => go('/docs#tiers')}>{t('Source Tiers (T1 / T1.5 / T2)', '来源分级：T1 / T1.5 / T2')}</button></li>
              <li><button type="button" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>{lang === 'en' ? '切换为简体中文' : 'Switch to English'}</button></li>
            </ul>
          </div>
        </div>

        <div className="ps-footer-bar">
          <span>© 2026 SIFTLINE · {t('Stored-sample traceable intelligence', '可追溯已存样本情报系统')}</span>
          <span>coverage: stored_sample</span>
        </div>
      </footer>
    </div>
  );
}
