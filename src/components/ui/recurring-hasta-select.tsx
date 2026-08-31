'use client';

import { useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  formatRecurringHastaOptionLabel,
  type RecurringEndDateOption,
  type RecurringHastaEmptyReason,
} from '@/lib/recurring-appointments';
import type { RecurringHastaOptionStatus } from '@/lib/recurring-hasta-availability';

const PLACEHOLDER = 'Selecciona la última sesión';
const NO_START_DATE_MESSAGE = 'Elige primero una fecha inicial en el calendario.';
const NO_VALID_END_MESSAGE = 'No hay suficientes minutos o vigencia de bono para programar al menos 2 sesiones.';
const LOADING_MESSAGE = 'Comprobando disponibilidad...';
const ERROR_MESSAGE = 'No se ha podido comprobar la disponibilidad.';

export function RecurringHastaSelect({
  options,
  value,
  onChange,
  emptyReason,
  optionStatuses,
  availabilityLoading,
  availabilityError,
}: {
  options: RecurringEndDateOption[];
  value: string;
  onChange: (endDate: string) => void;
  emptyReason: RecurringHastaEmptyReason | null;
  optionStatuses?: RecurringHastaOptionStatus[];
  availabilityLoading?: boolean;
  availabilityError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blocked = emptyReason === 'no-valid-end';
  const selected = options.find((option) => option.endDate === value);
  const label = selected ? formatRecurringHastaOptionLabel(selected) : PLACEHOLDER;
  const statusByDate = new Map(
    (optionStatuses ?? []).map((status) => [status.option.endDate, status]),
  );

  const canSelect = (endDate: string) => {
    if (availabilityLoading) return false;
    if (availabilityError || !optionStatuses) return true;
    return statusByDate.get(endDate)?.availability === 'available';
  };

  const selectOption = (endDate: string) => {
    if (!canSelect(endDate)) return;
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
            <>
              {availabilityLoading && (
                <p className="px-3 py-2 text-sm text-[var(--color-text-secondary)]" role="status">
                  {LOADING_MESSAGE}
                </p>
              )}
              {availabilityError && (
                <p className="px-3 py-2 text-sm text-amber-400" role="status">
                  {ERROR_MESSAGE}
                </p>
              )}
              <ul role="listbox" aria-label="Última sesión">
                {options.map((option, index) => {
                  const selectedOption = option.endDate === value;
                  const status = statusByDate.get(option.endDate);
                  const selectable = canSelect(option.endDate);
                  const showAvailable = !availabilityLoading && !availabilityError && status?.availability === 'available';
                  const showProblem = !availabilityLoading && !availabilityError && status && status.availability !== 'available';
                  const [year, month, day] = option.endDate.split('-');
                  const dateLabel = `${day}/${month}/${year}`;
                  return (
                    <li key={option.endDate} role="presentation">
                      <button
                        type="button"
                        id={`recurring-hasta-option-${option.endDate}`}
                        role="option"
                        aria-selected={selectedOption}
                        aria-disabled={!selectable}
                        aria-label={formatRecurringHastaOptionLabel(option)}
                        title={status?.message}
                        onClick={() => selectOption(option.endDate)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                          !selectable && 'cursor-not-allowed opacity-70',
                          selectedOption || index === activeIndex
                            ? 'bg-[var(--color-accent-dim)] text-[var(--color-text-primary)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-muted/40 hover:text-[var(--color-text-primary)]',
                        )}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-[var(--color-text-primary)]">{dateLabel}</span>
                            <span className="block text-xs text-[var(--color-text-secondary)]">
                              {option.occurrenceCount} sesiones · {option.totalMinutes} min
                            </span>
                            {showProblem && status.message && (
                              <span className="block mt-0.5 text-xs text-amber-400">{status.message}</span>
                            )}
                          </span>
                          {showAvailable && (
                            <Check className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-accent-val)]" aria-hidden />
                          )}
                          {showProblem && (
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" aria-hidden />
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </PopoverContent>
      </Popover>
      {blocked && (
        <p className="mt-2 text-xs text-red-400">{NO_VALID_END_MESSAGE}</p>
      )}
      {availabilityError && (
        <p className="mt-2 text-xs text-amber-400">{ERROR_MESSAGE}</p>
      )}
    </div>
  );
}
