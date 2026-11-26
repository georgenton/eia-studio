---
"@eia/field-sync-contract": minor
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/web": minor
"@eia/field": minor
---

La procedencia de la ubicación de una fotografía llega hasta quien puede leerla. El dispositivo
guardaba cuatro hechos desde su migración 5 y sólo tres viajaban; el resto moría al confirmar y
barrer la fila local. Migración 0061: `location_outcome`, `location_mocked` y `location_source` en
`app.field_media`, los tres anulables, y **nulo significa desconocido**, que no es lo mismo que «no
hubo posición» —eso ya lo dice un `location` nulo—. Compatible por dirección y no por versión: la
declaración viaja del dispositivo al servidor, y un esquema `.strict()` rechaza campos
*desconocidos*, no ausentes, de modo que un APK instalado sigue funcionando sin cambios. La lectura
autorizada muestra el resultado del intento, el proveedor y, en rojo y antes de las coordenadas,
**POSICIÓN SIMULADA** cuando la plataforma lo informó: todo emulador informa eso, y un punto
simulado leído como medición es el error que estos campos existen para impedir.
