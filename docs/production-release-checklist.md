# Checklist de publicación a producción: notificaciones

Este documento está igual en `web_focus_club/docs/` y en `app_focus_club/docs/`. Cubre la publicación del sistema de notificaciones al cliente (contrato en `web_focus_club/docs/notifications-contract.md`) y el endurecimiento previo a producción.

- **Proyecto Firebase:** `focus-club-f73b8` · **Región:** `europe-west1`
- **Codebases de Functions:**
  - `default` (`web_focus_club/functions`, Node 20): todo el backend.
  - `portal` (`app_focus_club/functions`, Node 22): solo `deleteOwnAccount`.
- **Fuente de verdad** de reglas e índices: `web_focus_club`. Los `predeploy` de `app_focus_club/firebase.json` bloquean su despliegue desde la app.
- **Estado (05/10/2026):** los pasos 2.1, 2.2 y 2.3 (incluido 2.3.b) están **desplegados y validados**. `firebase functions:list` muestra 49 funciones y los únicos secretos enlazados son `BREVO_API_KEY` y `GOOGLE_CALENDAR_ID`. Antes, producción ejecutaba `98bc5ec` (tag `pre-notifications-prod`), así que el despliegue incluyó también la migración de emails a Brevo.
- **Sistema de notificaciones:** Brevo (email) + FCM (push) + Firestore (historial y entregas), sin integraciones externas adicionales. Los secretos que quedan de la integración anterior se borran en 2.9.
- **Pendientes:** 2.2.b (permiso de borrado del historial), 2.4, 2.5 (opcional), 2.7, 2.8 (aplazado) y 2.9.
- **Versión de la app que se publica:** `1.4.5+15` (ver 0.3).
- **Fuera del despliegue inicial:** las reglas de Storage (ver 2.8).

> Todo lo de este documento es **manual**. Nada se despliega ni se publica de forma automática al hacer push.

### Cómo usar los comandos

- Todos los bloques están pensados para **PowerShell 7** en Windows. También funcionan en bash salvo donde se indica.
- Los valores que tienes que rellenar van en variables al principio del bloque (`$commit = 'COMMIT_SHA'`). No uses `<...>`: en PowerShell `<` es un operador.
- Las listas separadas por comas (`--only "a,b"`) van **entre comillas**. Sin comillas, PowerShell las convierte en un array y el CLI recibe un argumento distinto.
- **Ningún comando de este documento muestra valores de secretos.** No ejecutes `firebase functions:secrets:access` ni imprimas `key.properties`, claves de cuentas de servicio, `google-services.json` o `GoogleService-Info.plist` en terminales compartidos o capturas.

## 0. Antes de empezar

### 0.1 Requisitos externos

- [x] **APNs:** clave de autenticación configurada y verificada en Firebase para desarrollo y producción (04/10/2026).
- [ ] **Apple Developer:** el App ID `es.focusclub.clientes.appFocusClub` tiene activada la capability *Push Notifications*, y el perfil de distribución la incluye. La configuración Release usa `RunnerRelease.entitlements` (`aps-environment = production`).
- [x] **Brevo, inmediatamente antes de 2.3:**
  - el remitente `info@focusclub.es` sigue **verificado** en el panel de Brevo. Con este despliegue, todos los emails de la web (cliente, admin, contacto y bienvenida) salen por Brevo;
  - el secreto `BREVO_API_KEY` tiene una versión `ENABLED`. Este comando muestra solo metadatos, nunca el valor:

    ```powershell
    firebase functions:secrets:get BREVO_API_KEY
    firebase functions:secrets:get GOOGLE_CALENDAR_ID
    ```

- [x] **Plan Blaze:** facturación activa. Cloud Scheduler se habilita al desplegar los schedulers.
- [ ] **Firma Android:** el keystore de release y `android/key.properties` están en la máquina que genera el AAB. No están en el repo y no se deben abrir ni imprimir. Para comprobar que existen:

  ```powershell
  Test-Path android/key.properties
  ```

### 0.2 Copia de seguridad y punto de retorno

- [x] **Backup local de Firestore**, verificado: `C:\Users\david\Archivos\AA_Clientes\focus_db_backup\2026-10-04_20-38-41` (5.967 documentos). Para repetirlo justo antes de desplegar (desde `focus_db_backup\_tools`, ver su `README.md`):

  ```powershell
  $key = 'RUTA\A\LA\CLAVE-DE-CUENTA-DE-SERVICIO.json'
  node firestore-backup.mjs estimate --key $key
  node firestore-backup.mjs export --confirm --key $key
  ```

- [x] **Tag de rollback** `pre-notifications-prod` → `98bc5ec`, el commit que ejecuta producción. Se identificó comparando los exports y los secretos de `firebase functions:list` con el historial. Para comprobarlo (en `web_focus_club`):

  ```powershell
  git rev-parse --short 'pre-notifications-prod^{commit}'
  git ls-remote --tags origin pre-notifications-prod
  ```

- [x] **Reglas de Firestore desplegadas:** coinciden con `firestore.rules` del tag `pre-notifications-prod`. El historial de Firebase Console también permite restaurarlas.
- [ ] Anotar qué se está ejecutando justo antes de cada despliegue:

  ```powershell
  firebase functions:list
  ```

  Antes de 2.3 había 41 funciones. Hoy se esperan 49: entre ellas `adminRestoreSuggestion` y `deleteOwnAccount` (codebase `portal`), y ya no `onAppointmentStatusPushNotification`.

### 0.3 Versión y build number

Las builds **14** (`1.4.4`) están publicadas en las dos tiendas: `site_config/main` tiene `minAndroidBuild = 14` y `minIosBuild = 14`. Por eso esta publicación usa `1.4.5+15`:

- **Android:** `versionName 1.4.5`, `versionCode 15`.
- **iOS:** `CFBundleShortVersionString 1.4.5`, `CFBundleVersion 15`.

- [ ] Comprobar la versión del repo (en `app_focus_club`):

  ```powershell
  Select-String -Path pubspec.yaml -Pattern '^version:'
  ```

  Debe mostrar `version: 1.4.5+15`.
- [ ] Tras `flutter build appbundle --release`, comprobar lo que ha usado Gradle:

  ```powershell
  Select-String -Path android/local.properties -Pattern 'flutter.version'
  ```

  Debe mostrar `flutter.versionName=1.4.5` y `flutter.versionCode=15`.
- [ ] En macOS, tras `flutter build ipa --release`, comprobar la versión de iOS (bash):

  ```bash
  grep FLUTTER_BUILD_ ios/Flutter/Generated.xcconfig
  ```

  Debe mostrar `FLUTTER_BUILD_NAME=1.4.5` y `FLUTTER_BUILD_NUMBER=15`.
- [ ] Play Console y App Store Connect aceptan `15` (mayor que cualquier build subida antes). Si ya se hubiera subido una build 15, sube el número en `pubspec.yaml` antes de compilar.
- [ ] **No subir `minAndroidBuild` / `minIosBuild` a 15** hasta que la build 15 esté aprobada y publicada al 100 % en **las dos** tiendas. Subirlo obliga a actualizar a todos los clientes. Las builds 14 siguen siendo compatibles con el backend nuevo, así que no hace falta forzar la actualización.

## 1. Verificaciones locales (las dos ramas)

**`web_focus_club`:**

```powershell
npm ci
npm run lint
npm test
npm run build
npm --prefix functions ci
npm --prefix functions test
```

**`app_focus_club`:**

```powershell
flutter pub get
flutter analyze
flutter test
flutter build appbundle --release
npm --prefix functions ci
npm --prefix functions test
```

- [ ] Todo pasa en verde.
- [ ] `npm --prefix functions test` (web) incluye `deployGuards.test.cjs`: los 10 índices compuestos de producción siguen en `firestore.indexes.json` y el filtro de despliegue cubre todos los exports.
- [ ] `npm --prefix functions test` (app) imprime `[check-exports] OK: deleteOwnAccount`.
- [ ] El build de iOS se genera en macOS con `flutter build ipa --release`. Comprobar en Xcode (Signing & Capabilities, Release) que aparece Push Notifications con entorno *production*.

## 2. Orden de despliegue

Cada paso se hace solo cuando el anterior está verificado. Todos los comandos de los pasos 2.1 a 2.4 y 2.6 se lanzan desde `web_focus_club`.

### 2.1 Índices de Firestore: hecho

```powershell
firebase deploy --only firestore:indexes
```

- `firestore.indexes.json` contiene los 10 índices compuestos que ya existen en producción, más los `fieldOverrides` nuevos de `fcmTokens.token` y `fcmTokens.updatedAt` con alcance de grupo de colecciones (los usan `onFcmTokenWritten` y `pruneStaleFcmTokensScheduled`).
- **No se espera ninguna propuesta de borrado.** Si el CLI propone borrar algún índice, responde **No** y revisa el fichero.
- [x] En Firebase Console > Firestore > Índices > Exenciones de campo única, los dos overrides aparecen como **Habilitado** (no "Compilando").

### 2.2 Reglas de Firestore (Storage **no**): hecho

```powershell
firebase deploy --only firestore:rules
```

- Añade `users/{uid}/notifications` (lectura del propietario y solo `read`/`readAt` escribibles) y protege `notificationOperationId` en las citas recurrentes. El resto es igual a lo desplegado.
- **No uses `--only firestore`, `storage` ni `firebase deploy` sin filtro:** las reglas de Storage quedan fuera (ver 2.8).
- [x] Prueba rápida: un cliente con la app actual abre el perfil sin errores de permisos.

**2.2.b Permiso para borrar el historial propio.** Pendiente. La app permite eliminar una notificación (deslizar a la izquierda) o vaciar todas. Para eso, `firestore.rules` añade en `users/{uid}/notifications` la línea `allow delete: if isVerified() && request.auth.uid == uid;`. `create` sigue en `false`, y los registros del backend (`notification_deliveries`, `notification_outbox`, `email_dispatches`, `push_dispatches`) siguen sin acceso desde los clientes.

```powershell
firebase deploy --only firestore:rules
```

- Hasta desplegarlo, eliminar desde la app devuelve `permission-denied`: la lista se restaura y se muestra un aviso, sin perder datos.
- [ ] Con una cuenta de prueba: eliminar una notificación, cancelar un deslizamiento y vaciar todas; tras cerrar y abrir la app, lo borrado no vuelve. En Firestore, `notification_deliveries` de esa cuenta sigue intacto.

### 2.3 Functions del backend (codebase `default`), con filtro: hecho

Un `firebase deploy --only functions` sin filtro propondría borrar **dos** funciones en una sola pregunta: `onAppointmentStatusPushNotification` y `adminRestoreSuggestion`. Como se decidió **conservar `adminRestoreSuggestion`**, el despliegue se hace con un filtro que lista exactamente las funciones del código. Con filtro, el CLI **no propone borrar nada**. La función antigua de push se retira después, de forma explícita.

```powershell
npm --prefix functions test
$only = node functions/scripts/deploy-filter.cjs
($only -split ',').Count     # 47 funciones
firebase deploy --only "$only"
```

- Funciones nuevas esperadas (9):
  - `onAppointmentCustomerNotification`
  - `onNotificationOutboxCreated`
  - `onBonoCustomerNotification`
  - `onFcmTokenWritten`
  - `bonoExpiryWarningsScheduled`
  - `expireOverdueBonosScheduled`
  - `appointmentRemindersScheduled`
  - `retryNotificationDeliveriesScheduled`
  - `pruneStaleFcmTokensScheduled`
- Se actualizan las 38 restantes del codebase `default`.
- **Si a pesar del filtro el CLI propone borrar alguna función, responde No y aborta.** No uses `--force`.
- [x] `firebase functions:list` muestra 50 funciones:
  - las 9 nuevas;
  - `adminRestoreSuggestion` y `onAppointmentStatusPushNotification`, que siguen ahí;
  - `deleteOwnAccount` (Node 22, `portal`).
- [ ] Cloud Scheduler muestra los 5 jobs en `Europe/Madrid`:

  ```powershell
  gcloud scheduler jobs list --location europe-west1 --project focus-club-f73b8
  ```

**2.3.b Retirar la función antigua de push.** Hazlo **justo después** de comprobar que `onAppointmentCustomerNotification` está `ACTIVE`. Mientras convivan las dos, un cambio de cita puede generar dos push.

```powershell
firebase functions:delete onAppointmentStatusPushNotification --region europe-west1
```

- El CLI pide confirmación y lista **solo** esa función. Comprueba el nombre antes de aceptar.
- [x] `firebase functions:list` muestra 49 funciones: `adminRestoreSuggestion` y `deleteOwnAccount` siguen ahí y `onAppointmentStatusPushNotification` ya no.

### 2.4 Hosting de la web (panel admin)

```powershell
npm run build
firebase deploy --only hosting
```

- Se publica después de las functions. El recálculo masivo de caducidades marca sus escrituras con `notificationBulkOperationId`, y el backend nuevo ya las trata como "solo historial".
- [ ] El diálogo "Recalcular caducidad" avisa de que los clientes lo verán solo en el historial.

### 2.5 Functions del móvil (codebase `portal`). Opcional

Solo para incluir la limpieza de `notification_deliveries` en `deleteOwnAccount`. Desde `app_focus_club`:

```powershell
npm --prefix functions test
npm --prefix functions run deploy
```

- Despliega solo `functions:portal:deleteOwnAccount`. Los `predeploy` compilan y ejecutan `check-exports`.
- Si el CLI propone borrar alguna función, responde **No**: el codebase `portal` solo es dueño de `deleteOwnAccount`.
- `firebase deploy` sin filtros desde `app_focus_club` falla a propósito en `firestore`/`storage` (`[deploy-guard]`).

### 2.6 Verificaciones en producción (con una cuenta de prueba)

- [ ] **Cita:** crear una cita desde la app.
  - Llega "Solicitud de cita recibida" (push, historial y email desde `info@focusclub.es`).
  - En los logs aparece `[Notify] Delivered`:

    ```powershell
    firebase functions:log --only onAppointmentCustomerNotification
    ```

- [ ] **Confirmación:** aprobarla desde el admin. Llega "Cita confirmada" **una sola vez**, lo que confirma que la función antigua de push ya no existe.
  - Si la cita es dentro de menos de 24 h, el recordatorio no llega justo después: tarda al menos 6 h o no llega.
- [ ] **Brevo:** llegan el email de la cita al cliente y el aviso al admin. Si se puede, probar también el formulario de contacto.
- [ ] **Cancelación:**
  - Una cita con minutos devueltos: el aviso menciona la devolución.
  - Una cita sin bono: el aviso no la menciona.
- [ ] **Android:** el push suena y aparece en el canal "Focus Club" (Ajustes > Notificaciones de la app).
- [ ] **iOS:** con una build de TestFlight, el push llega con sonido.
- [ ] **Tokens:**
  - Desactivar el push en Perfil borra el documento del token.
  - Cerrar sesión con la cuenta A e iniciar con B en el mismo móvil: el documento del token desaparece de `users/A/fcmTokens` (los logs de `onFcmTokenWritten` lo confirman si quedaba alguno).
- [ ] **Bonos:**
  - Renovar el bono de un cliente de prueba solo envía "Tu bono se ha renovado".
  - En la siguiente pasada horaria, el bono antiguo no genera "Tu bono ha caducado".
- [ ] **Reintentos:** en los logs de `retryNotificationDeliveriesScheduled` no aparecen errores de índice (`FAILED_PRECONDITION`):

  ```powershell
  firebase functions:log --only retryNotificationDeliveriesScheduled
  ```

- [ ] **Borrado de cuenta:** borrar desde el admin un usuario de prueba.
  - No quedan `users/{uid}/notifications` ni `fcmTokens`.
  - No quedan documentos de ese `uid` en `notification_deliveries`.

### 2.7 Apps móviles (`1.4.5+15`)

Solo cuando 2.2, 2.2.b y 2.3 estén verificados. Sin 2.2.b, la build nueva no puede eliminar notificaciones (muestra un aviso y conserva la lista).

- [ ] **Android:** subir el AAB a la pista interna, probar, y pasar a producción con lanzamiento escalonado (por ejemplo, 20 %).
- [ ] **iOS:** subir el IPA a TestFlight, probar el push real y publicar con lanzamiento por fases.
- [ ] Cuando la build 15 esté al 100 % en las dos tiendas, decidir si se sube `minAndroidBuild`/`minIosBuild` (ver 0.3). Es opcional.
- Las versiones antiguas de la app siguen funcionando:
  - navegan con `type` cuando el push no trae `route`;
  - ignoran el `channelId` si no tienen el canal;
  - no ven el historial hasta que se actualizan.

### 2.8 Reglas de Storage: **aplazadas** (fuera del despliegue inicial)

- **Bloqueo:**
  - Las reglas del repo limitan los avatares (`user-avatars/{uid}/*`) a 5 MB.
  - Ya existe un avatar de 10,27 MB, y ni la web (`uploadUserAvatar`) ni la app (`imagePicker` con `imageQuality: 88`, sin reducir la resolución) redimensionan antes de subir.
  - Con esas reglas fallarían subidas que hoy funcionan.
- **Compatibilidad revisada:**
  - Las rutas en uso son compatibles: `media/root/*` (subida, movimiento y borrado, admin; el mayor archivo actual pesa 7,13 MB, por debajo de 50 MB), `user-avatars/{uid}/*` y `public/*` (solo lectura).
  - Los borrados de avatares antiguos que se rechacen se ignoran sin error.
- **Antes de desplegarlas** hay que redimensionar o comprimir los avatares en la web y la app por debajo de 5 MB, o subir el límite en `storage.rules`, y añadir tests.
- El primer despliegue de esas reglas pedirá conceder al agente de Storage acceso de lectura a Firestore, porque usan `firestore.get`.
- Cuando estén listas:

  ```powershell
  firebase deploy --only storage
  ```

  Comprobar después la subida de un avatar desde la web y desde la app, y la subida de un archivo en el panel de medios.

### 2.9 Retirada definitiva de la integración de email anterior

Ninguna función desplegada usa ya estos secretos; el código y la documentación ya no los contienen. Borrarlos es manual e irreversible.

- [ ] **Secretos de Firebase**: confirmar que ninguna función los enlaza. En la salida de `functions:list` solo deben aparecer `BREVO_API_KEY` y `GOOGLE_CALENDAR_ID`:

  ```powershell
  firebase functions:list --json | Select-String -Pattern 'MAKE_|RESEND_'
  ```

  No debe imprimir nada. Después, borrarlos uno a uno (el CLI pide confirmación). No uses `functions:secrets:prune --force`, que borra sin preguntar.

  ```powershell
  firebase functions:secrets:destroy MAKE_WEBHOOK_URL
  firebase functions:secrets:destroy MAKE_WELCOME_WEBHOOK_URL
  firebase functions:secrets:destroy MAKE_RESERVATION_WEBHOOK_URL
  firebase functions:secrets:destroy RESEND_API_KEY
  ```

- [ ] **Make:**
  - desactivar y borrar los escenarios que recibían los webhooks de citas, bienvenida y reserva;
  - borrar sus webhooks y las conexiones que usaban (correo, Firestore u otras);
  - borrar cualquier escenario de reseñas de Google, si llegó a crearse;
  - cancelar el plan si ya no se usa.
- [ ] **Resend:**
  - revocar todas las API keys;
  - eliminar el dominio y sus registros DNS de Resend (DKIM/SPF/MX con `resend`), **sin tocar** los de Brevo (`brevo-code`, DKIM de Brevo, SPF con `sendinblue`/`brevo`);
  - cerrar la cuenta.
- [ ] **IAM:** en Google Cloud > IAM, eliminar cualquier cuenta de servicio o clave creada para Make, si existe.
- [ ] Tras borrar, enviar un email de prueba (formulario de contacto) y confirmar que llega por Brevo.

## 3. Rollback

Hay que deshacer los pasos en orden inverso y solo lo necesario. Las apps nuevas son compatibles con el backend anterior: navegan con `type` y, sin historial, muestran el error controlado.

| Paso | Cómo revertir | Notas |
|---|---|---|
| 2.7 Apps | **Play Console:** detener el lanzamiento escalonado. **App Store Connect:** pausar el lanzamiento por fases. Publicar después la versión anterior con un build number mayor (16 o superior). | No se puede "despublicar" una versión ya instalada. No subir `minAndroidBuild`/`minIosBuild` si hay rollback. |
| 2.5 Functions `portal` | Ver bloque A. | Sin `--force`. Ese commit todavía exporta las callables antiguas: usa el filtro de función exacto. |
| 2.4 Hosting | Firebase Console > Hosting > historial de versiones > **Revertir** a la versión anterior. | Instantáneo. |
| 2.3 Functions `default` | **Corte rápido de avisos:** ver bloque B. **Volver a una versión anterior:** ver bloque C. | Solo se vuelve a commits con Brevo. Los anteriores a la migración ya no se pueden desplegar porque su integración de email está retirada (2.9). `adminRestoreSuggestion` no se toca. |
| 2.2 / 2.2.b Reglas | Firebase Console > Firestore > Reglas > historial > restaurar la versión anterior. O ver bloque D. | Sin el permiso de 2.2.b, la app no puede borrar avisos y conserva la lista. Sin la regla de `notifications`, la app muestra error en el historial, sin cerrarse. |
| 2.1 Índices | No hace falta revertirlos: los índices compuestos ya existían y los overrides de un solo campo no afectan a nada más. | |
| Datos | Las colecciones nuevas (`notification_deliveries`, `notification_outbox`, `push_dispatches`, `email_dispatches`, `users/*/notifications`) no las lee el código anterior y pueden quedarse. | El backup local de 0.2 es el último recurso; no restaurar sobre datos vivos sin revisar. |

**A. Functions `portal`** (en `app_focus_club`):

```powershell
git switch --detach 8429862
npm --prefix functions ci
firebase deploy --only "functions:portal:deleteOwnAccount"
git switch main
```

**B. Corte rápido de avisos** (en `web_focus_club`):

```powershell
firebase functions:delete onAppointmentCustomerNotification onBonoCustomerNotification onNotificationOutboxCreated --region europe-west1
```

**C. Volver a una versión anterior de las functions `default`** (en `web_focus_club`). `$commit` es un commit de `main` ya validado con Brevo (por ejemplo `2495824`, el desplegado en 2.3). El filtro evita propuestas de borrado:

```powershell
$commit = 'COMMIT_SHA'
git switch --detach $commit
npm --prefix functions ci
$only = node functions/scripts/deploy-filter.cjs
firebase deploy --only "$only"
git switch main
```

**D. Reglas de Firestore de un commit anterior** (en `web_focus_club`; por ejemplo `2495824`, las desplegadas en 2.2):

```powershell
$commit = 'COMMIT_SHA'
git switch --detach $commit
firebase deploy --only firestore:rules
git switch main
```

## 4. Referencia rápida de comandos que **no** se deben usar

- `firebase deploy --only functions` **sin filtro** en `web_focus_club`: propondría borrar `adminRestoreSuggestion`, que se conserva. Usa siempre `functions/scripts/deploy-filter.cjs`.
- `firebase deploy` sin `--only`, `--only firestore` o `--only storage` mientras Storage esté aplazado (2.8).
- `firebase deploy` sin `--only` desde `app_focus_club`: se bloquea, pero no hay que intentarlo.
- `firebase deploy --force` en cualquier repo: borra funciones sin preguntar.
- `firebase functions:delete deleteOwnAccount` o `adminRestoreSuggestion`: la primera la usa la app para "Eliminar cuenta" (requisito de las tiendas); la segunda se conserva por precaución.
- `firebase functions:secrets:access ...`: imprime el valor del secreto. Para comprobar un secreto basta con `firebase functions:secrets:get`.
- `--only a,b` sin comillas en PowerShell: la coma convierte el valor en un array.
