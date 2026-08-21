# Diseño: calendario de citas de solo lectura en el panel admin

Fecha: 2026-08-21
Repositorio: `erpereh/web_focus_club`
Estado: aprobado para planificación, pendiente de implementación

## Objetivo

Añadir a la pestaña existente **Citas** del panel de administración una segunda forma de visualizar las mismas citas: un calendario mensual. La vista actual de lista se conserva sin alterar su comportamiento.

El calendario es estrictamente de solo lectura. No introduce nuevas operaciones sobre citas, no modifica el flujo de negocio existente y no cambia la sincronización con Google Calendar.

## Alcance aprobado

- Mantener la vista de lista actual como vista por defecto.
- Añadir un botón con icono de calendario en la cabecera de Gestión de Citas.
- Permitir alternar entre `Lista` y `Calendario` sin cambiar de ruta ni recargar la página.
- Reutilizar los filtros existentes: `Todas`, `Pendiente`, `Aprobada`, `Rechazada`, `Cancelada`.
- Mostrar un calendario mensual con navegación al mes anterior/siguiente y botón `Hoy`.
- Mostrar las citas del mes usando los datos ya cargados por el admin.
- Abrir un modal de solo lectura al pulsar una cita del calendario.
- Mantener actualización en tiempo real mediante la suscripción existente a Firestore.
- Mantener la estética del panel de administración de Focus Club.

## Fuera de alcance

No se modificará:

- `app_focus_club`.
- Cloud Functions.
- Google Calendar ni su sincronización.
- Firestore Rules.
- Colecciones o estructura de Firestore.
- Lógica de bonos o descuento/devolución de minutos.
- `slot_occupancy`.
- Creación, aprobación, rechazo, cancelación, borrado o reprogramación de citas.
- Comportamiento actual de la vista de lista.

El nuevo calendario no importará ni invocará funciones de escritura de citas.

## Fuente de datos

Firestore continúa siendo la fuente de verdad.

Flujo existente:

```text
Firestore appointments
        |
        v
subscribeAppointments()
        |
        v
appointments[]
        |
        +-----------------> Vista Lista existente
        |
        +-----------------> Nueva Vista Calendario
                                 |
                                 v
                         Modal solo lectura
```

El calendario no consulta Google Calendar y no crea una segunda suscripción a Firestore. Consume el mismo estado `appointments` ya mantenido en `src/app/admin/page.tsx`.

## Integración en el admin

Se añadirá un estado local puramente visual equivalente a:

```ts
type AppointmentsView = 'list' | 'calendar';
```

Valor inicial: `list`.

La cabecera existente de Gestión de Citas conserva el botón Crear cita y los filtros actuales. A la derecha se añade un botón de alternancia:

- En vista lista: icono de calendario para abrir el calendario.
- En vista calendario: icono de lista para volver a la lista.

Cambiar de vista no modifica `statusFilter`.

## Reutilización de filtros

Se reutiliza la colección derivada ya existente `filteredAppointments`.

```text
appointments
    |
statusFilter
    |
filteredAppointments
    |
    +------> Lista
    |
    +------> Calendario
```

Consecuencias:

- `Pendiente` muestra solo pendientes en ambas vistas.
- `Aprobada` muestra solo aprobadas en ambas vistas.
- Cambiar de mes mantiene el filtro seleccionado.
- Cambiar Lista/Calendario mantiene el filtro seleccionado.
- No se duplica la lógica de filtrado.

## Calendario mensual

### Estructura

El calendario mostrará una cuadrícula mensual de siete columnas, de lunes a domingo.

Cabecera del calendario:

- Botón mes anterior.
- Nombre del mes y año.
- Botón mes siguiente.
- Botón `Hoy`.

Celdas:

- Los días fuera del mes visible se muestran atenuados.
- El día actual tiene un resaltado discreto.
- Las citas de cada día se ordenan por hora ascendente.
- La navegación de mes es estado local y no modifica datos.

### Fecha y hora efectiva de una cita

Para mantener compatibilidad con citas actuales y antiguas se resolverá el horario con esta prioridad:

1. `approvedSlot`, si existe y es válido.
2. `preferredSlots[0]`, si existe y es válido.
3. Campos legacy `date` + `time`, si existen y son válidos.

La utilidad que resuelva el slot será pura y de solo lectura.

### Tarjeta de cita

Cada evento mostrará información compacta suficiente para identificarlo:

- Hora.
- Nombre del cliente.
- Duración cuando haya espacio.
- Entrenador cuando haya espacio.
- Estado mediante estilo visual.

Estados visuales:

- `pending`: amarillo.
- `approved`: verde.
- `rejected`: rojo.
- `cancelled`: gris/neutro.

Los colores representan estado, no entrenador.

### Días con muchas citas

Para evitar que una celda crezca indefinidamente se mostrará un número limitado de eventos visibles y un indicador `+ N más` cuando haya más citas en ese día.

Al accionar `+ N más`, las citas restantes del día deben poder verse sin modificar datos. La implementación concreta puede usar expansión temporal de la celda o un pequeño listado/overlay de solo lectura, siempre manteniendo el calendario estable y accesible.

## Modal de detalle

Al pulsar una cita se abre un modal centrado sobre un overlay.

El modal es estrictamente de solo lectura y no contendrá controles para modificar la cita.

### Datos a mostrar

Cuando estén disponibles:

- Nombre del cliente.
- Estado.
- Servicio.
- Fecha.
- Hora de inicio y hora final calculada.
- Duración.
- Email.
- Teléfono.
- Entrenador.
- Tipo de sesión.
- Comentario o motivo.
- ID de la cita.

Si un campo no existe en citas antiguas se mostrará `—` en lugar de producir un error.

### Resolución de cliente y entrenador

Se reutilizarán los datos y mecanismos ya disponibles en el admin para resolver cliente y entrenador. No se añadirán consultas específicas al abrir el modal.

### Cierre

El modal se podrá cerrar mediante:

- Botón `X`.
- Botón `Cerrar`.
- Clic en el overlay.
- Tecla `Esc` en escritorio.

## Componentes propuestos

La funcionalidad nueva debe mantenerse fuera del archivo principal del admin tanto como sea razonable.

Estructura propuesta:

```text
src/components/admin/appointments/
  AppointmentsCalendar.tsx
  AppointmentReadOnlyModal.tsx
  appointment-calendar-utils.ts
```

Responsabilidades:

### `AppointmentsCalendar.tsx`

- Render del mes.
- Navegación mensual.
- Agrupación de citas por día.
- Ordenación por hora.
- Selección de una cita para abrir detalle.
- Presentación responsive.

No realiza lecturas ni escrituras directas a Firestore.

### `AppointmentReadOnlyModal.tsx`

- Presentar la cita seleccionada.
- Resolver formato de fecha/hora/duración.
- Mostrar datos opcionales de forma segura.
- Gestionar únicamente apertura/cierre.

No importa funciones de mutación.

### `appointment-calendar-utils.ts`

Funciones puras para:

- Resolver slot efectivo.
- Obtener clave local de día `YYYY-MM-DD`.
- Generar los días visibles del mes.
- Ordenar citas por fecha/hora.
- Calcular hora final según duración.
- Formatear fecha y hora.

Estas funciones deben poder probarse de forma aislada.

### `src/app/admin/page.tsx`

Cambios mínimos:

- Estado `list | calendar`.
- Botón de alternancia.
- Render condicional de lista existente o nuevo calendario.
- Estado/props necesarios para la cita seleccionada, salvo que se encapsule íntegramente dentro del componente calendario.

No se refactorizarán secciones no relacionadas del archivo admin.

## Responsive

Escritorio:

- Cuadrícula completa de siete columnas.
- Tarjetas con hora, cliente y metadatos disponibles.

Pantallas más estrechas:

- Se reduce el contenido de la tarjeta antes de alterar la estructura del calendario.
- Se priorizan día, hora y cliente.
- El modal debe ser usable sin desbordamiento horizontal.

No se hará una reestructuración general del admin móvil dentro de este cambio.

## Actualización en tiempo real

El calendario recibe `filteredAppointments` desde el estado ya alimentado por `subscribeAppointments()`.

Cuando entra una cita nueva o cambia una cita por el flujo existente:

1. Firestore actualiza el snapshot.
2. `appointments` se actualiza.
3. `filteredAppointments` se recalcula.
4. Lista y calendario reciben los nuevos datos.

No se requiere refresh manual ni polling.

## Seguridad de cambio

Para minimizar riesgo:

- No se cambia ninguna API existente.
- No se introduce una segunda fuente de verdad.
- No se modifica el esquema de `Appointment` salvo que TypeScript exija reflejar un campo ya existente; no se añadirán campos nuevos a Firestore.
- No se importan mutaciones en los componentes nuevos.
- No se cambia el flujo de Google Calendar.
- No se cambia Flutter.
- No se cambia lógica de negocio de citas.
- La lista actual queda disponible como fallback funcional inmediato.

## Manejo de errores y datos legacy

El calendario debe tolerar:

- Citas sin `approvedSlot`.
- Citas sin `preferredSlots` pero con `date/time` legacy.
- Citas sin entrenador.
- Citas sin comentario.
- Citas sin teléfono u otros metadatos opcionales.
- Duraciones inesperadas: mostrar la duración disponible si se puede parsear; no bloquear el render.
- Citas sin una fecha/hora válida: no deben romper el calendario. Podrán omitirse de la cuadrícula y seguir visibles en la lista existente.

Nunca se corregirá o escribirá automáticamente un documento legacy desde la UI.

## Pruebas y validación

### Utilidades

Pruebas unitarias para al menos:

- Generación correcta de cuadrícula mensual empezando en lunes.
- Cambio de año diciembre/enero.
- Resolución de `approvedSlot` con prioridad sobre `preferredSlots`.
- Fallback a `preferredSlots[0]`.
- Fallback legacy `date/time`.
- Ordenación cronológica de citas del mismo día.
- Cálculo de hora final para 30, 45 y 60 minutos, incluyendo cambio de hora.
- Datos inválidos sin excepción.

### Componente

Validar:

- La vista inicial sigue siendo Lista.
- El botón alterna Lista/Calendario.
- El filtro activo se conserva al alternar vistas.
- Los filtros afectan al calendario.
- Mes anterior/siguiente funciona.
- `Hoy` vuelve al mes actual.
- Pulsar una cita abre el modal correcto.
- Cerrar por X, botón, overlay y Esc funciona.
- El modal no contiene acciones de modificación.

### Regresión

Antes de considerar terminado:

- Build del proyecto web correcto.
- Tests existentes correctos.
- Crear cita desde el flujo actual sigue funcionando.
- Vista lista existente sigue funcionando sin cambios de comportamiento.
- Filtros actuales siguen funcionando.
- La suscripción en tiempo real sigue mostrando nuevas citas.
- Ninguna interacción del calendario produce escrituras a Firestore.

## Criterios de aceptación

La funcionalidad se considera completa cuando:

1. El admin abre `Citas` y ve la lista actual por defecto.
2. Existe un botón de calendario claramente identificable.
3. El botón alterna entre Lista y Calendario sin perder filtros.
4. El calendario muestra las citas del mes y respeta el filtro seleccionado.
5. Las citas se actualizan con el mismo flujo en tiempo real existente.
6. Pulsar una cita abre un modal con sus datos.
7. El modal es de solo lectura.
8. No se han modificado Flutter, Cloud Functions, Firestore Rules, Google Calendar ni lógica de negocio.
9. Build y pruebas relevantes pasan.
10. La vista lista existente continúa operativa como antes.

## Decisiones cerradas

- Se implementa la opción `Lista + Calendario`.
- La lista permanece como vista por defecto.
- El acceso al calendario se hace mediante un icono en la cabecera de Citas.
- Los filtros existentes funcionan también en calendario.
- Al pulsar una cita se abre un modal.
- El modal es solo lectura.
- No se implementan modificaciones de citas desde el calendario.
- No se toca la aplicación Flutter.
- No se toca la integración de Google Calendar.
