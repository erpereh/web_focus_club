# Checklist de publicación a producción: notificaciones

Este documento está igual en `web_focus_club/docs/` y en `app_focus_club/docs/`. Cubre la publicación del sistema de notificaciones al cliente (contrato en `web_focus_club/docs/notifications-contract.md`) y el endurecimiento previo a producción.

- **Proyecto Firebase:** `focus-club-f73b8` · **Región:** `europe-west1`
- **Codebases de Functions:**
  - `default` (`web_focus_club/functions`, Node 20): todo el backend.
  - `portal` (`app_focus_club/functions`, Node 22): solo `deleteOwnAccount`.
- **Fuente de verdad** de reglas, índices y storage: `web_focus_club`. Los `predeploy` de `app_focus_club/firebase.json` bloquean su despliegue desde la app.
- **Versión de la app que se publica:** `1.4.5+15` (ver apartado 0.3).

> Todo lo de este documento es **manual**. Nada se despliega ni se publica de forma automática al hacer push.

### Cómo usar los comandos

- Todos los bloques están pensados para **PowerShell 7** en Windows. También funcionan en bash salvo donde se indica.
- Los valores que tienes que rellenar van en variables al principio del bloque (`$commit = 'COMMIT_SHA'`). No uses `<...>`: en PowerShell `<` es un operador.
- Las listas separadas por comas (`--only "firestore:rules,storage"`) van **entre comillas**. Sin comillas, PowerShell las convierte en un array y el CLI recibe un argumento distinto.
- **Ningún comando de este documento muestra valores de secretos.** No ejecutes `firebase functions:secrets:access` ni imprimas `key.properties`, `google-services.json` o `GoogleService-Info.plist` en terminales compartidos o capturas.

## 0. Antes de empezar

### 0.1 Pendientes manuales (bloquean la publicación)

- [ ] **APNs:** subir la clave de autenticación APNs (.p8) en Firebase Console > Configuración del proyecto > Cloud Messaging > app iOS. Sin ella, iOS no recibe push en producción.
- [ ] **Apple Developer:** el App ID `es.focusclub.clientes.appFocusClub` tiene activada la capability *Push Notifications*, y el perfil de distribución la incluye. La configuración Release usa `RunnerRelease.entitlements` (`aps-environment = production`).
- [ ] **Brevo:** el secreto `BREVO_API_KEY` existe y tiene una versión `ENABLED`. Este comando muestra solo metadatos (versiones y estado), nunca el valor:

  ```powershell
  firebase functions:secrets:get BREVO_API_KEY
  ```

  El remitente debe estar verificado en el panel de Brevo.
- [ ] **Cloud Scheduler:** se habilita solo al desplegar los schedulers. El proyecto debe estar en el plan Blaze.
- [ ] **Firma Android:** el keystore de release y `android/key.properties` están en la máquina que genera el AAB. No están en el repo y no se deben abrir ni imprimir. Para comprobar que existen:

  ```powershell
  Test-Path android/key.properties
  ```

### 0.2 Copia de seguridad y punto de retorno

- [ ] Exportar Firestore (rollback de datos de último recurso):

  ```powershell
  $bucket = 'gs://NOMBRE-DEL-BUCKET-DE-BACKUPS'
  $fecha = Get-Date -Format 'yyyyMMdd'
  gcloud firestore export "$bucket/pre-notifications-$fecha" --project focus-club-f73b8
  ```

- [ ] Anotar qué se está ejecutando ahora:

  ```powershell
  firebase functions:list
  ```

  Se espera ver `onAppointmentStatusPushNotification` y ninguna de las funciones nuevas.
- [ ] Anotar el commit de la web desplegado ahora (el último anterior a `a7496df`) y marcarlo con un tag (en `web_focus_club`):

  ```powershell
  $commit = 'COMMIT_SHA'
  git tag pre-notifications-prod $commit
  git push origin pre-notifications-prod
  ```

- [ ] Descargar las reglas desplegadas ahora (Firebase Console > Firestore > Reglas > historial) para poder restaurarlas.

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
- [ ] `npm --prefix functions test` (app) imprime `[check-exports] OK: deleteOwnAccount`.
- [ ] El build de iOS se genera en macOS con `flutter build ipa --release`. Comprobar en Xcode (Signing & Capabilities, Release) que aparece Push Notifications con entorno *production*.

## 2. Orden de despliegue

Cada paso se hace solo cuando el anterior está verificado. Todos los comandos de los pasos 2.1 a 2.4 y 2.6 se lanzan desde `web_focus_club`.

### 2.1 Índices de Firestore

```powershell
firebase deploy --only firestore:indexes
```

- Añade los `fieldOverrides` de `fcmTokens.token` y `fcmTokens.updatedAt` con alcance de grupo de colecciones. Los usan `onFcmTokenWritten` y `pruneStaleFcmTokensScheduled`.
- [ ] En Firebase Console > Firestore > Índices > Exenciones de campo única, los dos overrides aparecen como **Habilitado** (no "Compilando").
- Si el CLI propone borrar índices que no están en el archivo, responde **No**.

### 2.2 Reglas de Firestore y Storage

```powershell
firebase deploy --only "firestore:rules,storage"
```

- [ ] Las reglas incluyen `users/{uid}/notifications` (lectura del propietario y solo `read`/`readAt` escribibles) y `fcmTokens`.
- [ ] Prueba rápida: un cliente con la app actual abre el perfil sin errores de permisos.

### 2.3 Functions del backend (codebase `default`)

```powershell
npm --prefix functions test
firebase deploy --only functions
```

- El CLI pedirá confirmación para **borrar `onAppointmentStatusPushNotification`**. Es la única función que se debe aceptar borrar.
- **Si propone borrar cualquier otra función** (sobre todo `deleteOwnAccount`), responde **No** y aborta. No uses `--force`.
- Funciones nuevas esperadas:
  - `onAppointmentCustomerNotification`
  - `onNotificationOutboxCreated`
  - `onBonoCustomerNotification`
  - `onFcmTokenWritten`
  - `bonoExpiryWarningsScheduled`
  - `expireOverdueBonosScheduled`
  - `appointmentRemindersScheduled`
  - `retryNotificationDeliveriesScheduled`
  - `pruneStaleFcmTokensScheduled`
- [ ] `firebase functions:list` muestra las funciones nuevas y `deleteOwnAccount` sigue ahí, con Node 22.
- [ ] Cloud Scheduler muestra los 5 jobs en `Europe/Madrid`:

  ```powershell
  gcloud scheduler jobs list --location europe-west1 --project focus-club-f73b8
  ```

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
  - Llega "Solicitud de cita recibida" (push, historial y email).
  - En los logs aparece `[Notify] Delivered`:

    ```powershell
    firebase functions:log --only onAppointmentCustomerNotification
    ```

- [ ] **Confirmación:** aprobarla desde el admin. Llega "Cita confirmada".
  - Si la cita es dentro de menos de 24 h, el recordatorio no llega justo después: tarda al menos 6 h o no llega.
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

Solo cuando 2.2 y 2.3 estén verificados. Sin la regla de `notifications`, el historial de la app muestra error.

- [ ] **Android:** subir el AAB a la pista interna, probar, y pasar a producción con lanzamiento escalonado (por ejemplo, 20 %).
- [ ] **iOS:** subir el IPA a TestFlight, probar el push real y publicar con lanzamiento por fases.
- [ ] Cuando la build 15 esté al 100 % en las dos tiendas, decidir si se sube `minAndroidBuild`/`minIosBuild` (ver 0.3). Es opcional.
- Las versiones antiguas de la app siguen funcionando:
  - navegan con `type` cuando el push no trae `route`;
  - ignoran el `channelId` si no tienen el canal;
  - no ven el historial hasta que se actualizan.

## 3. Rollback

Hay que deshacer los pasos en orden inverso y solo lo necesario. Las apps nuevas son compatibles con el backend anterior: navegan con `type` y, sin historial, muestran el error controlado.

| Paso | Cómo revertir | Notas |
|---|---|---|
| 2.7 Apps | **Play Console:** detener el lanzamiento escalonado. **App Store Connect:** pausar el lanzamiento por fases. Publicar después la versión anterior con un build number mayor (16 o superior). | No se puede "despublicar" una versión ya instalada. No subir `minAndroidBuild`/`minIosBuild` si hay rollback. |
| 2.5 Functions `portal` | Ver bloque A. | Sin `--force`. Ese commit todavía exporta las callables antiguas: usa el filtro de función exacto. |
| 2.4 Hosting | Firebase Console > Hosting > historial de versiones > **Revertir** a la versión anterior. | Instantáneo. |
| 2.3 Functions `default` | **Corte rápido de avisos:** ver bloque B. **Rollback completo:** ver bloque C, y aceptar solo el borrado de las funciones nuevas de la lista de 2.3. | El rollback completo recrea `onAppointmentStatusPushNotification` y los emails antiguos al cliente. Las entregas pendientes de `notification_deliveries` quedan inertes al no haber scheduler de reintentos. |
| 2.2 Reglas | Firebase Console > Firestore > Reglas > historial > restaurar la versión anotada en 0.2. O ver bloque D. | Sin la regla de `notifications`, la app nueva muestra error en el historial, sin cerrarse. |
| 2.1 Índices | No hace falta revertirlos: los overrides de un solo campo no afectan a nada más. | Si se quisiera, quitarlos de `firestore.indexes.json` y redesplegar. |
| Datos | Las colecciones nuevas (`notification_deliveries`, `notification_outbox`, `push_dispatches`, `email_dispatches`, `users/*/notifications`) no las lee el código anterior y pueden quedarse. | La exportación de 0.2 es el último recurso; no restaurar sobre datos vivos sin revisar. |

**A. Functions `portal`** (en `app_focus_club`):

```powershell
git switch --detach 8429862
npm --prefix functions ci
firebase deploy --only "functions:portal:deleteOwnAccount"
git switch release/notifications-hardening
```

**B. Corte rápido de avisos** (en `web_focus_club`):

```powershell
firebase functions:delete onAppointmentCustomerNotification onBonoCustomerNotification onNotificationOutboxCreated --region europe-west1
```

**C. Rollback completo de las functions `default`** (en `web_focus_club`):

```powershell
git switch --detach pre-notifications-prod
npm --prefix functions ci
firebase deploy --only functions
git switch release/notifications-hardening
```

**D. Reglas desde el tag** (en `web_focus_club`):

```powershell
git switch --detach pre-notifications-prod
firebase deploy --only "firestore:rules,storage"
git switch release/notifications-hardening
```

## 4. Referencia rápida de comandos que **no** se deben usar

- `firebase deploy` sin `--only` desde `app_focus_club`: se bloquea, pero no hay que intentarlo.
- `firebase deploy --force` en cualquier repo: borra funciones sin preguntar.
- `firebase functions:delete deleteOwnAccount`: la app la usa para "Eliminar cuenta" (requisito de las tiendas).
- `firebase functions:secrets:access ...`: imprime el valor del secreto. Para comprobar un secreto basta con `firebase functions:secrets:get`.
- `firebase deploy --only firestore:rules,storage` sin comillas en PowerShell: la coma convierte el valor en un array.
