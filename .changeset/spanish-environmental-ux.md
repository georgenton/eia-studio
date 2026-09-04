---
"@eia/ui": minor
"@eia/web": minor
---

The product speaks Spanish, and provenance stops shouting.

The rail said *Command Center*, *Field Surveys*, *Social Intelligence*, *Quality Gate*; the
provenance drawer was headed *DATA PROVENANCE* with a *Human validation* field; the map legend read
`OFFICIAL IMPORTED ALIGNMENT`; panels carried a solid **DEMO** stamp; and the badge a reader opens
to decide whether a figure may be quoted said `REAL_AGGREGATE`. Every one of those is now Spanish
(ADR-025): *Centro de control*, *Control de calidad*, *Origen del dato*, *Validación humana*,
*Eje vial del estudio*, *Simulación operativa*, *Dato histórico*.

The rule behind it is a boundary, not a translation pass: **a stored value is never rendered; a
label for it is.** The keys, capability names, URL segments, enum values and database are unchanged,
the four SOURCE TYPE categories and their derivation are unchanged (invariant 13), and the
consultancy's own words — the PGAS chapter, `FRENCUENCIA` included — are still quoted verbatim.

The badge's eyebrow now explains the datum instead of the mechanism. *Etiqueta derivada de las
facetas* was true and useless to someone deciding what to put in a study; *Cifra verificable del
expediente, sin datos identificables* answers the question they came with.

`e2e/vocabulary.spec.ts` reads every surface, the rail and the drawer, and fails on any
`SCREAMING_SNAKE_CASE` on screen or any term from the list this product actually leaked — because
the leak is systematic: a component that renders a domain value directly produces one without anyone
deciding to.
