---
"@eia/application": minor
---

Los hitos kilométricos tienen sitio, no sólo etiqueta: `loadCorridorMilestones` interpola cada poste
sobre **la misma ruta métrica** de la que salió la longitud y devuelve su coordenada en EPSG:4326,
además de los dos extremos de la ruta unida —porque `ST_LineMerge` no demuestra por sí solo la
orientación declarada—. Y el importador de vías aplica ya la medición correcta a las **escrituras
nuevas**: ruta entera, una sola transformación al `analysis_srid` del conjunto de datos, y fracción y
longitud tomadas sobre esa ruta proyectada. Una entrega cuyas piezas no se tocan se rechaza en vez de
medirse. Ninguna abscisa histórica se recalcula (TD-132).
