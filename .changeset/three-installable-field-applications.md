---
"@eia/field": minor
---

EIA Field es tres aplicaciones instalables: demo, pruebas y producción, con identificador de
paquete, esquema de enlace, nombre y base de datos propios. `app.json` pasa a `app.config.ts`
porque un manifiesto estático describe un solo paquete, e instalar producción sobre el paquete de
pruebas sería una *actualización*: heredaría su base cifrada, su sesión y cualquier captura sin
entregar. Pruebas conserva `ec.eiastudio.field` —es la instalación que existe— y los otros dos
estrenan identidad. El perfil de producción deja de apuntar a `REPLACE-WITH-PRODUCTION-HOST` y de
construir un paquete de tienda: los tres ambientes producen APK de distribución interna.
