const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ExpirableBono {
    id: string;
    fechaAsignacion: string;
    fechaExpiracion: string;
}

export interface BonoExpirationUpdate {
    id: string;
    fechaExpiracion: string;
    estado: 'activo' | 'expirado';
    /**
     * Marks the write as an administrative bulk edit. The notification
     * trigger records it in the customer's history without push or email,
     * so recalculating every bono never sends a mass mailing.
     */
    notificationBulkOperationId: string;
}

/**
 * Instant after which a bono is expired. Full timestamps are used as-is;
 * date-only values last until the end of that local day, matching the
 * backend (`functions/src/notifications/bonoEvents.ts`).
 */
export function bonoExpiryInstant(value: string | undefined): Date | null {
    if (!value) return null;
    if (DATE_ONLY_RE.test(value)) {
        const [year, month, day] = value.split('-').map(Number);
        return new Date(year, month - 1, day, 23, 59, 59, 999);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function isBonoOverdue(bono: { fechaExpiracion?: string }, now: Date): boolean {
    const expiresAt = bonoExpiryInstant(bono.fechaExpiracion);
    return Boolean(expiresAt && expiresAt.getTime() < now.getTime());
}

function addLocalMonthsClamped(date: Date, months: number): Date {
    const result = new Date(date);
    const day = date.getDate();
    const targetMonthIndex = date.getMonth() + months;
    const lastTargetDay = new Date(date.getFullYear(), targetMonthIndex + 1, 0).getDate();
    result.setFullYear(date.getFullYear(), targetMonthIndex, Math.min(day, lastTargetDay));
    return result;
}

/**
 * New validity for every active bono after changing the default duration:
 * start date + `months` (clamped to the month's last day), valid until the
 * end of that local day, the same rule used when assigning a bono.
 */
export function planBonoExpirationRecalculation(
    bonos: ExpirableBono[],
    months: number,
    now: Date,
    bulkOperationId: string,
): BonoExpirationUpdate[] {
    return bonos.flatMap((bono) => {
        const start = bonoExpiryInstant(bono.fechaAsignacion);
        if (!start) return [];
        const assignedDay = DATE_ONLY_RE.test(bono.fechaAsignacion)
            ? start
            : new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const expiry = addLocalMonthsClamped(assignedDay, months);
        expiry.setHours(23, 59, 59, 999);
        return [{
            id: bono.id,
            fechaExpiracion: expiry.toISOString(),
            estado: expiry.getTime() < now.getTime() ? 'expirado' as const : 'activo' as const,
            notificationBulkOperationId: bulkOperationId,
        }];
    });
}
