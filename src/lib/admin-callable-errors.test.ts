import { describe, expect, it } from 'vitest';
import { getAdminCallableErrorMessage, getAdminTransportErrorMessage } from './admin-callable-errors';
import { getRecurringRescheduleErrorMessage } from './recurring-reschedule';

describe('admin callable errors', () => {
    it.each(['internal', 'unavailable', 'aborted', 'resource-exhausted', 'deadline-exceeded'])('explains an uncertain %s without claiming rollback or retrying', (code) => {
        const error = Object.assign(new Error('INTERNAL private SDK detail'), { code: `functions/${code}` });
        const message = getAdminCallableErrorMessage(error, 'fallback');
        expect(message).toContain('comprobar el resultado antes de repetir');
        expect(message).not.toContain('private SDK');
        expect(getRecurringRescheduleErrorMessage(error, 'fallback')).toBe(message);
        expect(getAdminTransportErrorMessage({ code })).toBe(message);
    });

    it('preserves business messages and reason-specific series explanations', () => {
        const error = Object.assign(new Error('La cita ha cambiado.'), {
            code: 'functions/failed-precondition', details: { reason: 'appointment_conflict' },
        });
        expect(getAdminTransportErrorMessage(error)).toBeUndefined();
        expect(getAdminCallableErrorMessage(error, 'fallback')).toBe('La cita ha cambiado.');
        expect(getRecurringRescheduleErrorMessage(error, 'fallback')).toContain('se solapa');
        expect(getAdminCallableErrorMessage({ code: 'functions/already-exists' }, 'fallback')).toBe('Ya existe un usuario con este email.');
        expect(getAdminCallableErrorMessage(null, 'fallback')).toBe('fallback');
    });
});
