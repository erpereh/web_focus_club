'use client';

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface PremiumSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  muted?: boolean;
}

export interface PremiumSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: PremiumSelectOption[];
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
}

function firstEnabledOption(options: PremiumSelectOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

function selectedEnabledOption(options: PremiumSelectOption[], value: string): number {
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
  return selectedIndex >= 0 ? selectedIndex : firstEnabledOption(options);
}

function nextEnabledOption(
  options: PremiumSelectOption[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return -1;

  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (currentIndex + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }

  return -1;
}

export function PremiumSelect({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
  placeholder = 'Selecciona una opción',
}: PremiumSelectProps) {
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => selectedEnabledOption(options, value));
  const selectedOption = options.find((option) => option.value === value);

  const focusOption = (index: number) => {
    if (index < 0) return;
    setActiveIndex(index);
    optionRefs.current[index]?.focus();
  };

  const selectOption = (option: PremiumSelectOption | undefined) => {
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    setOpen(false);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    setActiveIndex(selectedEnabledOption(options, value));
    setOpen(true);
  };

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      focusOption(nextEnabledOption(options, activeIndex, direction));
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const index = event.key === 'Home'
        ? firstEnabledOption(options)
        : [...options].map((option, index) => ({ option, index })).reverse()
          .find(({ option }) => !option.disabled)?.index ?? -1;
      focusOption(index);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(options[activeIndex]);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled) return;
        if (nextOpen) setActiveIndex(selectedEnabledOption(options, value));
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            'group flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#111] px-4 py-3 text-left text-sm text-[var(--color-text-primary)] shadow-sm transition-all duration-200',
            'hover:border-white/20 focus-visible:outline-none focus-visible:border-[var(--color-accent-val)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)]/30',
            'data-[state=open]:border-[var(--color-accent-val)] data-[state=open]:ring-2 data-[state=open]:ring-[var(--color-accent-val)]/20',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <span className={cn(
            'truncate',
            (!selectedOption || selectedOption.muted) && 'text-[var(--color-text-secondary)]',
          )}>
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const index = selectedEnabledOption(options, value);
          focusOption(index);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
        className="z-[500] w-[var(--radix-popover-trigger-width)] max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-[#111]/95 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl outline-none"
      >
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={handleListboxKeyDown}
          className="space-y-1"
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left text-sm transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:border-[var(--color-accent-border)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)]/25',
                  selected
                    ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-accent-dim)]',
                  option.muted && 'text-[var(--color-text-secondary)]',
                  option.disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
                )}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {selected && (
                  <Check
                    className="h-4 w-4 shrink-0 text-[var(--color-accent-val)]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
