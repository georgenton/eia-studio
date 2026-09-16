-- Bilingual questionnaires: grants, row level security, and the rule that a translation is part of
-- the definition (Production V1 Wave 2, ADR-029). Hand-written, because policies and triggers are
-- reviewed SQL (ADR-013).
--
-- The one decision worth reading twice is the trigger. A translation added to a questionnaire that
-- technicians are already answering would change what a respondent was asked **after** they
-- answered it — the precise failure ADR-006's immutability exists to prevent, and it does not
-- become acceptable because the change is "only a translation". So a translation is frozen exactly
-- when the questions are: the existing `assert_survey_definition_frozen` is extended to resolve a
-- version through a translation's question or option, rather than a second rule being written
-- beside it where the two could drift.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON app.survey_question_translation, app.survey_option_translation TO eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.survey_question_translation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_question_translation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A questionnaire is not an individual's data: it is the form a technician must be able to read in
-- order to fill it in, so it takes ordinary project access and not the `field.responses.read` door.
CREATE POLICY survey_question_translation_select ON app.survey_question_translation
  FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY survey_question_translation_write ON app.survey_question_translation
  FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.survey_option_translation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_option_translation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_option_translation_select ON app.survey_option_translation
  FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY survey_option_translation_write ON app.survey_option_translation
  FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · a translation is frozen with the definition it belongs to
--
-- Extends the existing function rather than adding a second: "a published questionnaire never
-- changes" is one rule, and two implementations of it would eventually disagree.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.assert_survey_definition_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  version_status text;
  target_version uuid;
  target_tenant uuid;
  target_option uuid;
  target_question uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
  ELSE
    target_tenant := NEW.tenant_id;
  END IF;

  IF TG_TABLE_NAME = 'survey_question' THEN
    target_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;

  ELSIF TG_TABLE_NAME = 'survey_option' THEN
    target_question := CASE WHEN TG_OP = 'DELETE' THEN OLD.question_id ELSE NEW.question_id END;
    SELECT q.version_id INTO target_version
      FROM app.survey_question q
     WHERE q.tenant_id = target_tenant AND q.id = target_question;

  ELSIF TG_TABLE_NAME = 'survey_question_translation' THEN
    target_question := CASE WHEN TG_OP = 'DELETE' THEN OLD.question_id ELSE NEW.question_id END;
    SELECT q.version_id INTO target_version
      FROM app.survey_question q
     WHERE q.tenant_id = target_tenant AND q.id = target_question;

  ELSE -- survey_option_translation
    target_option := CASE WHEN TG_OP = 'DELETE' THEN OLD.option_id ELSE NEW.option_id END;
    SELECT q.version_id INTO target_version
      FROM app.survey_option o
      JOIN app.survey_question q ON q.tenant_id = o.tenant_id AND q.id = o.question_id
     WHERE o.tenant_id = target_tenant AND o.id = target_option;
  END IF;

  SELECT v.status::text INTO version_status
    FROM app.survey_version v
   WHERE v.tenant_id = target_tenant AND v.id = target_version;

  IF version_status IS NOT NULL AND version_status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'survey_definition_frozen: the questionnaire is %, so its questions, options and '
      'translations cannot change; publish a new version instead', version_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_survey_definition_frozen() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER survey_question_translation_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON app.survey_question_translation
  FOR EACH ROW EXECUTE FUNCTION app.assert_survey_definition_frozen();
--> statement-breakpoint
CREATE TRIGGER survey_option_translation_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON app.survey_option_translation
  FOR EACH ROW EXECUTE FUNCTION app.assert_survey_definition_frozen();
