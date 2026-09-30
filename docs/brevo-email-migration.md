# Migración de emails a Brevo Transactional Email

Todos los emails transaccionales de las Cloud Functions salen ahora por la API REST de Brevo (`POST https://api.brevo.com/v3/smtp/email`). Se eliminan los webhooks de Make y el SDK de Resend. Solo cambia la infraestructura: mismos eventos y mismos destinatarios. Flutter, FCM y los emails de Firebase Auth (verificación y recuperación de contraseña) no se tocan.

## Flujos migrados

Todos están en `functions/src/index.ts`.

| Función | Cuándo | Antes | Destinatarios |
|---|---|---|---|
| `onAppointmentCreated` | Cita nueva en `pending` (no recurrente) | Make | admin |
| `onAppointmentApproved` | Cambio a `approved` / `rejected` / `cancelled` (salvo recurrentes omitidas) | Make | cliente + admin |
| `onAppointmentDeleted` | Cita borrada | Make | cliente + admin |
| `createAppointmentFromAdmin` | Admin crea una cita ya `approved` | Make | cliente + admin |
| `onCustomerSuggestionCreated` | Nueva sugerencia de cliente | Make | `info@focusclub.es`, replyTo = cliente |
| `onUserProfileCreatedWelcomeEmail` | Nuevo `users/{uid}` | Make (webhook de bienvenida) | cliente |
| `sendContactMessage` | Formulario de contacto web | Resend | receptor de `site_content/main`, replyTo = cliente |

- Admin: `infofocusclub2026@gmail.com` (`ADMIN_NOTIFICATION_EMAIL`, igual que antes). Los avisos al admin llevan replyTo al cliente.
- Remitente único: `Focus Club <info@focusclub.es>` (el contacto usaba antes `noreply@focusclub.es`).
- Se mantiene el comportamiento anterior: cancelar una cita y después borrarla envía dos avisos, porque son dos eventos distintos.

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
- `contact_submissions` guarda `brevoMessageId`, que sustituye a `resendEmailId`.
- `users/{uid}` guarda `welcomeEmailMessageId`, además de los campos `welcomeEmail*` que ya existían.

## Despliegue (manual, no automático)

1. Comprueba que `BREVO_API_KEY` existe: `firebase functions:secrets:access BREVO_API_KEY`. No imprimas su valor en logs compartidos.
2. En Brevo, verifica el dominio `focusclub.es` (SPF, DKIM y DMARC) y el remitente `info@focusclub.es`.
3. Despliega: `cd functions && npm run deploy`.
4. Prueba con cuentas propias: formulario de contacto, alta de usuario, crear/aprobar/cancelar/borrar una cita y una sugerencia. Revisa los logs `[Email]` y el panel de Brevo, en Transactional > Logs.
5. Cuando todo esté validado, desactiva los escenarios de Make y borra los secretos antiguos: `MAKE_WEBHOOK_URL`, `MAKE_WELCOME_WEBHOOK_URL` y `RESEND_API_KEY`, con `firebase functions:secrets:destroy`.

**Rollback:** vuelve a desplegar el commit anterior. Los secretos de Make y Resend no deben borrarse hasta completar el paso 5.

## Tests

`cd functions && npm test` incluye:
- `test/brevoClient.test.cjs`: payload, cabeceras, reintentos con la misma clave de idempotencia, errores sin secretos.
- `test/emailTemplates.test.cjs`: estructura compatible con los clientes de correo, escape de HTML, texto plano y variantes de estado de las citas.
- `test/emailFlows.test.cjs`: registro con lease (enviado, en curso, lease caducado, fallido) y flujos de citas, bienvenida, sugerencias y contacto.
