---
"@eia/db": patch
"@eia/web": patch
---

Four fewer round trips on every page, and a pool that survives an idle path.

**The shell asked for a portfolio to draw a breadcrumb.** Every workspace page called
`loadPortfolio` for the tenant name and the project switcher — a read that also fetches metrics,
attention items, the activity feed and all of their provenance records so the *Portfolio page* can
draw cards. `loadWorkspaceHeader` asks for the two things the shell needs, under the same permission
and the same context. Measured: **49 → 45 round trips on the Command Center, 37 → 33 on GIS and
Trabajo de campo, 33 → 29 on Control de consistencia, 31 → 27 on Documentos and Informes**.

**The pool was running on defaults**: no TCP keepalive, unbounded connection lifetime, no connect
timeout, no statement timeout. On a long-haul path through a public TCP proxy that is exactly the
shape that produces one unexplainable `read ECONNRESET` — an idle connection reclaimed by something
in the middle and then handed to a request as though it were healthy. It now keeps the path alive,
recycles connections on its own schedule, and fails fast and legibly when it cannot get one or when
a query hangs (TD-067). Operator work — migrations, seeds, imports, test fixtures — opts out of the
statement timeout, because a migration cancelled halfway is worse than a slow one.

**No retries were added.** A retry around a transaction re-runs whatever it contained, and this
product's transactions write.

The performance driver now also measures the Plan de Manejo route and reports each route's **first
hit** separately from its median, because a reviewer opening a page nobody has opened today pays it.
