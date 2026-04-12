# Google Reviews -> Make -> Firestore

Automatizacion semanal para alimentar la seccion "Historias de Transformacion" de la home.

## Credenciales necesarias

- Acceso de propietario o gestor a Google Business Profile de Focus Club.
- Proyecto de Google Cloud con Google Business Profile APIs habilitadas/aprobadas.
- OAuth en Make conectado a Google Business Profile.
- `accountId` y `locationId` de la ficha de Focus Club.
- Credencial de Firestore para Make con permisos minimos de lectura/escritura sobre `testimonials`.

## Scenario recomendado en Make

1. Scheduler semanal.
2. Google Business Profile: listar reviews de `accounts/{accountId}/locations/{locationId}`.
3. Filtrar:
   - `starRating` equivalente a 5 estrellas.
   - comentario/texto no vacio.
4. Buscar en Firestore `testimonials` por `googleReviewId`.
5. Si existe, actualizar. Si no existe, crear.
6. No borrar testimonios existentes si Google o Make falla esa semana.

## Mapping Firestore

Coleccion: `testimonials`

```json
{
  "name": "{{review.reviewer.displayName}}",
  "role": "Resena de Google",
  "content": "{{review.comment}}",
  "rating": 5,
  "approved": true,
  "source": "google",
  "googleReviewId": "{{review.reviewId || review.name}}",
  "reviewCreateTime": "{{review.createTime}}",
  "reviewUpdateTime": "{{review.updateTime}}",
  "importedAt": "{{now}}"
}
```

## Blueprint Make

El blueprint JSON importable esta separado en `docs/google-reviews-make.json`.

Importacion recomendada: en Make crea un scenario nuevo y usa `Scenario Builder > ... > Import blueprint`.
Despues de importar, abre los modulos y sustituye los placeholders. Las conexiones no viajan listas en un blueprint:

- `REPLACE_GOOGLE_ACCOUNT_ID`
- `REPLACE_GOOGLE_LOCATION_ID`
- `REPLACE_FIREBASE_PROJECT_ID`
- `REPLACE_GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN_OR_CONFIGURE_OAUTH`
- `REPLACE_FIRESTORE_ACCESS_TOKEN_OR_CONFIGURE_OAUTH`

Nota: el blueprint usa modulos HTTP genericos para que sea facil de adaptar aunque tu cuenta de Make no tenga modulos nativos exactos para Business Profile o Firestore. Si Make lo rechaza por validacion interna de modulos, crea el scenario con estos mismos pasos manualmente, exporta un blueprint vacio desde tu cuenta y se adapta sobre ese formato exacto.

## Comportamiento en la web

- La home muestra solo testimonios `approved`.
- Las resenas mas recientes suben primero usando `reviewCreateTime` o `importedAt`.
- La home limita la seccion a 3 tarjetas para conservar el diseno.
- El admin muestra una etiqueta interna `Google` en las resenas importadas.
