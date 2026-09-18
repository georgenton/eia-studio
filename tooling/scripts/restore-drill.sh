#!/usr/bin/env bash
#
# A restore drill, on synthetic data, against a real PostgreSQL (docs/PRODUCTION_RECOVERY.md §6).
#
# It proves the *procedure*: a database can be dumped, restored into an empty one, and shown to be
# intact afterwards — schema, migration ledger, row level security, policies, triggers and the
# rows an application would read.
#
# It does **not** prove a provider's point-in-time recovery. Nothing can, until a provider is
# chosen and somebody restores from its own backup. This drill is the half that does not need one,
# and running it is how the other half stops being the only thing standing between here and an
# untested recovery.
#
#   tooling/scripts/restore-drill.sh
#
# Refuses to run against anything but a local container. A drill that could be pointed at a real
# environment is the shape of the accident IG3-001 exists to prevent (SECURITY.md §12a).

set -euo pipefail

CONTAINER="${EIA_PG_CONTAINER:-eia-studio-postgres}"
SOURCE_DB="${EIA_PG_DATABASE:-eia_studio}"
DRILL_DB="eia_restore_drill"
DUMP="/tmp/eia-restore-drill.dump"

say() { printf '%s\n' "$*"; }
step() { printf '\n── %s\n' "$*"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  say "refused: container '$CONTAINER' is not running."
  say "This drill runs only against the local development container, never a deployed database."
  exit 1
fi

step "0 · what is being drilled"
docker exec "$CONTAINER" psql -U postgres -d "$SOURCE_DB" -Atc \
  "select 'source: ' || current_database()
        || ' · migrations ' || (select count(*) from drizzle.__drizzle_migrations)
        || ' · projects '   || (select count(*) from app.project)
        || ' · responses '  || (select count(*) from app.survey_instance)"

step "1 · stop writes"
say "In production this is: worker to zero, web to maintenance (PRODUCTION_RECOVERY.md §4 steps 1–2)."
say "Here the drill dumps a quiescent development database, so there is nothing to stop."

step "2 · take the backup"
docker exec "$CONTAINER" pg_dump -U postgres -d "$SOURCE_DB" -Fc -f "$DUMP"
docker exec "$CONTAINER" sh -c "ls -l '$DUMP' | awk '{print \"dump: \" \$5 \" bytes\"}'"

step "3 · restore into an empty database"
docker exec "$CONTAINER" psql -U postgres -d postgres -Atc \
  "drop database if exists $DRILL_DB" >/dev/null
docker exec "$CONTAINER" psql -U postgres -d postgres -Atc \
  "create database $DRILL_DB" >/dev/null
# `--no-owner` is deliberate: roles live in the cluster, not the dump, and a production restore
# into a fresh cluster provisions them with migration 0000 before this step.
docker exec "$CONTAINER" pg_restore -U postgres -d "$DRILL_DB" --no-owner --exit-on-error "$DUMP"
say "restored into $DRILL_DB"

step "4 · verify — the migration ledger is at the repository's head"
# Node rather than jq: this is a repo command, and "jq: command not found" is a worse failure
# than a missing database. Node is a hard dependency of the workspace already.
EXPECTED=$(node -e "process.stdout.write(String(require('./packages/db/migrations/meta/_journal.json').entries.length))")
APPLIED=$(docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -Atc \
  "select count(*) from drizzle.__drizzle_migrations")
say "repository $EXPECTED · restored $APPLIED"
[ "$EXPECTED" = "$APPLIED" ] || { say "FAIL: ledger mismatch"; exit 1; }

step "5 · verify — row level security survived the restore"
docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -Atc "
  select 'tables in app/portal/audit: ' || count(*)
       || ' · with RLS enabled: '  || count(*) filter (where relrowsecurity)
       || ' · forced: '            || count(*) filter (where relforcerowsecurity)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app','portal','audit') and c.relkind = 'r'"
UNFORCED=$(docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -Atc "
  select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app','portal') and c.relkind = 'r' and not c.relforcerowsecurity")
say "app/portal tables without FORCE RLS: $UNFORCED"
[ "$UNFORCED" = "0" ] || { say "FAIL: a restored table lost FORCE RLS"; exit 1; }

step "6 · verify — policies, triggers and the effective-response view came back"
docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -Atc "
  select 'policies: '  || (select count(*) from pg_policy)
      || ' · triggers: ' || (select count(*) from pg_trigger where not tgisinternal)
      || ' · views: '    || (select count(*) from pg_class c
                              join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname = 'app' and c.relkind = 'v')"
INVOKER=$(docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -Atc "
  select coalesce((select c.reloptions::text from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname='app' and c.relname='effective_survey_instance'), 'MISSING')")
say "effective_survey_instance options: $INVOKER"
case "$INVOKER" in *security_invoker=true*) ;; *) say "FAIL: the view lost security_invoker"; exit 1;; esac

step "7 · verify — the application's own rows are readable"
docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -Atc "
  select 'projects '   || (select count(*) from app.project)
      || ' · parcels '   || (select count(*) from app.parcel)
      || ' · responses ' || (select count(*) from app.survey_instance where status='SUBMITTED')
      || ' · answers '   || (select count(*) from app.survey_answer)
      || ' · audit '     || (select count(*) from audit.log)"

step "8 · verify — objects are reconcilable against the database"
# PRODUCTION_RECOVERY.md §4a: the database is the record of what should exist; the bucket is
# checked against it, never the reverse. With no bucket configured there is nothing to reconcile,
# and the query that would do it is the deliverable.
docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -Atc "
  select 'stored objects the database expects: ' || count(*) from app.stored_object"

step "9 · clean up"
docker exec "$CONTAINER" psql -U postgres -d postgres -Atc \
  "drop database if exists $DRILL_DB" >/dev/null
docker exec "$CONTAINER" rm -f "$DUMP"
say "drill database and dump removed"

printf '\nrestore drill: PASSED (procedure, on synthetic local data)\n'
printf 'what this does NOT prove: a provider PITR restore. No provider is chosen (G7).\n'
