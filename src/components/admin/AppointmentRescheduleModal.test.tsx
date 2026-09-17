import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment, TimeSlot } from '@/types';
import type { CalendarAvailabilityState, InteractiveCalendarProps } from '@/components/ui/interactive-calendar';

const calendarControl = vi.hoisted(() => ({ status: 'ready' as 'ready' | 'loading' | 'error' }));
const recurrenceControl = vi.hoisted(() => ({
  recurrence: {
    id: 'series-1',
    userId: 'user-1',
    serviceType: 'Entrenamiento',
    duration: '60',
    startDate: '2026-09-20',
    startTime: '11:00',
    intervalDays: 7,
    endDate: '2026-10-11',
    occurrenceCount: 4,
    totalMinutes: 240,
    bonoId: 'bono-1',
    status: 'approved' as const,
    origin: 'admin' as const,
    createdAt: '2026-08-01T10:00:00.000Z',
  },
  bonos: [{
    id: 'bono-1',
    userId: 'user-1',
    tamano: 480 as const,
    minutosTotales: 480,
    minutosRestantes: 480,
    fechaAsignacion: '2026-08-01',
    fechaExpiracion: '2026-12-31',
    estado: 'activo' as const,
    historial: [],
    asignadoPor: 'admin@example.com',
    createdAt: '2026-08-01T10:00:00.000Z',
  }],
  deferRecurrence: false,
  resolveRecurrence: undefined as ((value: unknown) => void) | undefined,
}));

vi.mock('@/lib/firestore', () => ({
  getAppointmentRecurrence: vi.fn(() => recurrenceControl.deferRecurrence
    ? new Promise((resolve) => { recurrenceControl.resolveRecurrence = resolve; })
    : Promise.resolve(recurrenceControl.recurrence)),
  getBonosByUser: vi.fn(async () => recurrenceControl.bonos),
  getAvailabilityForDates: vi.fn(async () => ({ occupancy: {}, blockedSlots: [] })),
  getSiteConfig: vi.fn(async () => ({
    startHour: 8,
    endHour: 20,
    slotInterval: 30,
    bonoExpirationMonths: 1,
    maxCapacity: 4,
  })),
}));

vi.mock('@/components/ui/interactive-calendar', () => ({
  InteractiveCalendar: (props: InteractiveCalendarProps) => {
    useEffect(() => {
      const state = calendarControl.status === 'error'
        ? { status: 'error', message: 'No se pudo cargar la disponibilidad. Inténtalo de nuevo.' }
        : { status: calendarControl.status, message: null };
      props.onAvailabilityStateChange?.(state as CalendarAvailabilityState);
    }, [props.onAvailabilityStateChange]);
    return (
      <div
        data-testid="calendar"
        data-allow-past-dates={props.allowPastDates ? 'true' : 'false'}
        data-selected-date={props.selectedDate ?? ''}
      >
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
    recurrenceControl.deferRecurrence = false;
    recurrenceControl.resolveRecurrence = undefined;
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
    if (first === 'series') {
      await waitFor(() => expect(screen.getByRole('button', { name: 'Elegir fecha' })).toBeInTheDocument());
    }
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
      assignedTrainer: null,
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Elegir fecha' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Selecciona la última sesión/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Selecciona la última sesión/i }));
    fireEvent.click(screen.getByRole('option', { name: /27\/09\/2026/ }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambio/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      slot: { date: '2026-09-20', time: '18:00' },
      scope: 'series',
      assignedTrainer: null,
      endDate: '2026-09-27',
    }));
  });

  it.each(['loading', 'error'] as const)('does not allow saving while availability is %s', (status) => {
    calendarControl.status = status;
    const individual = { ...appointment('a1', '2026-08-14'), recurrenceSeriesId: undefined };
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

  it('disables a true no-op and enables a trainer-only change using the effective current slot', async () => {
    const individual = {
      ...appointment('a1', '2026-09-14'),
      recurrenceSeriesId: undefined,
      assignedTrainer: 'trainer-1',
    };
    const onSave = vi.fn(async () => undefined);
    render(
      <AppointmentRescheduleModal
        appointment={individual}
        appointments={[individual]}
        trainers={[
          { id: 'trainer-1', uid: 'uid-1', name: 'Entrenador Uno', active: true, createdAt: '2026-01-01' },
          { id: 'trainer-2', uid: 'uid-2', name: 'Entrenador Dos', active: true, createdAt: '2026-01-01' },
        ]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled());
    fireEvent.change(screen.getByRole('combobox', { name: /Entrenador asignado/i }), { target: { value: 'trainer-2' } });
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambio/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      slot: { date: '2026-09-14', time: '10:00' },
      scope: null,
      assignedTrainer: 'trainer-2',
    }));
  });

  it('keeps Save disabled when a recurring trainer changes before choosing a scope', async () => {
    const selected = { ...appointment('a1', '2026-09-14'), assignedTrainer: 'trainer-1' };
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, appointment('a2', '2026-09-21')]}
        trainers={[
          { id: 'trainer-1', uid: 'uid-1', name: 'Entrenador Uno', active: true, createdAt: '2026-01-01' },
          { id: 'trainer-2', uid: 'uid-2', name: 'Entrenador Dos', active: true, createdAt: '2026-01-01' },
        ]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled());
    fireEvent.change(screen.getByRole('combobox', { name: /Entrenador asignado/i }), { target: { value: 'trainer-2' } });
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
  });

  it('allows explicit trainer unassignment and preserves the current slot', async () => {
    const individual = {
      ...appointment('a1', '2026-09-14'),
      recurrenceSeriesId: undefined,
      assignedTrainer: 'trainer-1',
    };
    const onSave = vi.fn(async () => undefined);
    render(
      <AppointmentRescheduleModal
        appointment={individual}
        appointments={[individual]}
        trainers={[{ id: 'trainer-1', uid: 'uid-1', name: 'Entrenador Uno', active: true, createdAt: '2026-01-01' }]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: /Entrenador asignado/i }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambio/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      slot: { date: '2026-09-14', time: '10:00' },
      scope: null,
      assignedTrainer: null,
    }));
  });

  it('marks historical current and selected slots and allows past dates for Admin single', async () => {
    const individual = { ...appointment('a1', '2026-08-14'), recurrenceSeriesId: undefined };
    render(
      <AppointmentRescheduleModal
        appointment={individual}
        appointments={[individual]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText('Corrección histórica')).toBeInTheDocument();
    expect(screen.getByText('Los cambios solo afectan al registro de esta sesión.')).toBeInTheDocument();
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-allow-past-dates', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    expect(screen.getByText('Corrección histórica')).toBeInTheDocument();
  });

  it('loads series metadata without anchoring the calendar to the clicked appointment', async () => {
    const selected = appointment('a1', '2026-09-14');
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, appointment('a2', '2026-09-21'), appointment('a3', '2026-09-28')]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    await waitFor(() => expect(screen.getByText('Cada 7 días')).toBeInTheDocument());
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-selected-date', '');
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    expect(screen.getByRole('button', { name: /Selecciona la última sesión/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Selecciona la última sesión/i }));
    expect(screen.getByRole('option', { name: /27\/09\/2026 · 2 sesiones · 120 min/ })).toBeInTheDocument();
  });

  it('does not expose a series calendar or clicked-user conflicts while metadata is loading', async () => {
    recurrenceControl.deferRecurrence = true;
    const selected = { ...appointment('a1', '2026-09-14'), userId: 'stale-clicked-user' };
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, appointment('a2', '2026-09-21')]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    expect(screen.getByText(/Cargando la serie y el bono reservado/)).toBeInTheDocument();
    expect(screen.queryByTestId('calendar')).not.toBeInTheDocument();

    recurrenceControl.resolveRecurrence?.(recurrenceControl.recurrence);
    await waitFor(() => expect(screen.getByTestId('calendar')).toBeInTheDocument());
  });

  it('blocks and resets a selected series when future approved occurrences disappear', async () => {
    const selected = appointment('a1', '2026-09-14');
    const { rerender } = render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, appointment('a2', '2026-09-21')]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Elegir fecha' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Selecciona la última sesión/i })).toBeInTheDocument());

    rerender(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[{ ...selected, approvedSlot: { date: '2026-08-01', time: '10:00' } }]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled());
    expect(screen.getByRole('button', { name: /Toda la serie/i })).toBeDisabled();
    expect(screen.getByText(/No hay sesiones futuras aprobadas/)).toBeInTheDocument();
    expect(screen.queryByTestId('calendar')).not.toBeInTheDocument();
  });

  it('disables the series option when no future approved occurrence remains', async () => {
    const selected = appointment('a1', '2026-08-14');
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const seriesButton = screen.getByRole('button', { name: /Toda la serie/i });
    expect(seriesButton).toBeDisabled();
    expect(screen.getByText(/No hay sesiones futuras aprobadas/)).toBeInTheDocument();
  });
});
