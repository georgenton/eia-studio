---
"@eia/field": patch
---

Cuatro defectos del contrato de ejecución del móvil. **demo** entra en `APP_ENVIRONMENTS`: `eas.json`
y `app.config.ts` ya lo admitían y `src/config.ts` no, así que `readEnvironment("demo")` lanzaba y el
APK de demostración no podía construir su cliente de autenticación. Los tres orígenes distribuidos se
comparan ahora **exactos** —demo, pruebas y producción—, porque todo error interesante es un cruce.
El esquema de enlace deja de estar fijado a `eiafield` y sale del ambiente: con tres paquetes
instalables, una devolución de inicio de sesión iba al que reclamara el esquema. Y la carrera que
costaba la ubicación: liquidar las filas `pending` antes de sincronizar descartaba una solicitud GPS
viva, de modo que la respuesta llegaba y no actualizaba ninguna fila; una fila `pending` ahora nombra
la ejecución que la espera y sólo se liquidan las de otras. «Iniciar visita» también acota su espera.
