import React from 'react';

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'subtle' }>(
  ({ className, variant = 'ghost', style, disabled, ...props }, ref) => {
    const baseStyle: React.CSSProperties = {
      padding: '8px 16px',
      borderRadius: '6px',
      border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit',
      fontSize: '14px',
      fontWeight: 510,
      transition: 'all 0.2s ease',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      opacity: disabled ? 0.6 : 1,
      ...style,
    };

    const variants: Record<string, React.CSSProperties> = {
      primary: {
        backgroundColor: 'var(--brand-indigo)',
        color: '#ffffff',
      },
      ghost: {
        backgroundColor: 'rgba(255,255,255,0.02)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-secondary)',
      },
      subtle: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        color: 'var(--text-secondary)',
        padding: '4px 8px',
      }
    };

    return (
      <button
        ref={ref}
        className={className}
        style={{ ...baseStyle, ...variants[variant] }}
        onMouseOver={(e) => {
          if (disabled) return;
          if (variant === 'primary') e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
          if (variant === 'ghost') e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
        }}
        onMouseOut={(e) => {
          if (disabled) return;
          if (variant === 'primary') e.currentTarget.style.backgroundColor = 'var(--brand-indigo)';
          if (variant === 'ghost') e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)';
        }}
        disabled={disabled}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export const Card = ({ children, style, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    style={{
      backgroundColor: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--border-standard)',
      borderRadius: '8px',
      padding: '24px',
      boxShadow: 'var(--shadow-ring)',
      ...style,
    }}
    {...props}
  >
    {children}
  </div>
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ style, ...props }, ref) => (
    <input
      ref={ref}
      style={{
        backgroundColor: 'rgba(255,255,255,0.02)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-standard)',
        padding: '12px 14px',
        borderRadius: '6px',
        width: '100%',
        fontFamily: 'inherit',
        outline: 'none',
        ...style,
      }}
      onFocus={(e) => e.currentTarget.style.boxShadow = 'var(--shadow-focus)'}
      onBlur={(e) => e.currentTarget.style.boxShadow = 'none'}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ style, ...props }, ref) => (
    <select
      ref={ref}
      style={{
        backgroundColor: 'rgba(255,255,255,0.02)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-standard)',
        padding: '12px 14px',
        borderRadius: '6px',
        width: '100%',
        fontFamily: 'inherit',
        outline: 'none',
        ...style,
      }}
      onFocus={(e) => e.currentTarget.style.boxShadow = 'var(--shadow-focus)'}
      onBlur={(e) => e.currentTarget.style.boxShadow = 'none'}
      {...props}
    />
  )
);
Select.displayName = 'Select';

export const Badge = ({ children, style, variant = 'neutral' }: { children: React.ReactNode, style?: React.CSSProperties, variant?: 'success' | 'neutral' }) => (
  <span
    style={{
      backgroundColor: variant === 'success' ? 'var(--status-emerald)' : 'transparent',
      color: variant === 'success' ? '#ffffff' : 'var(--text-secondary)',
      padding: variant === 'success' ? '2px 8px' : '0 10px',
      borderRadius: '9999px',
      border: variant === 'neutral' ? '1px solid var(--border-primary)' : 'none',
      fontSize: '12px',
      fontWeight: 510,
      display: 'inline-flex',
      alignItems: 'center',
      ...style,
    }}
  >
    {children}
  </span>
);
