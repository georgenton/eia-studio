---
"@eia/web": patch
"@eia/ui": patch
---

Two amber notes meet the contrast minimum, because the fill is not a text colour.

The correction note on a technician's work card (*Corrección solicitada …*) and the draft note on
the report templates surface were drawn in `--eia-warn`, the amber **fill**. At 12 px on white that
is 3,38:1, below the 4,5:1 WCAG 2 AA minimum for normal text. Both now use `--eia-warn-text`
(5,32:1), the token that exists for exactly this; the template note's left rule keeps the fill,
which is what a stroke is for.

This is not a divergence from the approved bundle to record. The bundle gives amber as two values —
"`#B08519` · texto `#8A6512`" — and spends the first on the *Requiere revisita* stroke and the
*SeverityTag* dot, never on a word. The implementation had simply taken the fill where the design
system already offered the text shade.

Both call sites carried a hardcoded fallback that passed (`#9a6b1f`, 4,67:1) and never applied,
because a defined token means the fallback is dead; the failing colour was the one that rendered.
The axe scans had not caught it either, for a reason worth keeping: the correction note renders only
for a correction revisit, which does not exist on a freshly seeded database at the point the
technician project runs, so the violation surfaced only on a second run against a database that
already held one. A runtime scan can only see what renders, so the guard added here reads the
stylesheet instead and holds whatever the data happens to be.
