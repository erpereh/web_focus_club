import type { Appointment, TimeSlot } from '@/types';
import { classifyMadridCivilSlot, getAppointmentEffectiveSlot } from './madrid-date';

export type RecurringRescheduleScope = 'single' | 'following';

export interface RecurringRescheduleRequest {
    appointmentId: string;
    preferredSlot: TimeSlot;
    scope: RecurringRescheduleScope;
}

export function buildRecurringRescheduleRequest(
    appointmentId: string,
    preferredSlot: TimeSlot,
    scope: RecurringRescheduleScope,
): RecurringRescheduleRequest {
    return { appointmentId, preferredSlot, scope };
}

export function getRecurringRescheduleExcludedAppointmentIds(
    appointments: Appointment[],
    selected: Appointment,
    scope: RecurringRescheduleScope,
    now: Date,
): Set<string> {
    if (scope === 'single') return new Set([selected.id]);
    const selectedIndex = selected.recurrenceIndex;
    if (!selected.recurrenceSeriesId || !Number.isInteger(selectedIndex)) return new Set([selected.id]);

    return new Set(appointments
        .filter((appointment) => {
            if (appointment.recurrenceSeriesId !== selected.recurrenceSeriesId
                || appointment.status !== 'approved'
                || !Number.isInteger(appointment.recurrenceIndex)
                || (appointment.recurrenceIndex as number) < (selectedIndex as number)) {
                return false;
            }
            const slot = getAppointmentEffectiveSlot(appointment);
            return Boolean(slot && classifyMadridCivilSlot(slot, now).isFuture);
        })
        .sort((left, right) => (left.recurrenceIndex ?? 0) - (right.recurrenceIndex ?? 0))
        .map((appointment) => appointment.id));
}

export function canCustomerRescheduleRecurringAppointment(
    appointment: Appointment,
    userId: string | undefined,
    now: Date,
): boolean {
    if (!userId
        || appointment.userId !== userId
        || !appointment.recurrenceSeriesId
        || appointment.status !== 'approved') {
        return false;
    }
    const slot = getAppointmentEffectiveSlot(appointment);
    if (!slot) return false;
    const state = classifyMadridCivilSlot(slot, now);
    return state.isFuture && !state.isToday;
}

interface CallableErrorShape {
    message?: string;
    details?: unknown;
    customData?: { details?: unknown };
}

function errorDetails(error: unknown): Record<string, unknown> {
    const shape = error as CallableErrorShape;
    const details = shape?.details ?? shape?.customData?.details;
    return typeof details === 'object' && details !== null ? details as Record<string, unknown> : {};
}

function formatProblematicSlot(value: unknown): string {
    if (typeof value !== 'object' || value === null) return '';
    const slot = value as Partial<TimeSlot>;
    if (!slot.date || !slot.time) return '';
    const [year, month, day] = slot.date.split('-');
    return ` del ${day}/${month}/${year} a las ${slot.time}`;
}

export function getRecurringRescheduleErrorMessage(error: unknown, fallback: string): string {
    const details = errorDetails(error);
    const reason = typeof details.reason === 'string' ? details.reason : '';
    const slot = formatProblematicSlot(details.problematicSlot);
    const followingPrefix = details.scope === 'following' ? 'No se pudo modificar toda la serie: ' : '';
    const messages: Record<string, string> = {
        same_day_change_not_allowed: 'Las citas no se pueden modificar ni cancelar el mismo día.',
        slot_blocked: `${followingPrefix}la franja${slot} está bloqueada.`,
        slot_full: `${followingPrefix}la franja${slot} está completa.`,
        appointment_conflict: `${followingPrefix}ya existe otra cita que se solapa con la franja${slot}.`,
        outside_schedule: `${followingPrefix}la franja${slot} queda fuera del horario del centro.`,
        slot_not_future: `${followingPrefix}la franja${slot} ya no está en el futuro.`,
        invalid_occupancy: 'La ocupación registrada no es válida. Contacta con el centro.',
        recurring_occurrence_unavailable: `${followingPrefix}una sesión futura de la serie ya no está disponible.`,
    };
    if (messages[reason]) return messages[reason];
    return error instanceof Error && error.message ? error.message : fallback;
}
