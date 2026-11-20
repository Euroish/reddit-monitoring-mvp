import React, { createContext, useContext, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { LOGO_CATEGORIES, LogoCategory, SIFTLINE_LOGOS } from '../assets/logos';
import { useI18n } from '../i18n/translations';

interface LogoContextValue {
  activeIdx: number;
  setActiveIdx: (idx: number) => void;
  activeLogo: (typeof SIFTLINE_LOGOS)[number];
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
}

const LogoContext = createContext<LogoContextValue>({
  activeIdx: 0,
  setActiveIdx: () => {},
  activeLogo: SIFTLINE_LOGOS[0],
  switcherOpen: false,
  setSwitcherOpen: () => {},
});

const LOGO_STORAGE_KEY = 'siftline.activeLogoIdx';

export function LogoProvider({ children }: { children: React.ReactNode }) {
  const [activeIdx, setActiveIdxState] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(LOGO_STORAGE_KEY));
      return Number.isInteger(saved) && saved >= 0 && saved < SIFTLINE_LOGOS.length ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const setActiveIdx = (idx: number) => {
    const normalized = (idx + SIFTLINE_LOGOS.length) % SIFTLINE_LOGOS.length;
    setActiveIdxState(normalized);
    try {
      localStorage.setItem(LOGO_STORAGE_KEY, String(normalized));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!switcherOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') setActiveIdx(activeIdx - 1);
      else if (e.key === 'ArrowRight') setActiveIdx(activeIdx + 1);
      else if (e.key === 'Escape') setSwitcherOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switcherOpen, activeIdx]);

  return (
    <LogoContext.Provider
      value={{
        activeIdx,
        setActiveIdx,
        activeLogo: SIFTLINE_LOGOS[activeIdx],
        switcherOpen,
        setSwitcherOpen,
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
        aria-hidden="true"
      >
        <defs>
          {SIFTLINE_LOGOS.map((logo) => (
            <symbol key={logo.id} id={`sift-mark-${logo.id}`} viewBox="0 0 100 100">
              <path d={logo.path} />
            </symbol>
          ))}
        </defs>
      </svg>
      {children}
      {switcherOpen && <LogoSwitcherModal />}
    </LogoContext.Provider>
  );
}

export function useLogo() {
  return useContext(LogoContext);
}

export function SiftlineLogo({
  size = 28,
  showWordmark = true,
  fontSize = 21,
  subLabel,
}: {
  size?: number;
  showWordmark?: boolean;
  fontSize?: number;
  subLabel?: string;
}) {
  const { activeLogo } = useLogo();
  return (
    <span className="sift-lockup" style={{ fontSize }}>
      <svg className="sift-mark" style={{ width: size, height: size }} aria-hidden="true">
        <use href={`#sift-mark-${activeLogo.id}`} />
      </svg>
      {showWordmark && (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1 }}>
          <span>SIFTLINE</span>
          {subLabel && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0',
                opacity: 0.72,
                marginTop: 2,
              }}
            >
              {subLabel}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export function LogoSwitcherModal() {
  const { activeIdx, setActiveIdx, activeLogo, setSwitcherOpen } = useLogo();
  const { lang, t } = useI18n();
  const [cat, setCat] = useState<'all' | LogoCategory>('all');

  const filtered = SIFTLINE_LOGOS.map((item, idx) => ({ item, idx })).filter(
    ({ item }) => cat === 'all' || item.cat === cat,
  );

  return (
    <div className="sr-modal-backdrop" onClick={() => setSwitcherOpen(false)}>
      <div className="sr-modal logo-switcher-card" onClick={(e) => e.stopPropagation()}>
        <div className="logo-switcher-head">
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--purple)' }}>
              {t('Brand Mark Explorer · 30 Concepts', '品牌图标探索器 · 30 套矢量方案')}
            </div>
            <h3>{t('Switch SIFTLINE Logo Icon', '实时切换 SIFTLINE 标志图标')}</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              {t(
                'Click any mark or press ← / → arrow keys to preview across the homepage, workbench rail, and footer.',
                '点击任意图标或使用键盘 ← / → 方向键，即可全站同步预览首页、工作台侧栏与页脚图标。',
              )}
            </p>
          </div>
          <button
            className="sr-btn sr-btn--subtle sr-btn--xs"
            onClick={() => setSwitcherOpen(false)}
            aria-label="Close logo switcher"
          >
            <X size={15} />
          </button>
        </div>

        <div className="logo-switcher-toolbar">
          <div className="logo-cat-pills">
            {LOGO_CATEGORIES.map((c) => (
              <button
                key={c.key}
                className={`logo-cat-pill ${cat === c.key ? 'active' : ''}`}
                onClick={() => setCat(c.key)}
              >
                {lang === 'zh' ? c.labelZh : c.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
              {activeLogo.num} / {activeLogo.name}
            </span>
            <button
              className="sr-btn sr-btn--subtle sr-btn--xs"
              onClick={() => setActiveIdx(activeIdx - 1)}
              title={t('Previous (←)', '上一个 (←)')}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              className="sr-btn sr-btn--subtle sr-btn--xs"
              onClick={() => setActiveIdx(activeIdx + 1)}
              title={t('Next (→)', '下一个 (→)')}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="logo-picker-grid">
          {filtered.map(({ item, idx }) => (
            <button
              key={item.id}
              className={`logo-picker-cell ${idx === activeIdx ? 'active' : ''}`}
              onClick={() => setActiveIdx(idx)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="cell-title">
                  {item.num} / {item.name}
                </span>
                {idx === activeIdx && (
                  <span className="wb-pill wb-pill--purple">{t('Active', '当前')}</span>
                )}
              </div>
              <svg className="preview-lg" aria-hidden="true">
                <use href={`#sift-mark-${item.id}`} />
              </svg>
              <div className="sift-lockup" style={{ fontSize: 16, justifyContent: 'center' }}>
                <svg className="sift-mark" style={{ width: 22, height: 22 }}>
                  <use href={`#sift-mark-${item.id}`} />
                </svg>
                <span>SIFTLINE</span>
              </div>
              <div className="cell-meta">{item.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
