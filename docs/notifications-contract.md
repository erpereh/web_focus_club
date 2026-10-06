# Contrato de notificaciones al cliente

Este documento es el contrato entre las Cloud Functions de `web_focus_club` y la app Flutter (`app_focus_club`). Todas las notificaciones al cliente pasan por `functions/src/notifications/`. Esa capa coordina tres cosas:

- el **historial** (`users/{uid}/notifications`);
- el **push** (FCM);
- el **email** (Brevo, a través de `functions/src/email/`).

Los avisos existentes al administrador (emails de citas, contacto y sugerencias) no han cambiado.

## 1. `type` y `event`

El push y el historial usan exactamente los mismos campos:

| Campo | Significado | Valores |
|---|---|---|
| `type` | Categoría estable de navegación. Nunca cambia de significado. | `appointment_status`, `bono_status`, `support_message` |
| `event` | Evento concreto dentro de la categoría. | Ver tabla siguiente |

`type` nunca es igual a `event` en las citas ni en los bonos. Las versiones actuales de la app siguen navegando con `type` (`appointment_status` + `appointmentId`, `support_message` + `conversationId`). Las futuras pueden usar `event` para comportamientos más específicos.

### Eventos y canales

| `type` | `event` | Cuándo | Email | Push | Historial |
|---|---|---|:-:|:-:|:-:|
| appointment_status | `appointment_requested` | Cita creada en `pending`, o que vuelve a pendiente sin cambiar de horario | ✔ | ✔ | ✔ |
| appointment_status | `appointment_confirmed` | Pasa a `approved`, o se crea ya aprobada | ✔ | ✔ | ✔ |
| appointment_status | `appointment_rescheduled` | Cambia la fecha, la hora, el entrenador, la duración o el tipo de sesión, cambie o no el estado | ✔ | ✔ | ✔ |
| appointment_status | `appointment_rejected` | Pasa a `rejected` | ✔ | ✔ | ✔ |
| appointment_status | `appointment_cancelled` | Pasa a `cancelled` | ✔ | ✔ | ✔ |
| appointment_status | `appointment_deleted` | Se borra una cita futura que estaba pendiente o aprobada | ✔ | ✔ | ✔ |
| appointment_status | `appointment_reminder` | Recordatorio de una cita aprobada | — | ✔ | ✔ |
| appointment_status | `appointment_series_requested` | Serie recurrente solicitada, o horario de la serie sustituido por el cliente | ✔ | ✔ | ✔ |
| appointment_status | `appointment_series_confirmed` | Serie aprobada, o creada ya aprobada por el admin | ✔ | ✔ | ✔ |
| appointment_status | `appointment_series_rejected` | Serie rechazada | ✔ | ✔ | ✔ |
| appointment_status | `appointment_series_cancelled` | Serie pendiente cancelada por el cliente | ✔ | ✔ | ✔ |
| appointment_status | `appointment_series_rescheduled` | Reprogramación de la serie completa o de las siguientes sesiones, o sustitución de horario por el admin | ✔ | ✔ | ✔ |
| appointment_status | `appointment_series_returned_to_pending` | Una serie aprobada vuelve a pendiente | ✔ | ✔ | ✔ |
| appointment_status | `appointment_proposed` | El admin propone otra hora para una solicitud pendiente (`proposal.proposedAt` nuevo). Dedupe `appt:{appointmentId}:proposal:{proposedAt}`; la copia usa la franja y el profesional propuestos | ✔ | ✔ | ✔ |
| appointment_status | `appointment_proposal_declined` | El cliente rechaza la contrapropuesta (`rejected` + `cancellationReason: customer_declined_proposal`) | ✔ | ✔ | ✔ |
| appointment_status | `appointment_series_renewal_pending` | El admin crea citas renovadas al asignar un bono ("Repetir citas del bono anterior"). Un aviso agrupado por intento de renovación (`notification_outbox/renewal_{renewalId}_{n}`, dedupe `op:{operationId}`); `seriesId` = `renewalId`, `route: appointments` | ✔ | ✔ | ✔ |
| bono_status | `bono_assigned` | Primer bono del cliente | ✔ | ✔ | ✔ |
| bono_status | `bono_renewed` | Bono nuevo cuando ya existía otro | ✔ | ✔ | ✔ |
| bono_status | `bono_exhausted` | Los minutos disponibles pasan a 0 | ✔ | ✔ | ✔ |
| bono_status | `bono_expired` | Un bono `activo` con minutos pasa a `expirado`. Los bonos sustituidos o ya agotados caducan sin aviso | ✔ | ✔ | ✔ |
| bono_status | `bono_validity_changed` | Cambia la fecha civil (Europe/Madrid) de inicio o de caducidad del bono `activo` | ✔ | ✔ | ✔ |
| bono_status | `bono_expiring_7d` | Faltan 7 días civiles para la caducidad | ✔ | ✔ | ✔ |
| bono_status | `bono_expiring_2d` | Faltan 2 días civiles para la caducidad | ✔ | ✔ | ✔ |
| support_message | `support_message` | El admin responde en el chat | — | ✔ | ✔ |

## 2. Payload FCM (`data`, todo en strings)

Las versiones antiguas de la app no conocen los tres eventos anteriores: muestran el icono genérico de `appointment_status` y navegan por `route`, sin romperse.

Siempre incluye `type`, `event`, `notificationId` (el id del documento de historial) y `route`. Además lleva los IDs relacionados que correspondan:

| Clave | Presente en | Ejemplo |
|---|---|---|
| `type` | siempre | `appointment_status` |
| `event` | siempre | `appointment_rescheduled` |
| `notificationId` | siempre | `9f2c…` (sha256) |
| `route` | siempre | `appointment` · `appointments` · `bono` · `chat` |
| `appointmentId` | citas (en las series, la primera cita afectada) | `apt123` |
| `status` | citas: estado tras el cambio | `pending` · `approved` · `rejected` · `cancelled` · `deleted` |
| `seriesId` | series | `series123` |
| `appointmentIds` | series (separados por comas) | `apt1,apt2,apt3` |
| `bonoId` | bonos | `bono123` |
| `conversationId` | chat | `conv123` |

El bloque `notification` de FCM lleva `title` y `body`, con el mismo texto que el historial.

Opciones de plataforma (no forman parte de `data` y no cambian el contrato):

| Plataforma | Opciones |
|---|---|
| Android | `priority: high`, `notification.channelId: "focus_club_default"`, `sound: "default"` |
| iOS (APNs) | `apns-priority: 10`, `apns-push-type: alert`, `aps.sound: "default"` |

La app crea el canal `focus_club_default` al arrancar (`MainActivity.kt`) y lo declara como canal por defecto de FCM en el manifest. Si una build antigua no lo tiene, Android usa el canal por defecto del manifest o el de respaldo de FCM.

Ejemplos:

```json
{ "type": "appointment_status", "event": "appointment_confirmed", "notificationId": "…", "route": "appointment", "appointmentId": "apt123", "status": "approved" }
{ "type": "appointment_status", "event": "appointment_series_confirmed", "notificationId": "…", "route": "appointments", "seriesId": "s1", "appointmentIds": "a1,a2", "appointmentId": "a1", "status": "approved" }
{ "type": "bono_status", "event": "bono_expiring_7d", "notificationId": "…", "route": "bono", "bonoId": "bono123" }
{ "type": "support_message", "event": "support_message", "notificationId": "…", "route": "chat", "conversationId": "conv123" }
```

## 3. Historial `users/{uid}/notifications/{notificationId}`

| Campo | Tipo | Notas |
|---|---|---|
| `type` | string | Categoría. Igual que `data.type`. |
| `event` | string | Evento. Igual que `data.event`. |
| `title`, `body` | string | Mismo texto que el push. |
| `createdAt` | Timestamp | |
| `read` | bool | Al crearse, `false`. |
| `appointmentId`, `bonoId`, `conversationId`, `seriesId`, `status` | string \| null | |
| `appointmentIds` | string[] | Vacío si no aplica. |
| `navigation` | `{ route, params }` | Por ejemplo, `{ route: "appointment", params: { appointmentId } }`. |

Reglas: el propietario (o un admin) puede leer. El propietario solo puede actualizar `read` y `readAt`, y puede borrar sus propias entradas (deslizar para eliminar o "Vaciar notificaciones" en la app). Crear lo hacen únicamente las Cloud Functions. Borrar el historial nunca toca `notification_deliveries`, `notification_outbox`, `email_dispatches` ni `push_dispatches`, que no son accesibles desde los clientes; como el canal `history` de la entrega ya está `sent`, los reintentos no vuelven a crear una entrada borrada.

### Rutas de navegación

| `route` | `params` | Destino sugerido en Flutter |
|---|---|---|
| `appointment` | `appointmentId` | Detalle de la cita |
| `appointments` | `seriesId` | Lista de citas, o citas de la serie |
| `bono` | `bonoId` | Pantalla del bono |
| `chat` | `conversationId` | Conversación de soporte |

## 4. Reglas de negocio

- **Cambios técnicos**: no generan aviso. Son cambios técnicos los de sincronización con Google Calendar, `updatedAt`, los campos de minutos y `trainerNotes`, y las ediciones de sesiones que ya han pasado.
- **Recurrentes**: generan un solo aviso por operación. Cada callable que modifica varias citas escribe, en la misma transacción:
  - `notificationOperationId` en cada cita afectada;
  - un documento `notification_outbox/{operationId}`.

  El trigger `onNotificationOutboxCreated` envía el aviso agrupado. El trigger por cita ignora las escrituras que llevan un `notificationOperationId` nuevo. Una operación sobre una única ocurrencia se notifica como cita individual.
- **Bono agotado**: los minutos se reservan al pedir la cita, así que "agotado" significa que no quedan minutos para nuevas reservas. Desactivar el bono anterior al renovar (pasa a `agotado` con minutos restantes) no genera aviso.
- **Bono caducado**: solo se avisa si el bono era el `activo` del cliente y le quedaban minutos. El scheduler sigue marcando como `expirado` los bonos sustituidos (`agotado` con minutos) y los agotados, pero sin aviso: el cliente ya tiene otro bono o ya recibió `bono_exhausted`.
- **Ediciones masivas del admin**: cada escritura de una edición masiva (por ejemplo, "recalcular caducidades") lleva el mismo `notificationBulkOperationId`. Una escritura con un valor nuevo genera solo la entrada del historial, sin push ni email. Una edición individual posterior sobre ese bono avisa con normalidad.
- **Devolución de minutos**: los textos de cancelación y eliminación (push, historial y email) solo dicen que se han devuelto minutos si la cita tiene `minutesRefundedAt`. En las series, solo si el outbox lleva `refundedMinutes > 0`, que se calcula en la misma transacción que la devolución.
- **Cuentas eliminadas**: no se crea ningún aviso para un `uid` sin documento `users/{uid}`. Una entrega en cola cuyo cliente se borra después se cierra sin escribir historial ni enviar nada. `deleteUserFromAdmin` (web) y `deleteOwnAccount` (app) borran `users/{uid}` de forma recursiva, con `notifications` y `fcmTokens`, y también las entregas de `notification_deliveries` de ese `uid`.
- **Zona horaria**: las caducidades y los recordatorios se calculan en `Europe/Madrid`. Las fechas de solo día caducan al final de ese día en Madrid.
- **Recordatorio**: su título es "Recordatorio de tu cita" y el cuerpo indica la fecha y la hora de la cita. Nunca dice "faltan 24 horas", porque se envía la primera vez que el scheduler encuentra la cita en la ventana (ahora + 2 h, ahora + 24 h].
- **Recordatorio tras una confirmación**: si en las últimas 6 h se ha enviado `appointment_confirmed`, `appointment_rescheduled`, `appointment_series_confirmed` o `appointment_series_rescheduled` para esa cita, el recordatorio se retiene. El scheduler lo vuelve a intentar cada 15 min. Si la cita sale de la ventana antes, no hay recordatorio, porque el aviso reciente ya indicaba la fecha y la hora. La búsqueda usa `appointmentIds` y `createdAtMillis` de `notification_deliveries`.
- **Push**: solo se envía si `users/{uid}.pushNotificationsEnabled === true`. El email y el historial se envían igualmente.

### Ciclo de vida de los tokens FCM (`users/{uid}/fcmTokens/{token}`)

| Momento | Quién | Qué pasa |
|---|---|---|
| Activar el push o abrir la app con el push activado | App | Guarda el token y refresca `updatedAt` |
| `onTokenRefresh` | App | Guarda el token nuevo y borra el anterior |
| Desactivar el push | App | `pushNotificationsEnabled = false` y borra el documento del token de este dispositivo |
| Cerrar sesión o borrar la cuenta | App | Borra el documento del token (lo obtiene de FCM si la sesión no lo registró) y llama siempre a `deleteToken()` |
| Se registra un token | `onFcmTokenWritten` | Borra ese mismo token de cualquier otra cuenta: un token pertenece solo a la última cuenta que lo registró |
| Envío rechazado por FCM | Backend | Borra los tokens inválidos |
| Token sin refrescar en 270 días | `pruneStaleFcmTokensScheduled` | Lo borra |

Las búsquedas por `token` y por `updatedAt` en el grupo de colecciones `fcmTokens` usan los `fieldOverrides` de `firestore.indexes.json`.

## 5. Idempotencia y reintentos

- `dedupeKey` por aviso:

  | Aviso | Clave |
  |---|---|
  | Cita | `appt:{eventId}` |
  | Serie | `op:{operationId}` |
  | Bono asignado o renovado | `bono:{id}:created` |
  | Bono caducado | `bono:{id}:expired` |
  | Bono agotado o validez cambiada | `bono:{id}:{event}:{eventId}` |
  | Avisos de caducidad | `bono:{id}:{event}:{fechaCaducidad}` |
  | Recordatorio | `reminder:{appointmentId}:{fecha}T{hora}` |
  | Chat | `chat:{conversationId}:{messageId}` |

- `notificationId` es `sha256(dedupeKey)`. Se usa como id del historial y del documento `notification_deliveries/{id}`.
- Cada canal tiene su propio ledger:
  - el historial se crea solo si no existe;
  - el push usa `push_dispatches`;
  - el email usa `email_dispatches` más la clave de idempotencia de Brevo.

  Un canal que ya se envió nunca se repite.
- Cuando un canal falla, el fallo queda guardado en `notification_deliveries` (`status: "retrying"`, con estado por canal y `lastError` sin secretos). El scheduler `retryNotificationDeliveriesScheduled` (cada 15 min) reintenta solo los canales fallidos, con backoff exponencial desde 5 min y un máximo de 8 intentos. También recupera las entregas que se quedaron en `pending` porque el proceso se cayó.
- La cola se lee con `where("nextAttemptAtMillis", "<=", ahora).orderBy("nextAttemptAtMillis")`, hasta 100 entregas por pasada, de la más antigua a la más reciente. Solo las entregas `pending` o `retrying` tienen un número en ese campo; las terminadas guardan `null`. Así, las entregas programadas para más tarde nunca desplazan a las que ya tocan, y basta con el índice de campo único.
- Cada entrega guarda también `createdAtMillis` y `appointmentIds` (las citas a las que se refiere el aviso).

## 6. Funciones

| Función | Tipo | Qué hace |
|---|---|---|
| `onAppointmentCustomerNotification` | `onDocumentWritten appointments/{id}` | Avisos de citas individuales |
| `onNotificationOutboxCreated` | `onDocumentCreated notification_outbox/{id}` | Avisos agrupados de recurrentes |
| `onBonoCustomerNotification` | `onDocumentWritten bonos/{id}` | Avisos de bonos |
| `bonoExpiryWarningsScheduled` | diario 10:00 Madrid | Avisos a 7 y 2 días |
| `expireOverdueBonosScheduled` | cada hora (min 5) | Marca los bonos vencidos como `expirado`; el aviso lo envía el trigger de bonos |
| `appointmentRemindersScheduled` | cada 15 min | Recordatorios (push + historial) |
| `retryNotificationDeliveriesScheduled` | cada 15 min | Reintentos |
| `onFcmTokenWritten` | `onDocumentWritten users/{uid}/fcmTokens/{tokenId}` | Quita ese token de las demás cuentas |
| `pruneStaleFcmTokensScheduled` | lunes 04:30 Madrid | Borra los tokens sin refrescar en 270 días |

Sustituyen a lo siguiente, que se ha eliminado:
- `onAppointmentStatusPushNotification`;
- el push directo de `createAppointmentFromAdmin`;
- los emails al cliente de `onAppointmentApproved`, `onAppointmentDeleted` y `createAppointmentFromAdmin`.

El push del chat pasa también por la capa central, con el mismo título, texto y `type`.

## 7. Despliegue (manual)

El orden exacto, las verificaciones y el rollback están en [`production-release-checklist.md`](production-release-checklist.md). En resumen:

- Índices, reglas de Firestore y functions ya están desplegados y validados (49 functions). Las reglas de Storage quedan fuera.
- Las functions se despliegan **con filtro** (`functions/scripts/deploy-filter.cjs`), así que Firebase no propone borrar nada. `adminRestoreSuggestion` se conserva y `onAppointmentStatusPushNotification` ya se retiró.
- El permiso para que el cliente borre su historial requiere volver a desplegar solo `firestore:rules` (paso 2.2.b de la checklist).
- Brevo + FCM + Firestore son el único sistema de notificaciones. Los secretos que quedan sin uso de la integración anterior se borran a mano (paso 2.9 de la checklist).
