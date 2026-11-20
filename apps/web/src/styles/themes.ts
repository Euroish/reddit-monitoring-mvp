export type ThemeCategory = 'core' | 'gradient' | 'flat';

export interface ThemePaletteInput {
  id: string;
  category: ThemeCategory;
  hasGradient: boolean;
  nameEn: string;
  nameZh: string;
  descEn: string;
  descZh: string;
  tagEn: string;
  tagZh: string;
  heroTop: string;      // Upper hero atmospheric tint
  heroBottom: string;   // Lower hero wash (used when hasGradient=true)
  cardTint: string;     // Capabilities carousel card bg
  accent: string;       // Primary promo card, announcement bar, primary pill CTA
  accentEnd?: string;   // Secondary stop for gradient mode
  accentDeep: string;   // High-contrast link / chart #1 / active border
  accent2: string;      // Companion chart #2 / gradient partner
  chart1?: string;      // Distinct primary workbench series override
  chart2?: string;      // Distinct secondary workbench series override
  ink: string;          // Structural dark blocks & primary typography
  darkEnd?: string;     // Secondary dark stop for gradient mode
  mcpSurface: string;   // Secondary promo card neutral tint
}

export const THEME_CATEGORIES: Array<{
  key: 'all' | ThemeCategory;
  labelEn: string;
  labelZh: string;
}> = [
  { key: 'all', labelEn: 'All (17)', labelZh: '全部 (17)' },
  { key: 'gradient', labelEn: 'Gradient Editions (6)', labelZh: '渐变探索 (6)' },
  { key: 'flat', labelEn: 'Flat / Solid Editions (6)', labelZh: '纯色扁平 (6)' },
  { key: 'core', labelEn: 'Core & Baseline (5)', labelZh: '核心基础 (5)' },
];

export const PRESET_THEMES: ThemePaletteInput[] = [
  // === 5 CORE PRESETS ===
  {
    id: 'mineral-citron',
    category: 'core',
    hasGradient: true,
    nameEn: 'Mineral & Citron',
    nameZh: '矿物青 × 酸性柠檬黄',
    descEn: 'Shifts primary expression from Semrush lavender to Acid Citron & Teal while keeping Mineral Opal airiness.',
    descZh: '保留矿物绿通透氛围，用《定义稿》原生的酸性柠檬黄与深青绿替换 Semrush 标志紫，彻底避免撞衫。',
    tagEn: 'Core · Anti-Clash Default',
    tagZh: '默认主推 · 去紫防撞衫',
    heroTop: '#d4e9e5',
    heroBottom: '#edf6d8',
    cardTint: '#d8ebe7',
    accent: '#dbf477',
    accentEnd: '#cbe86b',
    accentDeep: '#1f7471',
    accent2: '#258c89',
    chart1: '#1f7471',
    chart2: '#527bc5',
    ink: '#20271f',
    mcpSurface: '#f4f6f2',
  },
  {
    id: 'glacier-cobalt',
    category: 'core',
    hasGradient: true,
    nameEn: 'Glacier & Electric Cobalt',
    nameZh: '冰川青灰 × 锐利钴蓝',
    descEn: 'Cool research-grade ice blue hero paired with high-contrast Electric Cobalt promo surfaces and Slate ink.',
    descZh: '冷静专业的科研/金融情报色调：冰川蓝渐变首屏搭配高饱和电光钴蓝行动区与深海岩灰主文字。',
    tagEn: 'Core · Enterprise Intelligence',
    tagZh: '核心 · 企业级情报蓝',
    heroTop: '#dde9f8',
    heroBottom: '#e7ecfc',
    cardTint: '#e3ecf8',
    accent: '#4c6ef5',
    accentEnd: '#3b5bdb',
    accentDeep: '#3b5bdb',
    accent2: '#0ea5a4',
    ink: '#131b26',
    mcpSurface: '#f3f5fa',
  },
  {
    id: 'warm-apricot',
    category: 'core',
    hasGradient: true,
    nameEn: 'Alabaster & Soft Apricot',
    nameZh: '暖砂石 × 柔杏橘',
    descEn: 'Warm editorial paper paired with Soft Apricot highlights, deep terracotta links, and Espresso charcoal blocks.',
    descZh: '极具人文研究杂志质感的暖调系统：柔杏橘主推卡搭配深烘浓缩黑底区块与青绿辅助线，高级耐看。',
    tagEn: 'Core · Editorial Warmth',
    tagZh: '核心 · 人文研报暖调',
    heroTop: '#f4ece1',
    heroBottom: '#fce9da',
    cardTint: '#f2eae0',
    accent: '#f5ae78',
    accentEnd: '#f09d65',
    accentDeep: '#b84c20',
    accent2: '#258c89',
    ink: '#231a16',
    mcpSurface: '#f7f4f0',
  },
  {
    id: 'seafoam-mint',
    category: 'core',
    hasGradient: true,
    nameEn: 'Seafoam & Electric Mint',
    nameZh: '海盐雾 × 极光翡翠',
    descEn: 'Crisp seafoam gradients with high-energy electric mint buttons and deep obsidian pine showcase blocks.',
    descZh: '高识别度观测平台风格：海盐薄荷首屏叠加高亮翡翠绿行动按钮，呈现全天候信号雷达的科技感。',
    tagEn: 'Core · Observability Tech',
    tagZh: '核心 · 观测雷达科技感',
    heroTop: '#dcf3ea',
    heroBottom: '#d9f4ef',
    cardTint: '#ddf1e8',
    accent: '#63e6be',
    accentEnd: '#38d9a9',
    accentDeep: '#0f766e',
    accent2: '#3b82f6',
    ink: '#10221b',
    mcpSurface: '#f2f7f5',
  },
  {
    id: 'wisteria-baseline',
    category: 'core',
    hasGradient: true,
    nameEn: 'Wisteria Reference',
    nameZh: '紫藤原色对照版',
    descEn: 'Original Opal & Digital Wisteria pairing aligned with Semrush 2026 homepage for A/B comparison.',
    descZh: '保留原版矿物绿与数字紫藤配色，方便与其余创新方案进行一键 A/B 对比。',
    tagEn: 'Core · Original Baseline',
    tagZh: '核心 · 原版对照参考',
    heroTop: '#d8ede8',
    heroBottom: '#ece6fa',
    cardTint: '#d4e9e5',
    accent: '#b7a5ed',
    accentEnd: '#a68ee8',
    accentDeep: '#7659bd',
    accent2: '#258c89',
    ink: '#20271f',
    mcpSurface: '#f3f6f6',
  },

  // === 6 NEW GRADIENT EDITIONS ===
  {
    id: 'aurora-jade-gold',
    category: 'gradient',
    hasGradient: true,
    nameEn: 'Aurora Jade & Champagne',
    nameZh: '极光翠玉 × 香槟流金',
    descEn: 'Luminous jade-to-champagne diagonal gradients with deep emerald typography and warm brass accents.',
    descZh: '翠玉薄荷向香槟流金平滑过渡的对角渐变，配合深墨松绿标题，兼具科技敏锐度与高级奢感。',
    tagEn: 'Gradient · Jade → Champagne',
    tagZh: '渐变 · 翠玉流金',
    heroTop: '#d8efe8',
    heroBottom: '#f7f1d5',
    cardTint: '#dbeee6',
    accent: '#c8f09c',
    accentEnd: '#f5dc7f',
    accentDeep: '#176d5b',
    accent2: '#258c89',
    chart1: '#176d5b',
    chart2: '#c5832b',
    ink: '#17261f',
    darkEnd: '#1f362c',
    mcpSurface: '#f6f6ef',
  },
  {
    id: 'nordic-azure-iris',
    category: 'gradient',
    hasGradient: true,
    nameEn: 'Horizon Azure & Indigo',
    nameZh: '晨曦天蓝 × 暮靛光晕',
    descEn: 'Crisp cloud-blue hero melting into periwinkle mist, anchored by a vivid cobalt-to-indigo CTA gradient.',
    descZh: '云端晴蓝渐变为柔和暮靛雾，主卡与按钮采用电光钴蓝到深靛的双色流光渐变，极具现代云平台质感。',
    tagEn: 'Gradient · Cobalt → Indigo',
    tagZh: '渐变 · 钴蓝暮靛',
    heroTop: '#dceeff',
    heroBottom: '#ebe6ff',
    cardTint: '#e1ecfe',
    accent: '#2f6fed',
    accentEnd: '#684ff2',
    accentDeep: '#2b52c7',
    accent2: '#0ea5e9',
    chart1: '#2b52c7',
    chart2: '#0ea5e9',
    ink: '#101829',
    darkEnd: '#1b2645',
    mcpSurface: '#f3f5fc',
  },
  {
    id: 'velvet-plum-rose',
    category: 'gradient',
    hasGradient: true,
    nameEn: 'Rose Berry & Sunset Coral',
    nameZh: '玫瑰梅红 × 落日珊瑚',
    descEn: 'Blush-to-peach atmospheric wash paired with a confident berry-to-coral gradient card and deep plum dark blocks.',
    descZh: '柔雾粉砂渐变底色搭配浆果红至落日珊瑚的暖调双色渐变卡片，深色区块呈暗梅黑，醒目却不刺眼。',
    tagEn: 'Gradient · Berry → Coral',
    tagZh: '渐变 · 浆果珊瑚',
    heroTop: '#f6e7ec',
    heroBottom: '#f9ebe0',
    cardTint: '#f5e8ea',
    accent: '#d64873',
    accentEnd: '#ed7d58',
    accentDeep: '#b02d54',
    accent2: '#287e85',
    chart1: '#b02d54',
    chart2: '#287e85',
    ink: '#24141c',
    darkEnd: '#381e2b',
    mcpSurface: '#f9f3f3',
  },
  {
    id: 'solar-amber-citrus',
    category: 'gradient',
    hasGradient: true,
    nameEn: 'Solar Amber & Peach Silk',
    nameZh: '晴空琥珀 × 蜜桃丝绒',
    descEn: 'Sunlit honey-amber flowing into warm peach silk with dark espresso ink and mineral teal contrast.',
    descZh: '阳光琥珀金平滑过渡到柔润蜜桃橘，用深烘咖黑压住视觉重心，适合增长洞察与品牌声量主题。',
    tagEn: 'Gradient · Amber → Peach',
    tagZh: '渐变 · 琥珀蜜桃',
    heroTop: '#fcf0db',
    heroBottom: '#fbe4da',
    cardTint: '#faede0',
    accent: '#ffd06b',
    accentEnd: '#f59976',
    accentDeep: '#b44e16',
    accent2: '#1f807c',
    chart1: '#b44e16',
    chart2: '#1f807c',
    ink: '#261a12',
    darkEnd: '#3a2719',
    mcpSurface: '#f9f5f0',
  },
  {
    id: 'cyber-cyan-emerald',
    category: 'gradient',
    hasGradient: true,
    nameEn: 'Lagoon Aqua & Lime Glow',
    nameZh: '深海泻湖 × 霓虹青柠',
    descEn: 'Refreshed lagoon-to-mint atmospheric wash and vivid aqua-emerald gradient cards for real-time telemetry.',
    descZh: '清透泻湖青向初春嫩绿流转的高光渐变体系，呈现出高频信号捕手般的灵动速度感。',
    tagEn: 'Gradient · Aqua → Mint',
    tagZh: '渐变 · 泻湖青柠',
    heroTop: '#d9f4f7',
    heroBottom: '#e3f7dd',
    cardTint: '#dcf3f2',
    accent: '#6ce6df',
    accentEnd: '#98ef8a',
    accentDeep: '#0a6f75',
    accent2: '#2d68d8',
    chart1: '#0a6f75',
    chart2: '#2d68d8',
    ink: '#0e2022',
    darkEnd: '#143034',
    mcpSurface: '#f2f8f8',
  },
  {
    id: 'midnight-ocean-teal',
    category: 'gradient',
    hasGradient: true,
    nameEn: 'Deep Tide & Seafoam',
    nameZh: '深潮青蓝 × 海盐薄雾',
    descEn: 'Architectural slate-mist hero paired with a deep pelagic cyan-to-emerald gradient card and crisp white type.',
    descZh: '海盐薄雾浅底衬托深海青蓝至翡翠绿的沉稳渐变主卡，自带数据大厂的稳健信赖气质。',
    tagEn: 'Gradient · Ocean → Emerald',
    tagZh: '渐变 · 深潮翡翠',
    heroTop: '#e1edf3',
    heroBottom: '#ddf2ea',
    cardTint: '#dfeef1',
    accent: '#0d7591',
    accentEnd: '#13997d',
    accentDeep: '#0b6178',
    accent2: '#de783f',
    chart1: '#0b6178',
    chart2: '#de783f',
    ink: '#0d1d24',
    darkEnd: '#162f3a',
    mcpSurface: '#f2f6f8',
  },

  // === 6 NEW FLAT / SOLID EDITIONS (ZERO GRADIENTS) ===
  {
    id: 'swiss-cobalt-paper',
    category: 'flat',
    hasGradient: false,
    nameEn: 'Swiss Paper & Klein Cobalt',
    nameZh: '瑞士纯纸 × 克莱因钴蓝',
    descEn: 'Zero-gradient Swiss modernism: matte ice-paper blocks, bold pure Klein Cobalt card, and sharp charcoal ink.',
    descZh: '零渐变纯粹瑞士平面主义：哑光冷纸底色、纯正克莱因钴蓝主推卡与高反差黑字，极简利落。',
    tagEn: 'Flat Solid · Swiss Modern',
    tagZh: '纯色扁平 · 瑞士极简',
    heroTop: '#edf2fb',
    heroBottom: '#edf2fb',
    cardTint: '#e6edf9',
    accent: '#2351e8',
    accentDeep: '#1a40bf',
    accent2: '#12947f',
    chart1: '#1a40bf',
    chart2: '#12947f',
    ink: '#111827',
    mcpSurface: '#f4f6fa',
  },
  {
    id: 'botanical-olive-sand',
    category: 'flat',
    hasGradient: false,
    nameEn: 'Botanical Sage & Olive',
    nameZh: '植物鼠尾草 × 橄榄青黄',
    descEn: 'Calm ungraded botanical sage surfaces paired with solid olive-lime accents and forest charcoal typography.',
    descZh: '不带任何渐变的纯色植物系：鼠尾草灰绿背景配合橄榄青黄高亮卡，温润耐看且长时间阅读不累眼。',
    tagEn: 'Flat Solid · Botanical',
    tagZh: '纯色扁平 · 植物鼠尾草',
    heroTop: '#edf1e9',
    heroBottom: '#edf1e9',
    cardTint: '#e4ebe0',
    accent: '#cbe378',
    accentDeep: '#3a6225',
    accent2: '#258c89',
    chart1: '#3a6225',
    chart2: '#258c89',
    ink: '#1e241b',
    mcpSurface: '#f5f6f2',
  },
  {
    id: 'terracotta-linen',
    category: 'flat',
    hasGradient: false,
    nameEn: 'Linen Stone & Terracotta',
    nameZh: '亚麻砂石 × 赤陶朱砂',
    descEn: 'Pure matte warm-linen canvas with architectural burnt terracotta blocks and contrasting deep teal graphics.',
    descZh: '纯哑光亚麻砂石白配高辨识度赤陶朱砂纯色主卡，以深青绿线条做冷暖平衡，如精装研报般扎实。',
    tagEn: 'Flat Solid · Editorial Print',
    tagZh: '纯色扁平 · 赤陶印刷',
    heroTop: '#f3ede6',
    heroBottom: '#f3ede6',
    cardTint: '#ede6dd',
    accent: '#d95338',
    accentDeep: '#b23b23',
    accent2: '#1f7a78',
    chart1: '#b23b23',
    chart2: '#1f7a78',
    ink: '#221b18',
    mcpSurface: '#f7f4f0',
  },
  {
    id: 'graphite-amber-signal',
    category: 'flat',
    hasGradient: false,
    nameEn: 'Graphite Fog & Signal Gold',
    nameZh: '石墨雾灰 × 工业信号金',
    descEn: 'Industrial precision without gradients: warm stone fog, solid signal-amber focal card, and crisp graphite ink.',
    descZh: '无渐变工业仪表风格：中性石墨雾灰底色配上纯色信号琥珀金主按钮，聚焦度与阅读清晰度极高。',
    tagEn: 'Flat Solid · Industrial',
    tagZh: '纯色扁平 · 工业信号金',
    heroTop: '#f1f1ed',
    heroBottom: '#f1f1ed',
    cardTint: '#e8e8e2',
    accent: '#f5c344',
    accentDeep: '#996008',
    accent2: '#2d68c4',
    chart1: '#996008',
    chart2: '#2d68c4',
    ink: '#1c1d1a',
    mcpSurface: '#f6f6f3',
  },
  {
    id: 'ice-sky-navy',
    category: 'flat',
    hasGradient: false,
    nameEn: 'Frost Sky & Deep Navy',
    nameZh: '纯霜冰蓝 × 深海墨蓝',
    descEn: 'Clean flat sky-frost tint paired with vivid solid sky-cyan accents and authoritative deep navy dark sections.',
    descZh: '全平面纯色冰霜浅蓝搭配明快天青行动卡，深色区采用深邃海军墨蓝，干练克制且毫无廉价感。',
    tagEn: 'Flat Solid · Crisp Frost',
    tagZh: '纯色扁平 · 冰霜海蓝',
    heroTop: '#eaf4fb',
    heroBottom: '#eaf4fb',
    cardTint: '#e1eff9',
    accent: '#7cd4fd',
    accentDeep: '#0369a1',
    accent2: '#4f46e5',
    chart1: '#0369a1',
    chart2: '#4f46e5',
    ink: '#0f1f33',
    mcpSurface: '#f3f7fa',
  },
  {
    id: 'matcha-charcoal',
    category: 'flat',
    hasGradient: false,
    nameEn: 'Kyoto Matcha & Sumi Ink',
    nameZh: '京都抹茶 × 墨黑纯色',
    descEn: 'Serene flat matcha-tint hero, solid forest-jade primary card with crisp white text, and deep sumi ink.',
    descZh: '克制沉静的纯色抹茶绿与翠林主卡（白字反衬），辅以暖赭色点缀，打造独特的中式/日式精研气质。',
    tagEn: 'Flat Solid · Serene Jade',
    tagZh: '纯色扁平 · 抹茶墨韵',
    heroTop: '#eaf2e9',
    heroBottom: '#eaf2e9',
    cardTint: '#e1ece0',
    accent: '#378757',
    accentDeep: '#276640',
    accent2: '#c97834',
    chart1: '#276640',
    chart2: '#c97834',
    ink: '#18211b',
    mcpSurface: '#f4f7f3',
  },
];

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [32, 39, 31];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function mixHex(hexA: string, hexB: string, ratioB: number): string {
  const [r1, g1, b1] = parseHex(hexA);
  const [r2, g2, b2] = parseHex(hexB);
  const t = Math.max(0, Math.min(1, ratioB));
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function hexRgbTuple(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return `${r}, ${g}, ${b}`;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pickContrastInk(bgHex: string, darkInk: string, bgEndHex?: string): { text: string; muted: string; isDarkBg: boolean } {
  const lumA = relativeLuminance(bgHex);
  const lumB = bgEndHex ? relativeLuminance(bgEndHex) : lumA;
  const lum = (lumA + lumB) / 2;
  if (lum < 0.36) {
    return { text: '#ffffff', muted: 'rgba(255, 255, 255, 0.86)', isDarkBg: true };
  }
  return { text: darkInk, muted: `rgba(${hexRgbTuple(darkInk)}, 0.82)`, isDarkBg: false };
}

export function computeThemeVariables(
  palette: ThemePaletteInput,
  syncWorkbench: boolean,
): Record<string, string> {
  const inkRgb = hexRgbTuple(palette.ink);
  const accentRgb = hexRgbTuple(palette.accent);
  const accentDeepRgb = hexRgbTuple(palette.accentDeep);
  const accent2Rgb = hexRgbTuple(palette.accent2);
  const heroTopRgb = hexRgbTuple(palette.heroTop);
  const endAccent = palette.accentEnd || mixHex(palette.accent, palette.accent2, 0.28);
  const contrast = pickContrastInk(palette.accent, palette.ink, palette.hasGradient ? endAccent : undefined);

  const hoverStart = contrast.isDarkBg
    ? mixHex(palette.accent, '#000000', 0.1)
    : mixHex(palette.accent, '#ffffff', 0.16);
  const hoverEnd = contrast.isDarkBg
    ? mixHex(endAccent, '#000000', 0.1)
    : mixHex(endAccent, '#ffffff', 0.16);

  const heroMid = mixHex(palette.heroTop, palette.heroBottom, 0.45);
  const solExpanded = mixHex(palette.cardTint, palette.accent2, 0.09);
  const darkEnd = palette.darkEnd || mixHex(palette.ink, palette.accentDeep, 0.16);

  const vars: Record<string, string> = {
    '--ink': palette.ink,
    '--ink-rgb': inkRgb,
    '--ink-90': `rgba(${inkRgb}, 0.9)`,
    '--ink-70': `rgba(${inkRgb}, 0.72)`,
    '--ink-50': `rgba(${inkRgb}, 0.52)`,
    '--ink-12': `rgba(${inkRgb}, 0.12)`,
    '--ink-hover': mixHex(palette.ink, '#ffffff', 0.14),
    '--dark-frame': mixHex(palette.ink, '#000000', 0.32),
    '--dark-rail': mixHex(palette.ink, '#000000', 0.15),

    '--opal': palette.cardTint,
    '--opal-expanded': solExpanded,
    '--opal-soft': mixHex(palette.cardTint, '#ffffff', 0.45),

    '--hero-top': palette.heroTop,
    '--hero-mid': heroMid,
    '--hero-bottom': palette.heroBottom,
    '--header-glass': `rgba(${heroTopRgb}, 0.9)`,

    '--surface-mcp': palette.mcpSurface,
    '--paper': mixHex(palette.mcpSurface, '#ffffff', 0.45),

    '--wisteria': palette.accent,
    '--wisteria-hover': hoverStart,
    '--wisteria-soft': mixHex(palette.accent, '#ffffff', 0.84),
    '--on-accent': contrast.text,
    '--on-accent-muted': contrast.muted,
    '--accent-rgb': accentRgb,
    '--accent-deep-rgb': accentDeepRgb,
    '--accent2-rgb': accent2Rgb,

    '--purple': palette.accentDeep,
    '--teal': palette.accent2,
    '--accent2-soft': mixHex(palette.accent2, '#ffffff', 0.86),

    // Surface Tokens: Gradient Mode vs Flat Solid Mode
    '--hero-bg': palette.hasGradient
      ? `linear-gradient(165deg, ${palette.heroTop} 0%, ${heroMid} 46%, ${palette.heroBottom} 82%, #ffffff 100%)`
      : `linear-gradient(180deg, ${palette.heroTop} 0%, ${palette.heroTop} 72%, #ffffff 72%, #ffffff 100%)`,
    '--promo-strip-bg': palette.hasGradient
      ? `linear-gradient(90deg, ${palette.accent} 0%, ${endAccent} 100%)`
      : palette.accent,
    '--promo-bg': palette.hasGradient
      ? `linear-gradient(135deg, ${palette.accent} 0%, ${endAccent} 100%)`
      : palette.accent,
    '--cta-bg': palette.hasGradient
      ? `linear-gradient(135deg, ${palette.accent} 0%, ${endAccent} 100%)`
      : palette.accent,
    '--cta-hover-bg': palette.hasGradient
      ? `linear-gradient(135deg, ${hoverStart} 0%, ${hoverEnd} 100%)`
      : hoverStart,
    '--sol-card-bg': palette.hasGradient
      ? `linear-gradient(155deg, ${palette.cardTint} 0%, ${mixHex(palette.cardTint, palette.heroBottom, 0.55)} 100%)`
      : palette.cardTint,
    '--sol-card-expanded-bg': palette.hasGradient
      ? `linear-gradient(155deg, ${solExpanded} 0%, ${mixHex(palette.heroBottom, palette.accent2, 0.08)} 100%)`
      : solExpanded,
    '--dark-section-bg': palette.hasGradient
      ? `linear-gradient(135deg, ${palette.ink} 0%, ${darkEnd} 100%)`
      : palette.ink,
    '--stats-arrow-fill': palette.hasGradient
      ? `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accent2} 100%)`
      : palette.accent,
    '--footer-band-bg': palette.hasGradient
      ? `linear-gradient(180deg, rgba(${accentRgb}, 0.18) 0%, rgba(${accent2Rgb}, 0.24) 100%)`
      : `rgba(${accent2Rgb}, 0.12)`,
    '--mega-feature-bg': palette.hasGradient
      ? `linear-gradient(155deg, ${palette.cardTint} 0%, ${palette.heroBottom} 100%)`
      : palette.cardTint,
    '--res-wisteria-bg': palette.hasGradient
      ? `linear-gradient(135deg, ${palette.accent} 0%, ${endAccent} 100%)`
      : palette.accent,
    '--res-opal-bg': palette.hasGradient
      ? `linear-gradient(135deg, ${palette.cardTint} 0%, ${palette.mcpSurface} 100%)`
      : palette.cardTint,
    '--lb-bar-gradient': palette.hasGradient ? '1' : '0',
  };

  if (syncWorkbench) {
    vars['--chart-1'] = palette.chart1 || palette.accentDeep;
    vars['--chart-2'] =
      palette.chart2 ||
      (palette.accent2.toLowerCase() === (palette.chart1 || palette.accentDeep).toLowerCase()
        ? '#527bc5'
        : palette.accent2);
    vars['--wb-active'] = mixHex(palette.accentDeep, '#ffffff', 0.89);
    vars['--wb-accent'] = palette.accent;
    vars['--wb-accent-end'] = endAccent;
    vars['--wb-on-accent'] = contrast.text;
    vars['--wb-purple'] = palette.accentDeep;
    vars['--wb-purple-deep'] = mixHex(palette.accentDeep, palette.ink, 0.25);
    vars['--wb-teal'] = palette.accent2;
    vars['--wb-teal-deep'] = mixHex(palette.accent2, palette.ink, 0.24);
    vars['--wb-tint'] = mixHex(palette.accentDeep, '#ffffff', 0.91);
    vars['--wb-teal-tint'] = mixHex(palette.accent2, '#ffffff', 0.90);
    vars['--wb-dark-bg'] = palette.hasGradient
      ? `linear-gradient(155deg, ${palette.ink} 0%, ${darkEnd} 100%)`
      : palette.ink;
    vars['--wb-canvas'] = mixHex(palette.mcpSurface, palette.heroTop, 0.22);
    vars['--wb-side'] = mixHex(palette.mcpSurface, '#ffffff', 0.68);
  } else {
    vars['--chart-1'] = '#7659bd';
    vars['--chart-2'] = '#258c89';
    vars['--wb-active'] = '#efeafc';
    vars['--wb-accent'] = '#b7a5ed';
    vars['--wb-accent-end'] = '#9a85dc';
    vars['--wb-on-accent'] = '#1b221a';
    vars['--wb-purple'] = '#7659bd';
    vars['--wb-purple-deep'] = '#5c4299';
    vars['--wb-teal'] = '#258c89';
    vars['--wb-teal-deep'] = '#1a6f6d';
    vars['--wb-tint'] = '#efeafc';
    vars['--wb-teal-tint'] = '#eef6f3';
    vars['--wb-dark-bg'] = '#151b14';
    vars['--wb-canvas'] = '#f3f5ee';
    vars['--wb-side'] = '#fbfcf7';
  }

  return vars;
}
