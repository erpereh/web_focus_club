import { describe, expect, it } from 'vitest';
import type { Appointment, BlockedSlot } from '@/types';
import {
    buildCanonicalBlockedSlotDocuments,
    canonicalBlockedSlotId,
    canonicalBlockGroupId,
    getBlockedSelectionKeys,
    groupBlockedSlots,
    overlapsBlockedSelection,
} from './blocked-slots';

const appointment = (time: string, duration: Appointment['duration'] = '45'): Appointment => ({
    id: `appointment-${time}`,
    userId: 'user-1',
    name: 'Test',
    email: 'test@example.com',
    phone: '',
    serviceType: 'Training',
    duration,
    preferredSlots: [{ date: '2026-10-01', time }],
    reason: '',
    status: 'pending',
    createdAt: '2026-09-01T00:00:00.000Z',
});

describe('canonical blocked-slot persistence model', () => {
    it('derives deterministic document and group ids', () => {
        expect(canonicalBlockedSlotId('2026-10-01', '16:15')).toBe('2026-10-01_16:15');
        expect(canonicalBlockGroupId('2026-10-01', '16:00', 30)).toBe('2026-10-01_16:00_30');
    });

    it('persists a visible 30 minute block as two canonical documents', () => {
        expect(buildCanonicalBlockedSlotDocuments({
            date: '2026-10-01',
            startTimes: ['16:00'],
            groupDurationMinutes: 30,
            reason: 'Evento',
            createdBy: 'admin-1',
            createdAt: '2026-09-01T10:00:00.000Z',
        })).toEqual([
            expect.objectContaining({
                id: '2026-10-01_16:00',
                time: '16:00',
                blockGroupId: '2026-10-01_16:00_30',
                groupStartTime: '16:00',
                groupDurationMinutes: 30,
                sourceSlotInterval: 30,
            }),
            expect.objectContaining({
                id: '2026-10-01_16:15',
                time: '16:15',
                blockGroupId: '2026-10-01_16:00_30',
            }),
        ]);
    });

    it('groups canonical documents into one logical Admin selection', () => {
        const slots = buildCanonicalBlockedSlotDocuments({
            date: '2026-10-01',
            startTimes: ['16:00'],
            groupDurationMinutes: 30,
            createdBy: 'admin-1',
            createdAt: '2026-09-01T10:00:00.000Z',
        }) as BlockedSlot[];

        expect(groupBlockedSlots(slots)).toEqual([
            expect.objectContaining({
                id: '2026-10-01_16:00_30',
                startTime: '16:00',
                durationMinutes: 30,
                documentIds: ['2026-10-01_16:00', '2026-10-01_16:15'],
            }),
        ]);
    });
});

describe('delete-on-block overlap detection', () => {
    const selectedKeys = getBlockedSelectionKeys('2026-10-01', ['16:15'], 15);

    it('detects an appointment whose range covers the selected canonical block', () => {
        expect(overlapsBlockedSelection(appointment('16:00'), selectedKeys)).toBe(true);
    });

    it('does not match an adjacent appointment ending at the selected block', () => {
        expect(overlapsBlockedSelection(appointment('15:30'), selectedKeys)).toBe(false);
    });

    it('uses approvedSlot before a stale preferred slot', () => {
        const approved = {
            ...appointment('16:15'),
            status: 'approved' as const,
            approvedSlot: { date: '2026-10-01', time: '18:00' },
        };
        expect(overlapsBlockedSelection(approved, selectedKeys)).toBe(false);
    });
});
