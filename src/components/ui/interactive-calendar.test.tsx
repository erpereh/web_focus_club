import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('allows historical days and times only when allowPastDates is enabled', async () => {
    subscribeMonthAvailability.mockImplementation((
      _year: number,
      _month: number,
      callback: (data: { occupancy: Record<string, number>; blockedSlots: unknown[] }) => void,
    ) => {
      callback({
        occupancy: {
          '2026-09-15_08:00': 4,
          '2026-09-15_10:00': 4,
          '2026-09-15_18:00': 4,
        },
        blockedSlots: [{ id: 'blocked', date: '2026-09-15', time: '18:00', createdBy: '', createdAt: '' }],
      });
      return vi.fn();
    });

    render(
      <InteractiveCalendar
        selectedSlot={null}
        onSelectSlot={vi.fn()}
        onClearSlot={vi.fn()}
        selectedDuration={60}
        allowPastDates
      />,
    );
    await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: /15 de Septiembre/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /15 de Septiembre/i }));

    expect(screen.getByRole('button', { name: /08:00, Libre/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /10:00, Libre/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
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

  describe('customer booking notice', () => {
    const withNotice = (hours: number) => {
      subscribeSiteConfig.mockImplementation((callback: (config: typeof DEFAULT_SITE_CONFIG) => void) => {
        callback({ ...DEFAULT_SITE_CONFIG, startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 4, minBookingNoticeHours: hours });
        return vi.fn();
      });
    };

    const renderCalendar = (bookingNotice?: 'booking' | 'modification') => render(
      <InteractiveCalendar
        selectedSlot={null}
        onSelectSlot={vi.fn()}
        onClearSlot={vi.fn()}
        selectedDuration={60}
        bookingNotice={bookingNotice}
      />,
    );

    it('greys out slots that start inside the notice and keeps +24h bookable', async () => {
      withNotice(24); // now = 16 Sep 10:00 Madrid
      renderCalendar('booking');
      await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /18:00, No disponible/i })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /17 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /08:00, No disponible/i })).toBeDisabled();
      // The exact +24:00 boundary is covered by booking-notice.test.ts (the fake clock advances here).
      expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
    });

    it('0h books normally', async () => {
      withNotice(0);
      renderCalendar('booking');
      await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
    });

    it('admin calendars (no bookingNotice prop) are never limited', async () => {
      withNotice(24);
      renderCalendar();
      await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
    });

    it('modifications only apply the notice above the fixed 24h lock', async () => {
      withNotice(48);
      renderCalendar('modification');
      await waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /17 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /18:00, No disponible/i })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /18 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /08:00, No disponible/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
    });
  });

  describe('same-day booking block', () => {
    const baseConfig: typeof DEFAULT_SITE_CONFIG = { ...DEFAULT_SITE_CONFIG, startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 4 };
    let emitConfig: (config: typeof DEFAULT_SITE_CONFIG) => void = () => undefined;

    const withConfig = (overrides: Partial<typeof DEFAULT_SITE_CONFIG>) => {
      subscribeSiteConfig.mockImplementation((callback: (config: typeof DEFAULT_SITE_CONFIG) => void) => {
        emitConfig = callback;
        callback({ ...baseConfig, ...overrides });
        return vi.fn();
      });
    };

    function CustomerCalendar({ bookingNotice }: { bookingNotice?: 'booking' | 'modification' }) {
      const [slot, setSlot] = useState<TimeSlot | null>(null);
      return (
        <>
          <InteractiveCalendar
            selectedSlot={slot}
            onSelectSlot={setSlot}
            onClearSlot={() => setSlot(null)}
            selectedDuration={60}
            bookingNotice={bookingNotice}
          />
          <output data-testid="slot">{slot ? `${slot.date}_${slot.time}` : 'none'}</output>
        </>
      );
    }

    const ready = () => waitFor(() => expect(screen.queryByText('Cargando disponibilidad...')).not.toBeInTheDocument());

    it('greys out every future slot today with its own reason and keeps tomorrow bookable', async () => {
      withConfig({ blockSameDayBooking: true }); // now = 16 Sep 10:00 Madrid
      render(<CustomerCalendar bookingNotice="booking" />);
      await ready();

      fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));
      const tonight = screen.getByRole('button', { name: /18:00, No disponible/i });
      expect(tonight).toBeDisabled();
      expect(tonight).toHaveAttribute('data-restriction', 'same_day_booking_disabled');
      expect(tonight).toHaveAttribute('title', 'No se pueden reservar citas para el mismo día.');
      // A genuinely past slot is not tagged as a configuration restriction.
      expect(screen.getByRole('button', { name: /08:00, No disponible/i })).not.toHaveAttribute('data-restriction');

      fireEvent.click(screen.getByRole('button', { name: /17 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /08:00, Libre/i })).toBeEnabled();
    });

    it('does not limit admin calendars, modifications or configs without the flag', async () => {
      withConfig({ blockSameDayBooking: true });
      const { unmount } = render(<CustomerCalendar />);
      await ready();
      fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
      unmount();

      withConfig({ blockSameDayBooking: true });
      const modification = render(<CustomerCalendar bookingNotice="modification" />);
      await ready();
      fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /18:00, Libre/i })).not.toHaveAttribute('data-restriction');
      modification.unmount();

      withConfig({});
      render(<CustomerCalendar bookingNotice="booking" />);
      await ready();
      fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));
      expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
    });

    it('reacts live to the admin toggling the flag and drops a selection that became blocked', async () => {
      withConfig({ blockSameDayBooking: false });
      render(<CustomerCalendar bookingNotice="booking" />);
      await ready();

      fireEvent.click(screen.getByRole('button', { name: /16 de Septiembre/i }));
      fireEvent.click(screen.getByRole('button', { name: /18:00, Libre/i }));
      expect(screen.getByTestId('slot')).toHaveTextContent('2026-09-16_18:00');

      act(() => emitConfig({ ...baseConfig, blockSameDayBooking: true }));
      expect(screen.getByRole('button', { name: /18:00, No disponible/i })).toBeDisabled();
      expect(screen.getByTestId('slot')).toHaveTextContent('none');

      act(() => emitConfig({ ...baseConfig, blockSameDayBooking: false }));
      expect(screen.getByRole('button', { name: /18:00, Libre/i })).toBeEnabled();
    });
  });
});
