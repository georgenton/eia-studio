# Showing EIA Studio to the consultancy

> A script for a live walkthrough of roughly 28 minutes, in Spanish, on the study the firm actually
> delivered. The operator's version — every route, every check, every state — is
> `docs/manual/10-demo-walkthrough.md`; this is what to *say* and in what order.
>
> Related: `docs/ZAMORA_WORKSPACE.md` (what is real and what is simulated, screen by screen),
> `docs/PRODUCT_VALUE_AND_DIRECTION.md` (what the product does and deliberately does not).

## Before you start

Give them `docs/CONSULTANCY_DEMO_BRIEF.md` — one page, non-technical Spanish, ending in the six
questions this meeting exists to answer. Read its three lists out loud early (what is real, what is
a simulation, what is not enabled) so nobody has to work it out from the badges.

Run the preflight first: `pnpm demo:preflight` and `pnpm demo:doctor` against the environment you
will show, and read `docs/CONSULTANCY_DEMO_PREFLIGHT.md` — including its last section, which is the
order of preference when something is red and there is no time left (**show less, never show
something false**). Have `docs/CONSULTANCY_FEEDBACK_TEMPLATE.md` open to write into during the
session; what they say is the point of the meeting, and it does not survive memory.

| | |
|---|---|
| Sign in as | `coordinadora@demo.invalid` — the coordinator sees the whole workflow |
| Have ready | a second identity (`especialista@demo.invalid`, `revisor@demo.invalid`) if the audience asks about roles |
| Say once, at the start | the cartography, the chainages, the management plan and the published figures are **theirs**; the field operation, the questionnaire and the codings are a **simulation**, and the screen says which is which |
| Do not lead with | *inteligencia artificial*. It is one step of nine, and it is the step that is least finished |

**The sentence to open with:**

> «Esto es el estudio Puente del Amor – Los Hachos, con su cartografía, sus abscisas y su plan de
> manejo tal como ustedes los entregaron. Lo que vamos a ver es cómo se vería ese expediente si el
> trabajo se hubiera hecho aquí dentro.»

## The ten beats

### 1 · El proyecto es el suyo — *Centro de control*, 2 min

The header names the study as its terms of reference do — *Actualización de Estudios
Socioambientales con lineamientos BID … Puente del Amor – Los Hachos* — with `PROVIAL 2 · EC-L1289`
beside it.

Point at the KPI strip: **141 predios · 119 encuestas · 185 participantes · 7,4 km**, each badged
*Dato histórico*. Then at the operational half — pendientes, productividad, cierre proyectado —
badged *Simulación operativa*.

> «Las cuatro primeras cifras son del expediente. Las de operación son una simulación, y el producto
> lo dice en la propia tarjeta, no en una nota al pie.»

Open **Ver origen** on one of each. Four facets, a source, a date, a validation state.

### 2 · El corredor y los predios — *Cartografía y predios*, 4 min

The centreline is theirs: **7 361,3 m medidos por el sistema** against the ~7,4 km the study
publishes. The 141 parcels are their own survey, with the codes the field sheet uses.

Turn the areas of influence on and off. Click a polygon; the table row selects. Click a row; the map
follows.

> «El mapa y la tabla son la misma consulta. Nada aparece en el mapa que no esté en la tabla, que es
> la que se puede leer con teclado y con lector de pantalla.»

The legend says *Capa del estudio · no es catastro oficial*. Say why that matters: the layer arrived
with owner names, deeds and photographs, and **none of that is in the system** — the attributes were
removed before the file entered it.

Open one parcel: código, abscisa, lado, superficie medida, afectación, and its own visit history.

### 3 · Cómo se reparte y se sigue el trabajo — *Trabajo de campo*, 3 min

*Operativo actual*: the campaign, the questionnaire version it captures against, progress counted
from the tables — never a stored total — and workload per technician as counts.

> «Esto no es un tablero que alguien actualiza. Son las asignaciones y las fichas enviadas, contadas
> en el momento de abrir la pantalla.»

If they ask about history: open *Ver el operativo anterior*. It is closed, complete, and takes no
part in today's figures.

### 4 · Una ficha de campo — *Trabajo de campo → una respuesta enviada*, 3 min

Open a submitted response. The answers, the version they were captured against, who captured them
and when.

> «Una respuesta enviada no se edita. Ni una palabra, ni una tilde. Una corrección es una nueva
> visita, y las dos quedan.»

That is the sentence that usually lands with a technical director.

### 5 · Tabulación — *Análisis social → Tabulación*, 3 min

Every closed question with its **denominator stated in words**, and the multi-choice one saying its
percentages can exceed 100 %.

> «El denominador está escrito. No hay que confiar en que la hoja de cálculo estaba bien filtrada.»

### 6 · Respuestas abiertas — *Análisis social → Respuestas abiertas*, 3 min

Explain the workflow before showing it: **las reglas calculan, el modelo propone, una persona
valida, y el sistema conserva las tres cosas.** A proposal never enters a validated figure.

> «Hoy, en este entorno, no hay proveedor de modelo configurado, así que la pantalla lo dice: el
> flujo está construido, la inferencia en vivo no está conectada. No vamos a simular una llamada
> que no ocurre.»

Show the two distributions side by side — validated and provisional — with their separate bases, and
the line saying the score is a model score and not a calibrated probability.

### 7 · Dónde el expediente se contradice — *Control de consistencia*, 3 min

Press *Ejecutar revisión*. Four findings, all real inconsistencies in their own file. Open
**QG-001**: 71 predios in one document, 70 in another, both quoted, neither called the error.

> «El producto no dice cuál está bien. Dice que dos documentos del mismo expediente no coinciden, y
> deja la decisión — con su justificación — al especialista que la firma.»

Show the rule catalogue: *lo que esta revisión comprueba, haya encontrado algo o no*. Point at the
last rule, the one that compares the plan against the cartography and found nothing.

### 8 · El plan de manejo — *Plan de Manejo*, 3 min

Nine plans, twenty-two programmes, eighty-six measures, in their own words, grouped as the chapter
groups them.

> «Está tal como lo escribieron. Incluida la columna que dice FRENCUENCIA: no la corregimos, la
> mostramos y la señalamos.»

Point at the header note: this is the plan the study **proposes**. There is no tick box, no evidence
upload, nothing that records execution — the road has not been built.

Then the two identifier columns: the document's own `N°` and the code EIA Studio minted so a measure
can be referenced at all.

### 9 · El borrador del capítulo — *Informes*, 3 min

Generate a version. Every figure carries the source it came from; the themes section says nothing
has been validated yet rather than counting proposals.

Download the .docx: **BORRADOR — NO ES UN ENTREGABLE APROBADO** on the first page and in every
footer.

> «No hay aquí un flujo de aprobación, así que el documento no puede decir que está aprobado.»

Generate again: a second version appears and the first one is still there, still saying what it
said.

### 10 · Lo que ve el cliente — *Portal del cliente → Vista del cliente*, 3 min

The strongest beat of the meeting, and the one to leave time for.

**Start where they already are — inside the workspace.**

> «Aquí trabaja la consultora.»

Point at the rail for two seconds: cartografía, campo, análisis, consistencia, plan, informes. Then
open **Portal del cliente**.

> «La información del cliente no sale directamente de este workspace. La consultora publica una
> actualización controlada.»

Show the three panels without dwelling: *lo que ve el cliente ahora*, *lo que diría una
actualización publicada hoy*, y el *historial*. Read one line from **No se publica** out loud — the
affected-parcel figure:

> «El expediente dice 70 en un sitio y 71 en otro, y esa revisión sigue abierta. El portal no
> escoge una. La omite y dice por qué.»

Then open **Vista del cliente**.

> «Esto es lo que ve el cliente.»

Let them look before you talk. Then point at five things, in this order:

1. **No hay datos individuales.** Ninguna respuesta, ningún propietario, ningún predio con código.
2. **No hay contradicciones internas.** Ni hallazgos de consistencia, ni la cifra en disputa.
3. **No hay operación simulada.** *Seguimiento* dice, literalmente, que todavía no se ha publicado
   información de avance — porque el avance disponible hoy es una simulación, y un cliente no puede
   ver actividad simulada como progreso de su proyecto.
4. **La fecha de publicación**, arriba. Entre publicaciones esto no cambia: no es un espejo.
5. **El mapa y los indicadores** — el corredor, las áreas de influencia, y las cifras del estudio.

Finish with `Imprimir resumen`, which is the answer to *«¿puedo enseñar esto en una sesión de
concejo?»*.

Say once, plainly, before anyone asks:

> «Este enlace todavía no está compartido con nadie fuera de la organización. El acceso externo del
> cliente — su usuario, su clave, su sesión — no está construido. Lo que están viendo es la
> publicación real, con acceso interno.»

## Closing

> «Lo que cambia no es que el estudio se escriba solo. Es que al final del proyecto ustedes pueden
> decir, de cada cifra del capítulo, de dónde salió — que las contradicciones entre documentos
> aparecen mientras hay tiempo de resolverlas, y que lo que ve el cliente lo deciden ustedes, con
> fecha.»

Three sentences, in this order, if they ask "¿y qué gano?":

1. **Menos retrabajo** — las discrepancias entre documentos aparecen solas, con las dos partes.
2. **Menos orden manual** — el levantamiento, las fichas y la cartografía están en un solo sitio, y
   el avance se cuenta en lugar de reportarse.
3. **Más trazabilidad** — cada cifra del informe dice de dónde viene, y eso es lo que se defiende
   ante la autoridad.

## What to say if they ask

| Question | Answer |
|---|---|
| «¿Esto usa IA?» | En un paso: proponer categorías para respuestas abiertas. Propone; valida una persona; el sistema conserva las dos cosas por separado. Hoy no hay proveedor conectado en este entorno. |
| «¿Dónde están los datos de las personas?» | No están. Los atributos de propietarios, escrituras y fotografías se eliminaron antes de que el archivo entrara al sistema, y el cuestionario de demostración no recoge datos personales. Antes de manejar datos reales de personas hay una revisión de cumplimiento pendiente. |
| «¿Podemos ver nuestros datos reales?» | La cartografía y el plan de manejo **son** los suyos. Lo que falta es la ficha socioeconómica editable y las respuestas individuales, que no se han entregado. |
| «¿El cliente puede entrar?» | Todavía no. Lo que ven en el beat 10 es la publicación real, abierta con acceso interno. El acceso externo del cliente — invitación, usuario y sesión propia — es lo que falta (`docs/CLIENT_PORTAL_DECISION.md`, ADR-027, TD-005). |
| «¿Sirve para la fiscalización de la obra?» | No, y a propósito. Esto es la etapa de estudio. Verificar la ejecución del plan es otro producto, y mezclarlos haría que el sistema afirmara que alguien está cumpliendo algo que nadie ha empezado (`docs/ENVIRONMENTAL_AUDIT_PRODUCT_DIRECTION.md`). |
| «¿Cuándo está listo?» | Lo que vieron funciona hoy sobre su estudio. Lo que falta para usarlo en un proyecto en curso está en la lista de limitaciones, y la primera es la revisión de protección de datos. |

## What not to do

- Do not open a screen that is not in this script hoping it looks finished.
- Do not describe the field operation as if it happened; it is a simulation and the badges say so.
- Do not promise a date. The order of what comes next is in
  `docs/PRODUCT_VALUE_AND_DIRECTION.md` §4, and it ends by saying why a roadmap with dates would be
  dishonest.
