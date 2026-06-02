# Sincronizacion de citas con Google Calendar

## Objetivo

La Function `syncAppointmentWithGoogleCalendar` sincroniza cambios de `appointments/{appointmentId}` con el calendario del centro. No envia invitaciones por email y no define `attendees`.

Calendario:

```text
ffd17bde7a4d70439683c1e14f5c63f9d19cb3ad3d28d055005d3ad7c692ee89@group.calendar.google.com
```

## Configuracion manual

1. En Google Cloud, activar Google Calendar API en el proyecto usado por Firebase.
2. Usar la cuenta de servicio runtime por defecto de Functions 2nd gen. Firebase/Cloud Functions 2nd gen usa por defecto la cuenta de servicio Compute Engine:

```text
PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

3. Compartir el calendario de Google Calendar con la cuenta runtime real y darle permisos para modificar eventos.
4. Configurar el unico secreto necesario:

```cmd
npx.cmd firebase-tools functions:secrets:set GOOGLE_CALENDAR_ID --project focus-club-f73b8
```

La Function usa Application Default Credentials desde el metadata server de Cloud Functions v2. No se guardan credenciales descargables en el repositorio ni en Firebase secrets.

Para ver la cuenta runtime real tras desplegar:

```cmd
gcloud functions describe syncAppointmentWithGoogleCalendar --gen2 --region europe-west1 --project focus-club-f73b8 --format="value(serviceConfig.serviceAccountEmail)"
```

## Permisos de la cuenta runtime

La cuenta runtime que devuelva el comando anterior debe poder:

- Leer `users` en Firestore.
- Actualizar `appointments` con campos `googleCalendar*`.
- Leer el secret `GOOGLE_CALENDAR_ID`.
- Crear, actualizar y borrar eventos en el calendario compartido.

Roles manuales minimos a revisar si el deploy o la ejecucion fallan:

- `roles/datastore.user` o permisos equivalentes para Firestore.
- `roles/secretmanager.secretAccessor` sobre `GOOGLE_CALENDAR_ID` si Firebase CLI no lo asigna automaticamente al desplegar el secret.
- Si se usa la cuenta por defecto de Functions 2nd gen, normalmente tendra permisos amplios de proyecto, pero conviene revisar estos permisos explicitamente antes de probar la sincronizacion.

## Comportamiento

- `pending` / `pendiente`: crea o actualiza un evento amarillo (`colorId: "5"`).
- `approved` / `aprobada`: crea o actualiza el mismo evento en verde (`colorId: "10"`).
- `rejected` / `rechazada`: borra el evento de Google Calendar y marca la cita como `googleCalendarSyncStatus: "deleted"`.
- Cita eliminada en Firestore: borra el evento si el documento tenia `googleCalendarEventId`.
- Si cambia fecha, hora, duracion, entrenador, comentario, cliente, servicio o estado, se recalcula `googleCalendarSyncHash` y se actualiza el evento.
- Si solo cambian campos `googleCalendar*`, la Function hace no-op para evitar bucles.

Para pendientes se usa `preferredSlots[0]`. Para aprobadas se usa `approvedSlot` y, si falta, `preferredSlots[0]`. Si no hay duracion valida (`30`, `45`, `60`), se usa fallback de 30 minutos.

Si Firestore tiene `googleCalendarEventId` pero el evento ya no existe en Google Calendar, la Function lo trata como recuperable:

- Durante update de pendientes/aprobadas, recrea el evento y guarda el nuevo `googleCalendarEventId`.
- Durante borrado/rechazo, considera 404/410 como evento ya eliminado y limpia metadatos si el documento sigue existiendo.

Si falla Google Calendar, la cita sigue creada o actualizada en Firestore. La Function solo guarda:

```text
googleCalendarSyncStatus = "error"
googleCalendarSyncError = mensaje corto
```

## Deploy manual

No se debe desplegar automaticamente desde Codex. Para desplegar solo la Function:

```cmd
npx.cmd firebase-tools deploy --only functions:syncAppointmentWithGoogleCalendar --project focus-club-f73b8
```

No hubo cambios de `firestore.rules` para esta integracion. Si en el futuro se modifican reglas:

```cmd
npx.cmd firebase-tools deploy --only firestore:rules --project focus-club-f73b8
```

## Pruebas manuales

1. Crear una cita desde el flujo actual de reservas. Debe quedar `pending`, crear evento amarillo y guardar `googleCalendarEventId`, `googleCalendarSyncStatus: "synced"` y `googleCalendarSyncHash`.
2. Aprobar la cita desde admin con entrenador/franja. Debe actualizar el mismo evento a titulo `Aprobada - ...`, color verde y horario aprobado.
3. Rechazar la cita. Debe borrar el evento y guardar `googleCalendarSyncStatus: "deleted"` en el documento.
4. Crear otra cita y eliminar el documento desde admin. Debe borrar el evento de Calendar.
5. Borrar manualmente el evento en Google Calendar y modificar un campo relevante de la cita. La Function debe recrear el evento y guardar el nuevo id.

## Mantenimiento y backfill

El script `scripts/sync-google-calendar-appointments.cjs` lista citas activas sin `googleCalendarEventId` en modo dry-run. No hace backfill ni escribe en Firestore. El backfill real queda como tarea futura para evitar sincronizaciones masivas accidentales.

```cmd
node scripts\sync-google-calendar-appointments.cjs
```
