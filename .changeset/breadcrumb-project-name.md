---
"@eia/web": patch
---

The breadcrumb names the project the same way on every surface.

The Command Center showed the project's display name; GIS, FieldFlow, Social Intelligence, the
Quality Gate, Documents, Reports and both detail routes showed the **URL slug** instead, which
reads as a different project on every screen but one. Invariant 1 asks for the project to be
visible everywhere, and it was — under two different names.

Every one of those pages already loads the portfolio, so the display name was in hand. `projectLabel`
resolves it by slug and falls back to the slug rather than to nothing: a breadcrumb that silently
loses its middle rung would be worse than one showing an identifier. `e2e/mvp-journey.spec.ts`
asserts the name is the same across all six rail destinations, so this cannot come back one surface
at a time.
