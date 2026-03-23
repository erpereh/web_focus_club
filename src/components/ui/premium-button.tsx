'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

interface PremiumButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'cta';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  children?: React.ReactNode;
}

export const PremiumButton = forwardRef<HTMLButtonElement, PremiumButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconPosition = 'left',
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const variants = {
      // Verde esmeralda
      primary:
        'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg',
      // Verde profundo
      secondary:
        'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border',
      // Contorno acento
      outline:
        'border border-accent text-accent hover:bg-accent/10 hover:border-accent',
      // Transparente
      ghost: 'text-foreground hover:bg-muted hover:text-foreground',
      // CTA principal
      cta: 'bg-accent text-accent-foreground font-semibold hover:bg-accent/90 shadow-lg hover:shadow-emerald',
    };

    const sizes = {
      sm: 'px-4 py-2 text-sm rounded-lg',
      md: 'px-6 py-3 text-base rounded-xl',
      lg: 'px-8 py-4 text-lg rounded-2xl',
    };

    return (
      <motion.button
        ref={ref}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 font-medium transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed',
          variants[variant],
          sizes[size],
          className
        )}
        whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
        whileTap={{ scale: disabled || loading ? 1 : 0.98 }}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {!loading && icon && iconPosition === 'left' && icon}
        {children}
        {!loading && icon && iconPosition === 'right' && icon}
      </motion.button>
    );
  }
);

PremiumButton.displayName = 'PremiumButton';

interface PremiumLinkProps {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'cta';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  icon?: React.ReactNode;
  external?: boolean;
}

export function PremiumLink({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className,
  icon,
  external = false,
}: PremiumLinkProps) {
  const variants = {
    primary:
      'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg',
    secondary:
      'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border',
    outline:
      'border border-accent text-accent hover:bg-accent/10 hover:border-accent',
    ghost: 'text-foreground hover:bg-muted hover:text-foreground',
    cta: 'bg-accent text-accent-foreground font-semibold hover:bg-accent/90 shadow-lg hover:shadow-emerald',
  };

  const sizes = {
    sm: 'px-4 py-2 text-sm rounded-lg',
    md: 'px-6 py-3 text-base rounded-xl',
    lg: 'px-8 py-4 text-lg rounded-2xl',
  };

  return (
    <motion.a
      href={href}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-300',
        variants[variant],
        sizes[size],
        className
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
    >
      {children}
      {icon}
    </motion.a>
  );
}
