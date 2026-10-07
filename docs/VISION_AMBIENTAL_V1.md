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
