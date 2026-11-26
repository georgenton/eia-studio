---
"@eia/web": minor
"@eia/domain": minor
"@eia/application": minor
"@eia/i18n": minor
"@eia/db": minor
---

El mapa puede colorearse por avance de campo además de por estado cartográfico, con su propia
leyenda, y las cifras salen de un contador privilegiado (migración 0062) para que un rol que puede
leer la cartografía y no las respuestas vea el avance real en vez de un corredor entero «sin
asignar». Quien no tiene `field.read` recibe una negativa con su motivo, nunca un mapa de ceros.
