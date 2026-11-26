---
"@eia/application": patch
"@eia/field": patch
---

El mapa del teléfono llevaba como *condición* el registro completo del contrato de importación —
trescientos caracteres de JSON en un campo de cuarenta—, y el esquema estricto del dispositivo
rechazaba **el mapa entero**. Se observó en el emulador; el servidor lo producía tan contento. Ahora
se extrae sólo la condición declarada, y una nota que no se pueda leer queda en nulo en vez de
truncarse en algo que parezca una declaración. El `versionCode` sube a 10 · 2 · 2 porque
`EIA_FIELD_VERSION_CODE` no llega a una compilación en la nube —sólo viaja el bloque `env` de
`eas.json`—, de modo que dos artefactos distintos salieron con el código 9.
