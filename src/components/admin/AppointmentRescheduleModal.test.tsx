import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment, TimeSlot } from '@/types';
import type { CalendarAvailabilityState, InteractiveCalendarProps } from '@/components/ui/interactive-calendar';

const calendarControl = vi.hoisted(() => ({ status: 'ready' as 'ready' | 'loading' | 'error' }));

vi.mock('@/components/ui/interactive-calendar', () => ({
  InteractiveCalendar: (props: InteractiveCalendarProps) => {
    useEffect(() => {
      const state = calendarControl.status === 'error'
        ? { status: 'error', message: 'No se pudo cargar la disponibilidad. Inténtalo de nuevo.' }
        : { status: calendarControl.status, message: null };
      props.onAvailabilityStateChange?.(state as CalendarAvailabilityState);
    }, [props.onAvailabilityStateChange]);
    return (
      <div data-testid="calendar">
        <button type="button" onClick={() => props.onSelectDate?.('2026-09-20')}>Elegir fecha</button>
        <button type="button" onClick={() => props.onSelectSlot({ date: '2026-09-20', time: '18:00' })}>Elegir hora</button>
      </div>
    );
  },
}));

import { AppointmentRescheduleModal } from './AppointmentRescheduleModal';

function appointment(id: string, date: string, status: Appointment['status'] = 'approved'): Appointment {
  return {
    id,
    userId: 'user-1',
    name: 'Cliente',
    email: 'client@example.com',
    phone: '',
    serviceType: 'Entrenamiento',
    duration: '60',
    preferredSlots: [{ date, time: '10:00' }],
    approvedSlot: status === 'approved' ? { date, time: '10:00' } : undefined,
    reason: '',
    status,
    recurrenceSeriesId: 'series-1',
    recurrenceIndex: Number(id.replace(/\D/g, '')) || 0,
    createdAt: '2026-08-01T10:00:00.000Z',
  };
}

describe('AppointmentRescheduleModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-01T08:00:00.000Z'));
    calendarControl.status = 'ready';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the shared scopes and counts only future approved series appointments', () => {
    const selected = appointment('a1', '2026-09-14');
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[
          selected,
          appointment('a2', '2026-09-21'),
          appointment('a3', '2026-09-28', 'pending'),
          appointment('a4', '2026-08-01'),
          appointment('a5', '2026-10-05', 'cancelled'),
          appointment('a6', '2026-10-12', 'rejected'),
        ]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Solo esta cita/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Toda la serie/i })).toHaveTextContent('2 sesiones futuras');
    expect(screen.queryByText(/Esta y las siguientes/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('calendar')).not.toBeInTheDocument();
  });

  it.each([
    ['single', 'series'],
    ['series', 'single'],
  ] as const)('clears the selected slot when changing scope from %s to %s', async (first, second) => {
    const selected = appointment('a1', '2026-09-14');
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, appointment('a2', '2026-09-21')]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: first === 'single' ? /Solo esta cita/i : /Toda la serie/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    expect(screen.getByText('Nueva franja')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: second === 'single' ? /Solo esta cita/i : /Toda la serie/i }));
    await waitFor(() => expect(screen.queryByText('Nueva franja')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
  });

  it('submits an individual appointment with a null scope', async () => {
    const individual = { ...appointment('a1', '2026-09-14'), recurrenceSeriesId: undefined };
    const onSave = vi.fn(async (_input: { slot: TimeSlot; scope: 'single' | 'series' | null }) => undefined);
    render(
      <AppointmentRescheduleModal
        appointment={individual}
        appointments={[individual]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambio/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      slot: { date: '2026-09-20', time: '18:00' },
      scope: null,
    }));
  });

  it('submits the selected recurring scope', async () => {
    const selected = appointment('a1', '2026-09-14');
    const onSave = vi.fn(async () => undefined);
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambio/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      slot: { date: '2026-09-20', time: '18:00' },
      scope: 'series',
    }));
  });

  it.each(['loading', 'error'] as const)('does not allow saving while availability is %s', (status) => {
    calendarControl.status = status;
    const individual = { ...appointment('a1', '2026-09-14'), recurrenceSeriesId: undefined };
    const onSave = vi.fn(async () => undefined);
    render(
      <AppointmentRescheduleModal
        appointment={individual}
        appointments={[individual]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
