# Staging operations — the commands nobody can run for you

> Related: `docs/DEPLOYMENT.md`, `docs/OBJECT_STORAGE.md` §7, `docs/SECURITY.md` §12a,
> ADR-031, ADR-034. Production is out of scope here and stays manual and gated
> (`DEPLOYMENT.md` §6).

This page exists because Wave 2 and Wave 3 built things that **cannot be verified on staging from a
developer's machine**: the credentials are not in this repository and must not be. Each section is
the exact sequence an operator runs, and what to look for afterwards.

Nothing here is a guess about what staging currently holds. Where the answer is unknown, the
procedure starts by finding out.

## 1. Before anything: what is staging on right now

```bash
export EIA_STAGING_MIGRATOR_URL='postgres://…'     # eia_migrator
export EIA_STAGING_RUNTIME_URL='postgres://…'      # eia_app
psql "$EIA_STAGING_MIGRATOR_URL" -c \
  "select count(*) as applied, max(created_at) as last from drizzle.__drizzle_migrations"
```

Compare `applied` with the number of entries in `packages/db/migrations/meta/_journal.json`
(`jq '.entries | length'`). A gap is the migrations below.

## 2. Applying migrations 0034 … 0043 (and 0044+ when they exist)

**Additive and forward-only**, every one: new tables, new columns, new enum values, two new
SECURITY DEFINER helpers, and one `DROP NOT NULL`. No backfill, no destructive change, no RLS
weakened (ADR-031, ADR-032, ADR-033).

```bash
# 1 · baseline, so "what changed" is answerable afterwards rather than asserted
psql "$EIA_STAGING_MIGRATOR_URL" -Atc \
  "select table_schema||'.'||table_name from information_schema.tables
    where table_schema in ('app','audit','portal') order by 1" > /tmp/staging-tables-before.txt

# 2 · apply
DATABASE_MIGRATOR_URL="$EIA_STAGING_MIGRATOR_URL" pnpm db:migrate

# 3 · baseline after, and the difference
psql "$EIA_STAGING_MIGRATOR_URL" -Atc \
  "select table_schema||'.'||table_name from information_schema.tables
    where table_schema in ('app','audit','portal') order by 1" > /tmp/staging-tables-after.txt
diff /tmp/staging-tables-before.txt /tmp/staging-tables-after.txt
```

Expected difference, and nothing else: `app.survey_question_translation`,
`app.survey_option_translation`, `app.upload_intent`, `app.stored_object`, `app.field_media`.

Then the non-destructive suite, which **reads** and rolls back every write (SECURITY.md §12a):

```bash
EIA_STAGING_MIGRATOR_URL=… EIA_STAGING_RUNTIME_URL=… pnpm test:staging
```

It fails if the environment carries the ephemeral marker — i.e. if these URLs point at a throwaway
container rather than staging. That is the guard, and it is meant to be believed.

**Do not** run `pnpm test:integration` against these URLs. It truncates (IG3-001), and it refuses
to run against anything without the marker, but the separation is the point.

## 3. Object storage (TD-090)

Staging has no bucket, so **no document can be uploaded and no photograph can leave a phone**.
`docs/OBJECT_STORAGE.md` §7 is the four-step activation; the variables are:

```
STORAGE_PROVIDER=s3
STORAGE_BUCKET=eia-studio-staging
STORAGE_REGION=auto                      # `auto` for Cloudflare R2
STORAGE_ENDPOINT=https://…               # omit entirely for AWS S3
STORAGE_ACCESS_KEY_ID=…
STORAGE_SECRET_ACCESS_KEY=…
```

Set them on **both** the web project and the worker service. They must name the same bucket: the
web process writes the bytes and the worker reads them, and `memory` — the only alternative — is
per process and is refused outside `local` and `test` anyway (ADR-031 §5, TD-100).

Afterwards, four things to try in staging, in order:

1. upload a PDF on *Documentos* → the row reads **En cola**;
2. wait for the worker → **Listo**, with passages and a page number;
3. *Descargar original* → the file comes back;
4. `audit.log` holds `document.version.download_issued` with the document and version, **and no
   filename**.

If step 2 does not happen, the worker's log says which: `document extraction disabled` means its
own storage variables are missing.

## 4. What must never be done here

| | |
|---|---|
| Real personal data | forbidden until the compliance review of SECURITY.md §10a passes. Staging holds synthetic, PII-free demo data |
| A public bucket | every object is private; every read is a short-lived signed URL |
| `pnpm test:integration` against staging | it truncates. Use `pnpm test:staging` |
| Exposing staging publicly | it sits behind deployment protection, and the client view is an internal session (TD-078) |
| A production deploy | manual, gated, and not from here (`DEPLOYMENT.md` §6) |

## 5. Local equivalent, for rehearsal

Everything above has a local rehearsal that needs no credentials:

```bash
pnpm e2e:storage      # one MinIO, shared by the web servers and the worker
pnpm db:migrate
DEMO_USER_PASSWORD=… pnpm e2e:prepare
pnpm e2e              # includes the full upload → worker → citation → download pipeline
```

That is the same topology staging has — two processes, one bucket — which is why the pipeline test
is worth having (ADR-034 §6).
