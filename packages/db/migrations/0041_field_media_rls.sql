-- Field media: grants, row level security, and the rule that a photograph is described once
-- (Production V1 Wave 2, ADR-032). Hand-written, because policies and grants are reviewed SQL
-- (ADR-013).
--
-- Three things this file protects.
--
-- 1. **A photograph is at least as sensitive as an answer.** A picture of a parcel can hold a
--    person, a house number or a number plate, so the predicate is `survey_instance`'s rather than
--    ordinary project access: *this row is mine, or I hold `field.responses.read`*. A GIS
--    specialist may know a parcel was visited without seeing what was photographed there
--    (SECURITY.md §10b).
--
-- 2. **A declaration is written once.** What a photograph is of, when it was taken and which
--    visit it belongs to are statements a technician made at the shutter; a row that could be
--    edited afterwards would let a later caller change what the evidence says while the object it
--    points at stays the same file. The REVOKE is load-bearing for the reason migration 0019 gives
--    — 0002's default privileges hand every new table full DML — and the trigger says it again so
--    the owning role cannot either.
--
-- 3. **A photograph cannot be re-pointed at other bytes.** `stored_object_id` is covered by the
--    write-once rule above and by a unique constraint, so one verified object backs exactly one
--    media row.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT ON app.field_media TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.field_media FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.field_media ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.field_media FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The same four conjuncts every project-scoped table carries, plus the row-ownership condition of
-- SECURITY.md §10b. A caller that forgets to set `app.field_responses_access` sees only its own
-- rows, which is the safe direction to fail in.
CREATE POLICY field_media_select ON app.field_media FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (captured_by_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint

-- A technician declares **their own** photographs and nobody else's: unlike the select policy,
-- this one has no `can_read_field_responses()` escape. Holding the permission to read what a
-- household answered is not the same as being able to file evidence in somebody else's name.
CREATE POLICY field_media_insert ON app.field_media FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND captured_by_user_id = app.current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · written once, by the owner as well
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.field_media_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'app.field_media is written once: a photograph''s declaration cannot be % (ADR-032)',
    lower(TG_OP);
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.field_media_immutable() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.field_media_immutable() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER field_media_no_update
BEFORE UPDATE ON app.field_media
FOR EACH ROW EXECUTE FUNCTION app.field_media_immutable();
--> statement-breakpoint

CREATE TRIGGER field_media_no_delete
BEFORE DELETE ON app.field_media
FOR EACH ROW EXECUTE FUNCTION app.field_media_immutable();
