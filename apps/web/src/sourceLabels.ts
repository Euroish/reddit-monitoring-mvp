export const sourceGroups = {
  "ai-firsthand": "AI 一手与研发",
  "dev-infra": "工程与基础",
  "tech-media": "科技与数码",
  science: "科研与科普",
  "public-affairs": "公共与文化",
  "design-visual": "设计与视觉",
  lifestyle: "生活与旅行",
  "social-trends": "热榜与趋势",
} as const;

export type SourceGroupKey = keyof typeof sourceGroups;

export const tierLabels = {
  T1: "T1 · 官方一手",
  T1_5: "T1_5 · 主创",
  T2: "T2 · 媒体与社区",
} as const;

export const tierShort = {
  T1: "T1",
  T1_5: "T1.5",
  T2: "T2",
} as const;

export const languages = {
  zh: "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
} as const;

const exactFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Shanghai",
});

const relativeFormatter = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "auto",
});

export function formatExactTime(iso: string | null | undefined): string {
  if (!iso) return "时间未知";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "时间未知";
  return exactFormatter.format(new Date(ms));
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "时间未知";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "时间未知";
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "刚刚";
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return relativeFormatter.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86_400 * 14) return relativeFormatter.format(Math.round(diffSec / 86_400), "day");
  return exactFormatter.format(new Date(ms));
}

export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}
