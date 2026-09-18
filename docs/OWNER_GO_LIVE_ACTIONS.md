# What the owner has to do, and nobody else can

> Every item here is blocked on an account, a payment, a legal opinion or a physical object. None of
> it is engineering, and none of it can be worked around in code. Ordered by what unblocks the most.
>
> Target operational date: **15 October 2026**. Status as of **18 September 2026**.

## The short version

| # | Action | Who | Unblocks | Cost |
|---|---|---|---|---|
| 1 | Sign the privacy checklist | Jorge + legal | **All real data** | time |
| 2 | Create an object storage bucket | Jorge | documents, photographs, templates, deliverables | ~$1–5/mo |
| 3 | Create an Expo account and build an APK | Jorge | offline field capture, the physical UAT | free |
| 4 | Provide one Android handset | Jorge / consultancy | the UAT — nothing else can substitute | a phone |
| 5 | Verify a database provider, then buy it | Jorge | production, backups, PITR | ~$25–40/mo |
| 6 | Get a commercial basemap licence | Jorge | the map in production, legally | to be quoted |
| 7 | Send 2–5 real deliverable templates | Carlos | generated Word deliverables | none |
| 8 | Send the eight road intake sheets | Carlos | the other seven projects | none |

Items 3 and 4 together are the whole of the field-system validation. Item 1 gates everything that
involves a real person.

---

## JORGE

### J1 · Sign, or get signed, the privacy checklist

| | |
|---|---|
| **What** | Work through `docs/PRODUCTION_PRIVACY_CHECKLIST.md` with whoever is responsible, and sign §4 |
| **Why** | Ecuador's personal-data framework requires a specific review before real personal data is processed. This product records; it does not decide |
| **Blocks** | **Everything involving a real person**: real survey responses, real photographs, real documents that name anybody, and any AI provider |
| **Needs** | The checklist, someone who can give a legal opinion, and the consultancy's view on controller/processor |
| **Evidence** | §4 filled in and signed, with a date and a named person |
| **Note** | Twelve lines, and the answers are not obvious. Start it early; it has the longest lead time of anything here |

### J2 · Create an object storage bucket

| | |
|---|---|
| **What** | An S3-compatible bucket, then six variables on **both** the Vercel project and the Railway worker |
| **Why** | Without it no document can be uploaded and **no photograph can leave a phone**. The product reports `NOT_CONFIGURED` and refuses to fall back to anything temporary, deliberately |
| **Blocks** | Documents, extraction, citations, the Quality Gate's evidence, AI document review, field photographs, template upload, generated deliverables |
| **Needs** | An account (Cloudflare R2 recommended — zero egress) and a **least-privilege** key for one bucket. Settings are in `docs/PRODUCTION_INFRASTRUCTURE_DECISION.md` §4a: private, versioning on, no lifecycle that expires current versions |
| **Evidence** | Upload a PDF on *Documentos* → it reads **En cola** → the worker makes it **Listo** with passages → *Descargar original* returns the file → `audit.log` holds `document.version.download_issued` **with no filename** |
| **Cost** | ~$1–5/month |

### J3 · Create an Expo account and produce an Android APK

| | |
|---|---|
| **What** | An Expo account, link the project, build an internal APK |
| **Why** | There is no installable build of EIA Field anywhere. Offline capture — the reason the mobile application exists — has never run on a phone |
| **Blocks** | Offline field capture, and therefore the physical UAT and any campaign with `offline_mode = required` |
| **Needs** | An email address. **The account is free and the build is free**; no Google Play account is needed for an internal APK |
| **Evidence** | An `.apk` a technician can install, and `pnpm go-live:doctor` reporting the EAS project as linked |
| **Commands** | `pnpm add -g eas-cli` → `npx eas-cli login` → `cd apps/field && npx eas-cli init` → `npx eas-cli build -p android --profile staging` |
| **Note** | **Do not submit to the Play Store.** An internal APK is sufficient and store submission is out of scope |

### J4 · Provide one Android handset

| | |
|---|---|
| **What** | A real Android phone, in somebody's hands, ideally somewhere with poor signal |
| **Why** | `docs/FIELD_MOBILE_OFFLINE_UAT.md` is **PREPARED and has never been executed**. A simulator does not test aeroplane mode, a force-kill, a camera or a corridor with no bars |
| **Blocks** | Go-live blocker 7. It is the last engineering-adjacent thing standing between this and a field-ready system |
| **Needs** | The phone, the APK from J3, and an afternoon |
| **Evidence** | The procedure worked through **exactly**, all 23 steps plus §4a's correction revisit, with the duplicate counts checked in the web after each case. Then — and only then — its status becomes **PASSED** |

### J5 · Verify and then buy a database provider

| | |
|---|---|
| **What** | First the free check, then the purchase |
| **Why** | Staging's PostGIS image **cannot do point-in-time recovery**, verified with Railway's own CLI. Production cannot inherit a database with no backups |
| **Blocks** | Production entirely, and the recovery guarantee of `docs/PRODUCTION_RECOVERY.md` |
| **Needs** | **Step one costs nothing**: a free Neon project, then `DATABASE_MIGRATOR_URL=… pnpm db:migrate` and `pnpm db:check`. That proves the migrator can create `eia_policy` with `BYPASSRLS`, which is the one thing that decides whether Neon works at all |
| **Evidence** | 52 of 52 migrations applied and no drift, on the provider's own database |
| **Cost** | ~$25–40/month once bought. Supabase is the fallback at roughly four times the price for the same PITR guarantee |
| **Then decide** | Launch gives 7 days of history; `PRODUCTION_RECOVERY.md` §3 asks for ≥ 14. Either take Scale or amend §3 with a reason |

### J6 · Get a commercially licensed basemap

| | |
|---|---|
| **What** | A MapTiler contract that permits commercial use, or an alternative provider |
| **Why** | **MapTiler's Free and Flex plans do not permit commercial use** — read from their published terms on 18 Sep 2026. Only a Custom prepaid contract does. A consultancy delivering paid studies to a government customer is commercial use |
| **Blocks** | The map in production, legally. **Not** technically — with no key the GIS surface renders *sin fondo* with every layer and both legends intact |
| **Needs** | A quotation from MapTiler, or another provider whose licence permits it |
| **Evidence** | The contract, and a production key **restricted by origin** to the production hostname |
| **Note** | Easy to assume settled because a key already works in staging. It is not: the key that works is not necessarily one that may be used |

### J7 · Decide the region

| | |
|---|---|
| **What** | Which region every component is provisioned in |
| **Why** | Nobody has said whether Ecuadorian personal data may be processed outside Ecuador. Choosing now would be answering a legal question by picking a dropdown |
| **Blocks** | Provisioning J2 and J5 in the right place — cheap to decide first, expensive to migrate later |
| **Needs** | J1's answer |
| **Evidence** | The decision recorded in `PRODUCTION_INFRASTRUCTURE_DECISION.md` §7, with a date |

---

## CARLOS / THE CONSULTANCY

### C1 · Send 2–5 real deliverable templates

| | |
|---|---|
| **What** | The firm's own `.docx` files — social report, consultation report, a standard cover, the PGAS deliverable if separate, an official English one only if it genuinely exists |
| **Why** | The template library is built and has never seen a real template. Every file the tests use is synthetic |
| **Blocks** | Generated Word deliverables. Nothing else — field capture, analysis and the portal are unaffected |
| **Needs** | `.docx` only (not `.docm`), **formatting untouched**, blank or already-used, **no real personal data needed**, and a note of which fields change from one road to the next |
| **Evidence** | Each uploaded, validated, activated, and a sample generated and opened in Word |
| **Ready to send** | `docs/CONSULTANCY_TEMPLATE_REQUEST.md` §4 is a message that can go as it is |

### C2 · Send the eight road intake sheets

| | |
|---|---|
| **What** | One copy of `docs/EIGHT_ROAD_ONBOARDING.md` §2 per road |
| **Why** | Seven of the eight projects do not exist and cannot, because nobody has supplied a title, a slug, a canton or a coordinator |
| **Blocks** | Seven of eight studies, entirely |
| **Needs** | For each road: the official title, a short name, the programme reference, canton and province, estimated dates, **who coordinates it**, and what cartography and corpus exist |
| **Evidence** | A project per road on the Portfolio, with its readiness report computed from what is actually loaded |
| **Note** | **No fake road projects have been created.** A field nobody can answer stays *WAITING FOR CLIENT DATA* rather than being guessed |

### C3 · Name who classifies document privacy

| | |
|---|---|
| **What** | A person who reviews each uploaded document and says whether it contains identified personal data |
| **Why** | Every version defaults to `REVIEW_REQUIRED`, which means *nobody has looked*. The product treats that as ineligible for a model — correctly — so an unreviewed corpus is one AI review will refuse in full |
| **Blocks** | AI document review over the real corpus. Not extraction, not citation, not the Quality Gate |
| **Needs** | A named person and a criterion they can apply |
| **Evidence** | Versions moving off the default, by somebody who read them |

---

## LEGAL / PRIVACY REVIEW

### L1 · Controller and processor

Who is controller and who is processor, between the consultancy, the client GAD and EIA Studio.
**Blocks** every other legal question. Evidence: written down and agreed by all three.

### L2 · Lawful basis, purpose and retention

Per data class in `PRODUCTION_PRIVACY_CHECKLIST.md` §2. **Blocks** real data, and the retention
answer also **blocks engineering**: there is no retention job today, and building one needs a period
to build it against. Evidence: §4 signed.

### L3 · Three specific policies

| Policy | The question |
|---|---|
| **Photographs** | What may be photographed, whether EXIF GPS may be retained, and **whether a deletion path must exist before go-live** — today a photograph cannot be removed by anybody, including whoever took it by mistake |
| **Technician GPS** | Staff location is a different category from a respondent's. Agreed with whoever employs the technicians? |
| **Erasure** | A subject-erasure request cannot be satisfied today without a manual database operation. Is that acceptable for V1? |

Each **blocks** real data of that kind. Evidence: a written policy, and any product change it
implies raised as work.

### L4 · AI vendor eligibility

Which provider, in which region, under which contract, with which retention terms. The processor
registry is modelled and **empty**. **Blocks** every AI feature. Evidence: a registry entry and a
contract. Until then all three selectors stay unset — which is the current state everywhere.

---

## VENDOR ACCOUNTS

| Account | Cost | Needed for | Needed by | State |
|---|---|---|---|---|
| **Expo** | free | J3, therefore J4 | now | not created |
| **Object storage** (R2 or equivalent) | ~$1–5/mo | J2 | now | not created |
| **Database** (Neon or equivalent) | free to verify, ~$25–40/mo | J5 | before production | not created |
| **MapTiler commercial** | to be quoted | J6 | before production | staging key is non-commercial |
| **Apple Developer** | $99/year | iOS only | not for UAT | not created |
| **Google Play** | $25 once | publishing only | not for UAT | not created |

Every one requires the owner's own identity and payment method. None has been created, and this wave
created none.

---

## What is NOT waiting on anybody

So the list above is read as what it is — the remainder, not the whole.

Questionnaire authoring, the correction workflow, offline sync and its idempotency, bilingual ES/EN,
document versioning and extraction, the Quality Gate, AI document review, PGAS, report snapshots,
the template library, the client publication, multi-project isolation, staging at migration 52, the
restore **procedure** (drilled and passed on synthetic data), and the operator diagnostics
(`pnpm ops:doctor`, `pnpm go-live:doctor`, `pnpm restore:drill`).

**Production deploy status: not deployed, and not attempted.**
