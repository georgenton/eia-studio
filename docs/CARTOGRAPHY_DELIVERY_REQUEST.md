# Lo que hace falta que entregue Carlos, y qué función depende de cada archivo

> Una sola solicitud, como pide el encargo del 26 de noviembre de 2026. Cada fila dice **qué deja
> de funcionar** si ese archivo no llega, para que la decisión de qué priorizar sea de quien
> entrega y no nuestra.
>
> Estado al escribir esto: **no hay ningún archivo de Carlos en esta máquina**. Se buscó en
> `~/Documents`, `~/Downloads`, `~/Desktop`, iCloud Drive y el repositorio, por nombre y por
> extensión (`.shp`, `.kmz`, `.kml`, `.dwg`, `.dxf`, `.geojson`, `.gpkg`). Mientras no lleguen, la
> implementación y las pruebas avanzan con **geometría sintética identificada como tal**, que nunca
> se presenta como cartografía oficial del cliente.

## 1 · Qué se necesita, en orden de lo que bloquea

| # | Archivo | Qué deja de funcionar sin él | Imprescindible para el piloto |
|---|---|---|---|
| 1 | **Eje actual de la vía** — una polilínea, continua | Todo lo lineal: la vía en el mapa, los hitos kilométricos, la abscisa y el lado de cada predio, el contexto que el teléfono descarga para *Ubicar predio* | **Sí** |
| 2 | **Predios con su identificador estable** — polígonos + el campo que los nombra | El explorador de predios, la asignación de trabajo, la ficha por predio, el avance de campo. Sin un identificador estable no hay a qué volver en una revisita | **Sí** |
| 3 | **Abscisado oficial** — hitos o, como mínimo, la abscisa del primer y último vértice del eje y hacia dónde corren los números | Los hitos se dibujan igual, pero rotulados como **distancia calculada** y no como el abscisado del estudio. Un poste que diga `3+000` sin que nadie haya comprobado dónde está el 0+000 es una referencia inventada, y un técnico navegaría por ella | Deseable |
| 4 | **Eje de diseño o implantación propuesta** | La comparación *actual frente a propuesto*. Sin él hay una sola capa y la comparación no existe; no se dibuja un diseño a partir del satélite | No |
| 5 | **Área de influencia social directa** | La capa correspondiente. Un buffer automático alrededor de la vía **no** acredita el área social de un estudio y no se va a generar | No |
| 6 | **Área de influencia social indirecta** | Igual que la anterior | No |

## 2 · Qué tiene que venir dicho con cada archivo

Esto no es burocracia: el importador lo exige y **no lo deduce**.

| Dato | Por qué se declara en vez de inferirse |
|---|---|
| **Sistema de coordenadas (EPSG)**, datum y, si es UTM, **zona y hemisferio** | Es el único error de este tipo que produce un mapa entero verosímil y desplazado. El producto nunca deduce la zona por estar en Ecuador |
| **Unidades** | Para distinguir metros de pies antes de medir nada |
| **Qué representa exactamente el eje propuesto** | Eje de diseño, huella de intervención, plataforma o derecho de vía son cuatro cosas distintas y se dibujan distinto. No se va a adivinar cuál es |
| **Campo que contiene el código del predio** | Se nombra, no se adivina: `parcelCodeField` es obligatorio |
| **Fecha y versión de la entrega** | Una corrección posterior es una **versión nueva** que sustituye, nunca una sobreescritura |
| **Condición**: borrador preliminar o definitivo | Se guarda con la cartografía y se muestra en pantalla |

## 3 · Formatos

- **Preferido: GeoJSON** (`FeatureCollection`), un archivo por capa. Es lo que el importador lee
  hoy, sin conversión intermedia.
- **Shapefile** (`.shp` + `.dbf` + `.shx` + `.prj`) o **GeoPackage** sirven: se convierten aquí, y
  el `.prj` es justamente la declaración del sistema de coordenadas de la fila anterior.
- **KMZ/KML** sirve para el eje, con la salvedad de que KML es siempre WGS 84 y pierde los
  atributos de los predios.
- **DWG/DXF** es lo más costoso: suele venir sin sistema de coordenadas declarado y con la
  geometría en coordenadas de dibujo. Si sólo hay CAD, hace falta además el archivo de
  georreferenciación o los puntos de control.

## 4 · Lo que no se va a hacer con estos archivos

Dicho por adelantado, para que nadie lo espere:

- **No se recalculan las abscisas ya almacenadas** de un proyecto existente. Un valor guardado es
  una referencia que otras filas y un estudio impreso ya citan (TD-132).
- **No se unen tramos discontinuos.** Si el eje llega en piezas que no se tocan, el producto lo
  informa y no mide: unirlas convertiría carretera ausente en longitud y correría todas las
  abscisas posteriores al hueco.
- **No se genera un área de influencia** a partir de un buffer, ni un diseño vial a partir de una
  imagen satelital.
- **No se descargan mapas base del proveedor** para uso sin conexión. El mapa del teléfono se
  dibuja con la geometría propia del proyecto; una capa de referencia externa es opcional y está
  sujeta a su licencia.

## 5 · Cómo entregarlos

Una carpeta por capa o un ZIP, por el canal privado habitual. **No** por un enlace público. Al
llegar se registran su nombre, su SHA-256 y la fecha, de modo que cualquier cifra en pantalla se
pueda rastrear hasta el archivo del que salió.
