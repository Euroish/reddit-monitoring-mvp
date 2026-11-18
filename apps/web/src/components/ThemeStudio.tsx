import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Palette, RotateCcw, Sparkles, X } from 'lucide-react';
import { useI18n } from '../i18n/translations';
import {
  PRESET_THEMES,
  THEME_CATEGORIES,
  type ThemeCategory,
  type ThemePaletteInput,
  computeThemeVariables,
  mixHex,
  pickContrastInk,
} from '../styles/themes';
import { ThemeContext, useTheme } from './themeContext';

const STORAGE_THEME_ID = 'siftline.themeId';
const STORAGE_CUSTOM = 'siftline.customPalette';
const STORAGE_SYNC_WB = 'siftline.syncWorkbenchTheme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [activeThemeId, setActiveThemeId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_THEME_ID) || PRESET_THEMES[0].id;
    } catch {
      return PRESET_THEMES[0].id;
    }
  });

  const [customPalette, setCustomPalette] = useState<ThemePaletteInput>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CUSTOM);
      if (raw) {
        return { ...PRESET_THEMES[0], ...JSON.parse(raw), id: 'custom' };
      }
    } catch {
      // ignore
    }
    return {
      ...PRESET_THEMES[0],
      id: 'custom',
      category: 'core',
      nameEn: 'Custom Studio Palette',
      nameZh: '自定义配色方案',
      descEn: 'User-tuned brand tokens with automatic WCAG contrast adjustment.',
      descZh: '手动微调的核心色板，自动计算按钮与卡片的文字对比度。',
      tagEn: 'Custom',
      tagZh: '自定义',
    };
  });

  const [syncWorkbench, setSyncWorkbenchState] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(STORAGE_SYNC_WB);
      return v === null ? true : v === 'true';
    } catch {
      return true;
    }
  });

  const [studioOpen, setStudioOpen] = useState(false);

  const palette = useMemo(() => {
    if (activeThemeId === 'custom') return customPalette;
    return PRESET_THEMES.find((p) => p.id === activeThemeId) || PRESET_THEMES[0];
  }, [activeThemeId, customPalette]);

  useEffect(() => {
    const vars = computeThemeVariables(palette, syncWorkbench);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
  }, [palette, syncWorkbench]);

  const selectPreset = (id: string) => {
    setActiveThemeId(id);
    try {
      localStorage.setItem(STORAGE_THEME_ID, id);
    } catch {
      // ignore
    }
  };

  const setSyncWorkbench = (v: boolean) => {
    setSyncWorkbenchState(v);
    try {
      localStorage.setItem(STORAGE_SYNC_WB, String(v));
    } catch {
      // ignore
    }
  };

  const updateCustomColor = (field: keyof ThemePaletteInput, value: string | boolean) => {
    const base = activeThemeId === 'custom' ? customPalette : palette;
    const next: ThemePaletteInput = {
      ...base,
      id: 'custom',
      nameEn: 'Custom Studio Palette',
      nameZh: '自定义配色方案',
      descEn: 'User-tuned brand tokens with automatic WCAG contrast adjustment.',
      descZh: '手动微调的核心色板，自动计算按钮与卡片的文字对比度。',
      tagEn: 'Custom',
      tagZh: '自定义',
      [field]: value,
    };
    setCustomPalette(next);
    setActiveThemeId('custom');
    try {
      localStorage.setItem(STORAGE_THEME_ID, 'custom');
      localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const resetCustomToPreset = (baseId = PRESET_THEMES[0].id) => {
    const preset = PRESET_THEMES.find((p) => p.id === baseId) || PRESET_THEMES[0];
    setActiveThemeId(preset.id);
    try {
      localStorage.setItem(STORAGE_THEME_ID, preset.id);
    } catch {
      // ignore
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        activeThemeId,
        palette,
        syncWorkbench,
        setSyncWorkbench,
        selectPreset,
        updateCustomColor,
        resetCustomToPreset,
        studioOpen,
        setStudioOpen,
      }}
    >
      {children}
      {studioOpen && <ThemeStudioModal />}
    </ThemeContext.Provider>
  );
}

const COLOR_SLOTS: Array<{
  field: keyof ThemePaletteInput;
  labelEn: string;
  labelZh: string;
  roleEn: string;
  roleZh: string;
  gradientOnly?: boolean;
}> = [
  {
    field: 'accent',
    labelEn: 'Primary Accent',
    labelZh: '品牌主强调色',
    roleEn: 'Top bar, Hero CTA, Big promo card',
    roleZh: '顶栏、首屏 CTA 按钮、主推大卡起点色',
  },
  {
    field: 'accentEnd',
    labelEn: 'Accent Gradient End',
    labelZh: '主强调渐变终点色',
    roleEn: 'Second hue stop for gradient CTA & promo card',
    roleZh: '开启渐变时用于 CTA 与主推卡的双色过渡终点',
    gradientOnly: true,
  },
  {
    field: 'accentDeep',
    labelEn: 'Deep Brand / Link',
    labelZh: '深阶强调与图表主色',
    roleEn: 'Text links, Active tabs, Chart series #1',
    roleZh: '链接、激活下划线、主趋势柱/折线',
  },
  {
    field: 'accent2',
    labelEn: 'Companion Accent',
    labelZh: '双色协同辅色',
    roleEn: 'Hatch stripes, Active arrow gradient, Chart #2',
    roleZh: '斜线纹理、数据箭头渐变、图表系列 #2',
  },
  {
    field: 'heroTop',
    labelEn: 'Hero Top Wash',
    labelZh: '首屏顶部氛围底色',
    roleEn: 'Header glass & Hero upper atmospheric tint',
    roleZh: '吸顶导航玻璃态与首屏上半部分底色',
  },
  {
    field: 'heroBottom',
    labelEn: 'Hero Lower Wash',
    labelZh: '首屏过渡渐变底色',
    roleEn: 'Lower hero blend in gradient mode',
    roleZh: '渐变模式下首屏下半部柔光过渡色',
    gradientOnly: true,
  },
  {
    field: 'cardTint',
    labelEn: 'Capabilities Card',
    labelZh: '9类能力卡片底色',
    roleEn: 'Solutions carousel cards background',
    roleZh: 'Capabilities 轮播卡片浅底色',
  },
  {
    field: 'ink',
    labelEn: 'Dark Ink Anchor',
    labelZh: '深色锚点与主文字',
    roleEn: 'Headlines, Enterprise dark block, Index band',
    roleZh: '大标题文字、企业深色横幅、指数黑底区',
  },
];

export function ThemeStudioModal() {
  const { lang, t } = useI18n();
  const {
    activeThemeId,
    palette,
    syncWorkbench,
    setSyncWorkbench,
    selectPreset,
    updateCustomColor,
    resetCustomToPreset,
    setStudioOpen,
  } = useTheme();
  const [cat, setCat] = useState<'all' | ThemeCategory>('all');
  const [copiedCss, setCopiedCss] = useState(false);

  const visiblePresets = useMemo(
    () => PRESET_THEMES.filter((p) => cat === 'all' || p.category === cat),
    [cat],
  );

  const handleCopyCss = async () => {
    const vars = computeThemeVariables(palette, syncWorkbench);
    const snippet = `:root {\n${Object.entries(vars)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n')}\n}`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedCss(true);
      setTimeout(() => setCopiedCss(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="sr-modal-backdrop" onClick={() => setStudioOpen(false)}>
      <div
        className="sr-modal"
        style={{ width: 'min(1020px, 100%)', padding: '26px 28px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="logo-switcher-head" style={{ marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Palette size={13} />
              {t('Color Replacement Studio · 17 Curated Presets', '色彩替换工作台 · 17 套精细配色预设')}
            </div>
            <h3 style={{ marginTop: 4 }}>
              {t('Brand Palette, Gradient & Flat Solid Editions', '渐变探索与纯色扁平配色方案')}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              {t(
                'Includes 6 expressive Gradient editions, 6 pure Flat Solid editions, and 5 Core baselines — all preserving Semrush hierarchy without lavender-mint collision.',
                '包含 6 套双色流光渐变方案、6 套零渐变纯色扁平方案及 5 套核心基准，在不破坏 Semrush 排版与对比逻辑下提供差异化视觉表达。',
              )}
            </p>
          </div>
          <button
            type="button"
            className="sr-btn sr-btn--subtle sr-btn--xs"
            onClick={() => setStudioOpen(false)}
            aria-label="Close palette studio"
          >
            <X size={15} />
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div className="logo-switcher-toolbar" style={{ marginBottom: 16 }}>
          <div className="logo-cat-pills">
            {THEME_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`logo-cat-pill ${cat === c.key ? 'active' : ''}`}
                onClick={() => setCat(c.key)}
              >
                {lang === 'zh' ? c.labelZh : c.labelEn}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
            {t('Active:', '当前：')} {lang === 'zh' ? palette.nameZh : palette.nameEn}
          </span>
        </div>

        {/* Preset Swatch Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(275px, 1fr))', gap: 12, marginBottom: 22 }}>
          {visiblePresets.map((preset) => {
            const active = activeThemeId === preset.id;
            const endAcc = preset.accentEnd || mixHex(preset.accent, preset.accent2, 0.28);
            const accContrast = pickContrastInk(preset.accent, preset.ink, preset.hasGradient ? endAcc : undefined);
            const heroBg = preset.hasGradient
              ? `linear-gradient(165deg, ${preset.heroTop} 0%, ${preset.heroBottom} 100%)`
              : preset.heroTop;
            const ctaBg = preset.hasGradient
              ? `linear-gradient(135deg, ${preset.accent} 0%, ${endAcc} 100%)`
              : preset.accent;
            const cardBg = preset.hasGradient
              ? `linear-gradient(155deg, ${preset.cardTint} 0%, ${preset.heroBottom} 100%)`
              : preset.cardTint;
            const darkBg = preset.hasGradient
              ? `linear-gradient(135deg, ${preset.ink} 0%, ${preset.darkEnd || mixHex(preset.ink, preset.accentDeep, 0.16)} 100%)`
              : preset.ink;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset.id)}
                style={{
                  textAlign: 'left',
                  padding: 13,
                  borderRadius: 6,
                  border: `1.5px solid ${active ? 'var(--ink)' : 'var(--wb-border)'}`,
                  background: active ? 'var(--paper)' : 'var(--white)',
                  boxShadow: active ? '0 0 0 2px rgba(var(--accent-deep-rgb), 0.16)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 9,
                }}
              >
                {/* Miniature Semrush Layout Swatch Preview */}
                <div
                  style={{
                    height: 60,
                    borderRadius: 4,
                    overflow: 'hidden',
                    display: 'grid',
                    gridTemplateColumns: '1.15fr 1.25fr 0.85fr 0.75fr',
                    border: '1px solid rgba(0,0,0,0.08)',
                  }}
                >
                  <div style={{ background: heroBg, padding: 6, display: 'flex', alignItems: 'flex-end' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: preset.ink }}>Hero</span>
                  </div>
                  <div style={{ background: ctaBg, padding: 6, display: 'flex', alignItems: 'flex-end' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: accContrast.text }}>
                      CTA
                    </span>
                  </div>
                  <div style={{ background: cardBg, padding: 6, display: 'flex', alignItems: 'flex-end' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: preset.ink }}>Card</span>
                  </div>
                  <div style={{ background: darkBg, padding: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>Dark</span>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: preset.accent2 }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <strong style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                      {lang === 'zh' ? preset.nameZh : preset.nameEn}
                    </strong>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span className={`wb-pill ${preset.hasGradient ? 'wb-pill--teal' : 'wb-pill--neutral'}`}>
                        {preset.hasGradient ? t('Gradient', '渐变') : t('Flat', '纯色')}
                      </span>
                      {active && (
                        <span className="wb-pill wb-pill--purple">
                          <Check size={10} />
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: preset.accentDeep, marginTop: 2 }}>
                    {lang === 'zh' ? preset.tagZh : preset.tagEn}
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.42 }}>
                    {lang === 'zh' ? preset.descZh : preset.descEn}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Custom Slot Editor */}
        <div
          style={{
            border: '1px solid var(--wb-border)',
            borderRadius: 6,
            padding: 16,
            background: 'var(--paper)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={15} color="var(--purple)" />
              <strong style={{ fontSize: 14 }}>
                {t('Custom Role Color Replacement', '自定义色彩角色微调')}
              </strong>
              {activeThemeId === 'custom' && (
                <span className="wb-pill wb-pill--purple">{t('Custom Active', '当前使用自定义色板')}</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={palette.hasGradient}
                  onChange={(e) => updateCustomColor('hasGradient', e.target.checked)}
                />
                <span>{t('Enable Gradient Mode', '开启渐变渲染模式')}</span>
              </label>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={syncWorkbench}
                  onChange={(e) => setSyncWorkbench(e.target.checked)}
                />
                <span>{t('Sync accent to Workbench', '工作台同步跟随主辅色调')}</span>
              </label>

              <button
                type="button"
                className="sr-btn sr-btn--subtle sr-btn--xs"
                onClick={handleCopyCss}
              >
                {copiedCss ? <Check size={12} /> : <Copy size={12} />}
                {copiedCss ? t('CSS Copied', '已复制 CSS 变量') : t('Copy CSS Tokens', '导出 CSS 变量')}
              </button>

              <button
                type="button"
                className="sr-btn sr-btn--subtle sr-btn--xs"
                onClick={() => resetCustomToPreset(PRESET_THEMES[0].id)}
              >
                <RotateCcw size={12} /> {t('Reset', '重置默认')}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
            {COLOR_SLOTS.filter((slot) => !slot.gradientOnly || palette.hasGradient).map((slot) => {
              const raw = palette[slot.field];
              const val = typeof raw === 'string' && raw ? raw : mixHex(palette.accent, palette.accent2, 0.28);
              return (
                <div
                  key={slot.field}
                  style={{
                    background: 'var(--white)',
                    border: '1px solid var(--wb-border-soft)',
                    borderRadius: 6,
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <input
                    type="color"
                    value={val}
                    onChange={(e) => updateCustomColor(slot.field, e.target.value)}
                    aria-label={slot.labelEn}
                    style={{
                      width: 34,
                      height: 34,
                      border: '1px solid var(--wb-border)',
                      borderRadius: 5,
                      padding: 2,
                      background: 'transparent',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <strong style={{ fontSize: 12 }}>{lang === 'zh' ? slot.labelZh : slot.labelEn}</strong>
                      <code style={{ fontSize: 11, color: 'var(--muted)' }}>{val.toUpperCase()}</code>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {lang === 'zh' ? slot.roleZh : slot.roleEn}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
