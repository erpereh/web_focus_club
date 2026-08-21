import { describe, expect, it } from 'vitest';
import {
  getMonthGrid,
  groupAppointmentsByDay,
  resolveAppointmentSchedule,
  shiftMonth,
} from './appointment-calendar-utils';

describe('getMonthGrid', () => {
  it('starts on the first of the month when the month begins on Monday', () => {
    const grid = getMonthGrid(2024, 0, new Date(2024, 0, 15));

    expect(grid[0]).toMatchObject({
      date: '2024-01-01',
      inCurrentMonth: true,
    });
    expect(grid.length % 7).toBe(0);
    expect(grid.filter((day) => day.inCurrentMonth)).toHaveLength(31);
  });

  it('pads the previous month when the month begins on Sunday', () => {
    const grid = getMonthGrid(2024, 8, new Date(2024, 8, 15));

    expect(grid[0]).toMatchObject({
      date: '2024-08-26',
      inCurrentMonth: false,
    });
    expect(grid[6]).toMatchObject({
      date: '2024-09-01',
      inCurrentMonth: true,
    });
    expect(grid.filter((day) => day.inCurrentMonth)).toHaveLength(30);
  });

  it('includes January days after December', () => {
    const grid = getMonthGrid(2024, 11, new Date(2024, 11, 15));
    const lastDay = grid[grid.length - 1];

    expect(grid.some((day) => day.date === '2024-12-01' && day.inCurrentMonth)).toBe(true);
    expect(lastDay.year).toBe(2025);
    expect(lastDay.monthIndex).toBe(0);
    expect(lastDay.inCurrentMonth).toBe(false);
  });

  it('includes December days before January', () => {
    const grid = getMonthGrid(2025, 0, new Date(2025, 0, 15));

    expect(grid[0].year).toBe(2024);
    expect(grid[0].monthIndex).toBe(11);
    expect(grid[0].inCurrentMonth).toBe(false);
    expect(grid.some((day) => day.date === '2025-01-01' && day.inCurrentMonth)).toBe(true);
  });

  it('renders a 28-day February', () => {
    const grid = getMonthGrid(2023, 1, new Date(2023, 1, 15));
    const currentDays = grid.filter((day) => day.inCurrentMonth);

    expect(currentDays).toHaveLength(28);
    expect(currentDays[0].date).toBe('2023-02-01');
    expect(currentDays[27].date).toBe('2023-02-28');
  });

  it('renders a 29-day February on a leap year', () => {
    const grid = getMonthGrid(2024, 1, new Date(2024, 1, 15));
    const currentDays = grid.filter((day) => day.inCurrentMonth);

    expect(currentDays).toHaveLength(29);
    expect(currentDays[0].date).toBe('2024-02-01');
    expect(currentDays[28].date).toBe('2024-02-29');
  });
});

describe('shiftMonth', () => {
  it('moves from December to January of the next year', () => {
    expect(shiftMonth(2024, 11, 1)).toEqual({ year: 2025, monthIndex: 0 });
  });

  it('moves from January to December of the previous year', () => {
    expect(shiftMonth(2025, 0, -1)).toEqual({ year: 2024, monthIndex: 11 });
  });
});

describe('resolveAppointmentSchedule', () => {
  it('uses approvedSlot before preferredSlots', () => {
    const schedule = resolveAppointmentSchedule({
      approvedSlot: { date: '2026-08-21', time: '08:00' },
      preferredSlots: [{ date: '2026-08-22', time: '10:00' }],
      date: '2026-08-23',
      time: '12:00',
      duration: '45',
    });

    expect(schedule).toMatchObject({
      date: '2026-08-21',
      time: '08:00',
      durationMinutes: 45,
      endTime: '08:45',
    });
  });

  it('uses preferredSlots[0] when there is no approved slot', () => {
    const schedule = resolveAppointmentSchedule({
      preferredSlots: [{ date: '2026-08-22', time: '10:00' }],
      duration: '60',
    });

    expect(schedule).toMatchObject({
      date: '2026-08-22',
      time: '10:00',
      durationMinutes: 60,
      endTime: '11:00',
    });
  });

  it('supports legacy date and time fields', () => {
    const schedule = resolveAppointmentSchedule({
      preferredSlots: [],
      date: '2026-08-23',
      time: '9:30',
      duration: '30',
    });

    expect(schedule).toMatchObject({
      date: '2026-08-23',
      time: '09:30',
      durationMinutes: 30,
      endTime: '10:00',
    });
  });

  it('returns null when the appointment has no valid date', () => {
    expect(
      resolveAppointmentSchedule({
        preferredSlots: [{ date: 'not-a-date', time: '10:00' }],
        date: '',
        time: '10:00',
      }),
    ).toBeNull();
  });
});

describe('groupAppointmentsByDay', () => {
  it('sorts appointments on the same day by time ascending', () => {
    const grouped = groupAppointmentsByDay([
      { preferredSlots: [{ date: '2026-08-21', time: '12:00' }] },
      { preferredSlots: [{ date: '2026-08-21', time: '08:00' }] },
      { preferredSlots: [{ date: '2026-08-21', time: '10:00' }] },
      { preferredSlots: [] },
    ]);

    expect(grouped.get('2026-08-21')?.map((item) => resolveAppointmentSchedule(item)?.time)).toEqual([
      '08:00',
      '10:00',
      '12:00',
    ]);
    expect(grouped.size).toBe(1);
  });
});
