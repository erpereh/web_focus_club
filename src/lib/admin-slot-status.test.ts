import { describe, expect, it } from 'vitest';
import fixture from '../../functions/test/fixtures/slot-parity.json';
import { getAdminCreateSlotStatus, type AdminSlotTone } from './admin-slot-status';
import { normalizeSiteConfig } from './site-config';
import type { Appointment, SiteConfig } from '@/types';

const TONE_TO_REASON: Record<AdminSlotTone, string | null> = {
    free: null,
    partial: null,
    full: 'slot_full',
    blocked: 'slot_blocked',
    invalid: 'invalid_occupancy',
    duplicate: 'appointment_conflict',
    muted: 'outside_schedule',
};

const HARD_REASONS = new Set(['invalid_occupancy', 'appointment_conflict']);

function approved(id: string, userId: string, time: string, duration: number): Appointment {
    return {
        id,
        userId,
        name: 'Cliente',
        email: 'c@example.com',
        phone: '',
        serviceType: 'Bono',
        duration: String(duration) as Appointment['duration'],
        preferredSlots: [{ date: fixture.date, time }],
        approvedSlot: { date: fixture.date, time },
        reason: '',
        status: 'approved',
        createdAt: '2026-10-01T00:00:00.000Z',
    } as Appointment;
}

function occupancyRecord(occupancy: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(occupancy).map(([time, count]) => [`${fixture.date}_${time}`, count]));
}

describe('admin "Nueva cita" grid matches evaluateSlot (shared fixture)', () => {
    const siteConfig = normalizeSiteConfig(fixture.config as Partial<SiteConfig>);
    for (const testCase of fixture.cases) {
        it(testCase.name, () => {
            const status = getAdminCreateSlotStatus({
                date: fixture.date,
                time: testCase.time,
                durationMinutes: testCase.duration,
                siteConfig,
                occupancy: occupancyRecord(testCase.occupancy),
                blockedSlotKeys: new Set(testCase.blocked.map((time) => `${fixture.date}_${time}`)),
                appointments: 'customerBooked' in testCase && testCase.customerBooked
                    ? [approved('other', 'user-1', testCase.customerBooked.time, testCase.customerBooked.duration)]
                    : [],
                userId: 'user-1',
            });
            expect(TONE_TO_REASON[status.tone]).toBe(testCase.expected);
            // Only rules an admin can never override stay disabled; the rest need a confirmation.
            expect(status.disabled).toBe(HARD_REASONS.has(testCase.expected ?? ''));
            expect(Boolean(status.restricted)).toBe(testCase.expected !== null && !HARD_REASONS.has(testCase.expected));
        });
    }
});

describe('getAdminCreateSlotStatus', () => {
    const siteConfig = normalizeSiteConfig({ ...fixture.config, maxCapacity: 4 } as Partial<SiteConfig>);
    const base = {
        date: '2030-01-15',
        time: '18:15',
        durationMinutes: 30,
        siteConfig,
        blockedSlotKeys: new Set<string>(),
        appointments: [] as Appointment[],
    };

    it('uses slot_occupancy, not the in-memory count, and reports the drift', () => {
        // Real production case: counter 5 (inflated by repeated approvals) vs 3 approved.
        const appointments = [
            approved('a', 'u1', '18:15', 30),
            approved('b', 'u2', '18:00', 45),
            approved('c', 'u3', '18:00', 30),
        ].map((appointment) => ({ ...appointment, preferredSlots: [{ date: base.date, time: appointment.approvedSlot!.time }], approvedSlot: { date: base.date, time: appointment.approvedSlot!.time } }));
        const status = getAdminCreateSlotStatus({
            ...base,
            appointments,
            occupancy: { '2030-01-15_18:15': 5, '2030-01-15_18:30': 5 },
        });
        expect(status).toMatchObject({ disabled: false, restricted: true, tone: 'full', occupancy: 5, mismatch: { registered: 5, approved: 3 } });
    });

    it('waits for the counters instead of showing free seats', () => {
        expect(getAdminCreateSlotStatus({ ...base, occupancy: null })).toMatchObject({ disabled: true, label: 'Cargando…' });
    });

    it('shows partial occupancy against the configured capacity', () => {
        expect(getAdminCreateSlotStatus({ ...base, occupancy: { '2030-01-15_18:30': 3 } }))
            .toMatchObject({ disabled: false, label: '3/4', tone: 'partial' });
    });

    it('keeps full, blocked and off-schedule slots selectable but restricted', () => {
        expect(getAdminCreateSlotStatus({ ...base, occupancy: { '2030-01-15_18:15': 4 } }))
            .toMatchObject({ disabled: false, restricted: true, tone: 'full', label: 'Lleno 4/4' });
        expect(getAdminCreateSlotStatus({ ...base, occupancy: {}, blockedSlotKeys: new Set(['2030-01-15_18:30']) }))
            .toMatchObject({ disabled: false, restricted: true, tone: 'blocked' });
        expect(getAdminCreateSlotStatus({ ...base, time: '06:00', occupancy: {} }))
            .toMatchObject({ disabled: false, restricted: true, label: 'Fuera de horario' });
    });

    it('never makes a customer duplicate or a corrupt counter selectable', () => {
        const own = { ...approved('own', 'u1', '18:15', 30), preferredSlots: [{ date: base.date, time: '18:15' }], approvedSlot: { date: base.date, time: '18:15' } };
        expect(getAdminCreateSlotStatus({ ...base, occupancy: { '2030-01-15_18:15': 1 }, appointments: [own], userId: 'u1' }))
            .toMatchObject({ disabled: true, tone: 'duplicate' });
        expect(getAdminCreateSlotStatus({ ...base, occupancy: { '2030-01-15_18:15': -1 } }))
            .toMatchObject({ disabled: true, tone: 'invalid' });
    });

    it('keeps past slots disabled until past dates are enabled, then restricted', () => {
        const now = new Date('2030-01-15T18:00:00.000Z'); // 19:00 in Madrid
        expect(getAdminCreateSlotStatus({ ...base, occupancy: {}, now }))
            .toMatchObject({ disabled: true, label: 'Pasada' });
        expect(getAdminCreateSlotStatus({ ...base, occupancy: {}, now, pastAllowed: true }))
            .toMatchObject({ disabled: false, restricted: true, label: 'Pasada · Libre' });
        expect(getAdminCreateSlotStatus({ ...base, time: '20:00', occupancy: {}, now }))
            .toMatchObject({ disabled: false, label: 'Libre' });
    });

    it('asks for a date first', () => {
        expect(getAdminCreateSlotStatus({ ...base, date: '', occupancy: {} })).toMatchObject({ disabled: true, label: 'Elige fecha' });
    });
});
