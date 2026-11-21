import type { CSSProperties } from 'react';

interface AiVendorLogoProps {
  slug: string;
  size?: number;
  color?: string;
  className?: string;
}

export function AiVendorLogo({ slug, size = 16, color, className }: AiVendorLogoProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    display: 'inline-block',
    color: color || 'currentColor',
  };

  switch (slug) {
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
          <path d="M12 3a4.5 4.5 0 0 1 3.9 2.25l3.1 1.8a4.5 4.5 0 0 1 1.65 6.15l-1.8 3.1a4.5 4.5 0 0 1-6.15 1.65L9.6 19.75A4.5 4.5 0 0 1 3.45 18.1l-1.8-3.1A4.5 4.5 0 0 1 3.3 8.85l1.8-3.1A4.5 4.5 0 0 1 12 3z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'anthropic':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={style} className={className} aria-hidden="true">
          <path d="M14.2 4.5h2.7l5.1 15h-2.6l-1.1-3.4h-4.6l-1.1 3.4h-2.5l4.1-15zm.3 9.4h3.1l-1.55-4.9-1.55 4.9zM6.9 4.5h2.6l4.6 15h-2.6L8.2 8.7 4.9 19.5H2.3l4.6-15z" />
        </svg>
      );
    case 'google':
      return (
        <svg viewBox="0 0 24 24" fill="none" style={style} className={className} aria-hidden="true">
          <path d="M21.35 12.23c0-.72-.06-1.42-.19-2.09H12v3.96h5.25a4.5 4.5 0 0 1-1.95 2.95v2.45h3.15c1.85-1.7 2.9-4.2 2.9-7.27z" fill="#4285F4" />
          <path d="M12 21.75c2.63 0 4.84-.87 6.45-2.36l-3.15-2.45c-.87.58-1.99.93-3.3.93-2.54 0-4.7-1.71-5.47-4.02H3.28v2.52A9.75 9.75 0 0 0 12 21.75z" fill="#34A853" />
          <path d="M6.53 13.85a5.85 5.85 0 0 1 0-3.7V7.63H3.28a9.75 9.75 0 0 0 0 8.74l3.25-2.52z" fill="#FBBC05" />
          <path d="M12 6.13c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.83 3.24 14.63 2.25 12 2.25A9.75 9.75 0 0 0 3.28 7.63l3.25 2.52C7.3 7.84 9.46 6.13 12 6.13z" fill="#EA4335" />
        </svg>
      );
    case 'meta':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
          <path d="M3 13.5c0-3.2 2-6 4.5-6 2.2 0 3.7 2 4.5 4.2.8-2.2 2.3-4.2 4.5-4.2 2.5 0 4.5 2.8 4.5 6 0 2.6-1.5 4.5-3.6 4.5-1.8 0-3.1-1.3-5.4-5.2-2.3 3.9-3.6 5.2-5.4 5.2C4.5 18 3 16.1 3 13.5z" />
        </svg>
      );
    case 'deepseek':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
          <path d="M4 13c2.5-4 6.5-6 11-5.5 2.5.3 4.3 1.7 5 3.8-1.8-.3-3.5.3-4.7 1.7 1.3.4 2.4 1.3 2.9 2.6-2.8 1.5-6.6 1.8-9.7.6C6.4 15.4 4.8 14.3 4 13z" />
          <circle cx="14.5" cy="10.8" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'qwen':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
          <polygon points="12 3 20 7.5 20 16.5 12 21 4 16.5 4 7.5" />
          <circle cx="12" cy="12" r="3" />
          <path d="M14.5 14.5L18 18" />
        </svg>
      );
    case 'moonshot':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={style} className={className} aria-hidden="true">
          <path d="M14.8 3.6a8.6 8.6 0 1 0 5.6 14.3A7.2 7.2 0 0 1 11.7 6.2c0-1 .2-1.8.6-2.6-.5 0-1 .1-1.5.1z" />
        </svg>
      );
    case 'zai':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
          <path d="M5 6h14L5 18h14" />
        </svg>
      );
    case 'mistral':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={style} className={className} aria-hidden="true">
          <rect x="3" y="4" width="4" height="4" />
          <rect x="17" y="4" width="4" height="4" />
          <rect x="3" y="9.5" width="8" height="4" />
          <rect x="13" y="9.5" width="8" height="4" />
          <rect x="3" y="15" width="4" height="4" />
          <rect x="10" y="15" width="4" height="4" />
          <rect x="17" y="15" width="4" height="4" />
        </svg>
      );
    case 'xai':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
          <path d="M5 4l14 16M19 4L5 20" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={style} className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}
