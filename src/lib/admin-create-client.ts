import type { AdminUserAccessMethod } from '@/lib/firestore';

export const REPAIRED_EXISTING_AUTH_NOTICE =
    'Usuario recuperado. La cuenta ya existía y se ha restaurado su perfil en el panel.';

export type AdminCreateClientSuccessKind = 'repaired' | 'created-with-reset' | 'created';

export function shouldSendPasswordResetAfterAdminCreate(
    repairedExistingAuth: boolean | undefined,
    accessMethod: AdminUserAccessMethod,
): boolean {
    return repairedExistingAuth !== true && accessMethod === 'email-reset';
}

export function getAdminCreateClientSuccessKind(
    repairedExistingAuth: boolean | undefined,
    accessMethod: AdminUserAccessMethod,
): AdminCreateClientSuccessKind {
    if (repairedExistingAuth === true) return 'repaired';
    if (accessMethod === 'email-reset') return 'created-with-reset';
    return 'created';
}
