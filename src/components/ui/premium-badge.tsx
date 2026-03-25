'use client';

import { cn } from '@/lib/utils';

interface PremiumBadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';
  size?: 'sm' | 'md';
  className?: string;
}

export function PremiumBadge({
  children,
  variant = 'default',
  size = 'md',
  className,
}: PremiumBadgeProps) {
  const variants = {
    default: 'bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] border-[var(--color-border-base)]',
    success: 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border-[var(--color-accent-border)]',
    warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    error: 'bg-destructive/10 text-destructive border-destructive/20',
    info: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    accent: 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border-[var(--color-accent-border)]',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: 'pending' | 'approved' | 'rejected';
  className?: string;
}

const statusConfig = {
  pending: { label: 'Pendiente', variant: 'warning' as const },
  approved: { label: 'Aprobada', variant: 'success' as const },
  rejected: { label: 'Rechazada', variant: 'error' as const },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <PremiumBadge variant={config.variant} className={className}>
      {config.label}
    </PremiumBadge>
  );
}
