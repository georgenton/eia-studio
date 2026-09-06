# Capturing what the consultancy says

> A form to fill in **during** the walkthrough and a rule for what happens to each line afterwards.
> Related: `docs/CONSULTANCY_DEMO_SCRIPT.md` (what is shown), `docs/CONSULTANCY_DEMO_BRIEF.md` (the
> questions to ask), `docs/TECH_DEBT.md` and `docs/DEVELOPMENT_WAVE_LOG.md` (where a line ends up).
>
> **This is a document, not a module.** No issue tracker is being built inside EIA Studio: the
> product has no backlog table, no ticket entity and no feedback surface, and none is planned. One
> copy of this file per session, in the repository, is the whole system.

## How to use it

1. Copy this file to `docs/feedback/YYYY-MM-DD-<firm>.md` before the session.
2. Fill §1 in advance. Fill §2 **while they speak**, in their words.
3. Do not classify anything during the session. Classification is §3, and it happens afterwards,
   with a cold head.
4. Route every line in §4. A line with no route is a line that will be forgotten.

Two capture rules, because both failures are common and both are expensive:

- **Quote, do not paraphrase.** «esto no me sirve si no puedo exportarlo» is data. "They want
  export" is already an interpretation, and it is the interpretation that turns out to be wrong.
- **Record what they did, not only what they said.** Where they hesitated, what they clicked twice,
  what they scrolled past, which screen they asked to go back to. A consultant who says "está claro"
  while hunting for the button has told you something the sentence did not.

---

## 1 · Session

| | |
|---|---|
| Date | |
| Firm | |
| Present, and their role in a study | |
| Shown from | (URL / commit) |
| Preflight | `demo:preflight` __ FAIL · `demo:doctor` __ FAIL (`docs/CONSULTANCY_DEMO_PREFLIGHT.md`) |
| Assisted coding | configured / not configured |
| Beats shown | 1 2 3 4 5 6 7 8 9 — circle what was actually reached |
| Duration | |

## 2 · What they said, as they said it

One row per remark. Leave the last two columns empty during the session.

| # | Beat / screen | Verbatim (their language) | What they were doing | Kind (§3) | Route (§4) |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |

### The six questions

`docs/CONSULTANCY_DEMO_BRIEF.md` ends with six questions to ask them. Their answers go here, in
full, even when the answer is "no sé":

| Question | Answer, verbatim |
|---|---|
| 1 | |
| 2 | |
| 3 | |
| 4 | |
| 5 | |
| 6 | |

### Anything they asked for that does not exist

Kept separate on purpose: this is the list that decides what gets built next, and it is the one that
disappears if it is mixed with observations about what does exist.

| # | What they asked for | Their words for why | Would it be theirs alone, or every study? |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

---

## 3 · Kinds

Classify afterwards. One kind per row; if a remark is two things, it is two rows.

| Kind | Means | Example |
|---|---|---|
| **CONFIRMA** | the product does something they recognise as their work | «así es exactamente como repartimos las fichas» |
| **VACÍO** | something their process needs and the product has no answer for | «¿y dónde firmo la aprobación del capítulo?» |
| **MALENTENDIDO** | the product does it, and they did not find it or read it as something else | they looked for provenance in a footnote |
| **DESACUERDO** | they dispute a deliberate decision, not an omission | «el sistema debería decirme si se cumplió» |
| **DEFECTO** | it is broken, slow, or says something untrue | |
| **PALABRA** | a term on screen is not the term they use | «nosotros no decimos *hallazgo*, decimos *observación*» |
| **FUERA** | a real need, outside what this product is | accounting, contracts, payroll |

**MALENTENDIDO and DESACUERDO are the two that must not be merged.** The first is a design defect on
our side and is usually cheap. The second is the product working as intended and being rejected —
and it is the more valuable of the two, because it is the one that says the decision needs an
argument, a change, or an ADR. A DESACUERDO recorded as a MALENTENDIDO turns a strategic signal into
a copy edit.

## 4 · Routes

| Kind | Route |
|---|---|
| CONFIRMA | one line in `docs/DEVELOPMENT_WAVE_LOG.md`; it is evidence, and it is what protects a decision the next time it is questioned |
| VACÍO | §5 below. Nothing is scheduled from the session itself |
| MALENTENDIDO | a copy or navigation change in the next wave, unless it is one screen, in which case fix it and say so in the PR |
| DESACUERDO | write down the disagreement and our reason next to it. If the reason no longer holds, it is an ADR (or an amendment to one), not a task |
| DEFECTO | reproduce it first. If it reproduces, `docs/TECH_DEBT.md` with an owner and a removal trigger, or a fix |
| PALABRA | `docs/PRODUCT_LANGUAGE_ES.md`; the product speaks their Spanish (ADR-025), and their word wins over ours unless it is one of invariant 11's forbidden ones |
| FUERA | say so, in the session, in one sentence, and write it here so it is not asked twice |

## 5 · What this session changed

Filled in **after** the routing, by whoever ran the session. Three lists, and the third is the one
that gets skipped and should not be.

**Decided to build:**

**Decided not to build, and why:**

**Still undecided, and what would settle it:**

---

## 6 · What this document is not

- Not a tracker. Nothing here has a status, an assignee or a sprint. When a line becomes work it
  becomes a wave phase, a tech-debt entry or an ADR, and it stops living here.
- Not a requirements document. A quotation from one firm is one firm. A second session's file
  agreeing with the first is a requirement; the first alone is a hypothesis.
- Not a commitment. Nothing said in a demonstration is a promise, and writing it down is not
  agreeing to it. §5's second list exists so that declining is recorded as deliberately as accepting.
