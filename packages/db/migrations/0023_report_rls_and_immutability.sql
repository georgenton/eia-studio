-- Report generation: row level security, and the immutability that makes an old version mean
-- something (Slice 7, ADR-022). Hand-written because policies, triggers and grants must be
-- reviewed SQL, not inferred from a schema diff (ADR-013).
--
-- Three things this file protects.
--
-- 1. **A delivered version never changes.** A study's chapter three is a thing that was produced on
--    a date from particular inputs. Editing one in place would make every earlier reference to it a
--    reference to something that no longer exists. A changed input produces a *new* version.
--
-- 2. **A section is immutable with its version.** Re-rendering one paragraph of a stored chapter
--    would produce a document that is partly one generation and partly another, with nothing
--    recording which parts.
--
-- 3. **Reports are project data behind project access.** A chapter contains validated figures and
--    cited passages, not an individual's answers, so it takes the ordinary predicate rather than
--    the `field.responses.read` door.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON app.generated_report TO eia_app;
--> statement-breakpoint
-- Written once, read forever. The REVOKE is required, not decorative: migration 0002 set
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ... UPDATE, DELETE`, so a narrower GRANT beside it
-- changes nothing (the lesson of migration 0019).
GRANT SELECT, INSERT ON app.report_version, app.report_section, app.report_section_source TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.report_version, app.report_section, app.report_section_source
  FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.generated_report ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.generated_report FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY generated_report_select ON app.generated_report FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY generated_report_write ON app.generated_report FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.report_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.report_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_version_select ON app.report_version FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY report_version_insert ON app.report_version FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.report_section ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.report_section FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Reachable only through a version the caller can already see, so the version's policy applies
-- first rather than being repeated here where the two could drift apart.
CREATE POLICY report_section_select ON app.report_section FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.report_version v
                      WHERE v.tenant_id = report_section.tenant_id
                        AND v.id = report_section.version_id));
--> statement-breakpoint
CREATE POLICY report_section_insert ON app.report_section FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.report_version v
                      WHERE v.tenant_id = report_section.tenant_id
                        AND v.id = report_section.version_id));
--> statement-breakpoint

ALTER TABLE app.report_section_source ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.report_section_source FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_section_source_select ON app.report_section_source FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.report_section s
                      WHERE s.tenant_id = report_section_source.tenant_id
                        AND s.id = report_section_source.section_id));
--> statement-breakpoint
CREATE POLICY report_section_source_insert ON app.report_section_source FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.report_section s
                      WHERE s.tenant_id = report_section_source.tenant_id
                        AND s.id = report_section_source.section_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · a version, its sections and their sources are written once
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.report_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'report_version_immutable: a report version states what it stated when it was '
                  'produced; regenerate to make a new one rather than editing this';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER report_version_no_update BEFORE UPDATE ON app.report_version
  FOR EACH ROW EXECUTE FUNCTION app.report_version_immutable();
--> statement-breakpoint
-- DELETE only through the cascade from its report, which is how a report is removed wholesale.
CREATE TRIGGER report_version_no_delete BEFORE DELETE ON app.report_version
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION app.report_version_immutable();
--> statement-breakpoint
CREATE TRIGGER report_section_no_update BEFORE UPDATE ON app.report_section
  FOR EACH ROW EXECUTE FUNCTION app.report_version_immutable();
--> statement-breakpoint
CREATE TRIGGER report_section_no_delete BEFORE DELETE ON app.report_section
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION app.report_version_immutable();
--> statement-breakpoint
CREATE TRIGGER report_section_source_no_update BEFORE UPDATE ON app.report_section_source
  FOR EACH ROW EXECUTE FUNCTION app.report_version_immutable();
--> statement-breakpoint
CREATE TRIGGER report_section_source_no_delete BEFORE DELETE ON app.report_section_source
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION app.report_version_immutable();
--> statement-breakpoint
ALTER FUNCTION app.report_version_immutable() OWNER TO eia_policy;
