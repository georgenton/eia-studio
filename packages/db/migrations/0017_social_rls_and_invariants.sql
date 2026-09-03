-- Social Intelligence: row level security, taxonomy immutability, review finality, and the one
-- narrow function the worker uses to find work (Slice 4). Hand-written because policies, triggers
-- and privileged functions must be reviewed SQL, not inferred from a schema diff (ADR-013).
--
-- Four things this file protects.
--
-- 1. **A published taxonomy version never changes.** A coding means whatever its category meant
--    when the coding was made. Editing a published category's description would silently redefine
--    every historic classification and review that points at it, with nothing in the data
--    recording that it happened. Refinement therefore publishes v2.
--
-- 2. **A submitted review is final.** The validated coding is the product's answer; editing it in
--    place would leave no trace that the answer changed. A superseding re-review is a future,
--    audited workflow, not an UPDATE.
--
-- 3. **An individual's words stay behind the same door as their answers.** Open-response text is
--    already governed by `field.responses.read` (SECURITY.md §10b). Its classifications and
--    reviews are derived from that text, so they inherit the same rule rather than inventing a
--    parallel permission that could drift from it.
--
-- 4. **The worker finds its work without seeing the tenant estate.** `app.claim_classification`
--    is SECURITY DEFINER, and it returns *one* row's identifiers and context — never answer text,
--    never a queue of other tenants' rows.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.taxonomy,
  app.taxonomy_version,
  app.taxonomy_category,
  app.classification_run,
  app.ai_classification,
  app.ai_classification_category,
  app.human_review,
  app.human_review_category
TO eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · the coding scheme: project data, readable by anyone with project access
--
-- A taxonomy is a definition, not anybody's words: a coordinator or reviewer must be able to see
-- what the categories mean. What protects it is immutability (§4 below), not visibility.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.taxonomy ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.taxonomy FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY taxonomy_select ON app.taxonomy FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY taxonomy_write ON app.taxonomy FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.taxonomy_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.taxonomy_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY taxonomy_version_select ON app.taxonomy_version FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY taxonomy_version_write ON app.taxonomy_version FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.taxonomy_category ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.taxonomy_category FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY taxonomy_category_select ON app.taxonomy_category FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY taxonomy_category_write ON app.taxonomy_category FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- The run is operational workflow — who asked for what, when, with which model — and carries no
-- individual's words. Project access is enough to see that a run happened and how it went.
ALTER TABLE app.classification_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.classification_run FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY classification_run_select ON app.classification_run FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY classification_run_write ON app.classification_run FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · codings of an individual's words
--
-- A classification *is* a statement about what one person said, and a review is a second one. Both
-- are reachable only by a caller who may read the underlying response — the same
-- `field.responses.read` boundary, expressed here as an EXISTS over `survey_answer`, whose own
-- policy has already applied. A technician who captured the response can still see the coding of
-- their own work, and nobody else's, without a second permission having to agree with the first.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.ai_classification ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ai_classification FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_classification_select ON app.ai_classification FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.ai_classification.tenant_id
                        AND a.id = app.ai_classification.answer_id));
--> statement-breakpoint
CREATE POLICY ai_classification_write ON app.ai_classification FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.ai_classification.tenant_id
                        AND a.id = app.ai_classification.answer_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.ai_classification.tenant_id
                        AND a.id = app.ai_classification.answer_id));
--> statement-breakpoint

ALTER TABLE app.ai_classification_category ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ai_classification_category FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_classification_category_select ON app.ai_classification_category
  FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.ai_classification c
                      WHERE c.tenant_id = app.ai_classification_category.tenant_id
                        AND c.id = app.ai_classification_category.classification_id));
--> statement-breakpoint
CREATE POLICY ai_classification_category_write ON app.ai_classification_category
  FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.ai_classification c
                      WHERE c.tenant_id = app.ai_classification_category.tenant_id
                        AND c.id = app.ai_classification_category.classification_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.ai_classification c
                      WHERE c.tenant_id = app.ai_classification_category.tenant_id
                        AND c.id = app.ai_classification_category.classification_id));
--> statement-breakpoint

ALTER TABLE app.human_review ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.human_review FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY human_review_select ON app.human_review FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.human_review.tenant_id
                        AND a.id = app.human_review.answer_id));
--> statement-breakpoint
CREATE POLICY human_review_write ON app.human_review FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.human_review.tenant_id
                        AND a.id = app.human_review.answer_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.human_review.tenant_id
                        AND a.id = app.human_review.answer_id));
--> statement-breakpoint

ALTER TABLE app.human_review_category ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.human_review_category FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY human_review_category_select ON app.human_review_category FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.human_review r
                      WHERE r.tenant_id = app.human_review_category.tenant_id
                        AND r.id = app.human_review_category.review_id));
--> statement-breakpoint
CREATE POLICY human_review_category_write ON app.human_review_category FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.human_review r
                      WHERE r.tenant_id = app.human_review_category.tenant_id
                        AND r.id = app.human_review_category.review_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.human_review r
                      WHERE r.tenant_id = app.human_review_category.tenant_id
                        AND r.id = app.human_review_category.review_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · a published taxonomy version never changes
--
-- The transition DRAFT → PUBLISHED → RETIRED is allowed on the version row (that is how a version
-- is published), together with the hash and the timestamps written at publication. Everything else
-- about a published version, and any change at all to its categories, is refused.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.assert_taxonomy_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION
        'taxonomy_version_immutable: version % is %, and a coding scheme that classifications '
        'reference is never deleted', OLD.version_label, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF NEW.taxonomy_id IS DISTINCT FROM OLD.taxonomy_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.version_label IS DISTINCT FROM OLD.version_label
     OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
     OR NEW.source_note IS DISTINCT FROM OLD.source_note
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.provenance_id IS DISTINCT FROM OLD.provenance_id THEN
    RAISE EXCEPTION
      'taxonomy_version_immutable: version % is published; publish a new version instead, so that '
      'existing codings keep the definition they were made against', OLD.version_label
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION
      'taxonomy_version_immutable: a published version may only be retired, not returned to %',
      NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'taxonomy_version_immutable: a retired version is not reopened'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_taxonomy_version_immutable() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER taxonomy_version_immutable
  BEFORE UPDATE OR DELETE ON app.taxonomy_version
  FOR EACH ROW EXECUTE FUNCTION app.assert_taxonomy_version_immutable();
--> statement-breakpoint

CREATE FUNCTION app.assert_taxonomy_categories_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  version_status text;
  target_version uuid;
  target_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
    target_version := OLD.version_id;
  ELSE
    target_tenant := NEW.tenant_id;
    target_version := NEW.version_id;
  END IF;

  SELECT v.status INTO version_status
    FROM app.taxonomy_version v
   WHERE v.tenant_id = target_tenant AND v.id = target_version;

  IF version_status IS NOT NULL AND version_status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'taxonomy_categories_frozen: this taxonomy version is %, so its categories cannot change; '
      'publish a new version instead', version_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_taxonomy_categories_frozen() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER taxonomy_category_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON app.taxonomy_category
  FOR EACH ROW EXECUTE FUNCTION app.assert_taxonomy_categories_frozen();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 5 · a classification is made against a published version, and its categories belong to it
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.assert_run_uses_published_taxonomy() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  version_status text;
BEGIN
  SELECT v.status INTO version_status
    FROM app.taxonomy_version v
   WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.taxonomy_version_id;

  IF version_status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION
      'classification_run_requires_published_taxonomy: a run codes against a published taxonomy '
      'version, not a % one', coalesce(version_status, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_run_uses_published_taxonomy() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER classification_run_published_taxonomy
  BEFORE INSERT ON app.classification_run
  FOR EACH ROW EXECUTE FUNCTION app.assert_run_uses_published_taxonomy();
--> statement-breakpoint

-- A selected category must belong to the exact version the run (or the review) names. Without
-- this, a v2 category could be attached to a v1 coding and the version reference would become
-- decorative.
CREATE FUNCTION app.assert_coding_category_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  expected_version uuid;
  actual_version uuid;
BEGIN
  IF TG_TABLE_NAME = 'ai_classification_category' THEN
    SELECT r.taxonomy_version_id INTO expected_version
      FROM app.ai_classification c
      JOIN app.classification_run r ON r.tenant_id = c.tenant_id AND r.id = c.run_id
     WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.classification_id;
  ELSE
    SELECT h.taxonomy_version_id INTO expected_version
      FROM app.human_review h
     WHERE h.tenant_id = NEW.tenant_id AND h.id = NEW.review_id;
  END IF;

  SELECT c.version_id INTO actual_version
    FROM app.taxonomy_category c
   WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.category_id;

  IF expected_version IS NULL OR actual_version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION
      'coding_category_version_mismatch: that category does not belong to the taxonomy version '
      'this coding was made against'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_coding_category_version() FROM PUBLIC;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER ai_classification_category_version
  AFTER INSERT OR UPDATE ON app.ai_classification_category
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION app.assert_coding_category_version();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER human_review_category_version
  AFTER INSERT OR UPDATE ON app.human_review_category
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION app.assert_coding_category_version();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 6 · a submitted review is final, and reviews the classification's own version
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.assert_human_review_final() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  run_version uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT r.taxonomy_version_id INTO run_version
      FROM app.ai_classification c
      JOIN app.classification_run r ON r.tenant_id = c.tenant_id AND r.id = c.run_id
     WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.classification_id;

    IF run_version IS DISTINCT FROM NEW.taxonomy_version_id THEN
      RAISE EXCEPTION
        'human_review_version_mismatch: a review records the taxonomy version its classification '
        'was made against; the review page cannot change it'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'human_review_final: this review was submitted at % and is not edited in place; a correction '
    'is a new, audited review that supersedes it', OLD.submitted_at
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_human_review_final() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER human_review_final
  BEFORE INSERT OR UPDATE OR DELETE ON app.human_review
  FOR EACH ROW EXECUTE FUNCTION app.assert_human_review_final();
--> statement-breakpoint

-- Its categories are frozen with it, or the rule above would be a formality.
CREATE FUNCTION app.assert_review_categories_final() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  submitted timestamptz;
  target_review uuid;
  target_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
    target_review := OLD.review_id;
  ELSE
    target_tenant := NEW.tenant_id;
    target_review := NEW.review_id;
  END IF;

  -- Within the inserting transaction the review row exists but its categories are being written;
  -- what must be refused is a change *after* that transaction, so the guard compares the review's
  -- submission time with the statement time of this transaction.
  SELECT h.submitted_at INTO submitted
    FROM app.human_review h
   WHERE h.tenant_id = target_tenant AND h.id = target_review;

  IF submitted IS NOT NULL AND submitted < transaction_timestamp() THEN
    RAISE EXCEPTION
      'human_review_categories_final: this review has been submitted; its categories cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_review_categories_final() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER human_review_category_final
  BEFORE INSERT OR UPDATE OR DELETE ON app.human_review_category
  FOR EACH ROW EXECUTE FUNCTION app.assert_review_categories_final();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 7 · how the worker finds work
--
-- The worker must not hold BYPASSRLS, and it has no session of its own: it is a process, not a
-- person. So it cannot simply "SELECT the pending queue" — every policy above needs a tenant, a
-- project and a member.
--
-- The narrow answer: one SECURITY DEFINER function that claims **exactly one** pending
-- classification across the estate and returns only what a job needs to build a scoped context —
-- the classification's id, its tenant, its project, and the user who initiated the run. It returns
-- **no answer text, no category, no response content**. The worker then opens an ordinary RLS
-- transaction as that user, and every subsequent read and write is governed by the policies above
-- exactly as a request would be. If the initiator's project access was revoked in the meantime,
-- that transaction sees nothing and the job fails safely.
--
-- `FOR UPDATE SKIP LOCKED` is what makes two workers unable to claim the same row; the status
-- transition to PROCESSING is what makes a claim visible; the unique key on (run, answer) is what
-- makes a duplicate success impossible even if both of those were wrong.
--
-- Hardening, as required for every privileged helper in this database (ADR-004, IG0-B01): fixed
-- `search_path` with `public` deliberately absent, every object schema-qualified, no dynamic SQL,
-- EXECUTE revoked from PUBLIC and granted only to `eia_app`.
CREATE FUNCTION app.claim_classification(max_attempts integer)
RETURNS TABLE (
  classification_id uuid,
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
    RAISE EXCEPTION 'claim_classification: max_attempts must be between 1 and 10'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.id INTO claimed
    FROM app.ai_classification c
    JOIN app.classification_run r ON r.tenant_id = c.tenant_id AND r.id = c.run_id
   WHERE c.status = 'PENDING'
     AND c.attempts < max_attempts
     AND r.status IN ('PENDING', 'RUNNING')
   ORDER BY c.created_at
   FOR UPDATE OF c SKIP LOCKED
   LIMIT 1;

  IF claimed IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE app.ai_classification c
     SET status = 'PROCESSING',
         claimed_at = now(),
         attempts = c.attempts + 1
   WHERE c.id = claimed
  RETURNING c.id,
            c.tenant_id,
            c.project_id,
            (SELECT r.initiated_by_user_id FROM app.classification_run r
              WHERE r.tenant_id = c.tenant_id AND r.id = c.run_id);
END;
$$;
--> statement-breakpoint

-- Owned by `eia_policy`, the NOLOGIN role that owns every privileged helper in this database and
-- nothing else (migration 0002). A SECURITY DEFINER function left owned by the migrator would run
-- as a superuser, which is the opposite of what "least privilege" means here.
ALTER FUNCTION app.claim_classification(integer) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.claim_classification(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_classification(integer) TO eia_app;
--> statement-breakpoint

-- A claim that never completed (a worker crashed between claiming and writing) returns to PENDING
-- after a bounded interval, so one lost process does not strand a run for ever. Bounded recovery,
-- not a distributed scheduler.
CREATE FUNCTION app.release_stale_classifications(stale_after interval)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  released integer;
BEGIN
  IF stale_after IS NULL OR stale_after < interval '1 minute' THEN
    RAISE EXCEPTION 'release_stale_classifications: stale_after must be at least one minute'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE app.ai_classification
     SET status = 'PENDING', claimed_at = NULL
   WHERE status = 'PROCESSING'
     AND claimed_at IS NOT NULL
     AND claimed_at < now() - stale_after;

  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.release_stale_classifications(interval) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.release_stale_classifications(interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.release_stale_classifications(interval) TO eia_app;
--> statement-breakpoint

-- `eia_policy` owns the functions, so the reads and writes inside them run as that role: it needs
-- exactly these two tables and nothing else. Note what is absent — `survey_answer`,
-- `taxonomy_category`, every table carrying content — so even a bug inside these bodies could not
-- return an answer's words.
GRANT SELECT, UPDATE ON app.ai_classification TO eia_policy;
--> statement-breakpoint
GRANT SELECT ON app.classification_run TO eia_policy;
