# What we need from the consultancy: deliverable templates

> The template library is built and working (ADR-036, `docs/REPORT_TEMPLATES.md`). What it has never
> seen is a **real** template. Every `.docx` the test suite exercises is synthetic and named as
> such; none of them is anybody's document. Closing TD-110 needs files, not code.
>
> §4 is a message that can be sent as it stands.

## 1. Why we are asking, and what we will not do without it

EIA Studio fills in **the consultancy's own Word files** — their cover, their heading hierarchy,
their legal phrasing, their register — rather than generating documents in a format this product
invented. A deliverable the firm did not write is one they would nonetheless have to sign.

That means the placeholder vocabulary has to be shaped by real documents. It is deliberately small
today — thirteen keys — and the design is that **meeting a real template adds keys rather than
reshaping the model**.

The alternative, which we are explicitly not taking: inventing plausible templates and building a
vocabulary around them. That would produce a product fitted to our imagination of a consultancy's
documents, and the mismatch would only surface at the moment somebody tried to deliver one.

## 2. What we are asking for

**Between two and five files.** Not the whole library — a representative sample:

| # | Deliverable | Why this one |
|---|---|---|
| 1 | **The social-component report** (*capítulo social* / *componente socioeconómico*) | The one deliverable the product already generates content for (ADR-022). The highest-value match |
| 2 | **The public-consultation / participation report** (*informe de consulta significativa*, *acta de socialización*) | Different structure: attendance, dates, places, quotations. It will test whether the vocabulary can describe an event |
| 3 | **A general environmental study deliverable** — whatever the firm's standard EIA cover and front matter is | The cover and front matter are what almost every deliverable shares, so getting them right helps all of the others |
| 4 | **The management-plan deliverable (PGAS)**, *if one is used as a separate document* | The product already imports the PGAS chapter's own rows (ADR-024). If the plan is delivered as its own file, its template is the one that would use them |
| 5 | **An official English template**, *only if one genuinely exists* | The programme is financed under IDB guidelines, so an English deliverable may be required. **Please do not translate a Spanish one for us** — a machine-translated template is a document the firm did not write, and we would rather have none than an invented one |

Items 4 and 5 are conditional. If the firm does not use them, saying so is a complete answer.

## 3. What the files need to be

| | |
|---|---|
| **Format** | **`.docx` only.** Not `.doc`, and **not `.docm`** — a macro-enabled file is refused by the product, and a `.docm` renamed `.docx` is refused too, because the macro project is detected inside the archive |
| **Formatting** | **Leave it exactly as it is.** Do not simplify, tidy or flatten anything. The institutional layout, the styles, the headers and footers, the numbering, the logos — all of it is what we are trying to preserve. A cleaned-up file teaches us the wrong thing |
| **Content** | **A blank or an already-published example, either is fine.** If it is a published one, it does **not** need real personal data: replace names, identity numbers and contact details with anything at all, or send a version from before those were filled in. We do not need real data and would rather not receive it |
| **What varies** | The useful part. In whatever form is easiest — a comment in the file, a highlight, or just a list in the reply — **mark the fields that change from one road to the next**: the project's name, the canton, the length, the dates, the figures, the personnel. Those are the candidates for automatic filling; everything else stays exactly as the firm wrote it |
| **How to send** | Whatever is convenient. They will be stored under the same rules as any delivered file: no filename in the storage key, access by permission, every download recorded |

## 4. A message that can be sent as it is

> Hola Carlos,
>
> Para terminar la parte del sistema que genera los entregables en Word, necesito ver **plantillas
> reales de la consultora** — entre dos y cinco archivos, no toda la biblioteca.
>
> Idealmente:
>
> 1. el informe del **componente social**;
> 2. el informe de **consulta / socialización**;
> 3. una **portada y preliminares** de un estudio ambiental estándar;
> 4. la plantilla del **Plan de Manejo (PGAS)**, si se entrega como documento aparte;
> 5. una plantilla **oficial en inglés**, sólo si realmente existe una (si no existe, no hace falta;
>    preferimos no tener ninguna a tener una traducida).
>
> Sobre los archivos:
>
> - **`.docx`**, por favor — no `.doc` ni `.docm` (el sistema rechaza los archivos con macros);
> - **sin retocar el formato**: los estilos, encabezados, numeración y logos institucionales son
>   justamente lo que queremos conservar. Un archivo "limpiado" nos sirve menos;
> - pueden ir **en blanco o ya usados**; si van usados, **no necesitamos datos personales reales** —
>   basta con sustituir nombres, cédulas y teléfonos por cualquier cosa;
> - si puedes, **marca qué campos cambian de una vía a otra** (nombre del proyecto, cantón,
>   longitud, fechas, cifras, responsables). Puede ser un comentario en el documento o simplemente
>   una lista en la respuesta.
>
> Con eso reviso qué valores puede rellenar el sistema automáticamente y cuáles conviene dejar como
> están. Lo que el sistema no pueda obtener de forma verificable **no lo va a inventar**: queda como
> campo a completar por la persona que firma el documento.
>
> Gracias,
> Jorge

## 5. What happens when the files arrive

Per template, through the product's own surface — no scripts, no fixtures:

1. **Upload** it under *Informes → Plantillas*. The archive is checked before anything is read: it
   must be a real Word package, it must carry no macro project, and it is bounded against its
   declared sizes before expansion.
2. **Validate**. The product reads every placeholder the file contains and lists them, including the
   ones it does not recognise.
3. **Report the unsupported placeholders** back, by name, with what each would need.
4. **Map only what can be sourced.** A value gets a placeholder when the product can produce it
   **deterministically** — a project's own identity column, a measured metric with its provenance,
   a row of the imported management plan.
5. **Activate** a version. That is a decision behind `deliverables.approve`, and it freezes the
   version: a deliverable can name it from that moment.
6. **Generate a sample**, download it, and **open it in Word** to check the layout survived.

### The rule that decides what is added

> **A blank field in a Word file is not a reason to add a placeholder.**

If EIA Studio cannot source a value deterministically, it will not be automated. Such a field is
reported as a **business decision**, with three honest options: leave it for a person to fill in;
make it something the project records (which means a real product change); or accept that this
template cannot be fully generated.

Adding a placeholder for a value the product would have to guess is the one outcome we will not
produce. An invented figure in a signed deliverable is worse than a blank one.

## 6. Status

| | |
|---|---|
| Real templates received | **None.** Verified 18 September 2026: no `.docx`, `.doc` or `.dotx` exists anywhere in this repository |
| What the suite uses instead | Three synthetic files built in code (`buildDocxTemplate`, `buildMacroEnabledTemplate`, `buildNotAWordPackage`). **They are not any consultancy's templates** |
| Tech debt | TD-110, open |
| Blocks | A generated deliverable a consultancy would actually send. It does **not** block field capture, analysis or the client portal |
| Owner | Jorge → Carlos / the consultancy |
