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
| bono_status | `bono_assigned` | Primer bono del cliente | ✔ | ✔ | ✔ |
| bono_status | `bono_renewed` | Bono nuevo cuando ya existía otro | ✔ | ✔ | ✔ |
| bono_status | `bono_exhausted` | Los minutos disponibles pasan a 0 | ✔ | ✔ | ✔ |
| bono_status | `bono_expired` | El estado pasa a `expirado` | ✔ | ✔ | ✔ |
| bono_status | `bono_validity_changed` | Cambia la fecha civil (Europe/Madrid) de inicio o de caducidad | ✔ | ✔ | ✔ |
| bono_status | `bono_expiring_7d` | Faltan 7 días civiles para la caducidad | ✔ | ✔ | ✔ |
| bono_status | `bono_expiring_2d` | Faltan 2 días civiles para la caducidad | ✔ | ✔ | ✔ |
| support_message | `support_message` | El admin responde en el chat | — | ✔ | ✔ |

## 2. Payload FCM (`data`, todo en strings)

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

Reglas: el propietario (o un admin) puede leer. El propietario solo puede actualizar `read` y `readAt`. Crear y borrar lo hacen únicamente las Cloud Functions.

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
- **Zona horaria**: las caducidades y los recordatorios se calculan en `Europe/Madrid`. Las fechas de solo día caducan al final de ese día en Madrid.
- **Recordatorio**: su título es "Recordatorio de tu cita" y el cuerpo indica la fecha y la hora de la cita. Nunca dice "faltan 24 horas", porque se envía la primera vez que el scheduler encuentra la cita en la ventana (ahora + 2 h, ahora + 24 h].
- **Push**: solo se envía si `users/{uid}.pushNotificationsEnabled === true`. El email y el historial se envían igualmente.

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

Sustituyen a lo siguiente, que se ha eliminado:
- `onAppointmentStatusPushNotification`;
- el push directo de `createAppointmentFromAdmin`;
- los emails al cliente de `onAppointmentApproved`, `onAppointmentDeleted` y `createAppointmentFromAdmin`.

El push del chat pasa también por la capa central, con el mismo título, texto y `type`.

## 7. Despliegue (manual)

- Al desplegar, Firebase pedirá confirmación para borrar `onAppointmentStatusPushNotification`.
- Los schedulers necesitan Cloud Scheduler, que se activa automáticamente al desplegarlos.
- Despliega también `firestore.rules`: añaden la regla de `notifications` y protegen `notificationOperationId` en las citas recurrentes.
- Los secretos antiguos de Make y Resend no se han tocado.
