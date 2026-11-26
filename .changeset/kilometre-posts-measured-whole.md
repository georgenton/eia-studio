---
"@eia/domain": minor
"@eia/application": minor
---

Los hitos kilométricos se miden sobre la ruta entera y en metros. `ChainageFrame` separa dos cosas
que el código auditado confundía: la distancia recorrida es una medición, y la abscisa es una
declaración —dónde está el 0+000 y hacia dónde corren los números—. `measureRoute` transforma una
sola vez al `analysis_srid` del propio conjunto de datos y mide con `ST_LineMerge` sobre la
geometría completa; si tras unir lo que se toca siguen quedando varias partes, la entrega tiene
huecos o ramales y **no se mide nada**, porque unirlos convertiría carretera ausente en longitud y
correría todas las abscisas posteriores. `milestonesFor` coloca un poste en cada kilómetro entero
que la vía recorre, con origen distinto de cero y con dirección inversa, y ninguno en los extremos
salvo que caigan en un kilómetro.
