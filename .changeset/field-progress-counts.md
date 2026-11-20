---
"@eia/application": patch
"@eia/db": patch
---

Trabajo de campo contaba cero para quien no lee respuestas individuales

Un **Gestor de información** abría *Trabajo de campo*, veía la campaña correcta y veía
`0 asignadas · 0 pendientes · 0 enviadas` para una operación que la coordinación leía como 13 y 8.
Nada fallaba, nada se negaba, y el número era falso: los recuentos eran agregados sobre
`app.field_assignment`, cuya política admite una fila sólo si es del propio llamador o si tiene
`field.responses.read`. A Cartografía/SIG le ocurría lo mismo.

Negar la pantalla habría contradicho lo que el rol promete («campañas, asignaciones, recuentos»),
así que **cuántos** deja de exigir permiso para leer **cuáles**: los recuentos salen de dos
funciones privilegiadas que devuelven enteros e identificadores y no tienen dónde poner una
respuesta. Abrir la ficha de un hogar no cambia: sigue exigiendo `field.responses.read`.

La autorización no se relaja. Pertenecer al proyecto no es el permiso —un técnico pertenece y no
debe obtener el resumen—, así que la puerta es el propio `field.read` resuelto, llevado a la
transacción como ya se llevan `field.responses.read` y `pii.read`. Un contexto ausente, un
argumento que contradice el proyecto activo, un proyecto sin acceso o un llamador sin el permiso
son **rechazados con error**, nunca con cero: devolver vacío habría reproducido el defecto una
capa más abajo.

Schema-impact: migración 0059 — cuatro funciones nuevas en `app` y las concesiones mínimas de
lectura y ejecución. Sin cambios de tablas, columnas, políticas ni datos; la reversión es borrar
las funciones y revocar.
Tenancy-impact: las dos funciones de recuento leen con BYPASSRLS y por eso comprueban ellas mismas
el acceso al proyecto, el permiso y la coherencia del contexto. Registradas como su propia clase
en el contrato de endurecimiento, con controles negativos ejecutados como `eia_app`.
