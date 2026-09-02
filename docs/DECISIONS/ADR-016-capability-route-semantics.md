# ADR-016 — A disabled capability has no route: 404, not `feature disabled`

- Status: Accepted (Implementation Gate 1, condition IG1-001)
- Date: 2026-09-02
- Related: ADR-002, FEATURES.md §3 and §6, ARCHITECTURE.md §4 and §11, design v0.2 invariant 2

## Context

Slice 1 shipped the first capability-guarded product routes and, in doing so, made a latent
ambiguity concrete. Three different situations were reaching the browser through the same door:

1. the project is not entitled to a capability (product, tenant or project resolution says no);
2. the capability is effective and the surface exists;
3. the capability is effective but this slice has not built the surface yet.

The architecture documented one answer for (1): *"a disabled capability has no route (not a 404
page: a `feature disabled` state rendered only when reached by direct link)"* (ARCHITECTURE.md
§4), and FEATURES.md §3 said a HIDDEN capability reached by direct link renders that state.

Implementing it revealed the cost. The `feature disabled` state is informative by design — it
names the capability key and says who can enable it ("Un Owner puede activarlo en Tenant
Settings › Módulos"). Served at a route, to anyone who can guess a URL, it turns the router into
an oracle for another party's configuration: which modules a tenant has bought, which ones a
project has switched off, and which keys exist at all. It also blurred (1) and (3) in the UI:
both were "a panel explaining why nothing is here", and a reader could not tell "you are not
entitled to this" from "this is coming".

## Decision

Route semantics are now decided by the **effective capability**, and nothing else:

| Situation | Route behaviour |
|---|---|
| Effective capability is `false` (any reason: product, tenant, project, dependency, ANNOUNCED) | **404 Not Found.** No capability key, no enablement copy, no "coming soon". |
| Effective capability is `true` and the surface is implemented | Render the surface. |
| Effective capability is `true` and the surface is not implemented yet | An explicit, non-functional state: *"Módulo habilitado para este proyecto. La implementación aún no está disponible."* It exposes no module data, offers no actions, and does not claim the workflow exists. |

Three constraints on the mechanism:

- **One policy, one place.** `apps/web/lib/surface-access.ts` resolves every project route.
  A page never re-derives the rule, and no page may substitute its own check.
- **Navigation presentation cannot widen it.** ACTIVE / ANNOUNCED / HIDDEN remain shell-only. An
  ANNOUNCED capability is `effective = false`, so its route is 404 exactly like a HIDDEN one; the
  rail may still show it as a non-navigable placeholder, because the rail is presentation.
- **The domain is unchanged.** `requireCapability` still throws `FeatureDisabled`, which still
  carries the capability key and `whoCanEnable`. The mapping from that error to a response is a
  *delivery* concern: the route layer answers 404. The typed error keeps its value for surfaces
  that legitimately know the capability — Tenant Settings › Módulos, Project Settings, and any
  in-page region of a surface the user is already authorized to see.

## Consequences

- **This supersedes** the parenthetical in ARCHITECTURE.md §4 and the HIDDEN row of FEATURES.md
  §3. Both are amended to point here; the earlier text is not rewritten silently.
- The `feature disabled` state remains one of the 15 system states and remains in the state
  gallery. Its scope narrows from "route reached by direct link" to "an in-page region of a
  surface the user may already see, and the settings surfaces that manage capabilities".
- A user who genuinely needs a module now learns about it from Tenant Settings or from a person,
  not from a URL. That is the intended trade: routes stop describing configuration.
- Enumeration of capability keys through the router is no longer possible: every disabled key
  answers identically to a nonsense URL.
- The distinction between "not entitled" and "not built" becomes visible where it matters — to
  someone who *is* entitled — and invisible where it does not belong.

## Alternatives considered

**Keep `feature disabled` at the route.** Faithful to the letter of the original text and to
invariant 2's spirit ("nada de atenuado ni candado" — no greyed-out item, no padlock). Rejected
because the state's own copy is the disclosure: a padlock at least says nothing about who can
open it, while this page names the key and the role that controls it.

**404 for everything, including unbuilt surfaces.** Simplest, and it was tempting. Rejected
because it lies to an entitled user: the project *does* have the module, the rail shows it, and
answering "no such thing" would make the shell inconsistent with itself and would hide real
delivery state from the person paying for it.

**A generic "not available" page for both.** Rejected: it re-creates the ambiguity this ADR
exists to remove, and it still confirms that the URL means something.
