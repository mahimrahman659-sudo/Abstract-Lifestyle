import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonRadius = 'full' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  radius?: ButtonRadius;
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  // Disabled primary buttons turn grey (not a faded green) so they read as inactive.
  primary:
    'bg-accent text-white hover:bg-brand-dark disabled:bg-line disabled:text-muted disabled:hover:bg-line',
  secondary: 'border border-line bg-surface text-ink hover:bg-tile disabled:opacity-50',
  ghost: 'text-ink hover:bg-tile disabled:opacity-50',
  danger: 'bg-danger text-white hover:bg-danger/90 disabled:opacity-50',
  dark: 'bg-ink text-white hover:bg-ink/90 disabled:opacity-50',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  radius = 'full',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed',
        radius === 'md' ? 'rounded-md' : 'rounded-full',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" label="Working" /> : null}
      {children}
    </button>
  );
}
