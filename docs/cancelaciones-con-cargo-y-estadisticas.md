# Cancelaciones con cargo y apartado «Estadísticas»

Octubre 2026. No se ha desplegado nada, no se han modificado datos históricos y no se ha tocado `app_focus_club` (Flutter).

## 1. Cancelaciones con cargo

### Por qué

La app no deja cancelar a los clientes el mismo día de la cita. Cuando avisan ese día, cancela el admin y decide si la sesión se cobra.

### Comportamiento

Al pulsar **Cancelar** en la agenda (citas aprobadas y pendientes no recurrentes, y sesiones sueltas de una serie aprobada) se abre un popup. Ninguna opción viene marcada: el admin tiene que elegir una.

| Opción | Aforo | Minutos del bono | Horas del entrenador |
|---|---|---|---|
| **Sin cargo** | Se libera | Se devuelven los minutos que de verdad se habían descontado, una sola vez | No cuentan |
| **Con cargo** | Se libera | Se mantienen los consumidos. **Nunca se descuenta nada nuevo**: si la cita no había descontado (pendiente creada por el admin, sin bono, nutrición), el cargo es de 0 min | No cuentan nunca |

Detalles:

- La cita no se borra. La agenda, el calendario y el historial del cliente muestran:
  - «Cancelada con cargo»
  - «Cancelada sin cargo»
  - «Cancelada · Sin clasificar», para las anteriores a este cambio.
- El portal web del cliente y la app siguen mostrando «Cancelada».
- El aviso al cliente (push, historial y email) es el mismo de siempre. Solo menciona la devolución cuando la hubo de verdad (`minutesRefundedAt`), así que una cancelación con cargo recibe el texto neutro.
- La cancelación de una serie entera sigue siendo siempre sin cargo.

### Datos

Los campos son aditivos en `appointments`. Solo los escriben las Cloud Functions; las reglas impiden que un cliente, entrenador o admin los cree o los cambie desde el navegador.

| Campo | Valor |
|---|---|
| `cancellationCharge` | `"charged"` o `"not_charged"`. Si falta, la cancelación es «Sin clasificar» |
| `cancellationChargedMinutes` | Minutos consumidos que se mantienen (0 si es sin cargo o si no había descuento) |
| `cancellationChargeDecidedBy` | `"admin"`, `"customer"` o `"system"` |
| `cancellationChargeDecidedByUid` | UID de quien decide |
| `cancellationChargeDecidedAt` | Fecha ISO |

`cancelledBy` y `cancelledAt` no cambian. El `activity_logs` `appointment_cancelled` incluye `cancellationCharge` y `chargedMinutes`.

Las cancelaciones de cliente (`cancelOwnAppointment`, serie pendiente, reducción de serie, renovación rechazada) y la reducción de serie hecha por el admin se registran como `not_charged`. El cliente siempre cancela al menos un día antes y esas rutas devuelven los minutos.

### Garantías

- **Una sola transacción** por cancelación. Dentro de ella:
  1. se relee el estado;
  2. se libera el aforo (solo si la cita estaba `approved`);
  3. se devuelven los minutos (sin cargo) o se mantienen (con cargo);
  4. se recalculan los metadatos de la serie;
  5. se escriben la modalidad y el log.
- **Idempotencia:**
  - Repetir la misma modalidad no escribe nada.
  - Pedir la otra falla con `already_cancelled` (`details.currentCharge`) y no toca el bono.
  - Si dos admins cancelan a la vez con modalidades distintas, gana una sola. Está probado con el emulador.
- **Nada deshace un cargo.** `refundAppointmentMinutesInTransaction` se niega a devolver minutos de una cita con `cancellationCharge == "charged"`. Esa es la guarda central para el trigger `onAppointmentApproved`, para `deleteAppointmentsFromAdmin` y para `blockSlotsFromAdmin`.
- **Borrar una cita cancelada con cargo mantiene el cargo.** `appointment_deletions/{id}.finance` guarda:
  - `refundStatus: "not_refundable"`
  - `refundReason: "cancelled_with_charge"`
  - `cancellationCharge`
  - `cancellationChargedMinutes`
- **Compatibilidad:** una pestaña del panel abierta antes del cambio que no envíe la modalidad cancela sin cargo, como hasta ahora. Los contratos Flutter (nombres, payloads, estados y `details.reason`) no cambian.

## 2. Estadísticas (`/admin/estadisticas`)

### Acceso

El menú lateral tiene un enlace en *Principal*, justo debajo de *Equipo*. La página solo se muestra a administradores.

La protección real está en el backend: las reglas de Firestore (`isAdmin()`, que lee `users/{uid}.role`) son las que impiden a clientes y entrenadores listar `appointments`, `bonos` o `users` por rango. Lo comprueba `functions/test/emulator/rules.emulator.test.cjs` con las reglas reales.

### Filtros

- Semana (lunes a domingo), mes, año o período personalizado (máximo 731 días), con navegación ‹ ›.
- Entrenador: afecta a las métricas de citas. Bonos, ocupación y retención describen siempre todo el centro, y la página lo indica.

**Comparación con el período anterior:** si el período seleccionado todavía no ha terminado, se compara con el mismo tramo transcurrido del anterior (por ejemplo, 1–21 de septiembre frente a 1–21 de octubre), nunca con el período anterior completo.

### Secciones

| Sección | Contenido |
|---|---|
| Resumen | Sesiones y horas contabilizadas, cancelaciones con y sin cargo (y sin clasificar), clientes activos, ocupación media (hasta hoy si el período está en curso), clientes nuevos y bonos activos. Cada dato con su variación |
| Entrenamientos | Evolución diaria, semanal o mensual por estado (contabilizadas, próximas, pendientes, canceladas y rechazadas) con línea de horas contabilizadas. Distribución por duración y por tipo |
| Entrenadores | Horas y sesiones contabilizadas, clientes atendidos, próximas y cancelaciones con cargo. Usa `calculateTrainerStatsInRange`, el mismo cálculo que *Equipo*. Exporta a CSV. Sin importes ni nóminas |
| Cancelaciones | Totales por modalidad, minutos cobrados sin entrenamiento, evolución, desglose por entrenador y detalle. Exporta a CSV |
| Clientes y bonos | Clientes activos, nuevos y con bono activo; bonos caducados en el período; bonos que caducan en 14 días o menos o tienen 30 min o menos; minutos del período (contabilizadas, cargos y reservados) con su cobertura; minutos restantes; renovación de bonos; clientes sin actividad (21 días o más sin sesión y sin cita futura) |
| Ocupación | Mapa de calor por día y hora, ocupación por franja horaria, plazas reservadas frente a canceladas y horarios con más demanda |
| Aspectos a revisar | Pendientes de aprobación, aprobadas sin entrenador, descuadres de aforo en los próximos 14 días, bonos por caducar o casi agotados, minutos pendientes de revisión manual, sesiones aprobadas sin descuento, clientes con más de un bono activo y clientes sin actividad. Cada aviso enlaza a su sección (`/admin?tab=…&status=…&trainer=…`) |

El *Dashboard* no cambia y sigue siendo el resumen rápido.

### Reglas de cálculo

- Una cita cuenta en el período de la **fecha de su sesión** (franja efectiva, hora de Madrid).
- **Horas contabilizadas** son las sesiones `approved` cuya hora de inicio ya pasó. No hay confirmación de asistencia y no se presupone.
- Una cancelación con cargo cuenta como minutos consumidos, pero nunca como sesión ni como hora del entrenador.
- **Ocupación:** se cuentan las plazas de 15 min ocupadas por citas aprobadas y se divide entre `maxCapacity` × los bloques abiertos (`startHour`–`endHour`), sin contar las franjas de `blocked_slots`. Se calcula a partir de las citas, no de los contadores `slot_occupancy`.

### Lecturas a Firestore

Todas están acotadas, sin listeners y sin índices nuevos (solo rangos sobre un campo):

- `appointments`:
  - `date` dentro del período actual más el anterior;
  - `date >= hoy-180` (retención y futuro);
  - `createdAt` en una ventana de 120 días antes del período, para las solicitudes de cliente que aún no tienen `date`;
  - `status == "pending"`.
- `users`: `role == "user"`.
- `bonos`:
  - activos;
  - `fechaExpiracion` o `replacedAt` en los períodos;
  - bonos más recientes de esos clientes, para saber si renovaron.
- `blocked_slots` del período.
- `slot_occupancy` de los próximos 14 días.

## 3. Limitaciones de los datos históricos

- Las cancelaciones anteriores al cambio aparecen como **«Sin clasificar»** y no se reclasifican.
- Las sesiones antiguas sin marcadores de descuento (`minutesDeductedAt`) no suman minutos consumidos. La página muestra la cobertura («datos fiables en el X % de las sesiones»).
- Las citas legacy sin ninguna franja válida se excluyen y se cuentan aparte.
- Las solicitudes de cliente sin `date` creadas más de 120 días antes de su sesión no se leen. En la práctica no ocurre, porque exigen un bono vigente.
- En un bono `agotado` no consta la fecha en que se agotó. La renovación se mide por la sustitución (`replacedAt`) o por la caducidad.
- Los 39 contadores `slot_occupancy` inflados (todos pasados) no afectan a la ocupación, que se calcula con citas. Sí aparecerían como descuadre si estuvieran dentro de los próximos 14 días; según la auditoría del 14-10-2026, ninguno está en fechas futuras.
- No hay datos de asistencia: «contabilizada» no significa «asistida».

## 4. Pruebas

| Suite | Cobertura |
|---|---|
| `npm --prefix functions test` | Incluye `test/cancellationCharge.test.cjs` (20 tests): ambas modalidades, pendientes, nutrición y sin bono, idempotencia y carrera, guarda del trigger, borrado, rutas de cliente y aviso neutro |
| `npm --prefix functions run test:emulator` | Admin SDK real: flujo con cargo y borrado posterior, carrera entre modalidades, repeticiones sin cargo, pendiente con cargo. Reglas reales: lecturas solo admin y campos de cargo protegidos |
| `npx vitest run` | Períodos (DST de marzo y octubre), cálculos, CSV, popup, enlaces y página |

## 5. Despliegue (pendiente, no ejecutado)

Orden: Functions → Hosting → Reglas. Los detalles están en `production-release-checklist.md` §6.
