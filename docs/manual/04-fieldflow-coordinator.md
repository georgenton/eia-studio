# 04 · FieldFlow for a coordinator

`/t/…/p/…/field`, signed in as `coordinadora@demo.invalid`.

One route serves two different screens, chosen by **permission** rather than role name: a caller
with `field.read` gets this one; a caller with only `field.assignments.read_own` gets _My Work_
(page 05).

## What the coordinator sees

- **_Operativo actual_** — the campaign running now, the **questionnaire version** it captures
  against, the **capture channel** and whether that channel supports offline;
- **_Operativo anterior_**, for each earlier operation the project ran. It is closed and complete —
  every assignment, visit and submitted response still there — and it takes no part in today's
  progress, the tabulation's denominator or a report snapshot (ADR-026). A project accumulates
  these; only one of them is what "pendientes" means today;
- **progress counted from the tables** — assignments, visits, responses submitted — never a stored
  running total that could drift;
- **workload per technician**: counts only. A coordinator sees how much a technician has done, not
  what any household answered, until they open a response.

## The inbox of submitted responses

Submitted responses only; drafts never appear and never enter a figure anywhere in the product.
Opening one requires `field.responses.read`, which a technician and a GIS specialist do not have.

## What cannot be done, and why

- **An answer cannot be edited.** Not a word, not a spelling correction. A submitted response and
  its answers are refused by the database. A correction is a new visit, and the superseding
  workflow is not built yet (TD-036).
- **A published questionnaire version cannot be changed.** Refinement publishes a new version, and
  responses stay readable against the version they were captured on.
- **Offline capture does not exist yet.** `field.surveys.offline_mode = required` refuses to
  activate a campaign, because the web capture channel declares no offline support (TD-035).
- **A campaign's parcels are not edited after the field work starts.** A campaign records an
  operation, not a plan: when the intended coverage changes, the operation that ran is **closed**
  and a new one opens. Nothing is deleted, and the old campaign keeps everything it did (ADR-026).

## Cuando una respuesta enviada está equivocada

Una ficha enviada **no se edita**. Ni por el técnico, ni por la coordinación, ni por nadie: la base
de datos rechaza la escritura. Lo que sí se puede hacer es pedir que se levante de nuevo.

1. Abre la respuesta desde _Trabajo de campo_ → la asignación del predio.
2. Al final de la ficha está **Historial de la respuesta**.
3. Escribe en **¿Qué hay que corregir?** qué está mal, en tus propias palabras. El técnico lo va a
   leer. No escribas ahí el dato corregido: eso se captura en campo.
4. Pulsa **Solicitar corrección**.

Lo que pasa después:

- se crea una **revisita** para el mismo técnico, en el mismo operativo y sobre el mismo predio;
- **no cambia ninguna cifra todavía**. La respuesta original sigue siendo la vigente para el
  análisis hasta que alguien levante la corrección. La pantalla lo dice;
- cuando el técnico envía la captura nueva, ésa pasa a ser la vigente. La anterior se conserva
  íntegra y aparece marcada **Sustituida**;
- el avance del operativo **no** cuenta la revisita como un predio más: sigue siendo el mismo
  predio. Las correcciones pendientes se cuentan aparte.

Si la solicitud ya no hace falta, **Cancelar la solicitud** la retira. La respuesta original nunca
dejó de ser la vigente.

Una corrección se pide siempre sobre la respuesta **vigente**. Si ya hay una corrección aplicada, la
siguiente se pide sobre ella, no sobre el envío original: así el historial es una línea y no una
bifurcación.

Ver `docs/SURVEY_CORRECTIONS.md`.
