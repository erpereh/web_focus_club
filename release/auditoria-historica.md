# Auditoría histórica de devoluciones — 18/11/2026

Auditoría de solo lectura del proyecto `focus-club-f73b8`, realizada a las 22:51:27 UTC. No se han aplicado compensaciones ni modificado datos de producción.

Informe completo local: [refund-audit-2026-11-18-final.json](refund-audit-2026-11-18-final.json).

Hash canónico del informe: `d963da61fc7083efa6dec80513e7fea3a939bdadec9aa5e77b8ae664ff83f217`.

| Cita | Descuento real comprobado | Abono comprobado | Pendiente | Saldo del receptor observado | Saldo previsto | Capacidad prevista |
|---|---:|---:|---:|---:|---:|---:|
| `gx7ntDqQEukKIg8VRbXU` | 60 | 0 | 60 | 90 | 150 | 300 |
| `pIseaJtxMLx3Ms2iaDib` | 60 | 0 | 60 | 0 | 60 | 300 |

Los destinatarios observados son, respectivamente, `20fda9f1-c666-41ed-aad5-c5a1054f06eb` y `7a8f6aeb-9b1c-4318-9f01-d64321a5309e`. En ambos se conservan 240 minutos contratados y la eventual compensación añade 60 recuperados. El segundo está agotado: su reactivación depende de que siga siendo el bono más reciente, vigente y sin sustituto cuando se ejecute el motor común.

Se examinaron 27 documentos en el primer caso y 30 en el segundo, con referencias, existencia, versión y hash. El informe conserva el descuento original y reconstruye los ocho y cinco movimientos respectivos de los receptores. Incluye citas relacionadas, archivos de eliminación, todos los bonos del cliente, registros de devolución y de actividad y la señal financiera del cliente. No contiene correos, teléfonos ni notas personales.

La reconstrucción de ambos saldos coincide con lo observado y no detecta compensaciones posteriores en los historiales de los bonos examinados. El historial antiguo `devolucion_cita` y `minutesRefunded: true` no se tomaron por prueba de un abono de 60: el importe realmente abonado se reconstruye como cero, compatible con el exceso de 60 marcado y con los movimientos posteriores. Ambos casos resultan elegibles para una importación revisada, sin incidencias en los registros disponibles.

**La auditoría no autoriza el abono.** Los saldos 120 y 180 del informe anterior han cambiado. Antes de aplicar se debe obtener y revisar expresamente un informe nuevo siguiendo [el procedimiento integrado](../docs/despliegue-integrado-aforo-devoluciones.md), una vez publicados backend, web y ambas apps, fijada la actualización mínima y autorizada la activación. La aprobación del informe completo se importa en una sola transacción. Cambios de evidencias o nuevos documentos financieros la rechazan sin importar parcialmente los casos. Los recibos hacen inocuo un reintento tras perder la respuesta.

La aplicación posterior corregirá las entradas engañosas mediante referencias al informe y a los recibos. Los saldos los actualizará exclusivamente el motor financiero común, con el flag, el destinatario y la capacidad revalidados. No usar ajustes manuales ni editar saldos para resolver estos dos casos.

La auditoría preliminar de ocupación está en `release/slot-audit-2026-11-18-preliminary.json`, hash `eb4958c9e02b25e4f5424dab0422760c55770e73e3b311d8121b10028ac989bc`: 1.179 citas activas examinadas, 24 contadores a crear, 52 a actualizar, 232 a eliminar y cuatro franjas sobre aforo; ninguna incidencia de formato. No se aplicó. No estaba congelado el mantenimiento, por lo que ese informe se rechaza para aplicar. Durante la ventana se generará otro que incluya las pendientes existentes, sin cancelar reservas.
