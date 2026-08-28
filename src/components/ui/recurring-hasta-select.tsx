'use client';

import { useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  formatRecurringHastaOptionLabel,
  type RecurringEndDateOption,
  type RecurringHastaEmptyReason,
} from '@/lib/recurring-appointments';

const PLACEHOLDER = 'Selecciona la última sesión';
const NO_START_DATE_MESSAGE = 'Elige primero una fecha inicial en el calendario.';
const NO_VALID_END_MESSAGE = 'No hay suficientes minutos o vigencia de bono para programar al menos 2 sesiones.';

export function RecurringHastaSelect({
  options,
  value,
  onChange,
  emptyReason,
}: {
  options: RecurringEndDateOption[];
  value: string;
  onChange: (endDate: string) => void;
  emptyReason: RecurringHastaEmptyReason | null;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blocked = emptyReason === 'no-valid-end';
  const selected = options.find((option) => option.endDate === value);
  const label = selected ? formatRecurringHastaOptionLabel(selected) : PLACEHOLDER;

  const selectOption = (endDate: string) => {
    onChange(endDate);
    setOpen(false);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (emptyReason === 'no-start-date' || options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % options.length);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + options.length) % options.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) selectOption(option.endDate);
    }
  };

  return (
    <div>
      <Popover
        open={blocked ? false : open}
        onOpenChange={(nextOpen) => {
          if (blocked) return;
          if (nextOpen) {
            const selectedIndex = options.findIndex((option) => option.endDate === value);
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          }
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={blocked}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              'w-full px-4 py-3 rounded-xl bg-input border border-border text-left text-[var(--color-text-primary)] flex items-center justify-between gap-3',
              blocked && 'opacity-60 cursor-not-allowed',
            )}
          >
            <span className={cn('truncate', !selected && 'text-[var(--color-text-secondary)]')}>{label}</span>
            <ChevronDown className="w-4 h-4 shrink-0 text-[var(--color-text-secondary)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onKeyDown={onListKeyDown}
          className="z-[400] p-1 min-w-[var(--radix-popover-trigger-width)] w-[var(--radix-popover-trigger-width)] max-h-60 overflow-y-auto rounded-xl border border-border bg-[var(--color-bg-surface)] shadow-2xl outline-none"
        >
          {emptyReason === 'no-start-date' ? (
            <p className="px-3 py-2 text-sm text-[var(--color-text-secondary)]" role="status">
              {NO_START_DATE_MESSAGE}
            </p>
          ) : (
            <ul role="listbox" aria-label="Última sesión">
              {options.map((option, index) => {
                const selectedOption = option.endDate === value;
                return (
                  <li key={option.endDate} role="presentation">
                    <button
                      type="button"
                      id={`recurring-hasta-option-${option.endDate}`}
                      role="option"
                      aria-selected={selectedOption}
                      onClick={() => selectOption(option.endDate)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                        selectedOption || index === activeIndex
                          ? 'bg-[var(--color-accent-dim)] text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-muted/40 hover:text-[var(--color-text-primary)]',
                      )}
                    >
                      {formatRecurringHastaOptionLabel(option)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {blocked && (
        <p className="mt-2 text-xs text-red-400">{NO_VALID_END_MESSAGE}</p>
      )}
    </div>
  );
}
