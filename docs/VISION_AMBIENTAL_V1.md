# Visión Ambiental — incorporación, bloque 1

> Estado: **preparado para importar**, no importado. Nada se creó en DEMO, STAGING ni PRODUCCIÓN,
> y ninguna cartografía cruda salió de este portátil. Rama `feat/vision-ambiental-v1`.
> Los bloques siguientes continúan en esa misma rama.

## 1. Alcance confirmado

| | |
|---|---|
| Consultora | **Visión Ambiental** · slug propuesto `vision-ambiental` (sin confirmar) |
| Encargo | **CONSULTORÍA DE APOYO AMBIENTAL Y SOCIAL** — una **etiqueta**, no una entidad nueva |
| Vías | cuatro, cada una un proyecto operativo, con la grafía recibida |

Las cuatro, tal como las escribió el propietario, y la carpeta con la que llegaron:

| clave | nombre recibido | carpeta entregada |
|---|---|---|
| `campozano-pajan` | Via Campozano - Paján | `1_CAMPOZANO_PAJAN` |
| `bramadora-la-alegria` | Vía Bramadora - La alegria | `2_BRAMADORA_LA_ALEGRIA` |
| `colorado-venado` | Via Colorado - Venado | `3_COLORADO_VENADO` |
| `y-de-san-pablo-naranjos` | Via Y de San Pablo - Naranjos | `4_Y_DE_SAN_PABLO_LOS_NARANJOS` |

El encargo general no crea jerarquía: este producto no tiene entidad entre *tenant* y *proyecto*,
y no se inventa una para sostener un título. Queda como etiqueta en el manifiesto hasta que el
propietario decida si es copia del espacio o convención de nombres.

**EIA Studio no se renombra**, y los ocho proyectos sintéticos de DEMO no se tocan.

## 2. Lo que la entrega contiene de verdad

El hallazgo principal de este bloque, y conviene leerlo antes que nada:

> **La cartografía entregada son láminas impresas, no datos SIG.** 77 JPG + 78 PDF + 2 XLSX.
> Ni un `.shp`, `.gdb`, `.kml`, `.geojson`, `.tif`. No hay geometría, no hay CRS declarado, no hay
> objetos que contar ni extensión espacial que medir.

Consecuencia directa: **el importador GIS no puede aceptar nada de esta entrega.** El camino que el
producto tiene hoy para cartografía consultable es GeoJSON por conjunto de datos de proyecto; una
lámina renderizada no es una capa, y llamarla así produciría cartografía que nadie puede consultar.
Las láminas sí son candidatas naturales al **corpus documental** (`core.documents`), que es donde
un PDF entregado pertenece — eso es decisión de un bloque posterior, no de éste.

Estructura, idéntica en las siete carpetas: `MAPAS/JPG` y `MAPAS/PDF` con once láminas numeradas
`01`…`11` (cartografía base, ubicación político-administrativa, cobertura vegetal, áreas naturales,
tipo de clima, pisos bioclimáticos, ecosistemas, imagen satelital, isoyetas, isotermas, estaciones).

Lo que la entrega trae **además** de lo confirmado, y que no se convierte en proyecto:

- `5_CRISTOBAL_COLON_PUENTE_BI_PROVINCIAL`, `6_VIA_QUININDE_KM13_VELASCO_IBARRA`,
  `8_EL_ARENAL_VICENTINO` — tres vías más, presentes en la cartografía. **No se inventaron: llegaron.**
- **La carpeta 7 no está.** La numeración va 1–6 y 8.

Hechos de la propia entrega, sin interpretar:

- Sólo la vía 1 trae `XLS/`: `01_RUTA.xlsx` (*RUTA: CAMPOZANO - PAJÁN*, *DISTANCIA: 5,36 km*) y
  `02_UBICACION_POLITICA_ADMINISTRATIVA.xlsx` (parroquias **PAJÁN / CAMPOZANO**, cantón **PAJAN**,
  provincia **MANABÍ**). Las otras seis vías no traen distancia ni ubicación.
- La lámina 11 se llama `ESTACIONES_METEOROLOGICAS` en las vías 1–3 y `ESTACIONES_CERCANAS` en las
  4, 5, 6 y 8. Se conserva como llegó.
- La vía 2 trae un PDF de más: `09_ISOYETAS_08.pdf` (29 MiB) junto a `09_ISOYETAS.pdf`.
- `04_ÁREAS_NATURALES` lleva tilde en mayúscula en el nombre del archivo.
- El archivo se llama **CARTO_PROVIAL_BDE**; el propietario lo describió como «Carto Provial **VDE**».
  Una letra. El tamaño coincide exactamente con lo comunicado, así que es casi seguro el mismo
  archivo — pero no lo doy por resuelto.

**Lo que no verifiqué:** ninguna geometría, porque no hay ninguna. No abrí ni una lámina: el
inventario se hizo sobre el directorio central del ZIP y sobre los dos XLSX, que son 19 KB. No hay
GDAL ni QGIS en este equipo; para una entrega SIG real haría falta **GDAL/OGR** (`ogrinfo`), y no lo
instalé.

## 3. Datos personales

La entrega **no contiene datos personales**: son láminas temáticas y dos hojas con topónimos. Los
nombres del equipo llegaron por conversación, no en el archivo, y viven sólo en el manifiesto
privado. Ningún nombre, fotografía ni documento de persona se publica aquí.

## 4. Módulos existentes que se reutilizan

Se revisaron antes de escribir nada. Ninguno se duplica:

| necesidad | caso de uso existente |
|---|---|
| crear la consultora | `createTenant` (`tenancy/tenants.ts`) |
| membresía de espacio | `addTenantMembership` |
| crear cada vía | `createProject` + `createProjectInputSchema` |
| membresía por proyecto | `addProjectMembership` |
| identidad | `ensureUser` — el id **es** el `subject` de la sesión |
| contexto y permisos | `buildRequestContext` / `resolveAccessContext` |
| preparación del proyecto | `loadProjectIntake`, `updateProjectIntake`, `activateProject` |
| cartera | `listPortfolio`, `loadPortfolio` |
| cartografía | conjunto de datos de proyecto en GeoJSON (patrón de `seed-demo-project.ts`); **no hay importador genérico** |

No se creó motor de roles, ni framework ETL, ni SQL de aprovisionamiento.

## 5. El manifiesto y el ejecutor

El manifiesto es **datos fuera del código**, en un fichero privado por encargo, porque lleva los
nombres del equipo y llevará sus correos:

```
~/.config/syntavera/work/eia-vision-ambiental/manifest.vision-ambiental.json   (modo 600)
~/.config/syntavera/work/eia-vision-ambiental/inventory/zip-raw.json           (inventario íntegro)
```

El esquema y el planificador viven en `packages/application/src/intake/consultancy-manifest.ts`.
`plan(manifest, snapshot)` es **puro**: no escribe, no abre transacción y no llega a la red. Cuatro
resultados, y los tres que no son «sí» llevan el motivo:

| resultado | significado |
|---|---|
| `would_create` | no existe y el manifiesto dice lo suficiente |
| `exists` | ya está, por identificador estable — repetir la carga no propone nada |
| `requires_review` | el manifiesto **se niega** a decidirlo (un correo sin confirmar no se rellena) |
| `not_supported` | el producto no tiene camino para eso (una lámina no es una capa) |

Ejecución:

```bash
pnpm intake:plan -- --manifest ~/.config/syntavera/work/eia-vision-ambiental/manifest.vision-ambiental.json
```

`--apply` **se rechaza** con código 2, no se ignora: aplicar exige destino explícito y una
autorización que este script no puede comprobar, y un interruptor que no hiciera nada en silencio
sería peor que ninguno. La instantánea es hoy la vacía, y la salida lo dice en una línea: *nada se
comprobó contra ninguna base de datos*.

Resultado del ensayo sobre la entrega real: **se crearía 2 · ya existe 0 · requiere revisión 11 ·
no compatible 157**.

## 6. Decisiones pendientes

Ninguna se resuelve aquí.

1. Slug `vision-ambiental`: propuesto, sin confirmar.
2. El título del encargo: ¿copia del espacio o convención de nombres? No crea entidad.
3. **Ningún correo está confirmado** para las ocho personas, así que no hay identidad ni membresía
   que crear. Un correo deducido de un nombre es una invitación a un desconocido.
4. Nadie está designado OWNER ni ADMIN del nuevo espacio.
5. Membresía por proyecto: **vacía a propósito**. Los tres encuestadores no se asignan a las cuatro
   vías automáticamente.
6. **La facultad de Manuel.** Decidir qué técnico atiende cada predio es `field.assignments.manage`,
   que hoy sólo tiene `COORDINATOR`. `SOCIAL_SPECIALIST` no la tiene. Tres caminos, y la elección es
   del propietario: darle `COORDINATOR` en estas vías (le da bastante más, incluida
   `deliverables.approve`), añadir `field.assignments.manage` a `SOCIAL_SPECIALIST` (cambia el rol
   para todo proyecto de todo cliente), o un rol nuevo. **No se tocó nada.** La misma facultad
   **no está confirmada** para Alexys/Alexis García, cuyo alcance sigue siendo cartográfico.
7. Carlos Velasco: propuesto `VIEWER`. Ser director no es por sí mismo razón para
   `deliverables.approve` ni `pii.read`.
8. Las tres vías adicionales (5, 6, 8) y la ausencia de la 7.
9. `CARTO_PROVIAL_BDE` contra «VDE».
10. Qué se hace con 155 láminas: corpus documental, o nada por ahora.

Dos personas llegaron con dos grafías —**Manuel Maila / Manuel Mayla** y **Alexys García / Alexis
García**— y el manifiesto guarda ambas en una sola persona. No se eligió una: elegir en silencio
habría borrado la prueba de que la pregunta existió.

## 7. Pruebas ejecutadas

| | |
|---|---|
| `consultancy-intake.test.ts` | **14** pruebas unitarias: los cuatro resultados, y que un segundo plan sobre un producto que ya lo tiene propone **cero** |
| `consultancy-intake.integration.test.ts` | **3** contra PostgreSQL real y aislado (Testcontainers): crea el espacio y una vía **con los casos de uso del producto**, vuelve a planificar y comprueba que sólo queda la vía que falta |
| `pnpm intake:plan` | ejecutado sobre la entrega real |

La base local del propietario no se reseteó, y la suite de integración corre sobre un contenedor
desechable.

## 8. Qué sigue

- **Preparado para importar**: el espacio, las cuatro vías y la correspondencia de archivos.
- **No importado**: nada existe en ningún entorno.
- **No implementado, y no se declara implementado**: el CMS y las socializaciones.
- Bloquea el avance: los correos confirmados (3), el dueño del espacio (4) y la facultad de Manuel (6).
