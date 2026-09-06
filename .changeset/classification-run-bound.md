---
"@eia/domain": patch
"@eia/application": patch
---

A classification run is bounded, and says so instead of truncating.

Nothing limited how many answers one run could send to a model: a run codes every eligible answer
of one question, so the cost of pressing the button was the size of the project's field work — four
responses in the pilot, and some other number in the project after it. `selectAnswersForRun` caps a
run at 200 and **refuses** above that rather than quietly taking the first 200: a silent truncation
would leave a queue whose remainder nobody is waiting for, and a distribution computed over
whichever answers sorted first.

The way to run a smaller one is an explicit `limit` on the input, which is also how a first live
call against a paid provider is kept to two answers — `pnpm social:run … --limit 2` — on the
product's own path, with the same demo-only gate and the same rows. The audit entry records the
limit, so a small run is distinguishable from a small project.

`ai-outbound-boundary.test.ts` asserts what each of the three AI paths actually sends: the
classifier carries one delimited answer and the taxonomy and has nowhere to put a respondent; the
document assistant carries the question and the passages' words but not the chunk ids, document
codes or pages a citation is resolved with; the report generator carries labels, values and bases
but not the sources each fact rests on. It fails when any of them widens.
