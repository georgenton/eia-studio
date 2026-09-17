-- AI document review: grants, row level security, immutability and the queue (Wave 3, ADR-035).
-- Hand-written, because policies, grants and a SECURITY DEFINER function are reviewed SQL
-- (ADR-013).
--
-- Five tables and four properties this file is responsible for.
--
-- 1. **A model's words are written once.** `document_review_candidate` may have its `state`
--    advanced and nothing else: what the model suggested is the record, and a specialist's
--    disagreement with it is a row in `document_review_decision`, never an edit of the suggestion.
--    A column-scoped trigger says so, because the alternative — trusting every future caller to
--    update only one column — is the kind of trust this schema does not extend anywhere else.
--
-- 2. **A decision is permanent.** `document_review_decision` is append-only by `REVOKE UPDATE,
--    DELETE` *and* a trigger, the same pair `specialist_review` uses. The REVOKE is load-bearing
--    for the reason migration 0019 gives: 0002's `ALTER DEFAULT PRIVILEGES` hands every new table
--    in `app` full DML, so a narrower GRANT beside it changes nothing.
--
-- 3. **The corpus a run read is part of what the run is.** `document_review_source` is write-once:
--    "which documents did this run actually look at?" must be answerable from the row a year
--    later, not re-derived from a corpus that has since changed.
--
-- 4. **The queue is the table.** `app.claim_document_review` is the third instance of the shape
--    `app.claim_classification` established: `FOR UPDATE SKIP LOCKED`, four identifiers and no
--    content, and the worker then opens an ordinary RLS transaction *as the initiating user* — so
--    it needs no `BYPASSRLS` and sees exactly what they may see.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------

-- The run advances through its states, so it keeps UPDATE. Everything else about it — the lens,
-- the corpus, the adapter, the model — is written at enqueue and never touched again; the
-- application writes only the status columns, and the immutability trigger below enforces it.
GRANT SELECT, INSERT, UPDATE ON app.document_review_run TO eia_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.document_review_run FROM eia_app;
--> statement-breakpoint

GRANT SELECT, INSERT ON app.document_review_source TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.document_review_source FROM eia_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON app.document_review_candidate TO eia_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.document_review_candidate FROM eia_app;
--> statement-breakpoint

GRANT SELECT, INSERT ON app.document_review_evidence TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.document_review_evidence FROM eia_app;
--> statement-breakpoint

GRANT SELECT, INSERT ON app.document_review_decision TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.document_review_decision FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
--
-- Ordinary project access, on all five. A review candidate is a statement about the project's own
-- documents — not about an individual's answers — so it does not inherit the
-- `field.responses.read` door of SECURITY.md §10b, exactly as a quality finding does not.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.document_review_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.document_review_run FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_review_run_rw ON app.document_review_run FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.document_review_source ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.document_review_source FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_review_source_rw ON app.document_review_source FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.document_review_candidate ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.document_review_candidate FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_review_candidate_rw ON app.document_review_candidate FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.document_review_evidence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.document_review_evidence FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_review_evidence_rw ON app.document_review_evidence FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.document_review_decision ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.document_review_decision FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A decision names who took it, and a caller may only take one in their own name.
CREATE POLICY document_review_decision_select ON app.document_review_decision FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY document_review_decision_insert ON app.document_review_decision FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND reviewer_user_id = app.current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · what a model said is not editable
--
-- The candidate's `state` advances; its three texts, its lens, its support kind and its run do
-- not. A trigger comparing the row rather than a grant, because the grant is per table and the
-- rule is per column.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.document_review_candidate_state_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.candidate_code IS DISTINCT FROM OLD.candidate_code
     OR NEW.lens IS DISTINCT FROM OLD.lens
     OR NEW.support IS DISTINCT FROM OLD.support
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.observation IS DISTINCT FROM OLD.observation
     OR NEW.suggested_check IS DISTINCT FROM OLD.suggested_check
     OR NEW.provenance_id IS DISTINCT FROM OLD.provenance_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'app.document_review_candidate: only state may change. What a model proposed is the record; a disagreement with it is a document_review_decision (ADR-035)';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.document_review_candidate_state_only() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.document_review_candidate_state_only() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER document_review_candidate_state_only
BEFORE UPDATE ON app.document_review_candidate
FOR EACH ROW EXECUTE FUNCTION app.document_review_candidate_state_only();
--> statement-breakpoint

CREATE FUNCTION app.document_review_candidate_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'app.document_review_candidate is not deletable: a dismissed candidate is the record that somebody looked and decided it was nothing (ADR-035)';
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.document_review_candidate_no_delete() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.document_review_candidate_no_delete() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER document_review_candidate_no_delete
BEFORE DELETE ON app.document_review_candidate
FOR EACH ROW EXECUTE FUNCTION app.document_review_candidate_no_delete();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · a decision, a source and a piece of evidence are written once
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.document_review_write_once() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%.% is written once: it cannot be % (ADR-035)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, lower(TG_OP);
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.document_review_write_once() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.document_review_write_once() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER document_review_decision_no_update
BEFORE UPDATE ON app.document_review_decision
FOR EACH ROW EXECUTE FUNCTION app.document_review_write_once();
--> statement-breakpoint
CREATE TRIGGER document_review_decision_no_delete
BEFORE DELETE ON app.document_review_decision
FOR EACH ROW EXECUTE FUNCTION app.document_review_write_once();
--> statement-breakpoint
CREATE TRIGGER document_review_source_no_update
BEFORE UPDATE ON app.document_review_source
FOR EACH ROW EXECUTE FUNCTION app.document_review_write_once();
--> statement-breakpoint
CREATE TRIGGER document_review_source_no_delete
BEFORE DELETE ON app.document_review_source
FOR EACH ROW EXECUTE FUNCTION app.document_review_write_once();
--> statement-breakpoint
CREATE TRIGGER document_review_evidence_no_update
BEFORE UPDATE ON app.document_review_evidence
FOR EACH ROW EXECUTE FUNCTION app.document_review_write_once();
--> statement-breakpoint
CREATE TRIGGER document_review_evidence_no_delete
BEFORE DELETE ON app.document_review_evidence
FOR EACH ROW EXECUTE FUNCTION app.document_review_write_once();
--> statement-breakpoint

-- A justification is mandatory, and a token word is not one. Twelve characters is not a quality
-- bar — nothing can be — but it stops "ok" standing as the recorded reason a model's suggestion
-- about a study was settled. The same CHECK `specialist_review` carries.
ALTER TABLE app.document_review_decision
  ADD CONSTRAINT document_review_decision_justification_check
  CHECK (length(btrim(justification)) >= 12);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 5 · the queue
--
-- Third instance of the shape migration 0017 established. `eia_policy` owns the function, so the
-- statements inside it run as that role and it needs exactly the two privileges they use on the
-- one table they touch.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, UPDATE ON app.document_review_run TO eia_policy;
--> statement-breakpoint

CREATE FUNCTION app.claim_document_review(max_attempts integer)
RETURNS TABLE (
  run_id uuid,
  tenant_id uuid,
  project_id uuid,
  initiated_by_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  claimed uuid;
BEGIN
  IF max_attempts IS NULL OR max_attempts < 1 OR max_attempts > 10 THEN
    RAISE EXCEPTION 'claim_document_review: max_attempts must be between 1 and 10'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.id INTO claimed
    FROM app.document_review_run r
   WHERE r.status = 'QUEUED'
     AND r.attempts < max_attempts
   ORDER BY r.created_at
   FOR UPDATE OF r SKIP LOCKED
   LIMIT 1;

  IF claimed IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE app.document_review_run r
     SET status = 'PROCESSING',
         claimed_at = now(),
         started_at = COALESCE(r.started_at, now()),
         attempts = r.attempts + 1
   WHERE r.id = claimed
  RETURNING r.id, r.tenant_id, r.project_id, r.initiated_by_user_id;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.claim_document_review(integer) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.claim_document_review(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_document_review(integer) TO eia_app;
--> statement-breakpoint

-- A claim that never completed returns to the queue after a bounded interval, so one lost worker
-- does not strand a run for ever.
CREATE FUNCTION app.release_stale_document_reviews(stale_after interval)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  released integer;
BEGIN
  IF stale_after IS NULL OR stale_after < interval '1 minute' THEN
    RAISE EXCEPTION 'release_stale_document_reviews: stale_after must be at least one minute'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE app.document_review_run r
     SET status = 'QUEUED',
         claimed_at = NULL
   WHERE r.status = 'PROCESSING'
     AND r.claimed_at IS NOT NULL
     AND r.claimed_at < now() - stale_after;

  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.release_stale_document_reviews(interval) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.release_stale_document_reviews(interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.release_stale_document_reviews(interval) TO eia_app;
