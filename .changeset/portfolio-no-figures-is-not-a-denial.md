---
"@eia/application": patch
---

La cartera dejó de llamar denegación a la ausencia de cifras. `metricsRestricted` se calculaba a
partir de que no volvieran filas de métricas y de un permiso de proyecto que nadie tiene en el
alcance de la organización, de modo que cualquier integrante de un proyecto que todavía no había
producido una cifra veía un panel de *permiso denegado* diciendo que su rol administra la
organización y no accede a los datos. Ahora la bandera se calcula con `app.has_project_access` por
proyecto: se muestra sólo cuando quien mira no puede abrir ninguno de los proyectos que ve, que es
el caso del ADMIN de organización sin asignación (D-015) para el que se escribió ese texto.
