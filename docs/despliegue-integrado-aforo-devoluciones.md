# Procedimiento definitivo: aforo y devoluciones de Focus Club

Fecha de preparación: 18 de noviembre de 2026. Proyecto: `focus-club-f73b8`. Región: `europe-west1`. Esta es la única secuencia de publicación para esta entrega; sustituye las instrucciones de despliegue de los documentos anteriores de devoluciones, aforo y notificaciones. **Durante la preparación solo se han ejecutado pruebas locales, emuladores y lecturas de producción. No se ha desplegado, activado, migrado ni compensado producción.**

## Qué se publica

- Backend compartido: 68 Functions de `web_focus_club/functions`, Node 22. Incluye toda la contabilidad permanente de devoluciones, administración de bonos en servidor, estadísticas, propuestas, renovaciones y ocupación transaccional de pendientes y aprobadas.
- Backend de la app: únicamente `portal:deleteOwnAccount`, también con bloqueo de mantenimiento. Total definitivo: **69 Functions**, siempre en tandas de máximo cinco.
- Hosting estático de `web_focus_club/out`, reglas e índices de Firestore de `web_focus_club`. No publicar Storage ni las reglas o índices duplicados del repositorio Flutter.
- Flutter `1.5.2+22`, mismo código y número de build para Android e iOS. El build 22 es candidato: comprobar antes que no esté usado en ninguna tienda. Si hay que incrementarlo, cambiar ambos, repetir validación y regenerar el manifiesto antes de publicar.
- Reconciliación de `slot_occupancy` con auditoría, confirmación del informe y recibos por bloques. La importación histórica de devoluciones es otra operación, posterior y con otro informe.

Las pendientes y aprobadas ocupan una plaza sobre cada bloque canónico de 15 minutos cubierto por sesiones de 30, 45 o 60 minutos. Aprobar conserva la plaza. Rechazar, cancelar y eliminar la liberan; mover conserva los bloques compartidos y actualiza los demás. Los aforos por fecha se aplican desde la creación. Las reservas existentes por encima del límite permanecen. Las excepciones administrativas requieren confirmar las restricciones exactas; si cambian, se vuelve a pedir confirmación.

El cambio económico aprobado conserva `tamano`, las ampliaciones anteriores y los extras recuperados separados. La devolución ordinaria al mismo bono restaura saldo sin ampliar capacidad. Los traslados y excesos legítimos se compensan como extras dentro de la capacidad efectiva. Sin receptor válido, la deuda queda conservada. Varios bonos activos bloquean la compensación. Los extras siguen la vigencia del receptor; la deuda sin abonar no caduca.

## 0. Preparar y comprobar, sin escribir producción

Usar PowerShell desde esta copia, conservando también el repositorio hermano `app_focus_club`. Guardar `release/manifest.json`, los diez paquetes de `release/bootstrap`, los informes revisados y los registros de ejecución fuera de Hosting. Los paquetes de bootstrap y los informes completos están excluidos de Git y deben conservarse en el equipo del operador. No publicar todo `release`.

Los comandos se ejecutan **por pasos**, deteniéndose en cada revisión. No copiar todo el documento como una ejecución única. No usar `npm run deploy`, `firebase deploy` sin filtro ni `--only functions` sin nombres. No ejecutar al mismo tiempo otras tareas administrativas con credenciales de servidor, importaciones, borrados o cambios económicos.

```powershell
Set-Location -LiteralPath 'C:\Users\david\Archivos\AA_Clientes\web_focus_club'
$ErrorActionPreference = 'Stop'
$proyectoFocus = 'focus-club-f73b8'
function Comprobar-Focus {
    if ($LASTEXITCODE -ne 0) { throw "Ha fallado el comando anterior ($LASTEXITCODE). Detener el procedimiento." }
}
firebase login
Comprobar-Focus
npm ci
Comprobar-Focus
npm --prefix functions ci
Comprobar-Focus
npm --prefix ../app_focus_club/functions ci
Comprobar-Focus
npm --prefix functions test
Comprobar-Focus
npm --prefix functions run test:emulator
Comprobar-Focus
npm --prefix ../app_focus_club/functions test
Comprobar-Focus
npm test
Comprobar-Focus
npx tsc --noEmit
Comprobar-Focus
npm run build
Comprobar-Focus
Push-Location -LiteralPath '../app_focus_club'
try {
    flutter pub get
    Comprobar-Focus
    flutter analyze
    Comprobar-Focus
    flutter test
    Comprobar-Focus
} finally { Pop-Location }
node scripts/prepare-coordinated-release.cjs --project $proyectoFocus --out release
Comprobar-Focus
node scripts/release-controls.cjs preflight --project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
```

`prepare-coordinated-release` solo hace lecturas remotas y prepara archivos locales. Ya se han capturado las 59 Functions realmente desplegadas, agrupadas en diez paquetes de código diferentes, y sus reglas. El bootstrap añade mantenimiento a cada versión real sin adelantar cambios de negocio. No se presupone que producción coincide con un commit del repositorio. Una captura existente se conserva; `--offline --refresh-manifest` permite recalcular huellas y recompilar esos paquetes sin recapturar producción. Si `preflight` encuentra otra versión remota, parar y revisar una nueva captura; no borrar la evidencia anterior para forzar que pase.

El manifiesto fija nombres, tandas, fuentes, código compilado, scripts, reglas, índices, web estática y versión móvil. Cualquier cambio posterior exige repetir las comprobaciones pertinentes y regenerarlo. Se verifican los archivos publicados contra su ZIP real, las etiquetas de versión y el tráfico hacia la revisión nueva. Una salida correcta de Firebase CLI por sí sola no acredita la versión.

Antes de continuar: confirmar acceso administrativo al proyecto, permisos de lectura de fuentes de Functions y Cloud Logging, las vinculaciones existentes de `BREVO_API_KEY` y `GOOGLE_CALENDAR_ID`, firma Android y distribución iOS. No imprimir los valores de secretos ni claves. Reservar una ventana con margen para todas las tandas y la reconciliación; no comprometer una reapertura por hora si falla una comprobación.

## 1. Índices, antes de cerrar el servicio

```powershell
firebase deploy --project $proyectoFocus --only 'firestore:indexes'
Comprobar-Focus
node scripts/release-controls.cjs verify-indexes --project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
```

Esperar hasta que todos los índices definidos estén disponibles. Si el verificador avisa de construcción pendiente, repetir únicamente la verificación. No desplegar aún las Functions definitivas. La recuperación horaria consulta trabajos debidos mediante índice simple; no se crea un nuevo Cloud Scheduler ni un barrido periódico de citas o bonos.

## 2. Instalar primero el bloqueo compatible con las versiones antiguas

Esta fase conserva la lógica económica desplegada. Es imprescindible para impedir llamadas de apps antiguas y escrituras directas durante el mantenimiento posterior. El script publica únicamente las 59 Functions capturadas, usando cada paquete correspondiente y tandas de máximo cinco; después publica las reglas preparatorias y verifica ambos.

```powershell
.\scripts\deploy-release.ps1 -Stage Bootstrap
```

Consultar `release/manifest.json`, apartado `bootstrap.artifacts`, para la lista exacta por paquete. No sustituir estos paquetes por la versión definitiva ni mezclar sus funciones. El script conserva el codebase `portal` para `deleteOwnAccount`.

### Continuar un Bootstrap parcialmente publicado

No repetir la publicación completa. El paquete portal capturado contenía puntos de entrada móviles antiguos ajenos a `deleteOwnAccount`; uno declaraba el secreto retirado `MAKE_RESERVATION_WEBHOOK_URL`. El descubrimiento de parámetros del paquete precede al filtro de Functions. La corrección conserva literalmente el manejador de borrado y sus dependencias, mantiene el bloqueo preparatorio y expone únicamente `deleteOwnAccount`, sin secretos. No crear un secreto de Make para superar el aviso.

La reparación local reproducible es `node scripts/prepare-coordinated-release.cjs --project focus-club-f73b8 --out release --offline --repair-portal-bootstrap`. Ya está aplicada al paquete entregado: no es un paso de despliegue. Conserva los diez paquetes, las versiones capturadas y el identificador original del release. Solo recompila portal, registra las huellas anteriores y posteriores en `bootstrap.artifacts[].amendments` y guarda la copia anterior en `release/test-logs`. Para posteriores cambios de herramientas o resultados, regenerar con `--offline --refresh-manifest --skip-bootstrap-build`, sin recompilar los otros paquetes.

```powershell
node scripts/release-controls.cjs preflight --project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs plan-bootstrap-resume --project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
.\scripts\deploy-release.ps1 -Stage Bootstrap -Resume
Comprobar-Focus
node scripts/release-controls.cjs verify-bootstrap --project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
```

`plan-bootstrap-resume` solo lee producción y guarda pruebas locales. Comprueba estado ACTIVE, región, runtime, codebase, etiquetas, tráfico y las huellas de los archivos del ZIP real. Una Function se omite únicamente si coincide con su paquete revisado. Una versión original capturada queda pendiente; una versión desconocida o reglas no revisadas detienen el procedimiento. La caché se vincula a la generación inmutable de la fuente y a las huellas del paquete, por lo que cambiar el manifiesto global no obliga a republicar Functions intactas. No ejecutar dos continuaciones simultáneas.

`-Resume` vuelve a comprobar las pendientes antes de cada tanda de máximo cinco. Si Firebase falla o se pierde su respuesta, se detiene; repetir el mismo comando vuelve a comprobar qué se publicó realmente. Las reglas preparatorias se publican solo cuando ya no quedan Functions pendientes, y se omiten si ya coinciden. No cerrar el mantenimiento hasta superar `verify-bootstrap` y la revisión de ejecuciones anteriores.

En la lectura del 19 de noviembre de 2026 quedaron acreditadas 51 de las 59 Functions y seguían pendientes estas ocho, en cuatro tandas. El plan remoto manda si el estado cambia:

| Paquete | Functions pendientes |
|---|---|
| `7baa344656ed5bbbdd19` | `appointmentRemindersScheduled`, `assignBonoFromAdmin`, `onAppointmentCreated`, `onAppointmentDeleted`, `reconcileSlotOccupancyFromApprovedAppointments` |
| `feaf41d65ada677f809c` | `portal:deleteOwnAccount` |
| `ddc5657a8be986cc0fad` | `returnRecurringSeriesToPendingFromAdmin` |
| `defb142255660627c8f2` | `onAppointmentCustomerNotification` |

`syncAppointmentWithGoogleCalendar` ya coincide con el paquete revisado y no debe repetirse. Las reglas todavía eran las originales. Esta continuación termina el Bootstrap; no adelanta las Functions definitivas, la reconciliación, el cambio mínimo de apps, la activación automática ni las compensaciones históricas.

**Antes de cerrar:** comprobar en Cloud Logging que han terminado las ejecuciones de las revisiones anteriores al bootstrap, incluidas llamadas antiguas y tareas programadas. El máximo observado en la captura fue 60 segundos; el cierre vuelve a leer los límites reales y exige al menos el máximo más 30 segundos desde la última actualización. Esa espera es una precaución adicional; la confirmación de revisión de ejecuciones sigue siendo obligatoria. Las ejecuciones anteriores al bootstrap carecen de los nuevos registros de admisión.

## 3. Abrir la ventana de mantenimiento y congelar las escrituras

```powershell
node scripts/release-controls.cjs maintenance-close --confirm-project $proyectoFocus --manifest release/manifest.json --wait --legacy-executions-reviewed
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
```

Continuar únicamente con `phase: frozen`, ninguna operación activa y devoluciones automáticas desactivadas. El cierre pasa por `draining`: deniega nuevas llamadas y escrituras de Firestore, espera las operaciones admitidas y después congela. No elimina una operación activa por el tiempo transcurrido. Una transacción financiera que coincide con el cierre vuelve a leer el bloqueo y aborta. Los eventos de fondo se guardan de forma duradera para su recuperación; los duplicados se agrupan.

Las reglas bloquean escrituras directas de clientes, entrenadores y administradores, incluyendo contadores y configuración. Las Functions bloquean también las apps antiguas que no muestran la pantalla de mantenimiento y el borrado de cuenta del codebase `portal`. Las lecturas siguen disponibles; las consultas administrativas de devoluciones y la vista previa de renovación conservan acceso. El operador conserva las acciones expresas de este procedimiento mediante IAM. No se debe cambiar `maintenanceMode` directamente desde la consola o el panel para abrir: ese campo visual no sustituye el bloqueo privado.

## 4. Publicar las Functions definitivas en tandas de máximo cinco

```powershell
.\scripts\deploy-release.ps1 -Stage Functions
```

El script ejecuta **exactamente** las tandas siguientes, deteniéndose ante cualquier fallo. Las órdenes de esta tabla documentan la expansión del script; no volver a ejecutarlas si el script ya terminó. Todas llevan `firebase deploy --project focus-club-f73b8 --only 'FILTRO'`.

| Tanda | Functions concretas | Filtro de publicación |
|---|---|---|
| 1 (5) | `adminDeleteSuggestion`, `adminHideSupportConversation`, `adminMarkSuggestionNew`, `adminMarkSuggestionReviewed`, `adminSendSupportMessage` | `firebase deploy --project focus-club-f73b8 --only 'functions:adminDeleteSuggestion,functions:adminHideSupportConversation,functions:adminMarkSuggestionNew,functions:adminMarkSuggestionReviewed,functions:adminSendSupportMessage'` |
| 2 (5) | `appointmentRemindersScheduled`, `approveRecurringAppointmentSeriesFromAdmin`, `assignBonoFromAdmin`, `auditMinuteRefundsFromAdmin`, `blockSlotsFromAdmin` | `firebase deploy --project focus-club-f73b8 --only 'functions:appointmentRemindersScheduled,functions:approveRecurringAppointmentSeriesFromAdmin,functions:assignBonoFromAdmin,functions:auditMinuteRefundsFromAdmin,functions:blockSlotsFromAdmin'` |
| 3 (5) | `bonoExpiryWarningsScheduled`, `cancelOwnAppointment`, `cancelOwnRecurringAppointmentSeries`, `closeSupportConversation`, `commitBonoAppointmentRenewalFromAdmin` | `firebase deploy --project focus-club-f73b8 --only 'functions:bonoExpiryWarningsScheduled,functions:cancelOwnAppointment,functions:cancelOwnRecurringAppointmentSeries,functions:closeSupportConversation,functions:commitBonoAppointmentRenewalFromAdmin'` |
| 4 (5) | `createAppointment`, `createAppointmentFromAdmin`, `createRecurringAppointments`, `createRecurringAppointmentsFromAdmin`, `createSupportConversation` | `firebase deploy --project focus-club-f73b8 --only 'functions:createAppointment,functions:createAppointmentFromAdmin,functions:createRecurringAppointments,functions:createRecurringAppointmentsFromAdmin,functions:createSupportConversation'` |
| 5 (5) | `createUserFromAdmin`, `deleteAppointmentsFromAdmin`, `deleteCapacityExceptionsFromAdmin`, `deleteUserFromAdmin`, `expireOverdueBonosScheduled` | `firebase deploy --project focus-club-f73b8 --only 'functions:createUserFromAdmin,functions:deleteAppointmentsFromAdmin,functions:deleteCapacityExceptionsFromAdmin,functions:deleteUserFromAdmin,functions:expireOverdueBonosScheduled'` |
| 6 (5) | `getMinuteRefundDetailFromAdmin`, `getMinuteRefundSummaryFromAdmin`, `getMinuteRefundsFromAdmin`, `markSupportConversationRead`, `migrateLegacyBlockedSlots` | `firebase deploy --project focus-club-f73b8 --only 'functions:getMinuteRefundDetailFromAdmin,functions:getMinuteRefundSummaryFromAdmin,functions:getMinuteRefundsFromAdmin,functions:markSupportConversationRead,functions:migrateLegacyBlockedSlots'` |
| 7 (5) | `mutateBonoFromAdmin`, `onAppointmentApproved`, `onAppointmentCreated`, `onAppointmentCustomerNotification`, `onAppointmentDeleted` | `firebase deploy --project focus-club-f73b8 --only 'functions:mutateBonoFromAdmin,functions:onAppointmentApproved,functions:onAppointmentCreated,functions:onAppointmentCustomerNotification,functions:onAppointmentDeleted'` |
| 8 (5) | `onBonoCustomerNotification`, `onBonoRefundDestinationChanged`, `onCustomerSuggestionCreated`, `onFcmTokenWritten`, `onMinuteRefundAccountWritten` | `firebase deploy --project focus-club-f73b8 --only 'functions:onBonoCustomerNotification,functions:onBonoRefundDestinationChanged,functions:onCustomerSuggestionCreated,functions:onFcmTokenWritten,functions:onMinuteRefundAccountWritten'` |
| 9 (5) | `onMinuteRefundActivation`, `onNotificationOutboxCreated`, `onReleaseDeferredEventWritten`, `onUserProfileCreatedWelcomeEmail`, `previewBonoAppointmentRenewalFromAdmin` | `firebase deploy --project focus-club-f73b8 --only 'functions:onMinuteRefundActivation,functions:onNotificationOutboxCreated,functions:onReleaseDeferredEventWritten,functions:onUserProfileCreatedWelcomeEmail,functions:previewBonoAppointmentRenewalFromAdmin'` |
| 10 (5) | `proposeAppointmentSlotFromAdmin`, `pruneStaleFcmTokensScheduled`, `reconcileSlotOccupancyFromApprovedAppointments`, `rejectRecurringAppointmentSeriesFromAdmin`, `reopenSupportConversation` | `firebase deploy --project focus-club-f73b8 --only 'functions:proposeAppointmentSlotFromAdmin,functions:pruneStaleFcmTokensScheduled,functions:reconcileSlotOccupancyFromApprovedAppointments,functions:rejectRecurringAppointmentSeriesFromAdmin,functions:reopenSupportConversation'` |
| 11 (5) | `replaceOwnRecurringSeriesSchedule`, `replaceRecurringSeriesScheduleFromAdmin`, `rescheduleAppointmentFromAdmin`, `rescheduleOwnRecurringAppointment`, `rescheduleRecurringAppointmentFromAdmin` | `firebase deploy --project focus-club-f73b8 --only 'functions:replaceOwnRecurringSeriesSchedule,functions:replaceRecurringSeriesScheduleFromAdmin,functions:rescheduleAppointmentFromAdmin,functions:rescheduleOwnRecurringAppointment,functions:rescheduleRecurringAppointmentFromAdmin'` |
| 12 (5) | `respondToAppointmentConfirmation`, `retryMinuteRefundFromAdmin`, `retryNotificationDeliveriesScheduled`, `returnRecurringSeriesToPendingFromAdmin`, `sendContactMessage` | `firebase deploy --project focus-club-f73b8 --only 'functions:respondToAppointmentConfirmation,functions:retryMinuteRefundFromAdmin,functions:retryNotificationDeliveriesScheduled,functions:returnRecurringSeriesToPendingFromAdmin,functions:sendContactMessage'` |
| 13 (5) | `sendSupportMessage`, `submitCustomerSuggestion`, `syncAppointmentWithGoogleCalendar`, `updateAppointmentStatusFromAdmin`, `updateMaxCapacityFromAdmin` | `firebase deploy --project focus-club-f73b8 --only 'functions:sendSupportMessage,functions:submitCustomerSuggestion,functions:syncAppointmentWithGoogleCalendar,functions:updateAppointmentStatusFromAdmin,functions:updateMaxCapacityFromAdmin'` |
| 14 (3) | `updateOwnAppointmentSlot`, `updateUserFromAdmin`, `upsertCapacityExceptionsFromAdmin` | `firebase deploy --project focus-club-f73b8 --only 'functions:updateOwnAppointmentSlot,functions:updateUserFromAdmin,functions:upsertCapacityExceptionsFromAdmin'` |
| 15 (1), desde la app | `deleteOwnAccount` | `firebase deploy --project focus-club-f73b8 --only 'functions:portal:deleteOwnAccount'` |

La última tanda se ejecuta desde `app_focus_club`, con el filtro `functions:portal:deleteOwnAccount`. Todas las demás salen de `web_focus_club`. No publicar otras Functions del repositorio móvil ni borrar Functions ajenas mediante una publicación global. Si aparece un punto de entrada remoto no recogido en el manifiesto, la comprobación previa se detiene para revisarlo.

## 5. Hosting y después las reglas definitivas

```powershell
.\scripts\deploy-release.ps1 -Stage Hosting
.\scripts\deploy-release.ps1 -Stage Rules
node scripts/release-controls.cjs verify-release --project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
```

Cada etapa comprueba que las Functions anteriores son las definitivas. Las reglas se publican después de comprobar también Hosting. Mantener `phase: frozen` y el flag desactivado. No abrir ni iniciar la migración si falta una Function, un índice, una regla o la versión estática de `/admin/devoluciones` y `/portal`.

## 6. Recuperar eventos pausados y auditar la ocupación

```powershell
node scripts/release-controls.cjs drain-deferred --confirm-project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
$marcaAforoFocus = Get-Date -Format 'yyyyMMdd-HHmmss'
$informeAforoFocus = "release/slot-audit-$marcaAforoFocus.json"
node scripts/reconcile-slot-occupancy.cjs --mode audit --project $proyectoFocus --out $informeAforoFocus
Comprobar-Focus
Get-Content -Raw -LiteralPath $informeAforoFocus
```

La recuperación corre en el servidor desplegado con sus secretos y destinos originales; el equipo local no ejecuta manejadores de correo o calendario. Se autoriza trabajo solo para este cierre y su época. Un fallo conserva el evento y exige revisión, en vez de descartarlo o reintentarlo sin límite. La cola debe quedar en cero antes de verificar la ocupación.

**PARAR AQUÍ PARA REVISAR EL INFORME.** Revisar sus operaciones, citas inválidas, contadores corruptos, aforo por fecha y excesos existentes. `issues` debe estar vacío. `overCapacity` es informativo y no autoriza cancelar citas. El informe preliminar de solo lectura del 18/11 examinó 1.179 citas activas: proponía crear 24 contadores, actualizar 52 y eliminar 232 contadores sin reservas activas; encontró cuatro franjas sobre aforo y ninguna incidencia de formato. No se aplicó. Es preliminar, no estaba congelado y **no sirve para aplicar**: debe sustituirse por el informe obtenido ahora durante este mantenimiento.

No ejecutar `reconcileSlotOccupancyFromApprovedAppointments` para aplicar. Su nombre se conserva por compatibilidad, pero su escritura antigua está bloqueada. No ejecutar la migración de bloqueos antiguos como parte de esta entrega.

## 7. Aplicar únicamente la reconciliación de aforo revisada y verificar

Después de revisar expresamente el archivo anterior, usar el UID real de un administrador y escribir el hash aprobado; no copiar ciegamente el hash de otro informe.

```powershell
$revisorFocus = Read-Host 'UID del administrador que ha revisado la auditoría de aforo'
$hashAforoFocus = Read-Host 'reportHash aprobado del informe de aforo'
node scripts/reconcile-slot-occupancy.cjs --mode apply --confirm-project $proyectoFocus --reviewed-report $informeAforoFocus --approved-report-hash $hashAforoFocus --reviewer-uid $revisorFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/reconcile-slot-occupancy.cjs --mode verify --confirm-project $proyectoFocus --reviewed-report $informeAforoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
```

Los bloques de hasta 400 escrituras tienen recibos inmutables con hash de operaciones, informe, revisor y época. Se comprueban la pertenencia y versiones de las fuentes, la configuración y la imagen anterior de cada contador. Un reintento valida lo ya confirmado y continúa sin sumar de nuevo. No cambia citas ni bonos. La verificación exige coincidencia exacta, recibos completos, cola vacía y ninguna operación activa; entonces marca `occupancyVersion: 2` y su época verificada. Cerrar otra ventana o recuperar otro evento invalida la verificación anterior.

Si llegan eventos después de auditar, recuperar la cola y volver a verificar. Si cambian las evidencias, generar **otro informe**, revisarlo, aplicarlo y verificarlo, manteniendo el cierre. No reutilizar un informe alterado ni una verificación de una época anterior.

## 8. Comprobar y reabrir con la compensación automática desactivada

```powershell
node scripts/release-controls.cjs verify-before-open --project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs maintenance-open --confirm-project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
```

La reapertura exige todas las versiones definitivas, índices, Hosting, reglas, cola vacía, ninguna operación activa y auditoría verificada en la época actual. No activa devoluciones. Con el flag desactivado las solicitudes nuevas y los recibos siguen registrándose transaccionalmente; las restituciones ordinarias siguen funcionando y los extras quedan pendientes sin perderse.

Comprobar con cuentas de prueba autorizadas: una reserva pendiente individual y una serie ocupan plaza desde el principio; aprobar mantiene el contador; mover actualiza las franjas; cancelar o eliminar libera una vez. Comprobar un aforo especial, un solapamiento de 45 minutos y la confirmación administrativa de una excepción. No usar los dos históricos como prueba. Las pruebas con escrituras reales de aceptación solo se realizan cuando el operador las autorice dentro de esta fase; los emuladores ya cubren estos recorridos.

## 9. Publicar Android e iOS con la misma versión

Se puede preparar la distribución antes de la ventana, pero no activar mínimos ni extras automáticos antes de que **ambas tiendas** sirvan la versión corregida. Mantener el contrato de las versiones antiguas: payloads existentes, nombres de callable, región y contadores públicos `{date,time,count}`; los campos financieros nuevos son aditivos. Una app antigua conserva las operaciones compatibles y recibe el bloqueo del servidor durante el mantenimiento. Sus pantallas no reflejan toda la separación nueva de extras: por eso los extras automáticos siguen desactivados hasta la actualización obligatoria.

Android, en PowerShell, con firma de producción configurada:

```powershell
Push-Location -LiteralPath '../app_focus_club'
try {
    flutter pub get
    Comprobar-Focus
    flutter analyze
    Comprobar-Focus
    flutter test
    Comprobar-Focus
    flutter build appbundle --release --build-name=1.5.2 --build-number=22
    Comprobar-Focus
} finally { Pop-Location }
```

Subir `app_focus_club/build/app/outputs/bundle/release/app-release.aab` a Google Play Console, completar sus comprobaciones y publicar de forma manual. No confundir subir una versión a pruebas con disponibilidad pública.

iOS, en un Mac con Xcode, firma y perfiles de distribución; copiar la misma revisión de `app_focus_club`. Comandos de terminal de macOS:

```bash
cd /ruta/a/app_focus_club
flutter pub get && flutter analyze && flutter test && flutter build ipa --release --build-name=1.5.2 --build-number=22
```

Subir el IPA de `build/ios/ipa` con Transporter o el archivo de Xcode Organizer a App Store Connect y publicar manualmente. Verificar en dispositivos Android e iOS: acceso, actualización obligatoria, mantenimiento, reserva pendiente, cambio de horario, cancelación y tarjeta de bono con capacidad efectiva. En este equipo Windows no se ha compilado ni firmado un IPA ni se ha verificado la disponibilidad de tiendas.

## 10. Exigir la actualización solo después de verificar ambas tiendas

Comprobar que las URLs de tienda existentes son HTTPS y abren las versiones correctas. El comando registra la confirmación expresa del operador, exige el build común del manifiesto y no permite reducir mínimos anteriores.

```powershell
node scripts/release-controls.cjs set-minimum-builds --confirm-project $proyectoFocus --manifest release/manifest.json --android-build 22 --ios-build 22 --stores-verified
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
```

No adelantar este paso mientras una tienda esté pendiente de revisión, propagación o pruebas. Las apps de clientes con build inferior deberán mostrar la actualización obligatoria antes de usar las pantallas económicas nuevas. Verificar también que una app actualizada permite entrar.

## 11. Activar devoluciones automáticas en una acción posterior autorizada

Este comando queda preparado. **No forma parte de la ejecución de despliegue ni de la autorización para preparar código.** Ejecutarlo únicamente cuando se autorice expresamente la activación después de comprobar los pasos anteriores.

```powershell
node scripts/release-controls.cjs enable-automatic-refunds --confirm-project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
```

Activar despierta deuda nueva elegible; no autoriza deuda histórica. El trabajador vuelve a leer el flag dentro de la transacción de abono. Los trabajos se agrupan por cliente, procesan como máximo 25 devoluciones y solo continúan si queda trabajo elegible. Una espera sin bono queda dormida; consumos y escrituras de historial no la despiertan. Los errores transitorios conservan el siguiente intento con espera creciente y las inconsistencias quedan bloqueadas. La ejecución horaria existente recupera como máximo 50 clientes con trabajo debido; con el flag apagado omite esa recuperación.

## 12. Volver a auditar y revisar los dos históricos antes de compensarlos

La auditoría completa entregada es `release/refund-audit-2026-11-18-final.json`. Su hash canónico es `d963da61fc7083efa6dec80513e7fea3a939bdadec9aa5e77b8ae664ff83f217`. Ver `release/auditoria-historica.md` para el detalle. Ambos casos muestran un descuento real de 60 minutos, abono comprobado de cero y deuda de 60. No hay incidencias en la reconstrucción disponible.

| Cita | Bono observado | Saldo observado el 18/11 | Saldo previsto al abonar | Capacidad prevista |
|---|---|---:|---:|---:|
| `gx7ntDqQEukKIg8VRbXU` | `20fda9f1-c666-41ed-aad5-c5a1054f06eb` | 90 | 150 | 300 = 240 contratados + 60 recuperados |
| `pIseaJtxMLx3Ms2iaDib` | `7a8f6aeb-9b1c-4318-9f01-d64321a5309e` | 0 | 60 | 300 = 240 contratados + 60 recuperados |

Los saldos 120 y 180 del informe anterior cambiaron; no utilizarlos para ajustar saldos. El segundo receptor observado está agotado y podrá reactivarse solo si sigue siendo el más reciente, vigente y sin sustituto. Los resultados de la tabla son una previsión y se vuelven a comprobar.

Después de la publicación y la activación autorizada, obtener un informe nuevo, sin escritura:

```powershell
$marcaRefundFocus = Get-Date -Format 'yyyyMMdd-HHmmss'
$informeRefundFocus = "release/refund-audit-$marcaRefundFocus.json"
node scripts/reconcile-minute-refunds.cjs --mode audit --project $proyectoFocus --appointment-ids 'gx7ntDqQEukKIg8VRbXU,pIseaJtxMLx3Ms2iaDib' --out $informeRefundFocus
Comprobar-Focus
Get-Content -Raw -LiteralPath $informeRefundFocus
```

**PARAR PARA REVISAR EXPRESAMENTE ESTE INFORME.** Confirmar descuentos, importes abonados, compensaciones posteriores, reconstrucción, documentos, versiones, destino y previsión. Si hay cambios o alguna compensación previa, abortar y revisar; no forzar el saldo. El modo `apply` exige revisión por un administrador, proyecto explícito y hash exacto. La aprobación de todos los casos de un informe es atómica: un cambio en el segundo no importa el primero. También detecta nuevos bonos y documentos financieros posteriores al informe. Repetir un informe ya importado reconoce sus recibos, sin duplicar abonos.

Solo tras esa revisión y autorización expresa:

```powershell
$revisorRefundFocus = Read-Host 'UID del administrador que ha aprobado expresamente los históricos'
$hashRefundFocus = Read-Host 'reportHash aprobado del informe histórico nuevo'
node scripts/reconcile-minute-refunds.cjs --mode apply --project $proyectoFocus --confirm-project $proyectoFocus --reviewed-report $informeRefundFocus --approved-report-hash $hashRefundFocus --reviewer-uid $revisorRefundFocus
Comprobar-Focus
```

La aplicación importa la aprobación y corrige mediante referencias auditadas los historiales engañosos; no edita saldos directamente. El motor común compensa posteriormente bajo el flag, con destino revalidado, extras, saldo e importe pendiente confirmados en una transacción. Un cambio de destino o un error económico puede dejar la deuda en revisión, conservada. No seleccionar manualmente otro bono ni usar `+30/+45` para estos casos.

## 13. Comprobaciones finales y recuperación

En `/admin/devoluciones`, revisar los dos recibos, importes solicitados/abonados/pendientes, destino, movimientos y referencias al informe. Las incidencias resueltas deben dejar de contar en pendientes y en estadísticas; las de citas eliminadas deben seguir contando mientras exista deuda. Esperar bono es información, no una falsa incidencia económica. Verificar `solicitados = abonados + pendientes`, saldo no superior a capacidad efectiva, contrato sin cambios y un único asiento por abono.

```powershell
node scripts/release-controls.cjs verify-release --project $proyectoFocus --manifest release/manifest.json
Comprobar-Focus
node scripts/release-controls.cjs status --project $proyectoFocus
Comprobar-Focus
```

Procedimiento ante fallos, sin perder la evidencia:

1. **Fallo de una tanda, Hosting, reglas o índice:** detenerse. Conservar el cierre. Corregir la causa y repetir la etapa o la tanda exacta de máximo cinco; nunca un despliegue global. No abrir con mezcla de versiones. Regenerar el manifiesto si se cambia el código y revisar de nuevo sus artefactos.
2. **Fallo de reconciliación después de algunas escrituras:** conservar informe, hash, época y recibos. Repetir el mismo `--mode apply` con los mismos parámetros revisados. Los bloques confirmados se validan y no se suman dos veces. Si cambió una fuente o contador, el informe se rechaza: generar otro durante el cierre, revisarlo, aplicar las diferencias y verificar. Un fallo no marca versión lista ni reabre automáticamente.
3. **Fallo de recuperación de eventos:** revisar el trabajo y su error. Tras corregir la causa, `drain-deferred` admite `--retry-reviewed`. Una ejecución interrumpida requiere revisar que terminó, esperar su concesión de 11 minutos —el manejador limita su ejecución a 9— y usar también `--retry-expired`. No borrar trabajos ni poner el contador de cola a cero. Después repetir verificación; si cambian fuentes, nueva auditoría.
4. **Operación admitida que no liberó su registro:** no abrir ni borrarlo por antigüedad. `resolve-completed-operation` exige un registro estructurado `handler_finished` en Cloud Logging correspondiente al ID exacto. Sin esa prueba se mantiene el cierre y se investiga la ejecución.
5. **Incidencia después de activar extras:** desactivar el flag con el comando siguiente. Las nuevas devoluciones ordinarias y el registro de deuda continúan. Si afecta a aforo o integridad, cerrar mantenimiento otra vez; la época nueva obliga a auditar/aplicar/verificar antes de reabrir.
6. **Tienda móvil pendiente:** mantener flag apagado y mínimos anteriores hasta disponer de ambas versiones. No revertir contadores a “solo aprobadas” ni reducir la capacidad efectiva para acomodar una pantalla antigua.
7. **Reversión:** conservar la versión con bloqueo y contabilidad permanente. No desplegar un backend antiguo sobre ocupación v2 ni restaurar contadores o saldos de una copia sin conciliación. Reparar hacia delante durante el cierre. Los recibos financieros y las deudas no se borran como parte de una recuperación.

Comandos de recuperación, cada uno solo en el supuesto descrito:

```powershell
node scripts/release-controls.cjs disable-automatic-refunds --confirm-project $proyectoFocus
Comprobar-Focus
node scripts/release-controls.cjs maintenance-close --confirm-project $proyectoFocus --manifest release/manifest.json --wait
Comprobar-Focus
```

```powershell
# Solo después de revisar y corregir el trabajo fallido:
node scripts/release-controls.cjs drain-deferred --confirm-project $proyectoFocus --manifest release/manifest.json --retry-reviewed
Comprobar-Focus
# Solo si además una recuperación terminó interrumpida y venció su concesión:
node scripts/release-controls.cjs drain-deferred --confirm-project $proyectoFocus --manifest release/manifest.json --retry-reviewed --retry-expired
Comprobar-Focus
```

```powershell
# Solo con prueba de finalización del ID exacto en Cloud Logging:
$operacionFocus = Read-Host 'ID de la operación cuya finalización se ha revisado'
node scripts/release-controls.cjs resolve-completed-operation --confirm-project $proyectoFocus --manifest release/manifest.json --operation-id $operacionFocus
Comprobar-Focus
node scripts/release-controls.cjs maintenance-close --confirm-project $proyectoFocus --manifest release/manifest.json --wait
Comprobar-Focus
```

La desactivación del flag no necesita un manifiesto intacto para poder detener extras en una incidencia. No elimina deudas, recibos ni trabajos. Ningún script de despliegue activa el flag, cambia mínimos, abre mantenimiento ni importa históricos por sí mismo.

## Resultados de la preparación

Los resultados reales y su ámbito se conservan en `release/test-results.json`. Las auditorías son de lectura y no equivalen a una prueba de las tiendas o a una autorización de aplicación. La aceptación en dispositivos y la disponibilidad pública de Android/iOS son comprobaciones operativas pendientes del paso 9. Esta entrega prepara el procedimiento; no ejecuta ninguno de sus pasos con escritura en producción.
