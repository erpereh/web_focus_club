# Reprogramación recurrente de clientes

## Alcance y contratos

El backend expone en `europe-west1`:

- `rescheduleOwnRecurringAppointment`, cuyo `scope: "single"` modifica solo la occurrence indicada y devuelve `{ success, appointmentId, status: "pending" }`.
- `replaceOwnRecurringSeriesSchedule`, que recibe `appointmentId`, `startSlot`, `intervalDays` y `endDate`. El `appointmentId` identifica la serie y acredita ownership; no actúa como ancla de fechas.

El reemplazo devuelve `seriesId`, `occurrenceCount`, `totalMinutes`, `status: "pending"` y cuatro arrays deterministas. `reusedAppointmentIds` sigue el orden de `recurrenceIndex`, `createdAppointmentIds` el orden cronológico y `cancelledAppointmentIds` el orden de `recurrenceIndex`. `affectedAppointmentIds` es la unión sin duplicados de esos arrays, en ese orden.

Los scopes heredados `series` y `following`, los callables Admin y las cancelaciones conservan sus contratos.

## Definición de occurrence activa

Una occurrence es activa exclusivamente cuando `status` es `pending` o `approved`. `cancelled` y `rejected` nunca son activas, con independencia de su fecha.

- `occurrenceCount`: todas las occurrences activas, históricas y futuras.
- `totalMinutes`: suma de la duración de todas las occurrences activas.
- `futureOccurrenceCount`: occurrences activas con slot efectivo válido cuyo instante real todavía es futuro.
- `futureStartDate`, `futureStartTime` y `futureEndDate`: primer slot y última fecha de ese subconjunto futuro.

## Regla temporal

La modificación Customer requiere que el slot actual sustituido y cada destino queden fuera de una ventana inclusiva de 24 horas reales (`86.400.000 ms`). Las fechas civiles se resuelven siempre en `Europe/Madrid`: se rechazan horas inexistentes del salto DST y, cuando una hora se repite, se usa el primer instante real.

La infracción devuelve `failed-precondition` con `details.reason = "one_day_change_not_allowed"`. Las cancelaciones conservan su regla y reason de same-day.

## Single recurrente

La occurrence seleccionada queda `pending`; ninguna otra cambia de estado. Una occurrence previamente `approved` libera su occupancy antigua con counts absolutos y elimina solo metadatos de aprobación y entrenador. Una occurrence ya `pending` no modifica occupancy. En ambos casos se preservan servicio, duración, recurrencia, índice, bono, auditoría financiera, `sessionType`, creación y campos de Google Calendar.

La serie queda `pending`, conserva `occurrenceCount` y `totalMinutes`, y recalcula únicamente `future*` sobre todas las occurrences activas reales. No existe refund ni nuevo descuento.

## Reemplazo del tramo futuro

Se preservan todas las occurrences históricas y todas las `cancelled`/`rejected`. Se sustituyen todas las activas futuras, ordenadas por `recurrenceIndex`. La nueva programación se genera exclusivamente con `generateRecurringOccurrenceDates(startSlot.date, intervalDays, endDate)`, exige intervalo entero positivo, cadencia exacta y entre 2 y el máximo permitido.

Las occurrences se reutilizan primero; las adicionales reciben índices únicos superiores al máximo histórico y las sobrantes se cancelan sin borrarse. El resultado completo queda `pending`, sin entrenador ni `approvedSlot`. IDs, índices, creación, bono, auditoría financiera, `sessionType` y campos Calendar se conservan en las reutilizadas.

## Occupancy, conflictos y bono

Solo se restan los bloques antiguos de occurrences futuras `approved`; las `pending` no dan crédito global. Todos los bloques antiguos y destino se leen y validan, incluso con delta neto cero. Los counts deben ser enteros no negativos y solo se escribe un count final absoluto cuando el delta no es cero. El resultado `pending` no reserva occupancy.

Los destinos validan horario completo, bloqueos, aforo efectivo, solapamientos internos y conflictos con otras citas activas del cliente. Las occurrences sustituidas se excluyen del conflicto propio.

`minutesDelta = newFutureMinutes - oldFutureReservedMinutes`. El delta positivo descuenta solo el incremento; el negativo devuelve exactamente las reservas canceladas y el cero no escribe el bono. Un bono eliminado siempre se rechaza. Un bono expirado permite mantener o reducir, pero no ampliar. Todos los cambios se hacen en una única transacción y todas las lecturas preceden a la primera escritura.

## Reaprobación y efectos derivados

La aprobación Admin procesa únicamente occurrences `pending` con slot válido y futuro. Las `approved` existentes permanecen intactas y su occupancy no se vuelve a reservar. Si después queda cualquier occurrence activa `pending`, incluida una histórica, la serie continúa `pending`; solo queda `approved` cuando no existe ninguna.

Los triggers evitan doble conciliación financiera y notificaciones de estado para `approved → pending` y para cancelaciones por `customer_series_schedule_reduction`. Google Calendar se gestiona exclusivamente mediante los triggers existentes: ningún callable de este flujo llama directamente a Calendar.

Los activity logs usan IDs, slots, estados, counts, minutos, delta y arrays de documentos, sin nombre, email ni teléfono.
