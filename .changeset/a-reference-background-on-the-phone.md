---
"@eia/field-sync-contract": minor
"@eia/application": minor
"@eia/contracts": minor
"@eia/domain": minor
"@eia/field": minor
"@eia/web": minor
---

El mapa del dispositivo puede dibujar un **fondo cartográfico de referencia** bajo el croquis, con
desplazamiento, acercamiento y centrado, y el croquis se conserva intacto debajo. La versión 3 del
recurso de mapa se negocia por petición —una aplicación ya instalada sigue recibiendo byte por byte
lo que recibía— y lleva `referenceBasemap`, que el servidor resuelve desde `MAPTILER_MOBILE_KEY`.

Un teléfono no es un navegador: la clave del navegador está restringida por origen permitido y una
aplicación nativa no envía `Referer`, así que son **dos claves distintas** y la del navegador nunca
se sustituye por la otra. Sin clave, la pantalla dibuja el croquis y dice en esas palabras que no
hay fondo cartográfico; nunca presenta un croquis como fondo.
