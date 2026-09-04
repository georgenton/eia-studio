# 09 · Report generation

`/t/…/p/…/reports`. The social chapter, built from validated data, versioned, traceable and
downloadable.

## What a version is

**A deterministic snapshot of figures, each carrying where it came from.** Not a piece of text. The
snapshot is what is stored, what is versioned, and what a later reader checks; the paragraph a model
may write is a rendering of it.

That is why a version works with no model configured at all — which is the state on staging today.
Every figure, its basis and its source are there; only the prose is absent, and the screen says so.

## Every figure names its origin

Under each number: a **cálculo determinista** with its method in words, a **codificación validada
por especialista** with how many reviews it rests on, a **hallazgo de calidad** with its code and
state, a **pasaje citado del expediente** with document and version, or a **registro de
procedencia** with its facets.

A figure with no source cannot exist — the type has no shape for one.

## What never enters a chapter

- **A provisional AI coding.** The themes section reads validated reviews only. With none, it says
  _"Todavía no hay codificaciones validadas"_ rather than counting proposals.
- **A figure a model invented.** If a generated paragraph states a number the section did not
  compute, the whole generation fails. It is not silently corrected: correcting it would leave the
  rest of the sentence unchecked.
- **A compliance conclusion.** Nothing in the chapter declares conformity, and the Quality Gate
  section says explicitly that signalling a discrepancy does not determine which source governs.
- **An undeclared regime.** A chapter built partly on simulated data names that at the top.

## Versions

Press **Generar versión**. Regenerating after the validated data changes produces a **new** version;
the previous keeps exactly what it said, and opening it says so. A version is never edited — the
database refuses, for the runtime role and for the owning role alike.

Regenerating with unchanged data still creates a version, and the message says the content is
identical to the previous one.

## The .docx

**Descargar .docx** renders the chapter from the stored snapshot. It carries _BORRADOR — NO ES UN
ENTREGABLE APROBADO_ on the first page and in every footer, and lists each figure's source, because
a Word file travels away from the product and has to say what it is on its face.

There is no approval workflow (TD-060): nothing in the system can mark a version approved, which is
why the document says it is not.

## Who

| Role                             | Read the chapter | Generate a version |
| -------------------------------- | ---------------- | ------------------ |
| Coordinator                      | ✅               | ✅                 |
| Social specialist                | ✅               | ✅                 |
| Environmental specialist         | ✅               | ✅                 |
| Reviewer, GIS specialist, viewer | —                | —                  |
| Field technician                 | —                | —                  |

Reading requires `reports.write` **and** `field.responses.read`: the chapter counts validated
codings of individual responses, so reading it needs the same permission the responses do.
