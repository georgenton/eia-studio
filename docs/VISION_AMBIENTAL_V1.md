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

**Corregido el 6 oct 2026.** La redacción anterior declaraba toda la entrega libre de datos
personales, y eso excedía lo comprobado.

Lo verificado: los **dos XLSX**, que se leyeron enteros y contienen un nombre de ruta, una
distancia y topónimos — ningún dato personal. Lo **no verificado**: las **155 láminas** (77 JPG,
78 PDF), que no se abrieron. Son mapas temáticos y es poco probable que lleven datos personales,
pero nadie ha mirado, y un corpus en el valor por defecto es un corpus que nadie ha revisado. Antes
de publicar o indexar cualquiera de ellas hay que clasificarlas.

Los nombres del equipo llegaron por conversación, no en el archivo, y viven sólo en el manifiesto
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

**Qué es y qué no es ese resultado.** Es un plan contra la **instantánea vacía**: `--apply` no
existe, no se contrastó con ninguna base de datos, y «ya existe 0» significa *no se comprobó*, no
*no hay nada*. El bloque 1 dejó inventario y planificador; no dejó una carga.

## 6. Decisiones pendientes

Ninguna se resuelve aquí.

1. Slug `vision-ambiental`: propuesto, sin confirmar.
2. El título del encargo: ¿copia del espacio o convención de nombres? No crea entidad.
3. **Ningún correo está confirmado** para las ocho personas, así que no hay identidad ni membresía
   que crear. Un correo deducido de un nombre es una invitación a un desconocido.
4. Nadie está designado OWNER ni ADMIN del nuevo espacio.
5. Membresía por proyecto: **vacía a propósito**. Los tres encuestadores no se asignan a las cuatro
   vías automáticamente.
6. ~~**La facultad de Manuel.**~~ **Corregido el 6 oct 2026: esto era un error mío.**
   `SOCIAL_SPECIALIST` **sí** tiene `field.assignments.manage` — está en
   `packages/domain/src/core/roles.ts`, en el conjunto del rol, y lo leí mal. Manuel, como
   especialista social, ya puede decidir qué técnico atiende cada predio. **No hace falta crear un
   rol, ni elevarlo a `COORDINATOR`, ni ampliar ningún permiso**, y el propietario no tiene ninguna
   decisión que tomar aquí. Pedí una elección entre tres malas opciones que no existía.

   Dos cosas más, comprobadas al corregirlo. La política RLS de `app.field_assignment` exige
   *(la fila es mía) OR `app.can_read_field_responses()`*, y un `SOCIAL_SPECIALIST` tiene
   `field.responses.read`, así que tampoco hay restricción en la base. Y `field.assignments.manage`
   **no se comprueba hoy en ningún caso de uso ni en ninguna ruta** — `grep` sobre
   `packages/application/src` y `apps/web` no encuentra una sola llamada: las asignaciones las crea
   el sembrador de demostración, no una superficie del producto. Así que el estado real no es «le
   falta el permiso» sino «lo tiene, y todavía no hay pantalla que lo use». El flujo se valida en
   el bloque 3.

   `docs/TENANCY.md` §3.1 también lo dice mal — su tabla atribuye `field.assignments.manage` sólo a
   `COORDINATOR` — y es la fuente que leí. Corregida en el mismo commit.

   La facultad **no está confirmada** para Alexys/Alexis García, cuyo alcance sigue siendo
   cartográfico; eso no cambia.
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
- **Qué bloquean los pendientes, exactamente.** Los correos confirmados (3) y el dueño del espacio
  (4) bloquean el **alta real** de Visión Ambiental: sin ellos no hay identidad ni membresía que
  crear. No bloquean el desarrollo del producto, que se hace con tenant e identidades sintéticos
  en pruebas aisladas — y así se hizo el bloque 2.

---

# Bloque 2 — el mini CMS

> Estado: **implementado y probado en local**, sin desplegar y sin fusionar. Misma rama.
> No validado en STAGING y no público en ninguna parte.

## 9. Qué se construyó

Una **extensión editorial del portal**, no un CMS aparte. Reutiliza la autenticación, la RLS, el
almacenamiento, los permisos y el catálogo de mensajes que ya existían; no añade login, ni
microservicio, ni constructor visual, ni dependencia nueva.

La decisión de fondo: **no se extendió `client_publication`**. Esa tabla es una *proyección* en la
que cada cifra se calculó y lleva un `provenance_id` (ADR-027). Esto es lo contrario — prosa que
escriben y revisan personas, sin una sola cifra derivada. Compartir tabla habría significado un
esquema que admite las dos cosas, y la primera cifra tecleada a mano guardada en una proyección es
el momento en que «toda cifra lleva procedencia» deja de ser verdad.

Por eso el payload editorial **no tiene** campo de métrica, porcentaje ni avance, y tampoco lleva
facetas de procedencia: reclamar procedencia para un párrafo que alguien escribió sería justo la
mentira que el modelo de procedencia existe para impedir. Una consultora que quiera dar una cifra
la escribe en una frase y la firma.

### Rutas

| ruta | quién |
|---|---|
| `/t/:tenant/p/:project/portal/editorial` | interno · *Presentación pública* |
| `/p/:tenant/:project` | **público, sin sesión** |
| `/p/:tenant/:project/media/:objectId` | público · 303 a una URL firmada de 5 minutos |

`/portal/:tenant/:project` —la vista del cliente de ADR-027— **no se tocó** y sigue exigiendo
sesión interna. Son dos cosas distintas y por eso son dos rutas: una presentación pública y una
publicación para un cliente concreto.

### Permisos

Tres actos, tres permisos, y uno solo es nuevo:

| acto | permiso | quién lo tiene |
|---|---|---|
| escribir el borrador | **`portal.editorial.write`** (nuevo) | COORDINATOR, SOCIAL_SPECIALIST, ENVIRONMENTAL_SPECIALIST |
| previsualizar | `portal.preview` (existente) | COORDINATOR, REVIEWER |
| publicar y retirar | `portal.publish` (existente) | COORDINATOR |

Es el mismo corte que el Control de consistencia hace entre ejecutar y resolver. Un especialista
escribe la página entera y no cambia nada de lo que ve un visitante; un revisor la lee antes que
nadie y no la envía. **No se dio `portal.publish` a ningún especialista**, y nadie se autorizó por
nombre: quién publicará por Visión Ambiental sigue pendiente y se probó con los roles sintéticos.

Abrir el borrador acepta **cualquiera de los dos** permisos de lectura o escritura: releer lo que
acabas de escribir es parte de escribirlo, y exigir sólo `portal.preview` dejaba al autor con una
página que podía guardar y no volver a abrir. (Salió en las pruebas.)

### Migración 0052

Aditiva. Cuatro tablas en el esquema `portal`, un valor nuevo en `app.storage_namespace`, una
función y las políticas.

| tabla | |
|---|---|
| `portal.editorial_draft` | una por proyecto, mutable, con `revision` para concurrencia optimista |
| `portal.editorial_publication` | **inmutable**, versionada, con los slugs encima |
| `portal.editorial_publication_asset` | **inmutable** — *es* la autorización de cada adjunto |
| `portal.editorial_visibility_event` | **sólo-inserción**: publicada, retirada, publicada otra vez |

Inmutabilidad por `REVOKE UPDATE, DELETE` **y** por trigger, como el resto del producto. `portal`
no tiene `ALTER DEFAULT PRIVILEGES`, así que cada tabla recibe exactamente los verbos que necesita
y las tres de sólo-escritura no reciben UPDATE ni DELETE que revocar.

### La frontera pública

Esto es lo único realmente nuevo en el modelo de seguridad, y conviene leerlo con cuidado.

`loadPublicEditorialPage` abre su transacción con `surface: "public"` y **sin tenant, sin proyecto
y sin usuario**. Dos políticas admiten eso — SELECT sobre la publicación editorial y sobre sus
adjuntos, y sólo mientras son visibles. Todas las demás tablas de todos los esquemas siguen
negando una transacción sin tenant, así que desde ahí no se alcanza un borrador, otro tenant, una
respuesta de encuesta ni un predio **aunque la consulta se escribiera para intentarlo**.

- No hay `COORDINATOR` ficticio y no hay `BYPASSRLS`.
- Los **slugs van desnormalizados** en la publicación: un visitante no tiene sesión, así que la
  lectura pública no puede unir contra `app.project` para convertir una URL en un id — y darle a
  la rama pública un camino hacia las tablas operativas para resolver un slug es exactamente el
  agujero que esta superficie no debe tener.
- Los adjuntos llevan `object_key`, `original_filename` y `mime_type` **copiados al publicar**, de
  modo que la lectura pública no toca `app.stored_object` ni para tres columnas.
- `eia_portal` **sigue sin recibir nada**. Es el rol previsto para un cliente externo autenticado
  (ADR-009, TD-005), que es otra superficie: ésta no tiene a quién autenticar.

Un slug cruzado, una página retirada y un proyecto inexistente dan la **misma** respuesta.

### Visibilidad, y un error que encontraron las pruebas

La primera versión preguntaba «¿se ha retirado esta versión?». Con eso, retirar la v2 volvía a
servir la v1 —publicada meses antes y nunca retirada— como página viva. Una consultora que baja su
página no quiere decir «muestra la anterior». La visibilidad es ahora **por proyecto**: un flujo de
eventos, el último decide, y `WITHDRAWN` significa que no hay nada público.

### Archivos

Namespace propio, `portal-editorial`, separado de `documents` y de `field-media`. Reutiliza
intent → PUT → finalize → hash. Formatos: JPEG, PNG, PDF y **PPTX como descarga**. Nada abre el
PPTX: el extractor despacha por tipo declarado y una presentación no coincide con ninguno, así que
no produce pasajes y no puede citarse. `.pptm` se rechaza por tipo y mirando dentro del ZIP
(`ppt/vbaProject.bin`), igual que `.docm`. **No se subió ningún límite global**: el PDF de 29 MiB
del inventario cabe en el límite de 120 MB que ya existía, y no se tocó nada por él.

Una fotografía publicada **exige texto alternativo**, por esquema y por `CHECK` en la base.

### Texto

Se guarda y se renderiza como **texto plano**. No hay HTML que sanear: el payload no admite
marcado, la página pública es un componente de servidor sin JavaScript de cliente, y cada cadena
llega como nodo de texto. `sanitiseEditorialText` quita lo que sobrevive a un viaje de ida y vuelta
— caracteres de control, U+2028/U+2029 y el BOM. Un `<script>` pegado se ve como once caracteres.

Hay además una lista de patrones prohibidos, **más estrecha** que la de la proyección del cliente:
correo, cédula/RUC contiguos, códigos de predio y de hallazgo, y los nombres de registros internos.
No prohíbe «propietario» ni «técnico», que son castellano corriente en un estudio ambiental; una
comprobación que rechaza contenido legítimo es una comprobación que la gente aprende a esquivar.

> Un defecto propio: el primer patrón de cédula admitía separadores y **capturaba `2026-10-06`**,
> así que una página no podía llevar una fecha. Corregido a dígitos contiguos.

## 10. Pruebas ejecutadas

Todas con datos sintéticos, en base aislada (Testcontainers). **No se reseteó la base local del
propietario** y no se tocó DEMO, STAGING ni producción.

| escenario del encargo | |
|---|---|
| 1 · guardar y reabrir borrador | ✓ y se comprueba que guardar **no** publica |
| 2 · visitante sin sesión no ve borrador ni adjuntos | ✓ |
| 3 · autor sin permiso no publica | ✓ (+ un técnico no puede ni guardar) |
| 4 · publicador legítimo crea versión visible | ✓ |
| 5 · edición posterior no altera lo publicado | ✓ |
| 6 · retirada bloquea página y adjuntos | ✓ |
| 7 · IDs cruzados rechazados, sin fuga de payload | ✓ (dos cruces de slug + ausencia de ids internos) |
| 8 · texto malicioso no ejecuta | ✓ |
| 9 · portal interno anterior sigue funcionando | ✓ `portal.integration.test.ts` sin cambios |
| 10 · contenido legítimo no exige inventar métricas | ✓ el payload no tiene dónde ponerlas |

Extra, por lo que salió al escribirlas: dos editores no se pisan en silencio; una versión publicada
es inmutable por grant y por trigger; un revisor mira y no publica; las versiones siguen ahí tras
una retirada.

```
pnpm format:check                       pass
eslint apps packages tooling e2e        pass · forbidden-strings 652 ficheros
pnpm typecheck                          11/11
pnpm test:unit                          706 pasan, 1 todo (51 ficheros)
pnpm test:integration                   677 pasan (50 ficheros) — eran 664
pnpm --filter @eia/web build            compila; las tres rutas nuevas aparecen en el manifiesto
```

**Lo que no se ejecutó, y por qué.** La suite e2e de Playwright: habría que levantar la aplicación
contra una base sembrada, y el encargo pide no repetir suites completas sobre una base local
alterada. **No hay capturas**: producirlas pide servidor levantado y datos sembrados, y preferí
gastar el tiempo en que los diez escenarios fueran pruebas de verdad. Las tres superficies
compilan y están en el manifiesto de rutas; que *rendericen bien* no está demostrado, y lo digo en
vez de insinuar lo contrario. Responsive, teclado y contraste están **escritos** (una columna,
`focus-visible` en cada control, sólo tokens del sistema, `prefers-color-scheme` heredado) y **no
verificados** con herramientas.

## 11. Pendientes del bloque 2

1. **Capturas y verificación visual** de editor, página pública y retirada.
2. **Subida de archivos desde el editor**: el modelo, el namespace, los formatos y la autorización
   por publicación están; el formulario de carga en el editor **no**. Hoy un adjunto se referencia
   por `storedObjectId` y las pruebas los crean directamente.
3. **Fotos públicas sin metadatos privados**: ADR-031 §7 ya dice que un fichero se reexporta sin
   EXIF antes de salir; para medios editoriales **no está implementado**, y una foto publicada sale
   hoy con los metadatos que traía. Es lo más cercano a un riesgo real de esta oleada.
4. **Portada de la consultora** (lista de vías publicadas): no construida; existe la ficha por vía.
5. **Caché y retirada**: la página pública es `force-dynamic` y la ruta de medios responde
   `no-store`; no hay CDN delante. Si se pone una, hay que decidir la expiración.
6. Ficha de equipo: modelada y editable por payload; el editor sólo expone secciones y resumen.

## 12. Lo que sigue sin estar implementado

El **CMS está implementado**; las **socializaciones no**, y no se declaran. Nada de esto está
validado en STAGING ni publicado en ninguna parte.

---

# Bloque 2.1 — cierre funcional (parcial)

> Estado: **el dominio y la frontera pública están cerrados y probados; la interfaz no.**
> No se alcanzó `CMS_VALIDATED_LOCALLY`. Misma rama, sin PR, sin desplegar.

## 13. Lo cerrado

### La puerta de subida estaba cerrada

`uploadIntentInputSchema` enumeraba tres namespaces como literales y omitía `portal-editorial`.
El namespace tenía permiso, lista de formatos y constructor de claves, y **no se podía pedir un
intent para él**. El esquema se deriva ahora del catálogo (`UPLOADABLE_NAMESPACES`), porque la
segunda lista mantenida a mano es justo lo que se desincronizó. `generated` queda fuera: nada sube
ahí. Probado de punta a punta — intent → PUT → finalize — con el namespace editorial.

Sigue sin poder: un `FIELD_TECHNICIAN` con `media.upload` no alcanza `portal-editorial` (el
namespace exige `portal.editorial.write`), y `documents.write` tampoco sirve de sustituto.

### Una fotografía publicada es un derivado

| | |
|---|---|
| original | privado, con su EXIF, **nunca referenciado por una publicación** |
| derivado | decodificado, orientado, acotado a 2400 px, re-codificado · SHA-256 propio |
| vínculo | `portal.editorial_image_derivative`, sólo-escritura, sin rama pública |
| garantía | publicar rechaza un `role: "photo"` que no sea el lado derivado de un par |

El metadato no está porque **nunca se escribió**, no porque algo lo borrara: `sharp` no copia
metadatos salvo que se le pida, y aquí no se le pide. `rotate()` aplica la orientación a los
píxeles y la descarta, así que un retrato sigue derecho en un visor que no lee EXIF.

**`field-media` no se tocó**, y no debe tocarse: la foto de un técnico es evidencia y conserva lo
que escribió la cámara (ADR-032). Son ficheros distintos con finalidades distintas.

`sharp@0.35.4` se eligió porque **ya estaba**: en el workspace vía Next y dentro de la imagen
publicada con su binario `linux-x64`. Declararlo a la versión ya resuelta no añade cadena de
suministro ni tamaño; sólo deja de ser una dependencia fantasma.

> **Y reprodujo inmediatamente el defecto de pdf.js.** Un import estático metió un módulo nativo
> en el bundle del worker —que empaqueta `@eia/application` entero— y el worker construido dejó de
> arrancar por una librería que nunca llama. Lo detectó `pnpm --filter @eia/worker build`, no un
> despliegue. Ahora se carga dinámicamente y es `external` de ese bundle.

### Portada pública del tenant

`/p/:tenant`. **No lista proyectos y filtra**: consulta las filas publicadas y nada más, bajo la
misma política pública que una página suelta. Un proyecto sin publicación, uno retirado, uno
archivado y uno privado están **ausentes**, no filtrados — no hay lista que filtrar ni condición
que olvidar. Una vía retirada desaparece de la portada por el mismo mecanismo que baja su página.

El nombre de la consultora sale de `portal.editorial_tenant_profile` (dos columnas: nombre y
título del encargo), con el slug como respaldo. **«Visión Ambiental» no está escrito en ningún
sitio del código.** Un tenant sin nada visible responde 404 igual que uno inexistente: que una
consultora use este producto no es un hecho que una URL deba poder establecer.

### Rutas públicas finales

```
/p/:tenant                              portada de la consultora
/p/:tenant/:project                     ficha de la vía
/p/:tenant/:project/media/:objectId     303 a URL firmada de 5 min, Cache-Control: no-store
```

Una URL firmada emitida antes de una retirada vive como mucho su TTL de cinco minutos. Es
aceptable y se dice así: **no se promete revocar una copia ya descargada**, y no hay purga de CDN.

## 14. Lo que NO se cerró

Honestamente, y es la mitad del encargo:

1. **Formulario de archivos en el editor** (§2). El camino completo existe y está probado por
   integración; **no hay UI** que lo recorra. Una persona todavía no puede subir una foto desde la
   pantalla.
2. **Ficha de equipo en el editor** (§4). El modelo soporta `team`; el editor sólo expone
   secciones y resumen.
3. **Smoke de seguridad en el borde web** (§7). Las propiedades están probadas en el dominio
   (18 pruebas de integración); no hay cobertura a nivel de ruta HTTP.
4. **Smoke de UX real con navegador** (§8). No se levantó la aplicación, no se sembró una base
   sintética, no se corrió Playwright ni axe, y **no hay capturas**.

Sin 1, 2 y 4, una persona **no puede** probar el CMS de punta a punta en local. Por eso esta
oleada no devuelve `CMS_VALIDATED_LOCALLY`.

## 15. Pruebas de este bloque

```
packages/application/test/editorial-image.test.ts        7 unitarias
packages/application/test/portal-editorial.integration.test.ts   18 (eran 13)
pnpm test:unit            713 pasan, 1 todo (52 ficheros)
pnpm test:integration     682 pasan (50 ficheros)
pnpm typecheck            11/11 · format · lint · forbidden-strings (656 ficheros)
pnpm --filter @eia/web build      las cuatro rutas públicas/editoriales en el manifiesto
pnpm --filter @eia/worker build   construye, y el binario arranca (`pdf-smoke.js` ok)
```

El fixture de imagen es un JPEG sintético **con un segmento EXIF APP1 real que contiene etiquetas
GPS**, construido por el propio suite. Partir de una imagen que demostrablemente *tiene* GPS es el
punto: una prueba que dice «no encontré GPS» sobre un fichero que nunca lo tuvo no prueba nada. La
salida se comprueba con dos lectores independientes — el de sharp y un barrido del marcador
`Exif\0\0` sobre los bytes crudos.

No se ejecutó la suite e2e de Playwright ni el gate de imagen Docker.

## 16. Límites y política, para el registro

| | |
|---|---|
| namespace editorial | `portal-editorial` · JPEG, PNG, PDF, PPTX |
| derivado de imagen | lado mayor ≤ 2400 px · entrada ≤ 60 Mpx · JPEG q82 · PNG sigue PNG |
| PPTX | descarga; nada lo abre, no produce pasajes, no se puede citar; `.pptm` rechazado por tipo y por `ppt/vbaProject.bin` |
| límites globales | **sin tocar** — el PDF de 29 MiB del inventario cabe en los 120 MB que ya existían |
| permisos | `portal.editorial.write` · `portal.preview` · `portal.publish` |

---

# Bloque 2.2 — la experiencia usable, validada en navegador

> Este bloque no amplió el modelo. Lo que hizo fue **conducir el CMS como lo conduce una persona**,
> en un navegador real, y arreglar lo que esa conducción encontró. Tres de los cuatro defectos que
> se corrigen aquí no eran visibles desde una prueba de integración, y el cuarto no era visible
> desde ninguna prueba de este repositorio.

## 17. Lo que ahora se puede hacer de extremo a extremo

Una persona con los permisos adecuados puede, **desde la interfaz**, sin consola y sin SQL:

| Acto | Quién | Dónde |
|---|---|---|
| nombrar la consultora y el título del encargo | `portal.profile.manage` (OWNER, ADMIN) | panel *Perfil público de la consultora* |
| escribir titular, bajada y resumen gerencial | `portal.editorial.write` | *Borrador* |
| añadir, reordenar y quitar secciones | `portal.editorial.write` | *Secciones* |
| subir una fotografía, un PDF y una presentación por sección | `portal.editorial.write` | tres campos, **rotulados por tipo** |
| añadir, editar, reordenar y quitar integrantes del equipo | `portal.editorial.write` | *Equipo técnico* |
| publicar | `portal.publish` | *Publicar* |
| retirar, con motivo | `portal.publish` | *Retirar del público* |

Y una visitante **sin sesión** ve la portada del tenant, la ficha del proyecto publicado y sus
archivos — y nada más.

## 18. Los cuatro defectos que encontró conducirlo

**El nombre de fichero fantasma.** Tras una subida con éxito el `<input type="file">` seguía
mostrando el nombre del fichero anterior, bajo un formulario que ya no lo tenía. Un elemento de
entrada de ficheros guarda su propio valor: limpiar el estado de React no lo limpia. Se limpia
ahora de las dos maneras, y la prueba afirma `toHaveValue("")` después de cada subida.

**Tres subidores idénticos.** Fotografía, PDF y presentación se ofrecían como tres filas que decían
«Elegir archivo» y «Añadir archivo», distinguibles sólo por su orden en la pantalla. Ahora cada una
dice de qué tipo es, en ambos idiomas (`chooseFileOfKind`, `addFileOfKind`).

**El equipo sin retrato, en una columna de 96 px.** `.member` reservaba una columna fija para el
retrato; un integrante sin fotografía — que es la mayoría — metía su nombre, su cargo y su reseña
en esos 96 píxeles, una palabra por línea, con el resto de la fila vacía. La captura
`03-ficha-publica.png` del primer intento lo muestra. `.memberPlain` ocupa la fila entera.

**Y el que ninguna prueba de este repositorio podía ver: la imagen publicada no podía publicar una
imagen.** Véase §20.

## 19. El recorrido, y por qué es serial

`e2e/portal-editorial.spec.ts`, proyecto Playwright propio, nueve actos en orden:

```
A  una administradora nombra la consultora, y persiste tras recargar
B  una editora escribe, sube JPEG + PDF + PPTX, añade una integrante
C  sin sesión, antes de publicar: la ficha responde 404 y el editor manda a /sign-in
D  la publicadora publica
F  editar el borrador después de publicar no cambia lo publicado
E  sin sesión, después de publicar: portada, ficha, foto y descargas — y no el borrador de F
H  axe sobre editor, portada y ficha · capturas · sin desbordamiento horizontal en 1440 y en 390
I  la ruta pública de archivos no es un directorio del bucket
G  retirar lo quita de la ficha, de la portada y de sus archivos
```

Tres decisiones que vale la pena dejar escritas:

- **La visitante se construye, no se asume.** `browser.newContext({ storageState: { cookies: [],
  origins: [] } })`. Reutilizar el contexto autenticado con una bandera de «desconectada» sería
  probar la bandera.
- **A empieza retirando lo que hubiera publicado.** Una publicación es duradera a propósito, así
  que una ejecución interrumpida entre D y G dejaría a la siguiente afirmando «todavía no hay nada
  público» contra la página de la anterior. Se comprobó ejecutando el recorrido dos veces seguidas.
- **I no afirma 404 para un proyecto ajeno.** El producto responde el estado *permission denied*
  con 200, que es su respuesta documentada de no-enumeración (SECURITY.md §3): la misma para un
  proyecto que no existe y para uno que no puedes ver. El 404 de ADR-016 es la respuesta a una
  **capacidad desactivada**, que es otra pregunta. La prueba afirma lo que el producto garantiza —
  ningún contenido editorial — en vez de una regla que no tiene.

## 20. El gate de imagen, y lo que encontró

El artefacto se construyó como lo construye CI (`docker build` desde el `Dockerfile` del
repositorio, con `GIT_SHA`) y se le hizo la pregunta que ninguna prueba del espacio de trabajo
hace: **¿puede *esta imagen* producir una fotografía publicable?**

No podía. El rastreo *standalone* de Next sí se había llevado `sharp` a `/app/node_modules/.pnpm`,
con el binario de la plataforma correcta al lado — y **nada lo enlazaba donde un proceso resuelve**:
`import("sharp")` fallaba desde `/app`, desde `/app/apps/web` y desde el bundle del worker por
igual. En la imagen publicada, publicar una fotografía habría fallado, mientras todas las pruebas
de este repositorio pasaban, porque todas resuelven `sharp` desde el `node_modules` del espacio de
trabajo.

Es exactamente la forma del defecto de pdf.js que encontró *staging*, y lo que lo hace peor que una
función caída es la reparación que invita: un derivado que no se puede construir tienta a servir el
original, que es el fichero subido **con su GPS dentro**.

La corrección es un enlace simbólico en el `Dockerfile`, junto a los de `pg` y `pino`, y la
afirmación de importación en tiempo de construcción para que no vuelva a desaparecer en silencio.
El gate es ahora un paso de CI y una entrada que viaja dentro de la imagen:

```
docker run --rm --network none --entrypoint node <imagen> apps/worker/dist/image-smoke.js
{"ok":true,"format":"jpeg","width":64,"height":48,"originalBytes":567,
 "derivativeBytes":287,"exifBefore":true,"exifAfter":false,"vips":"8.18.6","node":"v24.21.0"}
```

`image-smoke.ts` construye su propio JPEG **con EXIF**, comprueba que lo tiene antes de empezar —
una prueba cuya entrada deja de llevar EXIF pasaría para siempre sin probar nada — llama a
`buildPublishableImage` y `describeImageMetadata`, que son las funciones del producto, y verifica
la salida con dos lectores independientes: sharp, y un barrido del marcador `Exif\0\0` sobre los
bytes crudos. No toca red, ni base de datos, ni almacén de objetos, ni documento de nadie.

`sharp` pasa a ser **devDependency** de `@eia/worker`: esa entrada la necesita para compilar y para
ejecutarse, y el worker mismo nunca la llama (sigue siendo `external` en su bundle, por la razón
que explica `apps/worker/tsup.config.ts`).

## 21. Pruebas ejecutadas en este bloque

```
pnpm format:check                      todo el repositorio
node tooling/scripts/check-forbidden-strings.mjs   ok (658 ficheros)
pnpm typecheck                         11/11
pnpm test:unit                         713 pasan, 1 todo (52 ficheros)
pnpm test:integration                  686 pasan (50 ficheros)   ← 682 antes de este bloque
pnpm --filter @eia/web build           ok
pnpm --filter @eia/worker build        ok · pdf-smoke.js ok · image-smoke.js ok

Playwright (Node 24, MinIO real):
  portal-editorial     16 pasan   ← el recorrido nuevo, ejecutado dos veces seguidas
  coordinator + document-pipeline  163 pasan   (portal ADR-027, autorización, vocabulario,
                                                documentos, GIS, informes, intake, PGAS,
                                                accesibilidad, capturas, y la tubería
                                                subida → almacén → worker → cita)
  technician           23 pasan   (captura de campo)

Gate de imagen (local, linux/arm64):
  docker build                       ok · "runtime deps resolve"
  image-smoke.js                     ok · exifAfter:false
  pdf-smoke.js                       ok · 1 página, 319 caracteres
  /health                            gitSha == HEAD
  usuario                            node (no root)
  ficheros .env dentro de la imagen  ninguno
```

**Lo que no se ejecutó, y por qué.** `pnpm lint` falla **localmente** con 5 985 errores, todos
dentro de `.claude/worktrees/…`, un árbol de trabajo que crea la aplicación de escritorio: está
excluido de Git (`.git/info/exclude`) pero no de ESLint, así que ESLint lo recorre. Sobre los
ficheros del repositorio: **cero problemas**, comprobado con `eslint . --format json` y filtrando
esa ruta. Es deuda de herramienta local, ajena a este bloque, y se reporta en vez de arreglarse.

El gate de imagen se construyó para `linux/arm64` (la máquina local); CI construye `linux/amd64`.
El mecanismo que se corrige — el enlace y la afirmación de importación — es el mismo, y el binario
de `sharp` que cada arquitectura instala es el suyo, así que la respuesta de CI es la que vale para
el despliegue.

## 22. Accesibilidad y presentación

axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sobre el editor, la portada y la ficha pública:
**ninguna violación *serious* ni *critical***. El control de publicar se alcanza por teclado. Sin
desbordamiento horizontal ni a 1440 px ni a 390 px, que es el fallo responsivo que deja contenido
fuera del alcance de quien lo lee y que una captura esconde, porque la captura es tan ancha como el
contenido.

Las capturas — `docs/screenshots/vision-ambiental/{01-editor,02-portada,03-ficha-publica}.png` — se
regeneran con el recorrido, siguiendo el patrón de `docs/screenshots/slice-*`.

Un apunte que **no** se arregló aquí: el estado *permission denied* muestra «Tu rol OWNER no
incluye **project**» — una clave cruda en inglés en una frase en español. No es editorial: viene de
`request-context.ts`, afecta a todas las rutas del espacio de trabajo y es anterior a este bloque.

## 23. Lo que sigue sin estar implementado

Todo lo del §12 y del §14 sigue en pie. Este bloque no añadió ninguna capacidad nueva al catálogo,
no tocó `field-media`, no subió ningún límite global, no envió nada a ningún modelo, y no
desplegó nada.

---

# Bloque 2.3 — dos defectos del perfil público, cerrados

> Este bloque no amplió el CMS. Cerró dos defectos concretos del **perfil del tenant** — el nombre
> de la consultora y el título del encargo — y encontró un tercero por el camino. Ninguno era
> visible desde la interfaz: el primero necesita dos personas guardando a la vez, el segundo
> necesita una identidad que el recorrido no usaba, y el tercero aparece al azar.

## 24. La revisión del perfil no era una revisión

**Lo que había.** `loadEditorialTenantProfile` devolvía `revision = 0` si no existía la fila y
`1` si existía, y `updateEditorialTenantProfile` comparaba contra eso. En cuanto la fila existía
el número no volvía a moverse: **toda** administradora leía `1`, **todo** guardado coincidía, y el
segundo pisaba al primero sin decir nada. El comentario del código decía que eso era *optimistic
concurrency*; no lo era.

Peor: la comprobación era un `SELECT` y después un `UPDATE` incondicional. Aunque el número
hubiese crecido, dos transacciones concurrentes pasan las dos el `SELECT`.

**Migración 0054** (aditiva, sin backfill, sin cambio de política ni de grant):

```sql
ALTER TABLE portal.editorial_tenant_profile
  ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE portal.editorial_tenant_profile
  ADD CONSTRAINT editorial_tenant_profile_revision_positive CHECK (revision >= 1);
```

`DEFAULT 1` y no `0` porque `0` es la palabra de este modelo para *no hay perfil*, y un `0`
almacenado haría indistinguible una fila existente de una ausente.

**La atomicidad no la da la columna.** La da que comparar y escribir sean **una sola sentencia**:

| Caso | Sentencia | Perdedor |
|---|---|---|
| crear (`expectedRevision = 0`) | `INSERT … ON CONFLICT (tenant_id) DO NOTHING RETURNING revision` | no recibe fila → conflicto, no una violación de UNIQUE cruda |
| actualizar (`N`) | `UPDATE … SET revision = revision + 1 WHERE tenant_id = ? AND revision = N RETURNING revision` | actualiza cero filas → conflicto |

Sólo después de no recibir fila se lee la revisión actual, y sólo para poder decir cuál es.

**Dos cosas más que estaban mal por lo mismo.** El esquema de la server action tenía
`expectedRevision: z.number().int().min(0).max(1)` — habría rechazado el tercer guardado. Y el
componente hacía `setProfileRevision(1)` tras cada éxito, un número inventado; ahora usa el que
devolvió el servidor, en un campo propio (`profileRevision`) para que un guardado de perfil no
pueda reiniciar el contador del borrador.

### 24.1 Y el mismo patrón, una función más arriba

`saveEditorialDraft` tenía la misma forma: `SELECT revision` → comparar → `UPDATE` **sin
condición**. El contador del borrador sí crecía, así que dos guardados uno tras otro ya se
detectaban; dos al mismo instante no, porque ambas transacciones pasaban el `SELECT` y la segunda
sobrescribía a la primera.

No estaba en el encargo de este bloque, pero es el mismo defecto que el §24 nombra, en el fichero
que el §24 corrige, y dejarlo mientras se escribía una migración y una nota diciendo cómo debe
hacerse habría sido incoherente. Tres líneas: la comparación pasa al `WHERE` del `UPDATE`, y la
creación a `ON CONFLICT (tenant_id, project_id) DO NOTHING RETURNING`. Sin migración: el índice
único que lo sostiene ya existía desde 0052.

## 25. ADMIN tenía el permiso y no podía usarlo

`portal.profile.manage` es permiso de **tenant** (OWNER, ADMIN). Un ADMIN sin membresía de
proyecto resuelve el proyecto *para administración*: permisos de tenant, ningún permiso de
proyecto (TENANCY.md §2.1). Pero la ruta exigía `portal.editorial.write` **o** `portal.preview`
antes de renderizar nada, así que devolvía *permission denied*. **Tenía la llave de una puerta
que estaba detrás de otra puerta que no podía abrir**, y la única persona que podía nombrar la
consultora era el OWNER, por su acceso implícito.

**Lo que NO se hizo:** conceder `portal.preview`, conceder `portal.editorial.write`, dar
COORDINATOR, ni crear membresía automática. Cualquiera de esas habría ampliado el acceso al
borrador para arreglar un panel de dos campos.

**Lo que se hizo:** `EditorialTenantProfileEditor`, un componente propio, y un modo *sólo perfil*
en la misma ruta. La diferencia que importa está en una línea de la página:
`loadEditorialDraft` **no se llama**. El borrador no se trae y se oculta — no se trae.

| | ADMIN sin membresía | editor / revisor / publicador |
|---|---|---|
| panel de perfil | sí | sí (sólo lectura si no tiene el permiso) |
| borrador, secciones, equipo | **no se cargan** | igual que antes |
| subir, publicar, retirar | ausentes | igual que antes |
| `portal.preview` | **no** | igual que antes |

El use-case sigue siendo la autoridad: la superficie decide qué dibujar, no qué se permite.

## 26. Y un tercero, que encontró la corrida de integración

`findEditorialViolations` escaneaba `JSON.stringify(payload)` — **todo**, incluidos los
identificadores que genera este producto. Un `storedObjectId` es un UUID, así que una página de
cada pocos cientos llevaba dentro una tirada de exactamente diez dígitos y era rechazada como
`identity_number`: una negativa que nombra algo que nadie escribió y que no se puede quitar de la
pantalla. Habría aparecido al azar en producción.

Ahora se recorren las cadenas **legibles** y se excluyen por nombre los campos que son
identificadores (`schemaVersion`, `locale`, `key`, `kind`, `role`, `storedObjectId`). Exclusiones
con nombre y no una lista blanca de campos de prosa, para conservar la propiedad que hacía útil el
barrido: un campo de texto nuevo queda cubierto el día que se añade. Se unen con `\n`, para que
dos campos inocentes no formen una coincidencia en la costura.

`packages/domain/test/portal-editorial.test.ts` es nuevo: no había ninguna prueba unitaria de las
reglas de contenido editorial.

## 27. Pruebas

```
packages/domain/test/portal-editorial.test.ts            6 unitarias (nuevo fichero)
packages/application/test/portal-editorial.integration.test.ts   29 (eran 22)
  · la revisión cuenta 0 → 1 → 2 → 3
  · un guardado desde un número que ya se movió es rechazado
  · crear contra un perfil que ya existe es conflicto, no error SQL
  · dos guardados concurrentes desde la misma revisión: gana exactamente uno
  · el contador es por tenant
  · ADMIN sin membresía lee y escribe el perfil
  · ADMIN no tiene write/preview/publish, y no puede leer el borrador
  · ADMIN no puede guardar, publicar, retirar ni subir un archivo
  · dos guardados simultáneos del borrador: gana exactamente uno (§24.1)

pnpm test:unit          719 pasan, 1 todo (53 ficheros)   ← 713 / 52
pnpm test:integration   693 pasan (50 ficheros)           ← 686
  incluye el registro de migraciones y la cosecha RLS, con 0054 aplicada desde cero
pnpm format:check · forbidden-strings (661) · typecheck 11/11
eslint sobre los ficheros del repositorio: 0 problemas
pnpm --filter @eia/web build

Playwright:
  portal-editorial  18 pasan   ← eran 16
    J · dos administradoras con la misma revisión: la segunda no pisa a la primera,
        recarga y lee lo que escribió la primera
    K · una administradora sin membresía nombra la firma, y el borrador no está
        en la página — ni sus controles, ni su texto en el HTML
  portal + vocabulary + authorization  55 pasan
```

No se reconstruyó la imagen Docker: nada de este bloque toca el empaquetado, `sharp`, el
`Dockerfile` ni las dependencias.

## 28. Estado final del CMS

Cerrado para el siguiente bloque. Lo que queda escrito y **no** arreglado aquí, por ser anterior y
ajeno a estos dos defectos:

- el estado *permission denied* dice «Tu rol OWNER no incluye **project**» (§22);
- los errores de dominio del editorial —incluido el de conflicto— están en inglés, como el resto
  de los mensajes de dominio de este producto; traducirlos es un trabajo de catálogo propio, no
  medio hecho desde aquí;
- `pnpm lint` falla localmente dentro de `.claude/worktrees/`, que ESLint recorre y Git excluye.

---

# Bloque 3 — socializaciones, asignación de campo e invitaciones

> Este bloque construyó un dominio nuevo, dos superficies de escritorio, una versión nueva del
> protocolo móvil, y **se detuvo antes de terminar la aplicación móvil**. Lo último está dicho
> aquí y en TD-126, no implícito en un fichero ausente.

## 29. El modelo: una invitación es la unidad

Tres tablas bajo FieldFlow — `socialization_event` → `socialization_invitation` →
`socialization_delivery_attempt` — y la regla que las ordena: **tres visitas a un predio son un
invitado, no tres**. Todas las cifras de una convocatoria son sobre invitaciones; los intentos van
al lado, rotulados, con la frase escrita en la pantalla.

De ahí se sigue que `ABSENT` y `OTHER` dejan la invitación
`PENDING`: nadie fue informado, y cerrarla porque una visita no encontró a nadie registraría una
convocatoria que no ocurrió. `DELIVERED` y `REFUSED` la cierran.

**Una invitación nombra un predio, nunca a una persona.** `recipient_label` es una cadena opcional
de una lista que alguien llevaba: nunca derivada de una respuesta, nunca obligatoria, nunca en una
línea de auditoría.

**La logística se congela** en cuanto existe la primera invitación — en el dominio y otra vez en un
trigger — porque alguien ya fue informado de una fecha y no hay forma de des-informarle. Otra
convocatoria es otro evento.

## 30. Permisos

`field.socializations.manage` (COORDINATOR, SOCIAL_SPECIALIST) cubre la convocatoria entera.
Decidir **quién entrega** sigue siendo `field.assignments.manage`, la misma llave que decide quién
levanta un predio, porque es la misma decisión sobre los días de las mismas personas.

No se elevó ningún rol y no se creó ninguno con nombre de persona. El especialista social ya tenía
`field.assignments.manage`; lo que faltaba era una superficie que lo usara.

## 31. Asignación de levantamientos

`field.assignments.manage` existía desde el Slice 3 y no otorgaba nada: las asignaciones venían de
un seeder. Ahora hay un tablero de predios con su técnico, un selector y dos verbos — asignar y
cambiar. Sin reparto automático, sin round-robin, sin IA.

`assertAssignmentReassignable` es lo que impide que esto sea una forma de reescribir ayer: una
visita, una respuesta o una fotografía y la respuesta es no, con la puerta que sí existe nombrada
en el mensaje — una revisita (ADR-038).

## 32. El conflicto es el diseño

Una entrega capturada en una quebrada y sincronizada tres horas después, contra una invitación que
entretanto cambió de manos, vuelve como **conflicto**: el intento y la fotografía se conservan y
se marcan *requiere revisión*. Nunca como una reatribución silenciosa del trabajo de una persona a
otra, y nunca como «no encontrado» — que un dispositivo no distingue de un comando mal formado, y
al que respondería descartando la foto de una entrega real.

La política de fila oculta correctamente la invitación reasignada, así que
`app.socialization_delivery_conflict` responde esa única pregunta desde fuera de RLS y devuelve un
**enum de seis etiquetas** y nada más. Es una tercera clase de helper privilegiado, con su propia
regla en la prueba de contrato: vocabulario cerrado, porque `text` sería un lugar donde algún día
podrían ponerse las palabras de una fila.

## 33. Protocolo v4, al lado de v3

v3 queda intacto, byte por byte, en `/api/field/*`. v4 vive en `/api/field/v4/*`. Sin negociación
y sin un cuerpo que signifique dos cosas: un segmento de URL es el marcador de versión más claro
que hay.

Tres cambios, cada uno de los cuales necesitaba la versión:

| | v3 | v4 |
|---|---|---|
| trabajo | una campaña, obligatoria | `surveyWork` **anulable** + `socializationWork` |
| descubrimiento | tres salidas, una terminal (`multiple_field_projects`) | una lista; elige la persona |
| comandos | cinco | seis (`socialization.delivery.record`) |
| pack schema | 1 | 2 |

Los otros cinco comandos significan exactamente lo mismo, así que la ruta v4 reescribe su sobre y
los pasa por el **motor de v3**. Un segundo motor de sincronización es lo que este bloque tenía
prohibido construir: dos motores acabarían discrepando sobre qué significa un reintento.

## 34. Evidencia privada

Namespace propio: `socialization-evidence`. No `field-media`, que es evidencia de una *visita*; y
desde luego no `portal-editorial`, que es el único namespace cuyos objetos ve un visitante. Nada
la re-codifica y nada le quita el EXIF — es evidencia, y la regla para la evidencia es la de
ADR-032. Ninguna ruta pública resuelve ese prefijo.

El orden de liberación del fichero local es el de ADR-032 y se verifica con una prueba:
intent → PUT → finalize → guardar el id → encolar el comando → push → **ACK** → borrar la foto.
`mayDeleteEvidenceFile` sólo nombra `SYNCED` con id de servidor. Un conflicto nunca la libera.

## 35. Lo que la aplicación móvil tiene, y lo que no

**Hecho y probado:** migración local 4 (tres tablas, sin borrar nada de lo que un handset lleva en
el campo), la conversión de un pack v3 a uno v4, las reglas del dispositivo sobre una entrega y su
fotografía, el guardia de cambio de proyecto, el repositorio v4, el cliente de API v4 y el módulo
de sincronización de entregas y evidencia. 16 pruebas unitarias sobre funciones puras.

**No hecho:** el motor de sincronización no está recableado a v4, y las tres pantallas — selector
de proyecto, lista de invitaciones, captura de entrega — no están escritas. **Un dispositivo
todavía no puede entregar una invitación.**

Detenerse fue la decisión, no el resultado. El motor de sincronización es el único componente cuyo
fallo le cuesta a una técnica el trabajo que capturó, y recablearlo sin un emulador en el bucle
para ejecutar el resultado es exactamente el intercambio que ADR-028 §10e existe para evitar. Un
motor a medio cablear es peor que uno sin cablear: parece terminado. TD-126 lleva el orden exacto
de lo que falta.

## 36. Pruebas y comprobaciones

```
pnpm format:check · forbidden-strings · typecheck 11/11 · db:check (sin deriva)
pnpm test:unit            735 pasan, 1 todo        ← 719
pnpm test:integration     740 pasan                ← 693
  · socializations.integration.test.ts        24  (dominio, idempotencia, conflictos, límites)
  · field-work-v4.integration.test.ts         12  (descubrimiento, pack, pull, comando)
  · rls/socializations.integration.test.ts    10  (filas, grants, superficie pública)
  · apps/field/test/delivery.test.ts          16  (reglas del dispositivo)
Playwright  socializations 7 · portal-editorial 18 · coordinator+document-pipeline 163
pnpm --filter @eia/web build · worker build
```

Sin emulador: **EMULATOR_UAT_PENDING**. Las reglas móviles están verificadas por pruebas unitarias
sobre funciones puras; el recorrido en handset sigue siendo la compuerta que era.

## 37. Límites, para el registro

| | |
|---|---|
| unidad de cuenta | la **invitación**; los intentos se muestran aparte y rotulados |
| una invitación | un predio + un evento, en esta versión |
| asistencia | **no se modela**; quién asistió es otro hecho, recogido por otro acto |
| personas | ninguna entidad; `recipient_label` es una etiqueta opcional de una lista |
| capacidades | catálogo intacto en 14 claves; las socializaciones viven bajo `field.surveys` |
| v3 | intacto; un APK anterior sigue hablando `/api/field/*` sin cambios |
| offline | un proyecto activo por vez; el cambio es en línea y se bloquea con trabajo pendiente |

---

# Bloque 3.1 — EIA Field v4: sync, selector e invitaciones

> Cierra TD-126. Un técnico puede ahora descubrir sus vías, elegir una, descargarla, entregar
> una invitación sin señal, y sincronizarla dos veces sin duplicar nada. Lo que **no** se hizo
> es correr el emulador: hay un AVD en esta máquina y no hay runtime de Java, así que no se puede
> producir la build de desarrollo que la aplicación exige.

## 38. Cuatro hallazgos corregidos antes de cablear nada

**El contrato de pull mentía.** `workPullRequestSchema` declaraba `cursor` mientras la ruta y el
cliente enviaban `knownAssignmentIds` y `knownInvitationIds`. Un formato de wire en el que sólo
cree un lado es precisamente lo que `@eia/field-sync-contract` existe para evitar. Ahora el schema
**es** el wire: la ruta lo importa, el cliente valida contra él al salir, y `cursor` desapareció
porque el pull v4 es reconciliación de conjunto actual y no un feed de cambios — un valor que el
servidor nunca lee es peor que ninguno, porque un lector posterior creería que significa algo.

**Un corte de red aparcaba una fotografía para siempre.** `recordDeliveryFailure` escribía
`SYNC_ERROR` y `deliveriesAwaitingEvidence` sólo miraba `EVIDENCE_PENDING`. Ahora
`evidenceFailureKind` distingue *retryable* (sin conexión, timeout, 5xx, 408, 429) de *permanente*
(el servidor contestó y rechazó), el selector lee `RETRYABLE_EVIDENCE_STATES` en vez de un literal,
y hay una prueba que hace fallar el sync 1 y comprueba que el sync 2 vuelve a tomar el mismo
intento **sin editar la base a mano**. En ningún caso se borra la foto.

**`const APP_VERSION = "0.2.0"`** era una build mintiendo sobre sí misma. Ahora el engine pasa
`appVersion()`, como ya hacía `uploadPendingMedia`.

**`globalThis.crypto.randomUUID()`** no está en todos los runtimes de React Native. El engine pasa
`Crypto.randomUUID` de `expo-crypto`, que es lo que usa el resto de la aplicación; una prueba pasa
un contador. El `commandId` se genera una vez, se guarda, y no cambia en los reintentos.

## 39. El pack v4 alimenta las encuestas existentes

Hallazgo real: `saveWorkPack` escribía `work_pack` y `local_invitation` y **no** `field_pack`,
`local_assignment`, `local_question` ni `local_option` — las cuatro tablas que leen las pantallas
de encuesta. Una instalación limpia podía tener un pack v4 perfectamente válido con `surveyWork`
y **cero encuestas visibles**.

La corrección no es un segundo escritor: `fieldPackFromWorkPack` proyecta la mitad de encuestas a
la forma v3 y la entrega a `saveFieldPack`, que es el código contra el que se capturó cada
respuesta que este producto tiene. Dos implementaciones de una misma tabla serían dos cosas que
divergen, y la que divergiera perdería respuestas.

Con `surveyWork === null` se borra `field_pack` y se revocan (no se borran) las asignaciones: una
campaña cerrada de otra vía no puede quedar pareciendo el trabajo de hoy.

## 40. El cambio de vía es atómico de verdad

Antes: abrir transacción → borrar snapshots → **commit** → escribir el pack nuevo fuera. Un fallo
en medio dejaba un teléfono sin ninguna de las dos vías.

Ahora todo ocurre dentro de una `withTransactionAsync` — borrado, `work_pack`, invitaciones y
snapshot de encuestas — con escritores de fila que no abren transacción propia. La prueba fuerza
un fallo a mitad de la escritura de la vía B y comprueba que la vía A sigue **entera y legible**:
su pack, su invitación, su campaña y su asignación.

El orden externo es `PROJECT_SWITCH_STEPS`, escrito como valor porque el orden *es* la propiedad
de seguridad: contar lo pendiente → decidir → descargar → **parsear entero** → una transacción.
Un fallo en la descarga deja el dispositivo exactamente como estaba.

## 41. Un solo motor de sincronización

No hay `sync-engine-v2`. El motor existente conserva sus invariantes y gana tres pasos:

```
ensureWorkPack            (convierte un pack v3 si es lo único que hay)
uploadPendingMedia        (igual que antes; media.declare intacto)
uploadPendingEvidence     (intent → PUT → finalize → guardar storedObjectId)
queueReadyDeliveries      (al MISMO sync_outbox, entityKind "delivery")
pushWorkCommands          (/api/field/v4/sync: los seis comandos)
  survey/visit/media → applyResult()      delivery → settleDeliveryForCommand()
pullWork                  (ambos conjuntos + revocados + validity + cursor)
sweepUploadedMedia + sweepAcknowledgedEvidence
```

Los cinco comandos heredados **significan lo mismo**: la ruta v4 reescribe el sobre y los pasa por
el motor de v3. Un resultado v4 se estrecha a la forma v3 para los manejadores que no tienen rama
para una razón de conflicto nueva; el `outcome`, que es de lo que dependen la disposición y el
estado local, no cambia.

**Una entrega rechazada deja de reenviarse.** `pendingCommands` seleccionaba `('PENDING','FAILED')`
y ahora sólo `PENDING` — lo que `outbox-policy.ts` decía en su primer párrafo desde el Slice 3
mientras el selector lo contradecía. `FAILED` se escribe en un solo sitio: cuando el servidor
**contestó y rechazó**. Está en TD-128, porque también cambia v3.

## 42. Selector, Mi trabajo, entrega

**Selector de vías**: lista siempre; con una sola vía y ningún proyecto activo la descarga, porque
no hay elección que hacer; con dos o más **no elige nunca**. Cambiar de vía dice qué falta por tipo
— cola, encuestas, media, entregas, evidencia — o que hace falta conexión, y son dos frases
distintas porque mandan a resolver problemas distintos.

**Mi trabajo**: ENCUESTAS e INVITACIONES como dos listas, nunca mezcladas, con contadores propios.
Con `surveyWork === null` no aparece campaña ninguna. El teléfono funciona con 0 encuestas y 5
invitaciones.

**Pantalla de entrega**: evento, fecha, lugar, predio, destinatario si existe, propósito. Cuatro
resultados. `DELIVERED` exige fotografía y el botón no se habilita sin ella — la negativa ocurre
de pie en el camino y no tres horas después, porque la evidencia es lo que no se puede recrear.
La cámara, nunca la galería; el fichero se copia al directorio propio **antes** de escribir la
fila; nada se re-codifica. GPS si lo hay, vacío si no, nunca inventado. Guardar no necesita
conexión y no inicia ninguna subida.

**Centro de sincronización**: vía activa, comandos pendientes, evidencia pendiente, entregas que
requieren revisión. Nunca la nota, la etiqueta del destinatario, las coordenadas ni un nombre de
fichero: esa pantalla se fotografía y se manda a soporte.

## 43. Pruebas

```
apps/field/test/delivery.test.ts        reglas puras del dispositivo
apps/field/test/local-journal.test.ts   12 contra SQLite real (node:sqlite)
  A retry de red          sync 1 falla → sync 2 vuelve a tomarlo, sin tocar la base
  B rechazo permanente    no vuelve al selector, la foto permanece, visible
  C commandId             dos pasadas → un comando lógico
  D ACK / conflicto       SYNCED libera la foto · REQUIRES_REVIEW la conserva
  E guardar dos veces     una fila
  F hidratación           pack v4 con encuestas → assignments, questions, options
  G socialization-only    ninguna campaña vieja aparece
  H switch atómico        fallo a mitad → la vía A queda entera
  I switch bloqueado      cada tipo de pendiente lo bloquea y se nombra
  J actualización desde v3  draft, outbox, media y respuestas intactos; pack convertido
  + reapertura            nada vive en estado de React
packages/field-sync-contract  el pull compartido, y v3 sin tocar

format · lint 0 en ficheros del repo · typecheck 11/11 · db:check sin deriva
test:unit 755 pasan, 1 todo   ← 736
test:integration 740 pasan
web build · bundle android 2,9 MB · ios 2,9 MB
```

## 44. Emulador

Hay SDK de Android y un AVD (`Pixel_8`) en esta máquina. **No hay runtime de Java**, así que
`expo run:android` no puede producir la build de desarrollo; y la aplicación no corre en Expo Go
porque sus plugins nativos — SQLCipher, cámara, ubicación — exigen una build propia (ADR-028
§10e). Instalar un JDK quedaba fuera de lo autorizado.

**EMULATOR_UAT_PENDING.** No se afirma `HANDSET_VALIDATED` ni nada parecido. Lo verificado son
las reglas y el journal contra SQLite real; el recorrido en dispositivo sigue siendo la compuerta
que era (TD-121, TD-129).
