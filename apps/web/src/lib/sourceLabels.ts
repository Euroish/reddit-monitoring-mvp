import type { SourceTier } from '../contracts/api';

export const SOURCE_GROUPS = {
  'ai-firsthand': { zh: 'AI 一手与研发', en: 'AI Firsthand' },
  'dev-infra': { zh: '工程与基础', en: 'Dev & Infra' },
  'tech-media': { zh: '科技与数码', en: 'Tech Media' },
  science: { zh: '科研与科普', en: 'Science' },
  'public-affairs': { zh: '公共与文化', en: 'Public Affairs' },
  'design-visual': { zh: '设计与视觉', en: 'Design & Visual' },
  lifestyle: { zh: '生活与旅行', en: 'Lifestyle' },
  'social-trends': { zh: '热榜与趋势', en: 'Social Trends' },
} as const;

export type SourceGroupKey = keyof typeof SOURCE_GROUPS;

export const TIER_SHORT: Record<SourceTier, string> = {
  T1: 'T1',
  T1_5: 'T1.5',
  T2: 'T2',
};

const exactFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
});

const relativeFormatter = new Intl.RelativeTimeFormat('zh-CN', {
  numeric: 'auto',
});

export function formatExactTime(iso: string | null | undefined): string {
  if (!iso) return '时间未知';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '时间未知';
  return exactFormatter.format(new Date(ms));
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '时间未知';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '时间未知';
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return '刚刚';
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return relativeFormatter.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86_400 * 14) return relativeFormatter.format(Math.round(diffSec / 86_400), 'day');
  return exactFormatter.format(new Date(ms));
}

export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? full;
  });
}

export function shiftUtcDate(dateStr: string | null, deltaDays: number): string {
  const baseMs = dateStr ? Date.parse(`${dateStr}T00:00:00Z`) : Date.now();
  const safeMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  return new Date(safeMs + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

const NAIVE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

export function toUtcDatetimeLocal(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const normalized = NAIVE_DATETIME_RE.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) : '';
}

export function toSafeUtcIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = NAIVE_DATETIME_RE.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
