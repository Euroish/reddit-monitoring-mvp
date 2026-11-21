import type { CSSProperties } from 'react';

interface AiVendorLogoProps {
  slug: string;
  size?: number;
  color?: string;
  className?: string;
}

const BRAND_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d97757',
  google: '#4285f4',
  meta: '#0668e1',
  deepseek: '#4d6bfe',
  qwen: '#615ced',
  moonshot: '#1a1a1a',
  zai: '#2563eb',
  mistral: '#f59e0b',
  xai: '#111827',
};

const BRAND_LETTERS: Record<string, string> = {
  openai: 'O',
  anthropic: 'A',
  google: 'G',
  meta: 'M',
  deepseek: 'D',
  qwen: 'Q',
  moonshot: 'M',
  zai: 'Z',
  mistral: 'M',
  xai: 'X',
};

export function AiVendorLogo({ slug, size = 16, color, className }: AiVendorLogoProps) {
  const key = slug.trim().toLowerCase();
  const brandColor = color || BRAND_COLORS[key] || '#009f81';
  const letter = BRAND_LETTERS[key] || (key ? key[0].toUpperCase() : '?');

  const style: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: brandColor,
    fontWeight: 800,
    fontSize: Math.max(11, Math.round(size * 0.78)),
    lineHeight: 1,
    letterSpacing: '-0.02em',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    userSelect: 'none',
  };

  return (
    <span style={style} className={className} aria-hidden="true">
      {letter}
    </span>
  );
}
