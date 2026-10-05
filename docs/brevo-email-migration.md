# Emails transaccionales con Brevo

Todos los emails transaccionales de las Cloud Functions salen por la API REST de Brevo (`POST https://api.brevo.com/v3/smtp/email`). Brevo (email), FCM (push) y Firestore (historial y entregas) son el único sistema de notificaciones; no hay otros proveedores ni webhooks externos. Los emails de Firebase Auth (verificación y recuperación de contraseña) los envía Firebase Auth.

> **Actualización:** los emails de citas al cliente ya no se envían desde `onAppointmentApproved`, `onAppointmentDeleted` ni `createAppointmentFromAdmin`. Ahora los gestiona la capa central de notificaciones (`functions/src/notifications/`), que añade push, historial y reintentos. Los emails al admin siguen como aparece aquí abajo. El detalle está en [notifications-contract.md](notifications-contract.md).

## Flujos

Todos están en `functions/src/index.ts`.

| Función | Cuándo | Destinatarios |
|---|---|---|
| `onAppointmentCreated` | Cita nueva en `pending` (no recurrente) | admin |
| `onAppointmentApproved` | Cambio a `approved` / `rejected` / `cancelled` (salvo recurrentes omitidas) | cliente + admin |
| `onAppointmentDeleted` | Cita borrada | cliente + admin |
| `createAppointmentFromAdmin` | Admin crea una cita ya `approved` | cliente + admin |
| `onCustomerSuggestionCreated` | Nueva sugerencia de cliente | `info@focusclub.es`, replyTo = cliente |
| `onUserProfileCreatedWelcomeEmail` | Nuevo `users/{uid}` | cliente |
| `sendContactMessage` | Formulario de contacto web | receptor de `site_content/main`, replyTo = cliente |

- Admin: `infofocusclub2026@gmail.com` (`ADMIN_NOTIFICATION_EMAIL`). Los avisos al admin llevan replyTo al cliente.
- Remitente único: `Focus Club <info@focusclub.es>`.
- Cancelar una cita y después borrarla envía dos avisos, porque son dos eventos distintos.

## Arquitectura (`functions/src/email/`)

- `types.ts`: tipos compartidos (`EmailMessage`, `EmailClient`...).
- `brevo.ts`: `defineSecret("BREVO_API_KEY")` y el cliente REST (timeout de 10 s, reintentos en timeout, errores de red, 429 y 5xx). También contiene `sanitizeEmailError`, que elimina URLs y claves `xkeysib-` antes de registrar un error.
- `dispatch.ts`: `sendEmailOnce` / `sendEmailOnceSafely`, que evitan dobles envíos.
- `notifications.ts`: construye el mensaje de cada flujo, con destinatario, replyTo, tags y clave de deduplicación.
- `templates/`: `layout.ts` es la base común. Es HTML basado en tablas, con 600 px fluidos, estilos inline, VML/condicionales MSO para Outlook, media queries para móvil y preheader. `components.ts` contiene los bloques reutilizables. Hay una plantilla por email (`appointment`, `welcome`, `contact`, `customerSuggestion`) y cada una devuelve `{ subject, html, text }`, con versión en texto plano. Los valores del usuario se escapan en el HTML.

## Idempotencia (evitar dobles envíos)

Hay dos capas:

1. **Registro en Firestore** (`email_dispatches/{sha256(dedupeKey)}`), gestionado mediante transacción:
   - `sent` es definitivo: nunca se reenvía.
   - `sending` funciona como un bloqueo temporal (lease) con `sendingAt` y `leaseUntilMillis`, que dura 2 min. Si sigue vigente, el envío se omite. Si ha caducado, otro intento puede reclamarlo y reintentar.
   - `failed` permite reintentar. Se guarda `lastError` saneado y `attempts`.
   - Solo se guardan metadatos (categoría, `relatedId`, `recipientType`, `messageId`). Nunca se guarda el contenido del email. Las reglas de Firestore no dan acceso a esta colección desde los clientes.
2. **Clave de idempotencia de Brevo**: es un UUID determinista derivado de la misma `dedupeKey`. Se envía en `headers.idempotencyKey` del body, que es la forma documentada por Brevo con un TTL de 30 min, y también en la cabecera HTTP `Idempotency-Key`. Cada reintento del mismo envío (por timeout, 429, 5xx o reclamación de un lease) reutiliza exactamente la misma clave.

Claves de deduplicación:
- Triggers de citas: `event.id` + tipo de destinatario. Los reintentos de Eventarc conservan el mismo id.
- `createAppointmentFromAdmin`: `admin-created:{appointmentId}` + tipo de destinatario.
- Bienvenida: `welcome:{uid}`. Además se mantiene la comprobación `welcomeEmailSentAt` del perfil.
- Sugerencias: `customer-suggestion:{suggestionId}`.
- Contacto: `contact:{contactSubmissionId}`.

## Trazabilidad

- Los logs usan el prefijo `[Email]` e incluyen categoría, `relatedId`, `dispatchId` y `messageId` de Brevo. Nunca registran la API key ni URLs.
- `contact_submissions` guarda `brevoMessageId`.
- `users/{uid}` guarda `welcomeEmailMessageId`, además de los campos `welcomeEmail*` que ya existían.

## Despliegue (manual, no automático)

Desplegado y validado el 05/10/2026 (ver `production-release-checklist.md`). Para futuros despliegues:

1. Comprueba que `BREVO_API_KEY` existe y tiene una versión `ENABLED`: `firebase functions:secrets:get BREVO_API_KEY`. Solo muestra metadatos; no uses `functions:secrets:access`, que imprime el valor.
2. En Brevo, verifica el dominio `focusclub.es` (SPF, DKIM y DMARC) y el remitente `info@focusclub.es`.
3. Despliega con el filtro de la checklist (paso 2.3): `firebase deploy --only "$only"` con `$only = node functions/scripts/deploy-filter.cjs`.
4. Prueba con cuentas propias: formulario de contacto, alta de usuario, crear/aprobar/cancelar/borrar una cita y una sugerencia. Revisa los logs `[Email]` y el panel de Brevo, en Transactional > Logs.
**Rollback:** vuelve a desplegar un commit anterior ya validado con Brevo (bloque C de la checklist). La retirada de los secretos de la integración anterior está en el paso 2.9 de la checklist.

## Tests

`cd functions && npm test` incluye:
- `test/brevoClient.test.cjs`: payload, cabeceras, reintentos con la misma clave de idempotencia, errores sin secretos.
- `test/emailTemplates.test.cjs`: estructura compatible con los clientes de correo, escape de HTML, texto plano y variantes de estado de las citas.
- `test/emailFlows.test.cjs`: registro con lease (enviado, en curso, lease caducado, fallido) y flujos de citas, bienvenida, sugerencias y contacto.
