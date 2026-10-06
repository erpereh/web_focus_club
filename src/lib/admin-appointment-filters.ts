import { getAppointmentType, type Appointment, type AppointmentType } from '@/types';

export type AppointmentStatusFilter = 'all' | Appointment['status'];

/** Citas antiguas sin tipo cuentan como entrenamiento. */
export type AppointmentTypeFilter = 'all' | AppointmentType;

export type TrainerFilter =
  | 'all'
  | 'unassigned'
  | `trainer:${string}`;

export const TRAINER_FILTER_PREFIX = 'trainer:' as const;

export type FilterableAppointment = Pick<Appointment, 'status' | 'name' | 'email'> & {
  assignedTrainer?: string | null;
  appointmentType?: AppointmentType;
};

export function toTrainerFilter(trainerId: string): TrainerFilter {
  return `${TRAINER_FILTER_PREFIX}${trainerId}`;
}

export function getTrainerIdFromFilter(filter: TrainerFilter): string | undefined {
  if (filter === 'all' || filter === 'unassigned') return undefined;
  return filter.slice(TRAINER_FILTER_PREFIX.length);
}

export function filterAppointments<T extends FilterableAppointment>(
  appointments: T[],
  {
    statusFilter,
    trainerFilter,
    typeFilter = 'all',
    search,
  }: {
    statusFilter: AppointmentStatusFilter;
    trainerFilter: TrainerFilter;
    typeFilter?: AppointmentTypeFilter;
    search: string;
  },
): T[] {
  const q = search.trim().toLowerCase();
  const trainerId = getTrainerIdFromFilter(trainerFilter);

  return appointments.filter((appointment) => {
    if (statusFilter !== 'all' && appointment.status !== statusFilter) {
      return false;
    }

    if (typeFilter !== 'all' && getAppointmentType(appointment) !== typeFilter) {
      return false;
    }

    if (trainerFilter === 'unassigned') {
      if (appointment.assignedTrainer) return false;
    } else if (trainerId !== undefined) {
      if (appointment.assignedTrainer !== trainerId) return false;
    }

    if (q) {
      const matchesSearch =
        appointment.name.toLowerCase().includes(q)
        || appointment.email.toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }

    return true;
  });
}
