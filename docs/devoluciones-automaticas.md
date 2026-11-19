> **Publicación coordinada de noviembre de 2026:** seguir únicamente [el procedimiento integrado de aforo y devoluciones](despliegue-integrado-aforo-devoluciones.md). Las órdenes de publicación y cifras históricas de este documento se conservan como referencia anterior; no ejecutarlas para esta entrega.

# Devoluciones automáticas de minutos — 13 de noviembre de 2026

Estado de entrega: código local y auditoría de solo lectura. **No se ha desplegado, activado, migrado ni compensado producción.**

## Resultado de la auditoría histórica

Informe: [refund-audit-2026-11-13.json](refund-audit-2026-11-13.json).

SHA-256 del informe canónico: `d632c5b700666b1a9d8845e8b86b622f7a712421cc3d8a2b86701fdc97a29248`.

| Cita | Descuento comprobado | Abonado según evidencias | Pendiente | Destino vigente observado | Saldo observado → previsto | Contratado / capacidad prevista |
|---|---:|---:|---:|---|---|---|
| `gx7ntDqQEukKIg8VRbXU` | 60 | 0 | 60 | `20fda9f1-c666-41ed-aad5-c5a1054f06eb` | 120 → 180 | 240 / 300 |
| `pIseaJtxMLx3Ms2iaDib` | 60 | 0 | 60 | `7a8f6aeb-9b1c-4318-9f01-d64321a5309e` | 180 → 240 | 240 / 300 |

En ambos casos el intento del 6 de noviembre encontró el destino completo. El historial decía `devolucion_cita`, pero el marcador de límite registra los 60 minutos que no entraron. La reconstrucción de los movimientos posteriores coincide con los saldos actuales. Los bonos originales contienen un único descuento de 60 minutos para cada reserva. El informe incorpora las referencias, versiones y huellas de los documentos examinados; no contiene correos, teléfonos ni notas de clientes.

Estas son conclusiones de los registros disponibles, no una autorización para abonar. **Los dos casos requieren revisión expresa del informe.** Un cambio posterior de las evidencias obliga a generar y revisar otro informe. No se debe ajustar el saldo con los botones manuales para resolverlos.

## Contabilidad e invariantes

- `minute_refunds/{reservationId}` conserva la devolución, independiente de la existencia de la cita. La identidad deriva de cita, bono original y fecha del descuento. Un nuevo descuento de la misma cita inicia otra reserva.
- `requestedMinutes = creditedMinutes + pendingMinutes`. El importe solicitado nunca supera el descuento original. `movements/request`, `movements/credit_N` y `movements/review_HASH` dejan recibos permanentes, sin TTL.
- `minutesRefundedAmount` en citas representa minutos realmente abonados. `minutesRefundRequestedAmount` y `minutesRefundPendingAmount` separan solicitud y deuda. `minutesRefunded` indica devolución completa; el timestamp solo acompaña abonos reales. Los consumidores no deciden la contabilidad usando esos marcadores por separado.
- La devolución ordinaria al mismo bono restaura saldo, sin ampliar capacidad. Puede liberar una reserva de un bono futuro antes de su inicio, conservando su período original. Un bono ya caducado, eliminado o sustituido no recibe esa restitución.
- Traslados, deudas previas y excesos legítimos se compensan como extras: `minutosTotales = minutosCapacidadBase + minutosExtraRecuperados`. `tamano` conserva el contrato. La base congela las ampliaciones históricas existentes; consumir no reduce esa capacidad.
- Los extras abonados terminan con la vigencia o sustitución del receptor. La deuda todavía no abonada no caduca. No se transfieren saldos contratados no consumidos al renovar.
- Los ajustes manuales mantienen el límite efectivo; no pueden ampliarlo. Cada operación tiene un ID estable, actor y asiento. La web agrupa peticiones simultáneas y conserva el ID ante respuestas de red inciertas.
- `minute_refund_accounts/{userId}` serializa los cambios y conserva el trabajo pendiente. Compensar, asignar y modificar bonos relee el estado transaccionalmente. Varias operaciones no pueden crear dos abonos para la misma deuda.
- El receptor es el único bono activo y válido del cliente. Sin activo se puede reactivar exclusivamente el más reciente si está agotado, sigue vigente y no está sustituido. Varios activos, fechas o saldos inválidos y empates no resolubles bloquean el abono.
- Citas y archivos de eliminación son proyecciones. Una compensación antigua no pisa una reserva posterior de la misma cita. Los archivos pendientes no llevan TTL; al resolverlos recuperan la retención de dos años. El recibo canónico siempre se conserva.

## Flag, históricos y recuperación

`site_config/main.automaticMinuteRefundsEnabled` está **desactivado si falta o no es exactamente `true`**. No se añade ningún interruptor de activación al panel ni se escribe este valor durante el despliegue.

La comprobación de solo lectura en producción encontró el flag ausente y los mínimos Android/iOS en el build 20; no se han cambiado.

Con el flag desactivado siguen funcionando el registro permanente de solicitudes, las restituciones ordinarias, el archivo de citas borradas y la conservación del importe no abonado. Solo se detiene la compensación automática que traslada o añade extras. El trabajador vuelve a leer el flag dentro de la transacción de abono.

Las deudas históricas tienen una autorización independiente. Activar el flag, borrar una cita, modificar un bono o reintentar no las autoriza. Importarlas exige un informe aprobado, su hash, confirmación del proyecto y un UID con rol admin. El trabajador comprueba también el recibo inmutable de revisión; un booleano `reviewApproved` aislado no basta.

El procesamiento se despierta por solicitudes y cambios relevantes del destino. No se despierta por un consumo normal o por editar historial. Agrupa trabajo por cliente, procesa 25 devoluciones como máximo y continúa solo si queda trabajo. Una deuda sin bono duerme hasta un cambio relevante; el inicio futuro de vigencia deja una única fecha de recuperación.

No se crea otro Cloud Scheduler. La ejecución horaria existente `expireOverdueBonosScheduled` recupera como máximo 50 clientes con trabajo vencido mediante una consulta indexada. Con el flag desactivado no consulta trabajos. Sin trabajos debidos no escanea citas, bonos ni deudas. Los fallos transitorios usan espera creciente, hasta seis horas; los eventos repetidos respetan esa fecha. Las inconsistencias quedan bloqueadas sin temporizador. La recuperación no impide completar las caducidades.

## Administración y compatibilidad

`/admin/devoluciones` muestra solicitudes, abonos y deuda, incluyendo citas eliminadas e históricos todavía sin importar. Permite filtrar, descargar una auditoría histórica, ver movimientos y solicitar un reintento. No permite elegir importes o destinos ni aprobar históricos mediante un botón genérico.

Las estadísticas consultan la contabilidad canónica y añaden las incidencias legacy todavía no importadas, deduplicando sus proyecciones. Una deuda resuelta desaparece del recuento. Esperar bono es informativo; las inconsistencias y los históricos por auditar requieren revisión. Las páginas visibles actualizan el resumen cada 30 segundos.

Las reglas cierran los saldos y marcadores financieros a escrituras directas, también desde una pestaña admin antigua. Los registros internos se consultan mediante callables autenticadas como admin. Nombres, payloads, respuestas, estados y códigos de las operaciones móviles existentes se mantienen.

La web y Flutter comparten la semántica de capacidad efectiva. La app preparada es **1.5.1+21**, con pruebas de saldos 300, 240, 180 y 0 sobre un bono de 240 + 60. Las versiones anteriores recortan la visualización al tamaño comercial: hay que publicar ambos clientes y exigir el build compatible antes de activar extras. No modificar `tamano` para engañar a las versiones antiguas.

## Validación local

Desde `web_focus_club`:

```powershell
npm --prefix functions test
npm --prefix functions run test:emulator
npx vitest run
npx tsc --noEmit --incremental false
npm run build
```

Desde `app_focus_club`:

```powershell
flutter analyze --no-pub
flutter test --no-pub
```

Los tests del emulador exigen `FIRESTORE_EMULATOR_HOST` y un proyecto `demo-*`; no se pueden ejecutar accidentalmente contra producción. Las pruebas incluyen concurrencia real, reintentos, flag desactivado, históricos, registros borrados, renovaciones, caducidad, capacidad, compensación parcial, nuevos ciclos y permisos.

### Resultados de la entrega

- Suite completa de Functions y compilación: correcta; también pasan las pruebas específicas de recibos y fechas históricas.
- Firestore real en emulador: **56/56**, incluidas 22 pruebas nuevas de devoluciones y las reglas de protección financiera.
- Web: **401/401** pruebas en 47 archivos, TypeScript y exportación estática correctos; se genera `/admin/devoluciones`.
- Flutter: **449/449** pruebas y `flutter analyze --no-pub` sin incidencias.
- ESLint de los módulos web revisados y comprobación de whitespace: correctos.
- Una ejecución intermedia del emulador devolvió `ABORTED` al probar cinco aprobaciones simultáneas. La prueba aislada y la repetición completa posterior pasaron. No se relajaron las aserciones de concurrencia ni se añadieron reintentos al test para ocultarlo.
- No se generaron publicaciones ni binarios firmados de tiendas. Queda pendiente la validación de release en dispositivos y la distribución coordinada de Android/iOS antes de activar extras.

## Publicación coordinada — pendiente, no ejecutada

1. Revisar cambios en ambos repositorios. Mantener el flag ausente o `false`.
2. Desplegar índices desde la web y esperar a que estén disponibles:

   ```powershell
   firebase deploy --project focus-club-f73b8 --only firestore:indexes
   ```

3. Abrir una ventana de mantenimiento financiero: activar manualmente `maintenanceMode`, detener también las operaciones del panel y esperar a que terminen las solicitudes en curso. Las funciones antiguas solo conocen `minutesRefundedAt`; no deben convivir procesando devoluciones con el nuevo marcador de solicitud. El flag de compensación desactivado no controla ese código antiguo.

   Compilar y desplegar únicamente las funciones listadas por el filtro. Este filtro preserva las funciones del codebase móvil y las funciones externas al código de la web:

   ```powershell
   npm --prefix functions run build
   $focusFunctions = node functions/scripts/deploy-filter.cjs
   firebase deploy --project focus-club-f73b8 --only "$focusFunctions"
   npm run build
   firebase deploy --project focus-club-f73b8 --only hosting
   firebase deploy --project focus-club-f73b8 --only firestore:rules
   ```

   Recargar las pestañas admin antiguas, comprobar que todas las funciones usan la nueva versión y verificar una restitución ordinaria y una deuda conservada con el flag desactivado. Solo entonces retirar `maintenanceMode` y reanudar operaciones. No desplegar las copias de Functions o reglas del repositorio Flutter para esta entrega.

4. Compilar y publicar manualmente la app corregida:

   ```powershell
   # En app_focus_club; comprobar antes que el build 21 no se haya usado en las tiendas.
   flutter build appbundle --release
   ```

   En macOS, con firma y perfiles válidos: `flutter build ipa --release`. Distribuir y verificar la versión compatible en **ambas** tiendas; si otro lanzamiento ha ocupado el build 21, incrementar el número y usar ese mismo número en las comprobaciones y en los mínimos siguientes.

5. Comprobar en dispositivos Android e iOS el saldo efectivo y el desglose. Configurar manualmente `minAndroidBuild` y `minIosBuild` con el build publicado y verificar URLs HTTPS de tienda y pantalla de actualización obligatoria en versiones anteriores. No activar extras si quedan versiones utilizables que los oculten.
6. Solo mediante una acción posterior autorizada, cambiar `automaticMinuteRefundsEnabled` a `true` en la consola de Firebase con permisos IAM. Las reglas impiden hacerlo desde el panel. Verificar que las deudas nuevas elegibles se concilian y que los históricos siguen bloqueados.

## Auditoría y aplicación histórica — aplicación prohibida hasta revisión

Usar credenciales administrativas a través de `GOOGLE_APPLICATION_CREDENTIALS` o ADC; no copiarlas al informe ni al repositorio. El modo `audit` bloquea por código todas las APIs de escritura del SDK utilizado y no sobrescribe informes existentes.

```powershell
node scripts/reconcile-minute-refunds.cjs --mode audit --project focus-club-f73b8 --appointment-ids gx7ntDqQEukKIg8VRbXU,pIseaJtxMLx3Ms2iaDib --out refund-audit-nuevo.json
```

Revisar importes, movimientos, destinos, saldos previstos, versiones y ausencia de incidencias. Después de esa revisión expresa, y de la publicación coordinada, el operador podrá ejecutar:

```powershell
$approvedHash = '<reportHash del informe que hemos revisado>'
$reviewerUid = '<UID del administrador que lo ha revisado>'
node scripts/reconcile-minute-refunds.cjs --mode apply --reviewed-report refund-audit-nuevo.json --confirm-project focus-club-f73b8 --approved-report-hash $approvedHash --reviewer-uid $reviewerUid
```

El comando importa las deudas revisadas; el trabajador normal realiza el abono con el flag, destino y recibo revalidados. Si cambia una evidencia, la aplicación aborta para esa reserva: repetir la auditoría y revisar el nuevo informe. Repetir exactamente una importación ya confirmada reconoce su recibo y no vuelve a abonar. Cada caso se confirma en su propia transacción, por lo que una importación de varios casos puede terminar parcialmente y reintentarse con seguridad.

Comprobar en `/admin/devoluciones` el pendiente cero, el recibo de revisión, un único movimiento de compensación por deuda y la desaparición de las incidencias en estadísticas. Releer los saldos; si hubo consumos o renovaciones posteriores, deben seguir la contabilidad actual, no los números de este informe antiguo.

## Incidencias posteriores

Desactivar el flag detiene nuevas compensaciones y conserva deudas y recibos. Revisar inconsistencias desde administración y corregir su causa mediante operaciones auditadas. No borrar recibos, recortar saldos a `tamano`, editar saldos en consola o volver a una versión antigua que desconozca los extras. No activar TTL en `minute_refunds`, sus movimientos o `minute_refund_accounts`.
