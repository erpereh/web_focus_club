/** Financial capacity. Legacy manual extensions are frozen as the base, never lost. */
export interface BonoMinutes {
  tamano?: number;
  minutosTotales?: number;
  minutosRestantes?: number;
  minutosCapacidadBase?: number;
  minutosExtraRecuperados?: number;
  sesionesTotales?: number;
  sesionesRestantes?: number;
  modalidad?: string;
}

export function bonoBaseMinutes(bono: BonoMinutes): number {
  if (bono.minutosCapacidadBase !== undefined) return bono.minutosCapacidadBase;
  if (bono.tamano !== undefined && bono.minutosTotales !== undefined) return Math.max(bono.tamano, bono.minutosTotales);
  if (bono.minutosTotales !== undefined) return bono.minutosTotales;
  if (bono.tamano !== undefined) return bono.tamano;
  return (bono.sesionesTotales ?? 0) * (bono.modalidad === "30min" ? 30 : 60);
}

export function bonoEffectiveMinutes(bono: BonoMinutes): number {
  return bonoBaseMinutes(bono) + (bono.minutosExtraRecuperados ?? 0);
}

export function validBonoMinutes(bono: BonoMinutes): boolean {
  const values = [bono.tamano, bono.minutosTotales, bono.minutosRestantes,
    bono.minutosCapacidadBase, bono.minutosExtraRecuperados, bono.sesionesTotales, bono.sesionesRestantes]
    .filter((v) => v !== undefined);
  const capacity = bonoEffectiveMinutes(bono);
  return values.every((v) => Number.isSafeInteger(v) && v! >= 0)
    && Number.isSafeInteger(capacity) && capacity > 0
    && (bono.minutosRestantes ?? (bono.sesionesRestantes ?? 0) * (bono.modalidad === "30min" ? 30 : 60)) <= capacity
    && ((bono.minutosExtraRecuperados ?? 0) === 0 || bono.minutosCapacidadBase !== undefined)
    && (bono.minutosCapacidadBase === undefined || bono.minutosCapacidadBase >= (bono.tamano ?? 0))
    && (bono.minutosCapacidadBase === undefined || bono.minutosTotales === capacity);
}
