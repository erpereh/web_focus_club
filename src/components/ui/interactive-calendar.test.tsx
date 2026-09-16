import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { TimeSlot } from '@/types';
import { DEFAULT_SITE_CONFIG } from '@/lib/site-config';

const subscribeMonthAvailability = vi.fn();
const subscribeSiteConfig = vi.fn();

vi.mock('@/lib/firestore', () => ({
  generateTimeSlots: () => ['08:00', '10:00', '18:00'],
  subscribeMonthAvailability: (...args: unknown[]) => subscribeMonthAvailability(...args),
  subscribeSiteConfig: (...args: unknown[]) => subscribeSiteConfig(...args),
}));

import { InteractiveCalendar } from './interactive-calendar';

function ControlledCalendar() {
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [date, setDate] = useState<string | null>(null);
  return (
    <>
      <InteractiveCalendar
        selectedSlot={slot}
        selectedDate={date}
        onSelectDate={setDate}
        onSelectSlot={setSlot}
        onClearSlot={() => setSlot(null)}
        selectedDuration={60}
        showSelectedSlotSummary
      />
      <output data-testid="slot">{slot ? `${slot.date}_${slot.time}` : 'none'}</output>
    </>
  );
}

describe('InteractiveCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-16T08:00:00.000Z'));
    subscribeMonthAvailability.mockImplementation((
      _year: number,
      _month: number,
      callback: (data: { occupancy: Record<string, number>; blockedSlots: unknown[] }) => void,
    ) => {
      callback({ occupancy: {}, blockedSlots: [] });
      return vi.fn();
    });
    subscribeSiteConfig.mockImplementation((callback: (config: typeof DEFAULT_SITE_CONFIG) => void) => {
      callback({ ...DEFAULT_SITE_CONFIG, startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 4 });
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a slot from the selected date and time and clears it when the date changes', async () => {
    render(<ControlledCalendar />);
    await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /17 de Septiembre/i }));
    fireEvent.click(screen.getByRole('button', { name: /18:00, Libre/i }));
    expect(screen.getByTestId('slot')).toHaveTextContent('2026-09-17_18:00');

    fireEvent.click(screen.getByRole('button', { name: /18 de Septiembre/i }));
    expect(screen.getByTestId('slot')).toHaveTextContent('none');
  });

  it('allows today for admin-style usage but disables times that are not in Madrid future', async () => {
    render(
      <InteractiveCalendar
        selectedSlot={null}
        onSelectSlot={vi.fn()}
        onClearSlot={vi.fn()}
        selectedDuration={60}
      />,
    );
    await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));

    expect(screen.getByRole('button', { name: /08:00, No disponible/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /10:00, No disponible/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
  });

  it('honors a tomorrow minDate for the portal without changing the admin default', async () => {
    render(
      <InteractiveCalendar
        selectedSlot={null}
        onSelectSlot={vi.fn()}
        onClearSlot={vi.fn()}
        minDate="2026-09-17"
      />,
    );
    await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: /16 de Septiembre/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /17 de Septiembre/i })).toBeEnabled();
  });

  it('shows partial occupancy and disables full, blocked and customer-conflict slots', async () => {
    subscribeMonthAvailability.mockImplementation((
      _year: number,
      _month: number,
      callback: (data: { occupancy: Record<string, number>; blockedSlots: unknown[] }) => void,
    ) => {
      callback({
        occupancy: {
          '2026-09-17_08:00': 2,
          '2026-09-17_08:15': 3,
          '2026-09-17_08:30': 2,
          '2026-09-17_08:45': 2,
          '2026-09-17_10:00': 4,
        },
        blockedSlots: [{ id: 'blocked', date: '2026-09-17', time: '18:30', createdBy: '', createdAt: '' }],
      });
      return vi.fn();
    });

    render(
      <InteractiveCalendar
        selectedSlot={null}
        onSelectSlot={vi.fn()}
        onClearSlot={vi.fn()}
        selectedDuration={60}
        availabilityLabelMode="occupancy"
        userBookedSlotKeys={new Set(['2026-09-18_18:30'])}
      />,
    );
    await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /17 de Septiembre/i }));

    expect(screen.getByRole('button', { name: /08:00, 3\/4 plazas/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /10:00, Completa/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /18:00, Bloqueada/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /18 de Septiembre/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /18:00, No disponible/i })).toBeDisabled());
  });

  it('reports loading and errors without exposing a usable calendar', async () => {
    const onAvailabilityStateChange = vi.fn();
    subscribeMonthAvailability.mockImplementation((
      _year: number,
      _month: number,
      _callback: unknown,
      onError: (error: Error) => void,
    ) => {
      onError(new Error('offline'));
      return vi.fn();
    });

    render(
      <InteractiveCalendar
        selectedSlot={null}
        onSelectSlot={vi.fn()}
        onClearSlot={vi.fn()}
        onAvailabilityStateChange={onAvailabilityStateChange}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la disponibilidad');
    expect(screen.getByRole('button', { name: /17 de Septiembre/i })).toBeDisabled();
    expect(onAvailabilityStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }));
  });
});
