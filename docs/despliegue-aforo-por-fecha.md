# Despliegue: aforo por fecha

Informe de despliegue de la funcionalidad **aforo por fecha** (`capacity_exceptions`) y de la validación en servidor del aforo global.

> **Nada de esto se ha desplegado.** Todo es manual y sigue el orden indicado. Los comandos son para PowerShell 7, siguiendo las convenciones de `docs/production-release-checklist.md`: listas `--only` entre comillas y variables en lugar de `<...>`.

## Qué cambia en cada sistema

| Sistema | Cambio | ¿Hay que desplegar? |
|---|---|---|
| **Functions** | 3 callables nuevos y 16 callables existentes que ahora usan el aforo efectivo de cada fecha | Sí, primero |
| **Rules** | `capacity_exceptions`: lectura para verificados, sin escritura. `site_config`: `maxCapacity` y `capacityExceptionsEnabled` ya no se pueden escribir desde el cliente | Sí, después de Functions |
| **Índices** | Ninguno: solo hay consultas por `date` (igualdad, rango e `in`), que cubren los índices automáticos | No |
| **Hosting** | Tarjeta "Aforo por fecha", aforo global por callable, calendarios y estadísticas con el aforo de cada día | Sí, después de Rules |
| **Android / iOS** | La app lee `capacity_exceptions` y muestra las plazas reales de cada día | Sí, publicación en tiendas |
| **Activación** | `site_config/main.capacityExceptionsEnabled = true` | Manual, solo con las apps publicadas |

## Orden recomendado

| # | Paso | Requisito | Efecto visible |
|---|---|---|---|
| 1 | Functions | Tests en verde | Ninguno: sin excepciones, el aforo efectivo es el global |
| 2 | Rules | Paso 1 | El panel antiguo no puede guardar el aforo global hasta el paso 3 |
| 3 | Hosting | Pasos 1 y 2 | Tarjeta "Aforo por fecha" visible pero desactivada |
| 4 | Android e iOS | Paso 2 | La app lee las excepciones (todavía no hay ninguna) |
| 5 | Verificar en tiendas | Paso 4 | — |
| 6 | Activar `capacityExceptionsEnabled` | Paso 5 | El admin ya puede crear excepciones |
| 7 | (Opcional) subir `minAndroidBuild` / `minIosBuild` | Adopción suficiente | Fuerza la actualización de las apps antiguas |

---

## 0. Comprobaciones previas

En `web_focus_club`:

```powershell
npm run lint
npm test
npm run build
npm --prefix functions test
npm --prefix functions run test:emulator
```

En `app_focus_club`:

```powershell
flutter pub get
flutter analyze
flutter test
```

Resultado de la última ejecución local:

| Suite | Resultado |
|---|---|
| Functions | 388 tests, 0 fallos |
| Emulador | 30/30 |
| Web (Vitest) | 384/384 |
| Build web | Correcto |
| Flutter | 443/443 |
| `flutter analyze` | Sin incidencias |

## 1. Functions (backend)

Despliegue mínimo: los 3 callables nuevos y los callables cuyo comportamiento cambia porque validan el aforo.

```powershell
$only = @(
  'upsertCapacityExceptionsFromAdmin'
  'deleteCapacityExceptionsFromAdmin'
  'updateMaxCapacityFromAdmin'
  'createAppointment'
  'updateOwnAppointmentSlot'
  'createAppointmentFromAdmin'
  'updateAppointmentStatusFromAdmin'
  'createRecurringAppointments'
  'createRecurringAppointmentsFromAdmin'
  'approveRecurringAppointmentSeriesFromAdmin'
  'rescheduleAppointmentFromAdmin'
  'replaceRecurringSeriesScheduleFromAdmin'
  'rescheduleRecurringAppointmentFromAdmin'
  'rescheduleOwnRecurringAppointment'
  'replaceOwnRecurringSeriesSchedule'
  'proposeAppointmentSlotFromAdmin'
  'respondToAppointmentConfirmation'
  'previewBonoAppointmentRenewalFromAdmin'
  'commitBonoAppointmentRenewalFromAdmin'
) | ForEach-Object { "functions:$_" }
firebase deploy --only ($only -join ',')
```

- **Alternativa equivalente y más simple:** desplegar todas las funciones del código con el filtro habitual. Como siempre que se usa el filtro, no propone borrar nada.

  ```powershell
  $only = node functions/scripts/deploy-filter.cjs
  firebase deploy --only "$only"
  ```

- **Después, comprueba:**
  - `firebase functions:list` muestra los tres callables nuevos en `europe-west1`.
  - Una reserva normal sigue funcionando igual que antes. Con `capacityExceptionsEnabled` desactivado no puede existir ninguna excepción nueva, así que el aforo efectivo coincide con el global.

## 2. Firestore Rules

```powershell
firebase deploy --only firestore:rules
```

- **Ventana conocida:** entre este paso y el 3, el panel admin que está publicado no puede guardar la "Capacidad por franja", porque las reglas rechazan `maxCapacity` desde el cliente. El resto de la configuración se sigue guardando con normalidad. Despliega el Hosting justo después.
- **Las apps publicadas no se ven afectadas:** `site_config` sigue siendo de lectura pública y `slot_occupancy` no cambia.
- **Después, comprueba:** en la consola de Firebase, Reglas muestra el bloque `match /capacity_exceptions/{date}`.

## 3. Hosting (panel admin y portal web)

```powershell
npm run build
firebase deploy --only hosting
```

- **Requiere los pasos 1 y 2:**
  - El calendario lee `capacity_exceptions`. Sin las reglas, la disponibilidad mostraría un error de carga.
  - El aforo global se guarda con `updateMaxCapacityFromAdmin`.
- **Después, comprueba:**
  - En Configuración aparece la tarjeta **"Aforo por fecha"** con el aviso "todavía no está activado". Guardar está deshabilitado.
  - Cambiar la "Capacidad por franja" funciona y deja el registro `max_capacity_updated` en `activity_logs`.
  - Prueba a reducir el aforo global por debajo de una franja con citas aprobadas. Debe aparecer el modal de confirmación y las citas no deben cambiar. Si no quieres tocar producción, vuelve a dejar el valor anterior.

## 4. Android e iOS (`app_focus_club`)

1. **Sube la versión en `pubspec.yaml`.** Ahora mismo es `1.4.10+19`, todavía sin publicar según `test/release_version_test.dart`.
   - Si `1.4.10+19` no llegó a publicarse, puede salir con este cambio tal cual.
   - Si ya está en tiendas, usa la siguiente, por ejemplo `version: 1.5.0+20`.
2. **Android** (Windows o macOS, con `android/key.properties` real):

   ```powershell
   flutter clean
   flutter pub get
   flutter build appbundle --release
   ```

   - Sube `build/app/outputs/bundle/release/app-release.aab` a Play Console, primero a pruebas internas y después a producción.
3. **iOS** (macOS):

   ```bash
   flutter clean
   flutter pub get
   flutter build ipa --release
   ```

   - Sube `build/ios/ipa/*.ipa` con Transporter o Xcode a App Store Connect y envíalo a revisión.
4. **Después de publicar,** actualiza `_lastPublishedBuild` y `_lastPublishedVersion` en `test/release_version_test.dart`, como indica `docs/production-release-checklist.md`.

- **Las reglas locales `app_focus_club/firestore.rules` son solo para el emulador.** Su despliegue está bloqueado por diseño y no hay que desplegarlas.

## 5. Verificación en tiendas (manual)

Antes de activar nada:

- [ ] La versión nueva aparece como **disponible** (no "en revisión") en Google Play, en la ficha pública o en Play Console, en producción.
- [ ] La versión nueva aparece **disponible** en App Store para el país del centro.
- [ ] Una instalación de prueba de la nueva versión muestra correctamente el portal y las reservas.

## 6. Activación del aforo por fecha

Solo cuando el paso 5 esté completo:

- En la consola de Firebase, abre Firestore → `site_config/main` y añade el campo `capacityExceptionsEnabled` (boolean) con valor `true`.
  - Las reglas impiden cambiarlo desde el panel. La consola no pasa por las reglas.
- Recarga el panel. La tarjeta "Aforo por fecha" queda activa.
- **Prueba mínima:**
  1. Selecciona un día futuro sin citas y ponle aforo 1. Comprueba que el portal y la app nueva muestran 1 plaza ese día.
  2. Quita la excepción. El día vuelve al aforo general.

## 7. Opcional: forzar la actualización de las apps antiguas

Las versiones publicadas (≤ 1.4.4) siguen funcionando: el servidor siempre aplica el aforo correcto. Solo pueden mostrar plazas desfasadas en días con excepción:

- **Día con aforo menor que el global:** la franja aparece libre y, al reservar, el servidor responde "La franja seleccionada está llena".
- **Día con aforo mayor que el global:** la app antigua muestra la franja completa y no deja reservar desde ella. Desde la web o la app nueva sí se puede.

Cuando la adopción de la versión nueva sea suficiente, en `site_config/main`:

- `minAndroidBuild` = build publicado (por ejemplo `20`).
- `minIosBuild` = build publicado (por ejemplo `20`).
- `androidStoreUrl` y `iosStoreUrl` deben ser URLs https válidas. Sin ellas, la app no bloquea.

## Marcha atrás

| Paso | Cómo revertir | Nota |
|---|---|---|
| Activación | `capacityExceptionsEnabled = false` desde la consola | Las excepciones existentes se siguen aplicando; elimínalas desde el panel si quieres volver al aforo global |
| Hosting | En la consola de Hosting, "Revertir" a la versión anterior | El panel antiguo no podrá guardar el aforo global mientras sigan las reglas nuevas |
| Rules | Volver a desplegar `firestore.rules` del commit anterior | Antes, revierte también Hosting: el calendario nuevo necesita leer `capacity_exceptions` |
| Functions | Volver a desplegar la misma lista desde el commit anterior | **Antes elimina todas las excepciones**: las funciones antiguas las ignoran y la web o la app nueva mostrarían un aforo que el servidor no aplica |
| Apps | Publicar una versión anterior con build superior | Normalmente no hace falta: con las reglas anteriores, la app nueva ignora el fallo de lectura y usa el aforo global |
