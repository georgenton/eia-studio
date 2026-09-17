-- The extraction queue, which is the `document_version` table itself (Production V1 Wave 2,
-- ADR-033). Hand-written, because a SECURITY DEFINER function is reviewed SQL (ADR-013).
--
-- The shape is Slice 4's, deliberately: `app.claim_classification` already proved that a queue can
-- be a column plus `FOR UPDATE SKIP LOCKED`, with no broker, no Redis and no second store that can
-- disagree with the database about what work exists. Two workers can run this against one database
-- and neither will claim the same version.
--
-- What the claim returns is **four identifiers and no content**: the version, its tenant, its
-- project, and the user who uploaded it. The worker then opens an ordinary RLS transaction *as that
-- user*, so it needs no `BYPASSRLS` and sees exactly what they may see. If their project access was
-- revoked in the meantime, that transaction sees nothing and the job fails safely.
--
-- Hardening, as required of every privileged helper here (ADR-004, IG0-B01): fixed `search_path`
-- with `public` deliberately absent, every object schema-qualified, no dynamic SQL, owned by
-- `eia_policy`, EXECUTE revoked from PUBLIC and granted only to `eia_app`.

-- `eia_policy` owns the functions, so the reads and writes inside them run as that role: it needs
-- exactly the two privileges those statements use on the one table they touch, and nothing else.
-- The role has no LOGIN and is not `eia_app`; this is not a widening of what the application can
-- do (migration 0017 does the same for the classification queue).
GRANT SELECT, UPDATE ON app.document_version TO eia_policy;
--> statement-breakpoint

CREATE FUNCTION app.claim_document_extraction(max_attempts integer)
RETURNS TABLE (
  version_id uuid,
  tenant_id uuid,
  project_id uuid,
  imported_by_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  claimed uuid;
BEGIN
  IF max_attempts IS NULL OR max_attempts < 1 OR max_attempts > 10 THEN
    RAISE EXCEPTION 'claim_document_extraction: max_attempts must be between 1 and 10'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Only `QUEUED`. A version in `UPLOADED` is one nobody has asked to have read — an observable
  -- state, not a formality — and one in `FAILED` or `REQUIRES_OCR` returns here only when a person
  -- asks again.
  SELECT v.id INTO claimed
    FROM app.document_version v
   WHERE v.processing_state = 'QUEUED'
     AND v.extraction_attempts < max_attempts
     AND v.stored_object_id IS NOT NULL
   ORDER BY v.imported_at
   FOR UPDATE OF v SKIP LOCKED
   LIMIT 1;

  IF claimed IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE app.document_version v
     SET processing_state = 'PROCESSING',
         extraction_claimed_at = now(),
         extraction_attempts = v.extraction_attempts + 1
   WHERE v.id = claimed
  RETURNING v.id, v.tenant_id, v.project_id, v.imported_by_user_id;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.claim_document_extraction(integer) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.claim_document_extraction(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_document_extraction(integer) TO eia_app;
--> statement-breakpoint

-- A claim that never completed — a worker killed between claiming and writing — returns to the
-- queue after a bounded interval, so one lost process does not strand a document for ever.
-- Bounded recovery, not a distributed scheduler.
CREATE FUNCTION app.release_stale_document_extractions(stale_after interval)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  released integer;
BEGIN
  IF stale_after IS NULL OR stale_after < interval '1 minute' THEN
    RAISE EXCEPTION 'release_stale_document_extractions: stale_after must be at least one minute'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE app.document_version v
     SET processing_state = 'QUEUED',
         extraction_claimed_at = NULL
   WHERE v.processing_state = 'PROCESSING'
     AND v.extraction_claimed_at IS NOT NULL
     AND v.extraction_claimed_at < now() - stale_after;

  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.release_stale_document_extractions(interval) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.release_stale_document_extractions(interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.release_stale_document_extractions(interval) TO eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- A chunk's locator has to agree with itself
--
-- `PAGE` without pages, or `SECTION` with them, would be a row whose citation says one thing and
-- whose data says another. The database refuses both rather than leaving it to whoever writes
-- next: this is the constraint that stops a future extractor inventing a page for a DOCX.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.document_chunk
  ADD CONSTRAINT document_chunk_locator_consistent CHECK (
    (locator_kind = 'PAGE'
       AND page_from IS NOT NULL AND page_to IS NOT NULL AND section_path IS NULL)
    OR
    (locator_kind = 'SECTION'
       AND page_from IS NULL AND page_to IS NULL)
  );
