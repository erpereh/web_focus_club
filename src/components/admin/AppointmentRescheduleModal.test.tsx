import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment, AppointmentRecurrence, Bono, TimeSlot, Trainer } from '@/types';
import type { CalendarAvailabilityState, InteractiveCalendarProps } from '@/components/ui/interactive-calendar';

const calendarControl = vi.hoisted(() => ({ status: 'ready' as 'ready' | 'loading' | 'error' }));
const recurrenceControl = vi.hoisted((): {
  recurrence: AppointmentRecurrence;
  bonos: Bono[];
  deferRecurrence: boolean;
  resolveRecurrence: ((value: unknown) => void) | undefined;
} => ({
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

function trainer(id: string, name: string, active = true): Trainer {
  return { id, uid: `uid-${id}`, name, active, createdAt: '2026-01-01' };
}

function chooseUnassigned(): void {
  const select = screen.getByRole('combobox', { name: /Entrenador asignado/i });
  const option = screen.getByRole('option', { name: 'Sin asignar' }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: option.value } });
}

async function chooseEndDateOption(name: RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Selecciona la última sesión/i }));
  const option = screen.getByRole('option', { name });
  await waitFor(() => expect(option).toHaveAttribute('aria-disabled', 'false'));
  fireEvent.click(option);
}

describe('AppointmentRescheduleModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-01T08:00:00.000Z'));
    calendarControl.status = 'ready';
    recurrenceControl.recurrence = {
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
      status: 'approved',
      origin: 'admin',
      createdAt: '2026-08-01T10:00:00.000Z',
    };
    recurrenceControl.bonos = [{
      id: 'bono-1',
      userId: 'user-1',
      tamano: 480,
      minutosTotales: 480,
      minutosRestantes: 480,
      fechaAsignacion: '2026-08-01',
      fechaExpiracion: '2026-12-31',
      estado: 'activo',
      historial: [],
      asignadoPor: 'admin@example.com',
      createdAt: '2026-08-01T10:00:00.000Z',
    }];
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
    expect(screen.getByText(first === 'series' ? 'Nueva programación' : 'Nueva franja')).toBeInTheDocument();

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
    chooseUnassigned();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Selecciona la última sesión/i })).toBeInTheDocument());
    await chooseEndDateOption(/27\/09\/2026/);
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

    chooseUnassigned();
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

  it('uses the active recurrence trainer for series but restores the clicked trainer for single', async () => {
    recurrenceControl.recurrence = { ...recurrenceControl.recurrence, assignedTrainer: 'trainer-current' };
    const clicked = { ...appointment('a0', '2026-08-14'), assignedTrainer: 'trainer-old' };
    const futureOne = { ...appointment('a1', '2026-09-14'), assignedTrainer: 'trainer-current' };
    const futureTwo = { ...appointment('a2', '2026-09-21'), assignedTrainer: 'trainer-current' };
    render(
      <AppointmentRescheduleModal
        appointment={clicked}
        appointments={[clicked, futureOne, futureTwo]}
        trainers={[trainer('trainer-old', 'Entrenador histórico'), trainer('trainer-current', 'Entrenador actual')]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const select = screen.getByRole('combobox', { name: /Entrenador asignado/i });
    expect(select).toHaveValue('trainer-old');
    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    await waitFor(() => expect(select).toHaveValue('trainer-current'));
    expect(screen.getByText('El nuevo tramo quedará asignado a Entrenador actual.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Solo esta cita/i }));
    expect(select).toHaveValue('trainer-old');
  });

  it('requires an explicit series trainer decision for mixed, inactive, or unassigned schedules', async () => {
    recurrenceControl.recurrence = { ...recurrenceControl.recurrence, assignedTrainer: 'trainer-inactive' };
    const clicked = { ...appointment('a0', '2026-08-14'), assignedTrainer: 'trainer-inactive' };
    const futureOne = { ...appointment('a1', '2026-09-14'), assignedTrainer: 'trainer-one' };
    const futureTwo = { ...appointment('a2', '2026-09-21'), assignedTrainer: 'trainer-two' };
    render(
      <AppointmentRescheduleModal
        appointment={clicked}
        appointments={[clicked, futureOne, futureTwo]}
        trainers={[
          trainer('trainer-inactive', 'Entrenador inactivo', false),
          trainer('trainer-one', 'Entrenador Uno'),
          trainer('trainer-two', 'Entrenador Dos'),
        ]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    const select = screen.getByRole('combobox', { name: /Entrenador asignado/i }) as HTMLSelectElement;
    await waitFor(() => expect(select.selectedOptions[0]).toHaveTextContent('Selecciona el entrenador del nuevo tramo'));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    fireEvent.click(screen.getByRole('button', { name: /Selecciona la última sesión/i }));
    fireEvent.click(screen.getByRole('option', { name: /27\/09\/2026/ }));
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
  });

  it('falls back only to a uniform active future trainer for a series', async () => {
    recurrenceControl.recurrence = { ...recurrenceControl.recurrence, assignedTrainer: undefined };
    const clicked = { ...appointment('a0', '2026-08-14'), assignedTrainer: 'trainer-old' };
    const futureOne = { ...appointment('a1', '2026-09-14'), assignedTrainer: 'trainer-current' };
    const futureTwo = { ...appointment('a2', '2026-09-21'), assignedTrainer: 'trainer-current' };
    render(
      <AppointmentRescheduleModal
        appointment={clicked}
        appointments={[clicked, futureOne, futureTwo]}
        trainers={[trainer('trainer-old', 'Entrenador histórico'), trainer('trainer-current', 'Entrenador actual')]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Entrenador asignado/i })).toHaveValue('trainer-current'));
  });

  it('does not treat an inactive recurrence trainer as a valid series decision', async () => {
    recurrenceControl.recurrence = { ...recurrenceControl.recurrence, assignedTrainer: 'trainer-inactive' };
    const selected = { ...appointment('a1', '2026-09-14'), assignedTrainer: 'trainer-inactive' };
    const sibling = { ...appointment('a2', '2026-09-21'), assignedTrainer: 'trainer-inactive' };
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, sibling]}
        trainers={[trainer('trainer-inactive', 'Entrenador inactivo', false), trainer('trainer-active', 'Entrenador activo')]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    const select = screen.getByRole('combobox', { name: /Entrenador asignado/i }) as HTMLSelectElement;
    await waitFor(() => expect(select.selectedOptions[0]).toHaveTextContent('Selecciona el entrenador del nuevo tramo'));
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
  });

  it('does not infer Sin asignar from uniformly unassigned future occurrences', async () => {
    recurrenceControl.recurrence = { ...recurrenceControl.recurrence, assignedTrainer: undefined };
    const selected = appointment('a1', '2026-09-14');
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, appointment('a2', '2026-09-21')]}
        trainers={[trainer('trainer-active', 'Entrenador activo')]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    const select = screen.getByRole('combobox', { name: /Entrenador asignado/i }) as HTMLSelectElement;
    await waitFor(() => expect(select.selectedOptions[0]).toHaveTextContent('Selecciona el entrenador del nuevo tramo'));
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
  });

  it('submits an explicit series unassignment as null', async () => {
    const selected = appointment('a1', '2026-09-14');
    const onSave = vi.fn(async () => undefined);
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, appointment('a2', '2026-09-21')]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Elegir fecha' })).toBeInTheDocument());
    chooseUnassigned();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    await chooseEndDateOption(/27\/09\/2026/);
    const saveButton = screen.getByRole('button', { name: /Guardar cambio/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      slot: { date: '2026-09-20', time: '18:00' },
      scope: 'series',
      assignedTrainer: null,
      endDate: '2026-09-27',
    }));
  });

  it('does not show the historical single-session notice while editing the future series', async () => {
    const clicked = appointment('a0', '2026-08-14');
    render(
      <AppointmentRescheduleModal
        appointment={clicked}
        appointments={[clicked, appointment('a1', '2026-09-14'), appointment('a2', '2026-09-21')]}
        trainers={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText('Corrección histórica')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Elegir fecha' })).toBeInTheDocument());
    expect(screen.queryByText('Corrección histórica')).not.toBeInTheDocument();
    expect(screen.queryByText('Los cambios solo afectan al registro de esta sesión.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Solo esta cita/i }));
    expect(screen.getByText('Corrección histórica')).toBeInTheDocument();
  });

  it.each([
    ['2026-09-27', '2 sesiones'],
    ['2026-10-04', '3 sesiones'],
    ['2026-10-18', '5 sesiones'],
  ])('shows the selected new series count for end date %s', async (selectedEndDate, expectedCount) => {
    recurrenceControl.recurrence = { ...recurrenceControl.recurrence, assignedTrainer: 'trainer-current' };
    const selected = { ...appointment('a1', '2026-09-14'), assignedTrainer: 'trainer-current' };
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[
          selected,
          { ...appointment('a2', '2026-09-21'), assignedTrainer: 'trainer-current' },
          { ...appointment('a3', '2026-09-28'), assignedTrainer: 'trainer-current' },
        ]}
        trainers={[trainer('trainer-current', 'Entrenador actual')]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Elegir fecha' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    const [year, month, day] = selectedEndDate.split('-');
    await chooseEndDateOption(new RegExp(`${day}\\/${month}\\/${year}`));
    const summary = screen.getByText('Nueva programación').closest('section');
    expect(summary).not.toBeNull();
    expect(within(summary as HTMLElement).getByText(expectedCount)).toBeInTheDocument();
    expect(within(summary as HTMLElement).queryByText('3 sesiones futuras')).not.toBeInTheDocument();
  });

  it.each(['loading', 'error'] as const)('allows a trainer-only single save while availability is %s', async (status) => {
    calendarControl.status = status;
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
        trainers={[trainer('trainer-1', 'Entrenador Uno'), trainer('trainer-2', 'Entrenador Dos')]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: /Entrenador asignado/i }), { target: { value: 'trainer-2' } });
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambio/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      slot: { date: '2026-09-14', time: '10:00' },
      scope: null,
      assignedTrainer: 'trainer-2',
    }));
  });

  it('keeps a series disabled when availability fails', async () => {
    calendarControl.status = 'error';
    recurrenceControl.recurrence = { ...recurrenceControl.recurrence, assignedTrainer: 'trainer-current' };
    const selected = { ...appointment('a1', '2026-09-14'), assignedTrainer: 'trainer-current' };
    render(
      <AppointmentRescheduleModal
        appointment={selected}
        appointments={[selected, { ...appointment('a2', '2026-09-21'), assignedTrainer: 'trainer-current' }]}
        trainers={[trainer('trainer-current', 'Entrenador actual')]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toda la serie/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Elegir fecha' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
  });

  it('blocks editing when the exact series bono is deleted', async () => {
    recurrenceControl.bonos = [{ ...recurrenceControl.bonos[0], estado: 'eliminado' }];
    const selected = appointment('a1', '2026-09-14');
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
    expect(await screen.findByText('El bono asociado a esta serie está eliminado y la programación no puede modificarse.')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Selecciona la última sesión/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
  });

  it('offers active trainers plus only the current inactive trainer for a historical single', () => {
    const historical = {
      ...appointment('a1', '2026-08-14'),
      recurrenceSeriesId: undefined,
      assignedTrainer: 'trainer-current-inactive',
    };
    render(
      <AppointmentRescheduleModal
        appointment={historical}
        appointments={[historical]}
        trainers={[
          trainer('trainer-active', 'Entrenador activo'),
          trainer('trainer-current-inactive', 'Entrenador histórico', false),
          trainer('trainer-other-inactive', 'Otro inactivo', false),
        ]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole('option', { name: 'Entrenador activo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Entrenador histórico (inactivo)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Otro inactivo (inactivo)' })).not.toBeInTheDocument();
  });

  it('requires a new decision instead of preserving an inactive trainer for a future single', () => {
    const future = {
      ...appointment('a1', '2026-09-14'),
      recurrenceSeriesId: undefined,
      assignedTrainer: 'trainer-inactive',
    };
    render(
      <AppointmentRescheduleModal
        appointment={future}
        appointments={[future]}
        trainers={[trainer('trainer-active', 'Entrenador activo'), trainer('trainer-inactive', 'Entrenador inactivo', false)]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const select = screen.getByRole('combobox', { name: /Entrenador asignado/i }) as HTMLSelectElement;
    expect(select.selectedOptions[0]).toHaveTextContent('Selecciona un entrenador activo');
    expect(screen.queryByRole('option', { name: 'Entrenador inactivo (inactivo)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar cambio/i })).toBeDisabled();
  });

  it('uses trainer copy that remains correct when the slot also changes or is unassigned', () => {
    const individual = {
      ...appointment('a1', '2026-09-14'),
      recurrenceSeriesId: undefined,
      assignedTrainer: 'trainer-1',
    };
    render(
      <AppointmentRescheduleModal
        appointment={individual}
        appointments={[individual]}
        trainers={[trainer('trainer-1', 'Entrenador Uno'), trainer('trainer-2', 'Entrenador Dos')]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: /Entrenador asignado/i }), { target: { value: 'trainer-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir hora' }));
    expect(screen.getByText('Se asignará a Entrenador Dos.')).toBeInTheDocument();
    expect(screen.queryByText(/sin cambiar la franja/i)).not.toBeInTheDocument();
    chooseUnassigned();
    expect(screen.getByText('La sesión quedará sin entrenador asignado.')).toBeInTheDocument();
  });
});
