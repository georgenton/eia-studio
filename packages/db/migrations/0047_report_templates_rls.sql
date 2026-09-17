-- The template library: grants, row level security and immutability (Wave 3, ADR-036).
-- Hand-written, because policies and grants are reviewed SQL (ADR-013).
--
-- Three properties this file is responsible for.
--
-- 1. **An activated template version is frozen.** From the moment documents may be generated from
--    it, a deliverable can name it — so "which template produced this?" has to stay answerable.
--    A trigger permits the state and the activation columns to move and refuses every other
--    change; the file itself is a `stored_object`, immutable since ADR-031.
--
-- 2. **A generated document is written once.** It is what somebody was handed. A regeneration is
--    another row, because the figures may have moved in between and the previous document is the
--    one that left the building.
--
-- 3. **Neither is deletable.** The REVOKE is load-bearing for the reason migration 0019 gives:
--    0002's `ALTER DEFAULT PRIVILEGES` hands every new table in `app` full DML, so a narrower
--    GRANT beside it changes nothing.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT ON app.report_template TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.report_template FROM eia_app;
--> statement-breakpoint

-- The version's state advances — uploaded, validated, active, superseded — so it keeps UPDATE,
-- and the trigger below is what bounds which columns that may touch.
GRANT SELECT, INSERT, UPDATE ON app.report_template_version TO eia_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.report_template_version FROM eia_app;
--> statement-breakpoint

GRANT SELECT, INSERT ON app.generated_document TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.generated_document FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
--
-- Ordinary project access on all three. A template is the firm's own document about the study and
-- a generated draft is a statement about it; neither is an individual's answers, so neither
-- inherits the `field.responses.read` door of SECURITY.md §10b.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.report_template ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.report_template FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_template_rw ON app.report_template FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.report_template_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.report_template_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_template_version_rw ON app.report_template_version FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.generated_document ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.generated_document FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY generated_document_select ON app.generated_document FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- A generated document names who produced it, and a caller may only produce one in their own name.
CREATE POLICY generated_document_insert ON app.generated_document FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND generated_by_user_id = app.current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · what the file is, and which file it is, never change
--
-- The state may advance and the validation and activation columns may be written. The identity of
-- the version — its template, its locale, its label, the object behind it and that object's hash
-- — is fixed at upload, because it is what a generated document points at.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.report_template_version_identity_fixed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.version_label IS DISTINCT FROM OLD.version_label
     OR NEW.locale IS DISTINCT FROM OLD.locale
     OR NEW.stored_object_id IS DISTINCT FROM OLD.stored_object_id
     OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
     OR NEW.provenance_id IS DISTINCT FROM OLD.provenance_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'app.report_template_version: which file this version is cannot change. A corrected template is the next version (ADR-036)';
  END IF;

  -- An activated version is settled: a deliverable may already name it, so even its manifest and
  -- its validation record stop moving.
  IF OLD.state = 'ACTIVE' AND NEW.state = 'ACTIVE' THEN
    IF NEW.manifest::text IS DISTINCT FROM OLD.manifest::text
       OR NEW.validated_at IS DISTINCT FROM OLD.validated_at
       OR NEW.validation_error IS DISTINCT FROM OLD.validation_error
       OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
       OR NEW.activated_by_user_id IS DISTINCT FROM OLD.activated_by_user_id THEN
      RAISE EXCEPTION 'app.report_template_version: an activated version is settled; only a supersession may change it (ADR-036)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.report_template_version_identity_fixed() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.report_template_version_identity_fixed() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER report_template_version_identity_fixed
BEFORE UPDATE ON app.report_template_version
FOR EACH ROW EXECUTE FUNCTION app.report_template_version_identity_fixed();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · written once
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.template_library_write_once() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%.% is written once: it cannot be % (ADR-036)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, lower(TG_OP);
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.template_library_write_once() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.template_library_write_once() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER report_template_no_update
BEFORE UPDATE ON app.report_template
FOR EACH ROW EXECUTE FUNCTION app.template_library_write_once();
--> statement-breakpoint
CREATE TRIGGER report_template_no_delete
BEFORE DELETE ON app.report_template
FOR EACH ROW EXECUTE FUNCTION app.template_library_write_once();
--> statement-breakpoint
CREATE TRIGGER report_template_version_no_delete
BEFORE DELETE ON app.report_template_version
FOR EACH ROW EXECUTE FUNCTION app.template_library_write_once();
--> statement-breakpoint
CREATE TRIGGER generated_document_no_update
BEFORE UPDATE ON app.generated_document
FOR EACH ROW EXECUTE FUNCTION app.template_library_write_once();
--> statement-breakpoint
CREATE TRIGGER generated_document_no_delete
BEFORE DELETE ON app.generated_document
FOR EACH ROW EXECUTE FUNCTION app.template_library_write_once();
