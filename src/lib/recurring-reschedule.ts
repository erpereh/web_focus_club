import type { Appointment, TimeSlot } from '@/types';
import { classifyMadridCivilSlot, getAppointmentEffectiveSlot } from './madrid-date';
import { getCanonicalSlotBlocks, getSlotAvailability, slotOccupancyKey } from './appointment-slots';

export type RecurringRescheduleScope = 'single' | 'series';
export type RecurringRescheduleBackendScope = RecurringRescheduleScope | 'following';

export const RECURRING_RESCHEDULE_SCOPE_OPTIONS: ReadonlyArray<{
    scope: RecurringRescheduleScope;
    title: string;
    description: string;
}> = [
    {
        scope: 'single',
        title: 'Solo esta cita',
        description: 'Únicamente esta sesión.',
    },
    {
        scope: 'series',
        title: 'Toda la serie',
        description: 'Se modificarán todas las sesiones futuras de esta serie. Las sesiones anteriores o canceladas no cambiarán.',
    },
];

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
    if (!selected.recurrenceSeriesId) return new Set([selected.id]);

    if (selected.status === 'pending') {
        return new Set(appointments
            .filter((appointment) => appointment.recurrenceSeriesId === selected.recurrenceSeriesId
                && appointment.status === 'pending')
            .sort((left, right) => (left.recurrenceIndex ?? 0) - (right.recurrenceIndex ?? 0))
            .map((appointment) => appointment.id));
    }

    return new Set(appointments
        .filter((appointment) => {
            if (appointment.recurrenceSeriesId !== selected.recurrenceSeriesId
                || appointment.status !== 'approved'
            ) {
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

export type RecurringRescheduleSlotUnavailableReason =
    | 'slot_blocked'
    | 'slot_full'
    | 'appointment_conflict';

export interface RecurringRescheduleSlotAvailability {
    disabled: boolean;
    reason: RecurringRescheduleSlotUnavailableReason | null;
    occupancy: number;
}

export interface RescheduleCalendarContext {
    userBookedSlotKeys: Set<string>;
    occupancyCreditsByKey: Map<string, number>;
}

/**
 * Builds the purely visual adjustments used while an appointment is being moved.
 * Excluded pending appointments stop conflicting with themselves but never receive
 * occupancy credit because pending appointments do not consume global capacity.
 */
export function buildRescheduleCalendarContext(
    appointments: Appointment[],
    userId: string,
    excludedAppointmentIds: Set<string>,
): RescheduleCalendarContext {
    const userBookedSlotKeys = new Set<string>();
    const occupancyCreditsByKey = new Map<string, number>();

    appointments.forEach((appointment) => {
        const slot = getAppointmentEffectiveSlot(appointment);
        const duration = Number(appointment.duration);
        if (!slot || ![30, 45, 60].includes(duration)) return;

        if (appointment.userId === userId
            && !excludedAppointmentIds.has(appointment.id)
            && (appointment.status === 'pending' || appointment.status === 'approved')) {
            getCanonicalSlotBlocks(slot.time, duration).forEach((time) => {
                userBookedSlotKeys.add(slotOccupancyKey(slot.date, time));
            });
        }

        if (excludedAppointmentIds.has(appointment.id) && appointment.status === 'approved') {
            getCanonicalSlotBlocks(slot.time, duration).forEach((time) => {
                const key = slotOccupancyKey(slot.date, time);
                occupancyCreditsByKey.set(key, (occupancyCreditsByKey.get(key) ?? 0) + 1);
            });
        }
    });

    return { userBookedSlotKeys, occupancyCreditsByKey };
}

export function getRecurringRescheduleSlotAvailability(input: {
    appointments: Appointment[];
    selected: Appointment;
    excludedAppointmentIds: Set<string>;
    slot: TimeSlot;
    durationMinutes: 30 | 45 | 60;
    occupancy: Record<string, number>;
    blockedSlotKeys: Set<string>;
    maxCapacity: number;
}): RecurringRescheduleSlotAvailability {
    const context = buildRescheduleCalendarContext(
        input.appointments,
        input.selected.userId,
        input.excludedAppointmentIds,
    );
    return getSlotAvailability({
        slot: input.slot,
        durationMinutes: input.durationMinutes,
        occupancy: input.occupancy,
        blockedSlotKeys: input.blockedSlotKeys,
        userBookedSlotKeys: context.userBookedSlotKeys,
        occupancyCreditsByKey: context.occupancyCreditsByKey,
        maxCapacity: input.maxCapacity,
    });
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
    const multiAppointmentPrefix = details.scope === 'series' || details.scope === 'following'
        ? 'No se pudo modificar toda la serie: '
        : '';
    const messages: Record<string, string> = {
        invalid_request: 'Los datos de la modificación no son válidos.',
        unauthenticated: 'Debes iniciar sesión como administrador.',
        admin_required: 'No tienes permisos de administrador.',
        appointment_not_found: 'No se ha encontrado la cita indicada.',
        appointment_unavailable: 'La cita indicada ya no se puede modificar.',
        not_recurring: 'La cita indicada no pertenece a una serie recurrente.',
        series_not_found: 'No se ha encontrado la serie de la cita.',
        series_unavailable: 'La serie de la cita ya no se puede modificar.',
        series_owner_mismatch: 'Los datos de la serie no coinciden con sus sesiones.',
        user_not_found: 'No se ha encontrado el cliente de la serie.',
        no_future_approved_occurrences: 'La serie no tiene sesiones futuras aprobadas para modificar.',
        no_pending_occurrences: 'La serie no tiene sesiones pendientes para modificar.',
        no_approved_occurrences: 'La serie no tiene sesiones aprobadas para volver a pendiente.',
        series_has_historical_occurrences: 'Esta serie ya contiene sesiones pasadas y no puede volver completa a pendiente. Puedes modificar las sesiones futuras o corregir una cita individualmente.',
        trainer_not_found: 'No se ha encontrado el entrenador indicado.',
        trainer_inactive: 'El entrenador seleccionado no está activo.',
        invalid_duration: 'La duración de la cita no es válida.',
        invalid_interval: 'El intervalo de la serie no es válido.',
        invalid_current_slot: 'La cita actual no tiene una franja válida.',
        invalid_slot: 'La franja seleccionada no tiene un formato válido.',
        invalid_end_date: `${multiAppointmentPrefix}la fecha final no coincide con la cadencia de la serie.`,
        invalid_series_length: `${multiAppointmentPrefix}la serie debe contener entre dos y el máximo de sesiones permitido.`,
        invalid_occurrence_data: `${multiAppointmentPrefix}una sesión futura de la serie no contiene datos válidos.`,
        invalid_occurrence_slot: `${multiAppointmentPrefix}una sesión futura de la serie no tiene una franja válida.`,
        duplicate_recurrence_index: `${multiAppointmentPrefix}la serie contiene índices de recurrencia duplicados.`,
        series_membership_mismatch: 'La cita indicada no pertenece a la serie actual.',
        invalid_bono: 'El bono reservado de la serie no es válido.',
        bono_unavailable: 'El bono reservado no está disponible.',
        insufficient_bono_minutes: 'El bono reservado no tiene minutos suficientes.',
        invalid_financial_reservation: 'La reserva financiera no es válida. Contacta con el centro.',
        same_day_change_not_allowed: 'Las citas no se pueden modificar ni cancelar el mismo día.',
        slot_blocked: `${multiAppointmentPrefix}la franja${slot} está bloqueada.`,
        slot_full: `${multiAppointmentPrefix}la franja${slot} está completa.`,
        appointment_conflict: `${multiAppointmentPrefix}ya existe otra cita que se solapa con la franja${slot}.`,
        outside_schedule: `${multiAppointmentPrefix}la franja${slot} queda fuera del horario del centro.`,
        slot_not_future: `${multiAppointmentPrefix}la franja${slot} ya no está en el futuro.`,
        invalid_occupancy: 'La ocupación registrada no es válida. Contacta con el centro.',
        recurring_occurrence_unavailable: `${multiAppointmentPrefix}una sesión futura de la serie ya no está disponible.`,
    };
    if (messages[reason]) return messages[reason];
    return error instanceof Error && error.message ? error.message : fallback;
}
