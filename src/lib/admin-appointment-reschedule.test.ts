import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    httpsCallable: vi.fn(),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('@/lib/firebase', () => ({ db: {}, storage: {}, functions: 'firebase-functions' }));
vi.mock('firebase/firestore', () => ({}));
vi.mock('firebase/storage', () => ({}));

import {
    replaceRecurringSeriesScheduleFromAdmin,
    rescheduleAppointmentFromAdmin,
} from './firestore';

describe('admin appointment reschedule Firestore wrappers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('dispatches the single callable with its exact backend contract', async () => {
        const callable = vi.fn(async () => ({
            data: { success: true, appointmentId: 'appointment-1' },
        }));
        mocks.httpsCallable.mockReturnValue(callable);

        await expect(rescheduleAppointmentFromAdmin({
            appointmentId: 'appointment-1',
            slot: { date: '2026-09-20', time: '18:00' },
            assignedTrainer: null,
        })).resolves.toEqual({ success: true, appointmentId: 'appointment-1' });

        expect(mocks.httpsCallable).toHaveBeenCalledWith(
            'firebase-functions',
            'rescheduleAppointmentFromAdmin',
        );
        expect(callable).toHaveBeenCalledWith({
            appointmentId: 'appointment-1',
            slot: { date: '2026-09-20', time: '18:00' },
            assignedTrainer: null,
        });
    });

    it('dispatches series replacement with startSlot and endDate', async () => {
        const callable = vi.fn(async () => ({
            data: { success: true, seriesId: 'series-1', appointmentId: 'appointment-1' },
        }));
        mocks.httpsCallable.mockReturnValue(callable);
        const input = {
            appointmentId: 'appointment-1',
            startSlot: { date: '2026-09-20', time: '18:00' },
            endDate: '2026-10-04',
            assignedTrainer: 'trainer-1',
        } as const;

        await expect(replaceRecurringSeriesScheduleFromAdmin(input)).resolves.toEqual({
            success: true,
            seriesId: 'series-1',
            appointmentId: 'appointment-1',
        });
        expect(mocks.httpsCallable).toHaveBeenCalledWith(
            'firebase-functions',
            'replaceRecurringSeriesScheduleFromAdmin',
        );
        expect(callable).toHaveBeenCalledWith(input);
    });
});
