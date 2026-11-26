---
"@eia/field": patch
---

La fotografía se conserva antes de pedir la ubicación. `captureMedia` ya no recibe coordenadas:
copia el archivo al directorio de la aplicación y escribe la fila marcada `pending`, y la posición
se adjunta después con una espera acotada de 12 s. `getCurrentPositionAsync` no tiene tiempo máximo
propio, así que la orden anterior —ubicar y luego persistir— dejaba la fotografía en la caché de la
cámara durante una espera sin límite. La fila guarda ahora el resultado (`captured`, `denied`,
`timed_out`, `unavailable`), el instante del posicionamiento aparte del disparo, y si la plataforma
informó que la posición es simulada. Nada sustituye una posición ausente.
