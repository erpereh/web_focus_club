'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

interface GlassCardProps extends HTMLMotionProps<'div'> {
  variant?: 'default' | 'dark' | 'bordered';
  glow?: boolean;
  hover?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = 'default', glow = false, hover = true, children, ...props }, ref) => {
    const variants = {
      default: 'glass-card',
      dark: 'glass-dark',
      bordered: 'glass-card border-accent/30',
    };

    return (
      <motion.div
        ref={ref}
        className={cn(
          variants[variant],
          'rounded-2xl p-6',
          glow && 'shadow-glow',
          hover && 'transition-all duration-300 hover:border-emerald-light/30 hover:shadow-lg',
          className
        )}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

GlassCard.displayName = 'GlassCard';

interface GlassContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassContainer({ children, className }: GlassContainerProps) {
  return (
    <div className={cn('glass rounded-3xl p-8', className)}>
      {children}
    </div>
  );
}
