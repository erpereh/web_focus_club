import { describe, expect, it } from 'vitest';
import {
    getCancellationCategory,
    getChargedMinutes,
    previewCancellationMinutes,
    withCancellationVisual,
} from './appointment-cancellation';
import { buildAdminDeepLink, parseAdminDeepLink } from './admin-deep-link';

const base = { label: 'Cancelada', color: 'muted', icon: 'x' };

describe('cancellation modality', () => {
    it('classifies only what was recorded; old cancellations stay unclassified', () => {
        expect(getCancellationCategory({ status: 'cancelled', cancellationCharge: 'charged' })).toBe('charged');
        expect(getCancellationCategory({ status: 'cancelled', cancellationCharge: 'not_charged' })).toBe('not_charged');
        expect(getCancellationCategory({ status: 'cancelled' })).toBe('unclassified');
        expect(getCancellationCategory({ status: 'approved', cancellationCharge: 'charged' })).toBeNull();
        expect(getCancellationCategory({ status: 'rejected' })).toBeNull();
    });

    it('shows the modality in the status label and keeps the other fields', () => {
        expect(withCancellationVisual({ status: 'cancelled', cancellationCharge: 'charged' }, base)).toMatchObject({
            label: 'Cancelada con cargo', icon: 'x',
        });
        expect(withCancellationVisual({ status: 'cancelled', cancellationCharge: 'not_charged' }, base).label).toBe('Cancelada sin cargo');
        expect(withCancellationVisual({ status: 'cancelled' }, base).label).toBe('Cancelada · Sin clasificar');
        expect(withCancellationVisual({ status: 'approved' }, base)).toBe(base);
    });

    it('counts charged minutes only for charged cancellations', () => {
        expect(getChargedMinutes({ status: 'cancelled', cancellationCharge: 'charged', cancellationChargedMinutes: 60 })).toBe(60);
        expect(getChargedMinutes({ status: 'cancelled', cancellationCharge: 'not_charged', cancellationChargedMinutes: 60 })).toBe(0);
        expect(getChargedMinutes({ status: 'cancelled', cancellationCharge: 'charged' })).toBe(0);
    });

    it('previews the minutes exactly like the server (nothing new is ever debited)', () => {
        const deducted = { bonoId: 'b', minutesDeducted: true, minutesDeductedAmount: 30, minutesDeductedAt: 'x' };
        expect(previewCancellationMinutes(deducted).consumedMinutes).toBe(30);
        expect(previewCancellationMinutes({ ...deducted, minutesRefundedAt: 'y' }).consumedMinutes).toBe(0);
        expect(previewCancellationMinutes({ ...deducted, minutesDeductedAt: undefined }).consumedMinutes).toBe(0);
        expect(previewCancellationMinutes({ ...deducted, appointmentType: 'nutrition' })).toMatchObject({ consumedMinutes: 0, isNutrition: true });
        expect(previewCancellationMinutes({}).hasBono).toBe(false);
    });
});

describe('admin deep links', () => {
    it('round-trips the supported parameters', () => {
        const link = buildAdminDeepLink({ tab: 'appointments', status: 'pending', trainerId: 'trainer-1' });
        expect(link).toBe('/admin?tab=appointments&status=pending&trainer=trainer-1');
        expect(parseAdminDeepLink(link.slice('/admin'.length))).toEqual({ tab: 'appointments', status: 'pending', trainerId: 'trainer-1' });
        expect(parseAdminDeepLink('?tab=clients&q=Luc%C3%ADa')).toEqual({ tab: 'clients', clientQuery: 'Lucía' });
        expect(buildAdminDeepLink({})).toBe('/admin');
    });

    it('ignores unknown or oversized values', () => {
        expect(parseAdminDeepLink('?tab=config&status=deleted')).toEqual({});
        expect(parseAdminDeepLink(`?tab=team&trainer=${'x'.repeat(200)}`)).toEqual({ tab: 'team' });
    });
});
