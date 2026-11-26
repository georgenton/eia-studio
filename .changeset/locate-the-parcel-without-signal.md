---
"@eia/field-sync-contract": minor
"@eia/application": minor
"@eia/web": minor
"@eia/field": minor
---

**Ubicar predio**: el mapa del predio asignado, dibujado con la geometría del propio proyecto y sin
proveedor de mosaicos, de modo que sobrevive a un cierre forzado y a una semana sin señal. Recurso
cartográfico **aparte** —`POST /api/field/v4/map`, con su propio esquema— y no un campo del Field
Pack, cuyos esquemas son `.strict()` y viajan del servidor al dispositivo: ahí un campo nuevo es un
error de análisis en todo APK instalado. Lleva el predio (contorno, o un punto de referencia
identificado como tal), el eje como contexto, los hitos kilométricos con su sitio, el norte, la
escala y «Mi ubicación» con su precisión dibujada. Alcanzado por la política de filas: un
dispositivo no puede saber qué predios tiene otro técnico. Migración local 7 para guardarlo.
