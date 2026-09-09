import { describe, expect, it } from 'vitest';
import {
    getAdminCreateClientSuccessKind,
    REPAIRED_EXISTING_AUTH_NOTICE,
    shouldSendPasswordResetAfterAdminCreate,
} from './admin-create-client';

describe('admin create client success flow', () => {
    it('does not send password reset when an orphan Auth user was repaired', () => {
        expect(shouldSendPasswordResetAfterAdminCreate(true, 'email-reset')).toBe(false);
        expect(shouldSendPasswordResetAfterAdminCreate(true, 'password')).toBe(false);
        expect(getAdminCreateClientSuccessKind(true, 'email-reset')).toBe('repaired');
        expect(REPAIRED_EXISTING_AUTH_NOTICE).toBe(
            'Usuario recuperado. La cuenta ya existía y se ha restaurado su perfil en el panel.',
        );
    });

    it('sends password reset only for a new user created with email-reset', () => {
        expect(shouldSendPasswordResetAfterAdminCreate(false, 'email-reset')).toBe(true);
        expect(shouldSendPasswordResetAfterAdminCreate(false, 'password')).toBe(false);
        expect(shouldSendPasswordResetAfterAdminCreate(undefined, 'email-reset')).toBe(true);
        expect(getAdminCreateClientSuccessKind(false, 'email-reset')).toBe('created-with-reset');
        expect(getAdminCreateClientSuccessKind(false, 'password')).toBe('created');
    });
});
