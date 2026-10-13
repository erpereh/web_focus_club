'use client';

import { cn } from '@/lib/utils';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
}

/** Accessible on/off toggle (role="switch") in the admin visual language. */
export function Switch({ checked, onCheckedChange, disabled, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)] disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-val)]'
          : 'border-white/10 bg-white/10',
        className,
      )}
      {...aria}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-5 w-5 rounded-full shadow transition-transform',
          checked ? 'translate-x-6 bg-[var(--color-bg-base)]' : 'translate-x-1 bg-[var(--color-text-secondary)]',
        )}
      />
    </button>
  );
}
