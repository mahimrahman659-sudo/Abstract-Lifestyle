import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export type NoticeTone = 'info' | 'success' | 'error';

export interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<NoticeTone, string> = {
  info: 'border-line bg-paper text-ink',
  success: 'border-success/40 bg-success/10 text-success',
  error: 'border-danger/40 bg-danger/10 text-danger',
};

/** Inline notice / lightweight toast (renders in flow, announced to screen readers). */
export function Notice({ tone = 'info', children, className }: NoticeProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn('rounded-xl border px-4 py-3 text-sm', toneClasses[tone], className)}
    >
      {children}
    </div>
  );
}
