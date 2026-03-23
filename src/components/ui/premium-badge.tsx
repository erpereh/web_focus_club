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
    default: 'bg-muted text-muted-foreground border-border',
    success: 'bg-primary/20 text-primary border-primary/30',
    warning: 'bg-accent/20 text-accent border-accent/30',
    error: 'bg-destructive/20 text-destructive border-destructive/30',
    info: 'bg-forest-700/30 text-ivory border-forest-500/30',
    accent: 'bg-gradient-to-r from-accent/20 to-emerald-light/20 text-accent border-accent/30',
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
