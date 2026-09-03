-- Quality Gate: row level security, the append-only decision log, and the invariants that keep a
-- finding honest (Slice 5). Hand-written because policies, triggers and checks must be reviewed
-- SQL, not inferred from a schema diff (ADR-013).
--
-- Four things this file protects.
--
-- 1. **A decision is never edited.** `specialist_review` is append-only. A dismissal that could be
--    quietly rewritten is worse than no record of it: the study would carry a decision nobody
--    made, attributed to somebody who did not make it. A change of mind is another row.
--
-- 2. **A finding always compares two sources.** The evidence trigger refuses a finding that ends a
--    transaction with anything other than exactly one SOURCE_A and one SOURCE_B. A one-sided
--    "finding" is an assertion, and this module does not make assertions.
--
-- 3. **An assertion holds exactly one value.** A CHECK, because a rule comparing dates must
--    compare dates: a row carrying both a number and a date lets a rule silently read the wrong
--    one and produce a finding about nothing.
--
-- 4. **Quality data is project data, behind project access.** No new permission and no new
--    conjunct: a finding names documents and counts, not an individual's answers, so it inherits
--    the ordinary tenant + project + membership predicate rather than the `field.responses.read`
--    door that governs the responses themselves.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.document_assertion,
  app.quality_run,
  app.quality_finding,
  app.finding_evidence
TO eia_app;
--> statement-breakpoint
-- No UPDATE, no DELETE: the append-only rule is a grant before it is a trigger, so a bug cannot
-- even form the statement. The REVOKE is required, not decorative — migration 0002 set
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ... UPDATE, DELETE`, so every new table in this
-- schema arrives with full DML and a narrower GRANT beside it changes nothing.
GRANT SELECT, INSERT ON app.specialist_review TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.specialist_review FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
--
-- The same predicate on every table: this tenant, this project (or a tenant-level listing), and
-- the caller actually has access to that project. `app.current_project_id() IS NULL` allows the
-- portfolio-shaped reads that cross a tenant's projects, still bounded by membership.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.document_assertion ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.document_assertion FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_assertion_select ON app.document_assertion FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY document_assertion_write ON app.document_assertion FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.quality_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.quality_run FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quality_run_select ON app.quality_run FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY quality_run_write ON app.quality_run FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.quality_finding ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.quality_finding FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quality_finding_select ON app.quality_finding FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY quality_finding_write ON app.quality_finding FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.finding_evidence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.finding_evidence FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Evidence is reachable only through a finding the caller can already see. Stated as an EXISTS
-- over `quality_finding` so the finding's own policy applies first, rather than repeating its
-- predicate here where the two could drift apart.
CREATE POLICY finding_evidence_select ON app.finding_evidence FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.quality_finding f
                      WHERE f.tenant_id = finding_evidence.tenant_id
                        AND f.id = finding_evidence.finding_id));
--> statement-breakpoint
CREATE POLICY finding_evidence_write ON app.finding_evidence FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.quality_finding f
                      WHERE f.tenant_id = finding_evidence.tenant_id
                        AND f.id = finding_evidence.finding_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.quality_finding f
                      WHERE f.tenant_id = finding_evidence.tenant_id
                        AND f.id = finding_evidence.finding_id));
--> statement-breakpoint

ALTER TABLE app.specialist_review ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.specialist_review FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY specialist_review_select ON app.specialist_review FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.quality_finding f
                      WHERE f.tenant_id = specialist_review.tenant_id
                        AND f.id = specialist_review.finding_id));
--> statement-breakpoint
CREATE POLICY specialist_review_insert ON app.specialist_review FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.quality_finding f
                      WHERE f.tenant_id = specialist_review.tenant_id
                        AND f.id = specialist_review.finding_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · an assertion holds exactly one value, and it is not empty
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.document_assertion
  ADD CONSTRAINT document_assertion_single_value CHECK (
    (CASE WHEN value_text    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_number  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_date    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_boolean IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
--> statement-breakpoint
-- A date is a calendar date. Stored as text so the fixture reads as it is written, checked here so
-- a rule that parses it can rely on the shape.
ALTER TABLE app.document_assertion
  ADD CONSTRAINT document_assertion_date_shape CHECK (
    value_date IS NULL OR value_date ~ '^\d{4}-\d{2}-\d{2}$'
  );
--> statement-breakpoint
-- Slice 5 has no ingested documents, so an assertion claiming to come from one would be a
-- fabricated citation. The check is dropped by the migration that adds document versions.
ALTER TABLE app.document_assertion
  ADD CONSTRAINT document_assertion_source_kind_available CHECK (
    source_kind = 'RECONSTRUCTED_CORPUS'
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · a justification is mandatory, and a token word is not one
--
-- Twelve characters is not a quality bar. It stops "ok", "sí" and "." from standing as the
-- recorded reason a finding about a study was settled. What actually enforces quality is that the
-- text is kept forever and attributed to a person.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.specialist_review
  ADD CONSTRAINT specialist_review_justification_present CHECK (
    length(btrim(justification)) >= 12
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 5 · a decision is never edited or deleted
-- ---------------------------------------------------------------------------------------------
-- `search_path` is pinned on every function in these schemas (migration 0004's contract, asserted
-- by `security-definer.integration.test.ts`): `pg_catalog` first so a shadowed built-in cannot be
-- substituted, no `public`, `pg_temp` last so a temporary object never resolves ahead of a real one.
CREATE OR REPLACE FUNCTION app.specialist_review_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'specialist_review_append_only: a specialist decision is a permanent record; '
                  'record a new decision instead of changing this one';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER specialist_review_no_update BEFORE UPDATE ON app.specialist_review
  FOR EACH ROW EXECUTE FUNCTION app.specialist_review_append_only();
--> statement-breakpoint
CREATE TRIGGER specialist_review_no_delete BEFORE DELETE ON app.specialist_review
  FOR EACH ROW EXECUTE FUNCTION app.specialist_review_append_only();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 6 · a finding compares exactly two sources
--
-- A CONSTRAINT TRIGGER, deferred to commit, because the finding and its evidence are inserted as
-- separate statements in one transaction: checking per statement would refuse the first insert of
-- a perfectly good pair. The same shape as `affectation_within_parcel` (TD-032).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.quality_finding_has_two_sources() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  target uuid;
  target_tenant uuid;
  sources_a integer;
  sources_b integer;
BEGIN
  -- The same function guards both tables, and they name the finding differently: on
  -- `quality_finding` it is the row's own id, on `finding_evidence` it is `finding_id`. Reading
  -- `NEW.id` for both would silently check a finding that does not exist and pass every time.
  IF TG_TABLE_NAME = 'quality_finding' THEN
    target := COALESCE(NEW.id, OLD.id);
    target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  ELSE
    target := COALESCE(NEW.finding_id, OLD.finding_id);
    target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  END IF;

  -- The finding may have been deleted in the same transaction; then there is nothing to check.
  IF NOT EXISTS (SELECT 1 FROM app.quality_finding f
                  WHERE f.tenant_id = target_tenant AND f.id = target) THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*) FILTER (WHERE role = 'SOURCE_A'),
    count(*) FILTER (WHERE role = 'SOURCE_B')
    INTO sources_a, sources_b
    FROM app.finding_evidence e
   WHERE e.tenant_id = target_tenant AND e.finding_id = target;

  IF sources_a <> 1 OR sources_b <> 1 THEN
    RAISE EXCEPTION 'quality_finding_two_sources: a finding compares exactly two sources '
                    '(found % SOURCE_A and % SOURCE_B); supporting material belongs in CONTEXT',
                    sources_a, sources_b;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER quality_finding_two_sources
  AFTER INSERT OR UPDATE ON app.quality_finding
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.quality_finding_has_two_sources();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER finding_evidence_two_sources
  AFTER INSERT OR UPDATE OR DELETE ON app.finding_evidence
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.quality_finding_has_two_sources();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 7 · the trigger functions belong to the policy owner, like every other one in this schema
-- ---------------------------------------------------------------------------------------------
ALTER FUNCTION app.specialist_review_append_only() OWNER TO eia_policy;
--> statement-breakpoint
ALTER FUNCTION app.quality_finding_has_two_sources() OWNER TO eia_policy;
