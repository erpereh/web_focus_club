# Plan de implantación: capacidad global, actualización obligatoria y citas recurrentes

## Objetivo

Este documento recoge la propuesta de evolución del sistema de citas de Focus Club para cubrir tres necesidades relacionadas:

1. Sustituir la capacidad fija actual de 2 personas por franja por una capacidad global configurable desde el panel de administración.
2. Añadir un mecanismo de actualización obligatoria de la app móvil para evitar que versiones antiguas sigan usando reglas incompatibles con el backend.
3. Añadir entrenamientos/citas recurrentes por semanas, por ejemplo un cliente que entrena todos los lunes a las 10:00 durante un periodo definido.

La intención es implantar estas mejoras de forma progresiva, manteniendo compatibilidad con el sistema actual y reduciendo al mínimo el riesgo sobre reservas, bonos, ocupación, notificaciones y Google Calendar.

---

# 1. Estado actual relevante

Actualmente la capacidad máxima por periodo/franja es 2 y está representada en más de un punto del sistema.

En la web/admin existe una capacidad fija usada para validar operaciones administrativas.

En las Cloud Functions existe también una capacidad fija que es la que realmente protege el backend cuando se intenta crear o mover una cita a una franja completa.

En Flutter existe además una capacidad fija usada por la app para decidir si una franja está completa antes de que el usuario intente reservar.

Por tanto, cambiar únicamente el número en la interfaz web no sería suficiente. La capacidad debe convertirse en una configuración compartida por web, backend y app móvil.

El proyecto ya dispone de una configuración global en Firestore mediante `site_config/main`, con campos como:

- `startHour`
- `endHour`
- `slotInterval`
- `bonoExpirationMonths`
- `maintenanceMode`

Este documento propone ampliar esa misma configuración en lugar de crear un sistema paralelo.

---

# 2. Fase 1 — Capacidad global configurable

## Requisito

El cliente quiere poder modificar el número máximo de personas que pueden reservar simultáneamente en una misma franja horaria.

Por ahora se implementará una única capacidad global para todas las franjas.

No se implementará todavía capacidad diferente por hora o por día.

## Configuración propuesta

Añadir a `site_config/main`:

```text
maxCapacity: 5
```

El valor será configurable desde el panel de administración.

Rango permitido recomendado:

```text
mínimo: 1
máximo: 10
```

## Compatibilidad

Mientras el documento de Firestore no tenga el nuevo campo, todos los clientes deben usar:

```text
maxCapacity = 2
```

como fallback.

Esto es importante para que desplegar el código no cambie automáticamente el comportamiento actual.

Solo cuando el administrador guarde explícitamente un nuevo valor, por ejemplo `5`, el sistema pasará a permitir hasta 5 personas simultáneas.

## Interfaz del admin

En la sección Configuración se añadirá una nueva card a la derecha de `Configuración de Bonos`.

En escritorio ambas cards ocuparán la misma fila:

```text
┌─────────────────────────────┐  ┌─────────────────────────────┐
│ Configuración de Bonos      │  │ Capacidad por franja       │
│                             │  │                             │
│ Validez: [ 1 ] meses        │  │ Máximo: [ 5 ] personas     │
│                             │  │                             │
│ [ Guardar configuración ]   │  │ [ Guardar capacidad ]      │
└─────────────────────────────┘  └─────────────────────────────┘
```

Texto recomendado:

> Define el número máximo de clientes que pueden reservar simultáneamente en una misma franja horaria.

## Fuente única de verdad

A partir de esta implementación, la capacidad no debe mantenerse mediante constantes independientes.

La arquitectura objetivo es:

```text
site_config/main.maxCapacity
             │
      ┌──────┼──────┐
      ▼      ▼      ▼
     Web   Backend  Flutter
```

Todos deben aplicar exactamente el mismo valor y el mismo fallback.

## Cambios conceptuales por componente

### Web/admin

- Extender `SiteConfig` con `maxCapacity`.
- Normalizar el campo con fallback a `2`.
- Añadir la nueva card de configuración.
- Sustituir las comprobaciones del admin basadas en una constante fija por `siteConfig.maxCapacity`.

### Cloud Functions

- Extender el modelo interno de `SiteConfig`.
- Leer y normalizar `maxCapacity`.
- Sustituir las validaciones basadas en `MAX_CAPACITY = 2` por la capacidad configurada.
- Mantener las validaciones de ocupación actuales; solo cambia el límite.

### Flutter

- Extender el modelo `SiteConfig` con `maxCapacity`.
- Usar el valor recibido de Firestore para determinar si una duración/franja está llena.
- Eliminar la dependencia funcional de una capacidad fija de 2.
- Mantener fallback a 2 para configuraciones antiguas.

## Resultado esperado

Con `maxCapacity = 5`:

```text
0 reservas -> 5 plazas disponibles
1 reserva  -> 4 plazas disponibles
2 reservas -> 3 plazas disponibles
3 reservas -> 2 plazas disponibles
4 reservas -> 1 plaza disponible
5 reservas -> completo
```

La capacidad representa personas simultáneas, no el número de entrenadores.

No debe calcularse automáticamente como `trainers.length`, ya que Focus Club puede tener 3 entrenadores y aun así permitir hasta 5 clientes simultáneos.

---

# 3. Fase 2 — Actualización obligatoria de la app móvil

## Motivo

Cambios como la capacidad dinámica crean un problema de compatibilidad con versiones antiguas de Flutter.

Ejemplo:

```text
Backend/configuración nueva: capacidad = 5
App antigua: capacidad hardcodeada = 2
```

Una app antigua podría mostrar una franja como completa cuando en realidad aún quedan plazas.

Por ello se propone incorporar control de versión mínima en la app móvil.

## Limitación importante

Una versión que ya está instalada y que no contiene esta comprobación no puede recibir retroactivamente una pantalla de actualización obligatoria.

Es decir, la primera versión que incorpore esta funcionalidad será la base para poder forzar actualizaciones en versiones posteriores.

No es posible obligar al sistema operativo a instalar automáticamente una actualización, pero sí impedir que una versión compatible con este mecanismo continúe navegando por la app si está por debajo de la versión mínima exigida.

## Configuración propuesta

Ampliar `site_config/main` con campos de control de versión, preferiblemente usando build numbers enteros:

```text
minAndroidBuild: 1
minIosBuild: 1
latestAndroidBuild: 1
latestIosBuild: 1
```

También conviene disponer de URLs de tienda configurables o constantes bien centralizadas:

```text
androidStoreUrl: ...
iosStoreUrl: ...
```

Los campos `latest*` son opcionales para el bloqueo, pero permiten diferenciar en el futuro entre actualización recomendada y actualización obligatoria.

## Flujo de arranque

La app obtiene su build instalado y la configuración remota:

```text
Abrir Focus Club
      │
      ▼
Leer build instalado
      │
      ▼
Leer minAndroidBuild / minIosBuild
      │
      ▼
¿build instalado >= build mínimo?
   │                         │
   sí                        no
   │                         │
   ▼                         ▼
App normal        Pantalla bloqueante de actualización
```

## Pantalla bloqueante

Texto orientativo:

> Actualización necesaria
>
> Hemos publicado una nueva versión de Focus Club necesaria para seguir utilizando la aplicación.

Acción:

```text
[ Actualizar ahora ]
```

El botón abrirá directamente Google Play o App Store según la plataforma.

No habrá opción de continuar con una versión inferior a la mínima.

## Administración

A medio plazo estos valores pueden administrarse desde Configuración del panel web para no necesitar un nuevo despliegue cada vez que se quiera elevar la versión mínima.

La modificación de versiones mínimas debe estar claramente diferenciada de otras configuraciones para evitar bloquear usuarios por accidente.

## Despliegue recomendado

La primera publicación debe incluir simultáneamente:

- lectura de `maxCapacity` dinámica;
- soporte para `minAndroidBuild` / `minIosBuild`;
- pantalla de actualización obligatoria.

A partir de esa versión, las siguientes actualizaciones podrán bloquear versiones anteriores de forma controlada.

Para la transición inicial hay que recordar que las versiones previas a este mecanismo no pueden mostrar el bloqueo remoto.

Como medida de seguridad, no se debe elevar de forma agresiva `maxCapacity` sin tener en cuenta que usuarios con una versión antigua podrían seguir viendo disponibilidad calculada con capacidad 2.

---

# 4. Fase 3 — Citas/entrenamientos recurrentes

## Necesidad del cliente

El cliente quiere poder configurar entrenamientos repetitivos por semanas.

Ejemplo:

```text
Cliente: María
Día: lunes
Hora: 10:00
Duración: 60 min
Frecuencia: cada 1 semana
Hasta: fecha determinada
```

La idea es evitar crear manualmente una cita cada semana para clientes con horario fijo.

## Alcance funcional acordado

Al crear una cita desde el admin debe poder elegirse entre:

```text
- Una sola cita
- Repetir semanalmente
```

En una cita recurrente se definirá como mínimo:

- cliente;
- día/hora inicial;
- duración;
- entrenador cuando corresponda;
- frecuencia en semanas;
- fecha final o periodo de repetición.

La serie debe respetar disponibilidad y capacidad.

No debe permitirse crear una ocurrencia que exceda la capacidad de la franja.

También debe respetarse la lógica de bonos y minutos; una serie no puede tratarse como un simple duplicado masivo de citas aprobadas sin considerar el bono disponible y su caducidad.

## Principio de diseño

No se recomienda representar toda la recurrencia mediante una única cita especial.

Cada entrenamiento real debe seguir siendo una cita normal compatible con el sistema existente.

Ejemplo:

```text
Serie: María · lunes 10:00
              │
      ┌───────┼────────┐
      ▼       ▼        ▼
   7 sept   14 sept   21 sept
    cita      cita       cita
```

Cada ocurrencia conservará su propio `appointmentId`.

Además se añadirá metadata que permita saber que pertenece a una serie, por ejemplo:

```text
recurrenceSeriesId
recurrenceIndex
```

## Modelo recomendado de serie

Se recomienda una colección separada para la definición de la recurrencia, por ejemplo:

```text
appointment_recurrences/{seriesId}
```

Campos conceptuales:

```text
id
userId
serviceType
duration
assignedTrainer
startDate
startTime
intervalWeeks
endDate
status: active | cancelled
createdByAdminUid
createdAt
updatedAt
```

Las citas generadas pueden incluir:

```text
recurrenceSeriesId
recurrenceIndex
recurrenceDate
```

Esto permite gestionar la serie sin convertir las citas normales en un formato incompatible.

## Bonos y recurrencia

Este es el punto más sensible.

El sistema actual descuenta y devuelve minutos por cita mediante el lifecycle de appointments.

Por ello no se debe crear una serie larga como un bloque de citas aprobadas que descuente todos los minutos futuros de una sola vez sin validar el bono.

Ejemplo problemático:

```text
Bono vence el 30 de septiembre
Serie continúa hasta noviembre
```

La existencia de una recurrencia y la existencia de minutos disponibles no son exactamente el mismo concepto.

La implementación final debe decidir explícitamente cuándo se materializan las ocurrencias y cuándo se descuentan los minutos.

## Estrategia recomendada para V1

Para reducir riesgo, la primera versión debe ser finita y controlada:

1. El admin elige fecha inicial, frecuencia semanal y fecha final.
2. Antes de confirmar, el backend calcula todas las ocurrencias necesarias.
3. Se validan todas las fechas contra:
   - horario permitido;
   - bloqueos;
   - capacidad global;
   - conflictos del cliente;
   - bono/minutos disponibles según las reglas definidas.
4. Si alguna ocurrencia no puede crearse, no se debe crear una serie parcialmente sin informar claramente.
5. Una vez validada, cada fecha se crea como una cita normal vinculada a `recurrenceSeriesId`.

La validación debe ser transaccional o estar protegida contra carreras para evitar sobrepasar la capacidad cuando dos operaciones se realizan simultáneamente.

## Posibles políticas ante conflicto

La V1 debe escoger una política clara. La recomendación inicial es:

```text
Si una fecha de la serie no está disponible -> no crear la serie completa.
```

Es más predecible que crear silenciosamente solo algunas semanas.

Una mejora posterior podría permitir:

```text
Crear las fechas disponibles y mostrar las excepciones
```

pero no es necesaria para la primera versión.

## Gestión posterior de una serie

No es necesario implementar toda la potencia de un calendario profesional en la V1.

Capacidades recomendadas para una primera iteración:

- crear serie semanal;
- ver que una cita pertenece a una serie;
- cancelar/desactivar la serie;
- cancelar una ocurrencia concreta si el flujo actual ya lo permite de forma segura.

Funciones que pueden dejarse para una fase posterior:

- modificar toda la serie;
- cambiar entrenador de toda la serie;
- mover todas las futuras;
- editar una única ocurrencia conservando la serie;
- recurrencias con múltiples días por semana;
- series indefinidas sin fecha final.

## Google Calendar

Las ocurrencias seguirán siendo documentos normales de `appointments`.

Por tanto, la sincronización actual con Google Calendar debería continuar trabajando a nivel de cada cita individual.

No se recomienda introducir una segunda sincronización específica de recurrencias mientras el flujo actual por appointment siga siendo suficiente.

Cada ocurrencia creada debe poder generar/actualizar/eliminar su correspondiente evento de Google Calendar mediante el mecanismo ya existente.

---

# 5. Orden recomendado de implantación

## Paso 1 — Preparar configuración compartida

Añadir y normalizar:

```text
maxCapacity
minAndroidBuild
minIosBuild
latestAndroidBuild
latestIosBuild
```

Mantener fallbacks seguros.

## Paso 2 — Actualizar Flutter

Publicar una nueva versión que:

- use `maxCapacity` desde `site_config`;
- soporte actualización obligatoria;
- siga funcionando con configuraciones antiguas mediante fallback.

## Paso 3 — Actualizar backend y admin

Desplegar:

- Cloud Functions usando `maxCapacity` dinámico;
- card de capacidad global en Configuración;
- controles de versión cuando se decida exponerlos en el admin.

## Paso 4 — Cambiar capacidad real

Una vez validada la nueva versión, cambiar desde el admin:

```text
maxCapacity = 5
```

## Paso 5 — Diseñar e implementar recurrencias

Tratar las citas recurrentes como una funcionalidad independiente, con tests específicos de:

- capacidad;
- concurrencia;
- bonos;
- expiración;
- cancelaciones;
- Google Calendar.

---

# 6. Riesgos principales

## Inconsistencia entre versiones

Una app antigua con capacidad fija 2 puede mostrar información distinta al backend configurado a 5.

Mitigación:

- capacidad remota;
- actualización obligatoria en nuevas versiones;
- rollout controlado.

## Sobreocupación

La capacidad no puede validarse únicamente en UI.

El backend debe seguir siendo la autoridad final.

## Bonos en series recurrentes

Crear muchas citas futuras puede consumir o bloquear minutos de forma incorrecta si no se define cuándo se descuenta cada sesión.

La recurrencia debe reutilizar el lifecycle existente de bonos en lugar de saltárselo.

## Series parcialmente creadas

Si una semana está llena, crear únicamente el resto de semanas puede generar confusión.

Para V1 se recomienda una operación todo-o-nada o, como mínimo, una confirmación explícita de las excepciones antes de crear nada.

## Versiones mínimas mal configuradas

Un build mínimo incorrecto podría bloquear usuarios válidos.

Debe existir validación en el admin y una forma clara de revertir el valor.

---

# 7. Pruebas mínimas necesarias

## Capacidad global

- fallback a 2 cuando `maxCapacity` no existe;
- valores 1 y 10;
- rechazo de valores fuera de rango;
- creación con capacidad disponible;
- rechazo con capacidad completa;
- reprogramación respetando capacidad;
- admin y Flutter muestran la misma disponibilidad.

## Actualización obligatoria

- build igual al mínimo: permite entrar;
- build superior: permite entrar;
- build inferior: bloquea;
- URL correcta según Android/iOS;
- comportamiento razonable ante fallo temporal al cargar configuración.

## Recurrencias

- serie semanal simple;
- frecuencia cada 2 semanas;
- fecha final;
- cambio de mes/año;
- una fecha bloqueada;
- una fecha completa;
- conflicto con otra cita del mismo usuario;
- bono insuficiente;
- bono que expira antes del fin de la serie;
- rollback/no creación parcial cuando falla una ocurrencia;
- generación de Google Calendar por cada cita creada.

---

# 8. Fuera de alcance inicial

No forma parte de la primera implementación:

- capacidad distinta por cada franja;
- capacidad por entrenador;
- cálculo automático de capacidad a partir del número de entrenadores;
- recurrencias diarias/mensuales complejas;
- múltiples días de la semana en una misma serie;
- recurrencias infinitas;
- sustitución del sistema actual de citas por un nuevo motor de calendario.

---

# 9. Criterio general de arquitectura

El sistema debe seguir manteniendo `appointments` como unidad real de entrenamiento/reserva.

Las nuevas funcionalidades deben añadir configuración y automatización alrededor del flujo existente, no crear un segundo sistema incompatible.

Objetivo final:

```text
                 site_config
              /       |       \
      capacidad    versiones   horarios
          |             |          |
          ▼             ▼          ▼
        Web          Flutter     Backend
          \             |          /
           \            |         /
                    appointments
                         |
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
       ocupación       bonos     Google Calendar
                         |
                         ▼
                recurrenceSeriesId
                 (cuando aplique)
```

Esta aproximación permite evolucionar Focus Club sin romper las reservas ya existentes ni duplicar la lógica crítica de negocio.
