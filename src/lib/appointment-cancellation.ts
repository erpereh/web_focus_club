import type { Appointment } from '@/types';

/**
 * Cancellation modality, decided by the admin (same-day cancellations) or
 * recorded automatically as "sin cargo" for customer cancellations. Mirrors
 * `functions/src/cancellationCharge.ts`; only Cloud Functions write it.
 */
export type CancellationCharge = 'charged' | 'not_charged';

/** Cancellations written before the modality existed are never classified after the fact. */
export type CancellationCategory = CancellationCharge | 'unclassified';

export const CANCELLATION_CATEGORY_LABELS: Record<CancellationCategory, string> = {
    charged: 'Cancelada con cargo',
    not_charged: 'Cancelada sin cargo',
    unclassified: 'Cancelada · Sin clasificar',
};

export const CANCELLATION_CATEGORY_SHORT_LABELS: Record<CancellationCategory, string> = {
    charged: 'Con cargo',
    not_charged: 'Sin cargo',
    unclassified: 'Sin clasificar',
};

const CANCELLATION_CATEGORY_COLORS: Record<CancellationCategory, string> = {
    charged: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    not_charged: 'bg-muted/30 text-[var(--color-text-secondary)] border-muted/40',
    unclassified: 'bg-muted/20 text-[var(--color-text-secondary)] border-dashed border-muted/40',
};

type CancellationFields = Pick<Appointment, 'status' | 'cancellationCharge'>;

export function getCancellationCategory(appointment: CancellationFields): CancellationCategory | null {
    if (appointment.status !== 'cancelled') return null;
    if (appointment.cancellationCharge === 'charged' || appointment.cancellationCharge === 'not_charged') {
        return appointment.cancellationCharge;
    }
    return 'unclassified';
}

/** Minutes kept by a charged cancellation (0 for any other appointment). */
export function getChargedMinutes(appointment: Pick<Appointment, 'status' | 'cancellationCharge' | 'cancellationChargedMinutes'>): number {
    if (getCancellationCategory(appointment) !== 'charged') return 0;
    const minutes = Number(appointment.cancellationChargedMinutes ?? 0);
    return Number.isFinite(minutes) && minutes > 0 ? Math.trunc(minutes) : 0;
}

/** Same status visual everywhere in the admin, with the modality for cancellations. */
export function withCancellationVisual<T extends { label: string; color: string }>(
    appointment: CancellationFields,
    base: T,
): T {
    const category = getCancellationCategory(appointment);
    if (!category) return base;
    return { ...base, label: CANCELLATION_CATEGORY_LABELS[category], color: CANCELLATION_CATEGORY_COLORS[category] };
}

export interface CancellationMinutesPreview {
    /** Minutes the appointment has consumed and not got back: refunded without charge, kept with charge. */
    consumedMinutes: number;
    isNutrition: boolean;
    hasBono: boolean;
}

/**
 * What each modality would do, computed the same way as the server
 * (`chargeableMinutesOf`). The server re-reads the appointment before writing.
 */
export function previewCancellationMinutes(
    appointment: Pick<Appointment, 'appointmentType' | 'bonoId' | 'minutesDeducted' | 'minutesDeductedAmount' | 'minutesDeductedAt' | 'minutesRefundedAt'>,
): CancellationMinutesPreview {
    const isNutrition = appointment.appointmentType === 'nutrition';
    const hasBono = Boolean(appointment.bonoId);
    const amount = Number(appointment.minutesDeductedAmount ?? 0);
    const consumed = !isNutrition
        && appointment.minutesDeducted === true
        && Boolean(appointment.minutesDeductedAt)
        && !appointment.minutesRefundedAt
        && Number.isFinite(amount)
        && amount > 0;
    return { consumedMinutes: consumed ? Math.trunc(amount) : 0, isNutrition, hasBono };
}
