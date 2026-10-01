import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDocs: vi.fn(),
    update: vi.fn(),
    commit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, storage: {}, functions: 'firebase-functions' }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('firebase/storage', () => ({}));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => 'bonos'),
    query: vi.fn(() => 'query'),
    where: vi.fn(),
    orderBy: vi.fn(),
    getDocs: mocks.getDocs,
    doc: vi.fn((_db: unknown, collection: string, id: string) => `${collection}/${id}`),
    writeBatch: vi.fn(() => ({ update: mocks.update, commit: mocks.commit })),
}));

import { bonoExpiryInstant, isBonoOverdue, planBonoExpirationRecalculation } from './bono-expiration';
import { expireOverdueBonos, recalculateAllBonoExpirations } from './firestore';

function bonoDoc(id: string, data: Record<string, unknown>) {
    return { id, data: () => data };
}

describe('bono expiration helpers', () => {
    it('treats date-only expiries as valid until the end of that local day', () => {
        const expiry = bonoExpiryInstant('2026-10-08');
        expect(expiry?.getHours()).toBe(23);
        expect(isBonoOverdue({ fechaExpiracion: '2026-10-08' }, new Date(2026, 9, 8, 12))).toBe(false);
        expect(isBonoOverdue({ fechaExpiracion: '2026-10-08' }, new Date(2026, 9, 9, 0, 1))).toBe(true);
        expect(isBonoOverdue({ fechaExpiracion: 'not-a-date' }, new Date())).toBe(false);
    });

    it('recalculates to the end of the local day and clamps short months', () => {
        const [update] = planBonoExpirationRecalculation(
            [{ id: 'b1', fechaAsignacion: new Date(2026, 0, 31).toISOString(), fechaExpiracion: '' }],
            1,
            new Date(2026, 1, 1),
            'bulk-1',
        );
        const expiry = new Date(update.fechaExpiracion);
        expect([expiry.getMonth(), expiry.getDate(), expiry.getHours(), expiry.getMinutes()]).toEqual([1, 28, 23, 59]);
        expect(update).toMatchObject({ id: 'b1', estado: 'activo', notificationBulkOperationId: 'bulk-1' });
    });

    it('marks bonos whose new validity already passed as expired', () => {
        const [update] = planBonoExpirationRecalculation(
            [{ id: 'b1', fechaAsignacion: '2026-01-10', fechaExpiracion: '' }],
            1,
            new Date(2026, 5, 1),
            'bulk-1',
        );
        expect(update.estado).toBe('expirado');
    });
});

describe('administrative bulk recalculation', () => {
    beforeEach(() => vi.clearAllMocks());

    it('stamps every write with one bulk operation id so customers get no mass email', async () => {
        mocks.getDocs.mockResolvedValue({
            docs: [
                bonoDoc('b1', { userId: 'u1', estado: 'activo', fechaAsignacion: '2026-09-01', fechaExpiracion: '2026-10-01' }),
                bonoDoc('b2', { userId: 'u2', estado: 'activo', fechaAsignacion: '2026-09-15', fechaExpiracion: '2026-10-15' }),
            ],
        });

        await expect(recalculateAllBonoExpirations(3)).resolves.toBe(2);

        expect(mocks.update).toHaveBeenCalledTimes(2);
        const ids = mocks.update.mock.calls.map(([, update]) => update.notificationBulkOperationId);
        expect(ids[0]).toMatch(/^bulk-expiration-/);
        expect(ids[1]).toBe(ids[0]);
        expect(mocks.commit).toHaveBeenCalledTimes(1);
    });

    it('client-side expiry keeps date-only bonos valid for the whole day', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 8, 12));
        mocks.getDocs.mockResolvedValue({
            docs: [bonoDoc('today', { userId: 'u1', estado: 'activo', fechaExpiracion: '2026-10-08' })],
        });
        await expireOverdueBonos();
        expect(mocks.update).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
