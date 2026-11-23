# Sincronización de citas con Google Calendar

## Incidencia del 23 de noviembre de 2026

Cloud Run seguía sirviendo el 100 % del tráfico desde `syncappointmentwithgooglecalendar-00012-nok`, con 256 MiB, concurrencia 80 y 1 vCPU. La revisión `00013-zay` que anunciaba Cloud Functions falló al arrancar con `Quota exceeded for total allowable CPU per project per region`. Cloud Logging registró ocho terminaciones por memoria en la revisión que atendía tráfico, con un uso de 257–260 MiB.

El código anterior podía hacer dos inserciones cuando creación y aprobación leían instantáneas sin `googleCalendarEventId`. Los reintentos tras una respuesta perdida y las escrituras fuera de orden podían repetir la inserción o dejar un estado obsoleto. Firestore confirmó cuatro citas aprobadas no recurrentes sin enlace y con última escritura el 2 de junio. Hace falta leer el calendario compartido para determinar si tienen un evento existente. El informe local `release/calendar-audit-2026-11-23-verified.json` contiene sus IDs, franjas, versiones y evidencias de operación.

| Cita | Franja de Madrid | Resultado de Firestore |
|---|---|---|
| `GCfOLD8zqrea4RxS8KNt` | 11/06/2026, 10:00 | Aprobada, sin enlace |
| `sTwJVgpAQ7OYOedTssxP` | 17/06/2026, 09:00 | Aprobada, sin enlace |
| `ff3n2GIxp3d2CDexuoVK` | 19/06/2026, 10:00 | Aprobada, sin enlace |
| `tHyc4UfN8LECTJb44r7k` | 24/06/2026, 10:00 | Aprobada, sin enlace |

Las tres operaciones `active` carecen de `handler_finished` y de identidad de evento en su concesión antigua. Cada una coincide con una solicitud y una terminación por memoria en la misma instancia de la revisión servida. Es una correlación temporal, incluso cuando el registro HTTP dice `200`. Los registros y sus versiones se conservan. Cualquier recuperación de esas concesiones exige una autorización y una revisión aparte de los efectos en Calendar.

| Operación | Terminación, hora peninsular | ID del log de terminación |
|---|---|---|
| `ca8001da-9728-4feb-beea-28b9adc49a05` | 06:20:47 | `6b03cd2f00095f95031f2a2a` |
| `d4e44eb3-c938-4551-80a7-2b01c78fd8c2` | 11:01:36 | `6b040f00000f21400dee4c5e` |
| `8d373580-f197-4c4b-96c4-3a64b46eb90b` | 12:01:57 | `6b041d25000131b05f422ea4` |

## Comportamiento del parche

- La cita vigente en Firestore decide qué mostrar. Un bloqueo corto por cita, reservado transaccionalmente y compartido por todas las instancias, serializa el trabajo. Antes de modificar Calendar y al guardar el resultado se verifica la versión exacta de la cita. Si cambia durante un envío, se vuelve a conciliar. Una cita eliminada nunca se recrea al proyectar el resultado.
- Se reutiliza un evento legado si pertenece a la misma cita. Si falta el enlace, se busca su identificador exacto en Calendar. Varios candidatos o un vínculo de otra cita quedan para revisión. Las coincidencias por nombre y horario no autorizan escrituras.
- Una cita nueva usa un ID determinista derivado de `appointments/{appointmentId}` y deja su identificador en las propiedades privadas de Calendar. Una inserción repetida usa el mismo ID. Se relee el evento ante `409` y las actualizaciones o eliminaciones usan `If-Match`. Un `409` sin un evento legible deja el mismo ID pendiente.
- Una cita individual pendiente se muestra en amarillo y al aprobarla se actualiza el mismo evento a verde. Las recurrentes pendientes siguen sin mostrarse. Rechazar, cancelar, borrar o devolver una recurrente a pendiente retira el evento correspondiente. Cuando Google expone el evento cancelado con su versión, volver a aprobar restaura el mismo ID.
- Las respuestas de Calendar que se pierden mantienen la reserva hasta que expire. Los fallos transitorios utilizan los reintentos de Eventarc. Los fallos permanentes quedan registrados para revisión. Se usa `sendUpdates: none` y la Function no añade asistentes.
- La primera invocación relevante de la versión nueva espera una ventana compartida de 90 segundos, frente al timeout anterior de 60 segundos. Las solicitudes reintentadas podrán continuar después de ese margen, que permite concluir las invocaciones de la revisión saliente.

## Recursos y cuotas

El parche fija **512 MiB, concurrencia 1, CPU `gcf_gen1` y máximo 5 instancias**. Con 512 MiB, Firebase CLI asigna aproximadamente 1/3 de vCPU por instancia. El máximo nominal de este servicio suma unas 1,67 vCPU y 2,5 GiB. La cuota es regional y se comparte con otros servicios. La carga sostenida y los arranques pueden consumir el margen disponible. Verifica la cuota de CPU y memoria de `europe-west1` antes de publicar y observa el retraso de Eventarc, `429`/`5xx`, memoria y escalado al terminar. Concurrencia 1 limita una solicitud por instancia y la reserva transaccional protege la misma cita entre instancias. [Configuración de Functions](https://firebase.google.com/docs/functions/manage-functions?gen=2nd) · [Cuotas regionales](https://docs.cloud.google.com/functions/quotas) · [Límites de Calendar](https://developers.google.com/workspace/calendar/api/guides/quota)

La consulta de cuotas del proyecto devolvió `403` con la identidad disponible. Queda pendiente confirmar el margen regional en la consola con la cuenta operadora. [Cuotas de Focus Club](https://console.cloud.google.com/iam-admin/quotas?project=focus-club-f73b8)

El SDK de Calendar se carga de forma diferida y su cliente se reutiliza por instancia. El ID estable permite evitar listados en citas ya vinculadas. Los reintentos de cuota emplean el backoff de Eventarc. [Versionado de recursos de Calendar](https://developers.google.com/workspace/calendar/api/guides/version-resources) · [Reintentos de Functions](https://firebase.google.com/docs/functions/retries)

## Auditoría de solo lectura

Ejecuta desde la raíz del repositorio, con la sesión de Firebase para Firestore, Cloud Functions y Logging. El informe parcial se generó desde esa sesión. La identidad disponible recibió un `403` al intentar obtener un token de lectura para la cuenta de servicio del runtime. Para cruzar ambos inventarios, ejecuta con ADC autorizado para `calendar.events.readonly` y acceso al calendario, o carga en `FOCUS_CALENDAR_READ_TOKEN` un token OAuth temporal con ese alcance de una cuenta con acceso de lectura. El script usa exclusivamente `GET` en Calendar y la consulta de entradas en Logging. El informe local requiere una ruta nueva.

```powershell
$proyectoFocus = 'focus-club-f73b8'
$fechaFocus = Get-Date -Format 'yyyyMMdd-HHmmss'
npm.cmd --prefix functions run build
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación' }
$informeFocus = "release/calendar-audit-$fechaFocus.json"
node scripts/sync-google-calendar-appointments.cjs --project $proyectoFocus --calendar --out $informeFocus
if ($LASTEXITCODE -ne 0) { throw 'Auditoría de Calendar incompleta. Revisa el informe parcial si existe.' }
Get-Content -Raw -LiteralPath $informeFocus
```

Sin `--calendar`, el mismo comando guarda exclusivamente evidencia de Firestore y Cloud Run/Logging. `calendar.status: not-read` y `matches: null` indican que las citas no se cruzaron con el calendario. La auditoría completa enumera duplicados por cita, huérfanos, citas inactivas aún visibles, enlaces sin evento y conflictos de identidad. Los eventos manuales sin ninguna marca o enlace de Focus Club requieren inspección humana. Repite la consulta si hubo cambios entre la captura de Firestore y la lectura de Calendar.

## Publicación selectiva

1. Revisa el parche, el informe y la cuota regional. Coordina una ventana sin otras publicaciones. Las reservas pueden seguir abiertas. El preflight exige publicación coordinada abierta, aforo v2, cola de mantenimiento vacía y devoluciones automáticas desactivadas. Conserva los tres registros activos y evita `maintenance-close` para este cambio selectivo.
2. Compila y ejecuta el preflight. Deben aparecer **68 Functions verificadas y única pendiente `syncAppointmentWithGoogleCalendar`**, o las 69 verificadas si ya se publicó. El manifiesto distingue la fuente anterior aprobada del paquete nuevo. Conserva los diez paquetes Bootstrap y permite acreditar las Functions previas sin republicarlas.

   ```powershell
   Set-Location -LiteralPath 'C:\Users\david\Archivos\AA_Clientes\web_focus_club'
   $ErrorActionPreference = 'Stop'
   $proyectoFocus = 'focus-club-f73b8'
   $manifiestoFocus = 'release/manifest.json'
   npm.cmd --prefix functions run build
   if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación' }
   node scripts/release-controls.cjs plan-calendar-hotfix --project $proyectoFocus --manifest $manifiestoFocus
   if ($LASTEXITCODE -ne 0) { throw 'Detén la publicación. El preflight falló.' }
   ```

3. Tras la revisión, publica la única Function con el wrapper. El filtro interno es `firebase deploy --project focus-club-f73b8 --config firebase.json --only functions:syncAppointmentWithGoogleCalendar`. El wrapper repite el preflight y confirma el código publicado, trigger, recursos y 100 % del tráfico real. Si la versión ya quedó publicada, la verifica sin volver a publicarla.

   ```powershell
   .\scripts\deploy-release.ps1 -Stage CalendarHotfix
   node scripts/release-controls.cjs verify-calendar-hotfix --project $proyectoFocus --manifest $manifiestoFocus
   if ($LASTEXITCODE -ne 0) { throw 'Cloud Run todavía no acredita la revisión del hotfix.' }
   node scripts/release-controls.cjs status --project $proyectoFocus
   if ($LASTEXITCODE -ne 0) { throw 'Falló la lectura del estado.' }
   ```

4. Observa una reserva orgánica y su aprobación tras la ventana inicial, con los permisos de Calendar adecuados. Verifica el mismo `googleCalendarEventId`, el estado `synced`, una sola entrada y franja correcta. Revisa los logs de memoria, errores de Google y retrasos. Repite la auditoría con una ruta nueva. La reparación retrospectiva de duplicados, huérfanos, citas sin enlace y operaciones `active` se decide en una revisión separada.
5. Si Firebase devuelve un error o Cloud Run aún no sirve la revisión revisada, detén la publicación. Ejecuta de nuevo `verify-calendar-hotfix` para descartar una respuesta perdida. Si Cloud Run sigue informando de cuota, consulta su condición `Ready`, libera margen o solicita un aumento de cuota por el procedimiento del proyecto. Reintenta únicamente el mismo filtro y paquete tras verificar la revisión fallida. Mantén la revisión anterior y los eventos existentes mientras el servicio no confirme el nuevo tráfico. Si en el futuro se necesita drenar un trabajo diferido de Calendar, actualiza antes `onReleaseDeferredEventWritten` en la publicación coordinada correspondiente. Su código desplegado anterior contiene su propia copia del sincronizador.
