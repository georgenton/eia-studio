---
"@eia/domain": minor
"@eia/application": minor
"@eia/contracts": minor
"@eia/ui": minor
"@eia/web": minor
"@eia/worker": minor
---

IG4-001: a persistent environment never classifies with the deterministic fake. UX-001: signing out
is findable.

**`SOCIAL_CLASSIFIER` no longer defaults.** It had defaulted to `fake`, so an environment that
simply never set it would have written keyword-matcher output into `ai_classification` — rows that,
once stored, nobody could tell apart from a model's proposals. One domain rule now decides for the
web app, the worker and the operator scripts: `local` and `test` may select the fake explicitly,
every other environment refuses it, unset means assisted coding is unavailable rather than
defaulted, and a gateway missing its credential (or given a model id that does not name its
provider) reports `BLOCKED_EXTERNAL_CONFIG` and is never demoted to the fake. An environment name
nobody anticipated counts as persistent, so a typo in `APP_ENV` loses assisted coding rather than
gaining a fake one.

Two consequences are enforced, not described: `startClassificationRun` writes **nothing** — no run,
no pending classification — when no classifier is available, so a queue never shows work that cannot
move; and a worker whose classifier is unavailable never constructs its consumer, so it never
claims. Neither the web app nor the worker refuses to boot over it, and deterministic tabulation is
untouched: the Social surface simply says which of the three reasons applies.

**An account menu in the topbar.** The identity is now a native `<details>` disclosure containing
the signed-in address, the active role and one action, `Cerrar sesión`. It opens with the keyboard,
announces its state and works before hydration. There is no role switcher: a role is a membership
resolved server-side, so changing it means signing in as someone else, and the menu says so.
