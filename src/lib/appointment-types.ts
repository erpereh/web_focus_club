import { getCanonicalSlotBlocks } from '@/lib/appointment-slots';
import { getAppointmentEffectiveSlot } from '@/lib/madrid-date';
import {
    getAppointmentType,
    getOpenCustomerConfirmation,
    type Appointment,
    type AppointmentType,
    type TimeSlot,
    type Trainer,
} from '@/types';

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
    training: 'Entrenamiento',
    nutrition: 'Nutrición',
};

export type AppointmentTypeFilter = 'all' | AppointmentType;

/** Profesionales que pueden atender ese tipo de cita (activos; nutrición solo si está marcado). */
export function trainersForAppointmentType(trainers: Trainer[], type: AppointmentType): Trainer[] {
    return trainers.filter((trainer) => trainer.active !== false
        && (type !== 'nutrition' || trainer.offersNutrition === true));
}

function blockKeys(slot: TimeSlot, durationMinutes: number): Set<string> {
    return new Set(getCanonicalSlotBlocks(slot.time, durationMinutes).map((time) => `${slot.date}_${time}`));
}

/**
 * Regla confirmada para nutrición: el profesional no puede tener otra cita
 * pendiente o aprobada que se solape. (Comprobación de UX; el servidor la
 * repite en los flujos de creación, reprogramación, propuesta y confirmación.)
 */
export function hasProfessionalConflict(
    appointments: Appointment[],
    input: { trainerId: string; slot: TimeSlot; durationMinutes: number; excludeAppointmentId?: string },
): boolean {
    const target = blockKeys(input.slot, input.durationMinutes);
    return appointments.some((appointment) => {
        if (appointment.id === input.excludeAppointmentId) return false;
        if (appointment.assignedTrainer !== input.trainerId) return false;
        if (appointment.status !== 'pending' && appointment.status !== 'approved') return false;
        const slot = getAppointmentEffectiveSlot(appointment);
        const duration = Number(appointment.duration);
        if (!slot || ![30, 45, 60].includes(duration)) return false;
        for (const key of blockKeys(slot, duration)) {
            if (target.has(key)) return true;
        }
        return false;
    });
}

export type CustomerConfirmationBadge = 'proposal_pending' | 'renewal_pending';

/** Citas pendientes que esperan al cliente (no al admin). */
export function customerConfirmationBadge(appointment: Appointment): CustomerConfirmationBadge | null {
    const confirmation = getOpenCustomerConfirmation(appointment);
    if (!confirmation) return null;
    return confirmation.kind === 'proposal' ? 'proposal_pending' : 'renewal_pending';
}

export const CUSTOMER_CONFIRMATION_LABELS: Record<CustomerConfirmationBadge, string> = {
    proposal_pending: 'Propuesta enviada · esperando al cliente',
    renewal_pending: 'Renovada · esperando confirmación del cliente',
};

/** "Proponer otra hora" solo para solicitudes individuales pendientes que esperan al admin. */
export function canProposeAlternative(appointment: Appointment): boolean {
    if (appointment.status !== 'pending' || appointment.recurrenceSeriesId) return false;
    return getOpenCustomerConfirmation(appointment)?.kind !== 'renewal';
}

export { getAppointmentType };

export const PROPOSAL_STATUS_LABELS: Record<NonNullable<Appointment['proposal']>['status'], string> = {
    pending: 'Esperando respuesta del cliente',
    accepted: 'Aceptada por el cliente',
    declined: 'Rechazada por el cliente',
    superseded: 'Sustituida',
};

/** "lun, 12 oct · 10:00" a partir de la fecha civil (sin desfase horario). */
export function formatSlotLabel(slot: TimeSlot): string {
    const [year, month, day] = slot.date.split('-').map(Number);
    const label = new Intl.DateTimeFormat('es-ES', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
    return `${label} · ${slot.time}`;
}
