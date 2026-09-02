-- FieldFlow: row level security, questionnaire immutability, and the invariants a typed answer
-- model needs (Slice 3). Hand-written because policies and triggers must be reviewed SQL, not
-- inferred from a schema diff (ADR-013).
--
-- Three things this file protects.
--
-- 1. **A technician must not read the project's other responses.** `field.read` (the operational
--    workflow) and `field.responses.read` (individual answers) are different permissions, and the
--    policies below say the same thing at the row level: a technician sees their own assignments,
--    visits, responses and answers, and nothing else. A role holding `field.responses.read` sees
--    the project's. This is the one place in the product where project access is deliberately not
--    enough.
--
-- 2. **A published questionnaire never changes.** Answers are only interpretable against the
--    question that was asked, so an UPDATE or DELETE touching a PUBLISHED or RETIRED version, its
--    questions or its options is refused. Editing means publishing a new version.
--
-- 3. **An answer's value matches its question's type.** A CHECK per row, so a number cannot land
--    where a date belongs and the Social slice can read a column instead of casting a string.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.project_configuration,
  app.survey_template,
  app.survey_version,
  app.survey_question,
  app.survey_option,
  app.survey_campaign,
  app.field_assignment,
  app.field_visit,
  app.survey_instance,
  app.survey_answer,
  app.survey_answer_option
TO eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · who is acting, and what may they see
--
-- `app.current_user_id()` already exists (migration 0004). The helper below answers the one new
-- question: does this request hold the permission to read individual responses?
--
-- It is read from a transaction-local setting the application sets alongside the tenant and
-- project, exactly like `app.pii_access` in SECURITY.md §5. That keeps the policy a boolean
-- comparison instead of a membership subquery inside a policy that is itself evaluated on the
-- membership tables — the recursive shape that makes RLS both slow and hard to reason about.
--
-- Forging it buys nothing: the setting is transaction-local, the application sets it only after
-- `requirePermission` has passed, and every policy below *also* requires tenant and project to
-- match. A caller who could set session settings arbitrarily already holds the runtime role.
CREATE FUNCTION app.can_read_field_responses() RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT coalesce(current_setting('app.field_responses_access', true), 'off') = 'on';
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.can_read_field_responses() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.can_read_field_responses() TO eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · project configuration, questionnaire definition
--
-- These carry no individual's data: a questionnaire is the *questions*, not the answers. They
-- follow the ordinary project-data policy, so a technician can read the form they must fill in.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.project_configuration ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.project_configuration FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_configuration_select ON app.project_configuration FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY project_configuration_write ON app.project_configuration FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.survey_template ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_template FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_template_select ON app.survey_template FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY survey_template_write ON app.survey_template FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.survey_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_version_select ON app.survey_version FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY survey_version_write ON app.survey_version FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.survey_question ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_question FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_question_select ON app.survey_question FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY survey_question_write ON app.survey_question FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.survey_option ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_option FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_option_select ON app.survey_option FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY survey_option_write ON app.survey_option FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- The campaign is operational workflow, readable by anyone with project access.
ALTER TABLE app.survey_campaign ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_campaign FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_campaign_select ON app.survey_campaign FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY survey_campaign_write ON app.survey_campaign FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · the rows that belong to a person
--
-- From here on, project access is not enough. Each policy adds: *either* this is the caller's own
-- work, *or* the caller holds `field.responses.read`.
--
-- `assignee_user_id` is denormalised onto the assignment precisely so these policies compare two
-- columns instead of joining `project_membership` from inside a policy — which would be evaluated
-- against a table that has policies of its own.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.field_assignment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.field_assignment FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY field_assignment_select ON app.field_assignment FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (assignee_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint
CREATE POLICY field_assignment_write ON app.field_assignment FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (assignee_user_id = app.current_user_id() OR app.can_read_field_responses()))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (assignee_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint

ALTER TABLE app.field_visit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.field_visit FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY field_visit_select ON app.field_visit FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (technician_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint
CREATE POLICY field_visit_write ON app.field_visit FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (technician_user_id = app.current_user_id() OR app.can_read_field_responses()))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (technician_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint

ALTER TABLE app.survey_instance ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_instance FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_instance_select ON app.survey_instance FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (respondent_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint
CREATE POLICY survey_instance_write ON app.survey_instance FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (respondent_user_id = app.current_user_id() OR app.can_read_field_responses()))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (respondent_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint

-- An answer inherits its instance's visibility. The EXISTS is over `survey_instance`, whose own
-- policy has already applied, so a technician's answer query sees only their own instances.
ALTER TABLE app.survey_answer ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_answer FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_answer_select ON app.survey_answer FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_instance i
                      WHERE i.tenant_id = app.survey_answer.tenant_id
                        AND i.id = app.survey_answer.instance_id));
--> statement-breakpoint
CREATE POLICY survey_answer_write ON app.survey_answer FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_instance i
                      WHERE i.tenant_id = app.survey_answer.tenant_id
                        AND i.id = app.survey_answer.instance_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_instance i
                      WHERE i.tenant_id = app.survey_answer.tenant_id
                        AND i.id = app.survey_answer.instance_id));
--> statement-breakpoint

ALTER TABLE app.survey_answer_option ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_answer_option FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY survey_answer_option_select ON app.survey_answer_option FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.survey_answer_option.tenant_id
                        AND a.id = app.survey_answer_option.answer_id));
--> statement-breakpoint
CREATE POLICY survey_answer_option_write ON app.survey_answer_option FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.survey_answer_option.tenant_id
                        AND a.id = app.survey_answer_option.answer_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND EXISTS (SELECT 1 FROM app.survey_answer a
                      WHERE a.tenant_id = app.survey_answer_option.tenant_id
                        AND a.id = app.survey_answer_option.answer_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 5 · a published questionnaire never changes
--
-- The transition DRAFT → PUBLISHED → RETIRED is allowed on the version row itself (that is how a
-- version is published), and so is writing the definition hash at publication. Everything else
-- about a published version, and any change at all to its questions or options, is refused.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.assert_survey_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION
        'survey_version_immutable: version % is %, and a questionnaire that answers reference is '
        'never deleted', OLD.version_label, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  -- Published or retired: only the lifecycle columns may move, and only forwards.
  IF NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.version_label IS DISTINCT FROM OLD.version_label
     OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.provenance_id IS DISTINCT FROM OLD.provenance_id THEN
    RAISE EXCEPTION
      'survey_version_immutable: version % is published; publish a new version instead, so that '
      'existing answers keep the questionnaire they were given', OLD.version_label
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION
      'survey_version_immutable: a published version may only be retired, not returned to %',
      NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'survey_version_immutable: a retired version is not reopened'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_survey_version_immutable() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER survey_version_immutable
  BEFORE UPDATE OR DELETE ON app.survey_version
  FOR EACH ROW EXECUTE FUNCTION app.assert_survey_version_immutable();
--> statement-breakpoint

-- Questions and options of a non-draft version are frozen outright: there is no legitimate edit.
CREATE FUNCTION app.assert_survey_definition_frozen() RETURNS trigger
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
  ELSE
    target_tenant := NEW.tenant_id;
  END IF;

  IF TG_TABLE_NAME = 'survey_question' THEN
    target_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  ELSE
    SELECT q.version_id INTO target_version
      FROM app.survey_question q
     WHERE q.tenant_id = target_tenant
       AND q.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.question_id ELSE NEW.question_id END;
  END IF;

  SELECT v.status INTO version_status
    FROM app.survey_version v
   WHERE v.tenant_id = target_tenant AND v.id = target_version;

  IF version_status IS NOT NULL AND version_status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'survey_definition_frozen: this survey version is %, so its questions and options cannot '
      'change; publish a new version instead', version_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_survey_definition_frozen() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER survey_question_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON app.survey_question
  FOR EACH ROW EXECUTE FUNCTION app.assert_survey_definition_frozen();
--> statement-breakpoint

CREATE TRIGGER survey_option_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON app.survey_option
  FOR EACH ROW EXECUTE FUNCTION app.assert_survey_definition_frozen();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 6 · a response references a published version, and is final once submitted
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.assert_survey_instance_rules() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  version_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT v.status INTO version_status
      FROM app.survey_version v
     WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.survey_version_id;

    IF version_status IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION
        'survey_instance_requires_published_version: answers may only be captured against a '
        'published survey version, not a % one', coalesce(version_status, 'missing')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'SUBMITTED' THEN
    -- Nothing about a submitted response moves. Correction, when it exists, will be a reviewed
    -- workflow that records who changed what — not an UPDATE that leaves no trace.
    RAISE EXCEPTION
      'survey_instance_submitted: this response was submitted at % and is not edited in place',
      OLD.submitted_at
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.survey_version_id IS DISTINCT FROM OLD.survey_version_id THEN
    RAISE EXCEPTION
      'survey_instance_version_fixed: a response cannot be moved to another survey version; its '
      'answers were given against this one'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_survey_instance_rules() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER survey_instance_rules
  BEFORE INSERT OR UPDATE ON app.survey_instance
  FOR EACH ROW EXECUTE FUNCTION app.assert_survey_instance_rules();
--> statement-breakpoint

-- Answers of a submitted response are frozen too, or the instance rule would be a formality.
CREATE FUNCTION app.assert_answer_editable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  instance_status text;
  target_instance uuid;
  target_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
  ELSE
    target_tenant := NEW.tenant_id;
  END IF;

  IF TG_TABLE_NAME = 'survey_answer' THEN
    target_instance := CASE WHEN TG_OP = 'DELETE' THEN OLD.instance_id ELSE NEW.instance_id END;
  ELSE
    SELECT a.instance_id INTO target_instance
      FROM app.survey_answer a
     WHERE a.tenant_id = target_tenant
       AND a.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.answer_id ELSE NEW.answer_id END;
  END IF;

  SELECT i.status INTO instance_status
    FROM app.survey_instance i
   WHERE i.tenant_id = target_tenant AND i.id = target_instance;

  IF instance_status = 'SUBMITTED' THEN
    RAISE EXCEPTION
      'survey_answer_frozen: this response has been submitted; its answers cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_answer_editable() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER survey_answer_editable
  BEFORE INSERT OR UPDATE OR DELETE ON app.survey_answer
  FOR EACH ROW EXECUTE FUNCTION app.assert_answer_editable();
--> statement-breakpoint

CREATE TRIGGER survey_answer_option_editable
  BEFORE INSERT OR UPDATE OR DELETE ON app.survey_answer_option
  FOR EACH ROW EXECUTE FUNCTION app.assert_answer_editable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 7 · an answer's value matches its question's type
--
-- A constraint trigger rather than a CHECK, because the question's type lives in another table.
-- It also enforces that a chosen option belongs to *that* question — the rule that stops a v2
-- option code being accepted against a v1 response.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.assert_answer_matches_question() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  q_type text;
  filled integer;
BEGIN
  SELECT q.type INTO q_type
    FROM app.survey_question q
   WHERE q.tenant_id = NEW.tenant_id AND q.id = NEW.question_id;

  IF q_type IS NULL THEN
    RAISE EXCEPTION 'survey_answer_unknown_question: no such question in this tenant'
      USING ERRCODE = 'check_violation';
  END IF;

  filled := num_nonnulls(NEW.text_value, NEW.number_value, NEW.boolean_value, NEW.date_value,
                         NEW.option_id);
  IF filled > 1 THEN
    RAISE EXCEPTION
      'survey_answer_type_mismatch: an answer fills exactly one typed column, not %', filled
      USING ERRCODE = 'check_violation';
  END IF;

  IF q_type IN ('SHORT_TEXT', 'LONG_TEXT') AND NEW.text_value IS NULL AND filled > 0 THEN
    RAISE EXCEPTION 'survey_answer_type_mismatch: % expects text_value', q_type
      USING ERRCODE = 'check_violation';
  END IF;
  IF q_type IN ('INTEGER', 'DECIMAL') AND NEW.number_value IS NULL AND filled > 0 THEN
    RAISE EXCEPTION 'survey_answer_type_mismatch: % expects number_value', q_type
      USING ERRCODE = 'check_violation';
  END IF;
  IF q_type = 'INTEGER' AND NEW.number_value IS NOT NULL
     AND NEW.number_value <> trunc(NEW.number_value) THEN
    RAISE EXCEPTION 'survey_answer_type_mismatch: INTEGER expects a whole number, got %',
      NEW.number_value
      USING ERRCODE = 'check_violation';
  END IF;
  IF q_type = 'BOOLEAN' AND NEW.boolean_value IS NULL AND filled > 0 THEN
    RAISE EXCEPTION 'survey_answer_type_mismatch: BOOLEAN expects boolean_value'
      USING ERRCODE = 'check_violation';
  END IF;
  IF q_type = 'DATE' AND NEW.date_value IS NULL AND filled > 0 THEN
    RAISE EXCEPTION 'survey_answer_type_mismatch: DATE expects date_value'
      USING ERRCODE = 'check_violation';
  END IF;
  IF q_type = 'SINGLE_CHOICE' AND NEW.option_id IS NULL AND filled > 0 THEN
    RAISE EXCEPTION 'survey_answer_type_mismatch: SINGLE_CHOICE expects option_id'
      USING ERRCODE = 'check_violation';
  END IF;
  IF q_type = 'MULTI_CHOICE' AND filled > 0 THEN
    RAISE EXCEPTION
      'survey_answer_type_mismatch: MULTI_CHOICE selections live in survey_answer_option'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.option_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM app.survey_option o
        WHERE o.tenant_id = NEW.tenant_id
          AND o.id = NEW.option_id
          AND o.question_id = NEW.question_id) THEN
    RAISE EXCEPTION
      'survey_answer_option_mismatch: that option does not belong to this question in this survey '
      'version'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_answer_matches_question() FROM PUBLIC;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER survey_answer_matches_question
  AFTER INSERT OR UPDATE ON app.survey_answer
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION app.assert_answer_matches_question();
--> statement-breakpoint

-- A multi-choice selection must name an option of the answered question, for the same reason.
CREATE FUNCTION app.assert_answer_option_matches_question() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM app.survey_answer a
      JOIN app.survey_option o
        ON o.tenant_id = a.tenant_id AND o.question_id = a.question_id
     WHERE a.tenant_id = NEW.tenant_id
       AND a.id = NEW.answer_id
       AND o.id = NEW.option_id
  ) THEN
    RAISE EXCEPTION
      'survey_answer_option_mismatch: that option does not belong to the answered question in this '
      'survey version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_answer_option_matches_question() FROM PUBLIC;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER survey_answer_option_matches_question
  AFTER INSERT OR UPDATE ON app.survey_answer_option
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION app.assert_answer_option_matches_question();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 8 · smaller invariants geometry and timestamps cannot state for themselves
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.field_visit
  ADD CONSTRAINT field_visit_completed_after_started
  CHECK (completed_at IS NULL OR completed_at >= started_at);
--> statement-breakpoint

-- A completed visit has a completion time, and an in-progress one does not.
ALTER TABLE app.field_visit
  ADD CONSTRAINT field_visit_status_matches_completion
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL));
--> statement-breakpoint

-- A location and its metadata arrive together, or not at all.
ALTER TABLE app.field_visit
  ADD CONSTRAINT field_visit_location_consistent
  CHECK ((location IS NULL AND location_outcome <> 'captured')
         OR (location IS NOT NULL AND location_outcome = 'captured'
             AND location_captured_at IS NOT NULL));
--> statement-breakpoint

ALTER TABLE app.field_visit
  ADD CONSTRAINT field_visit_accuracy_positive
  CHECK (location_accuracy_m IS NULL OR location_accuracy_m > 0);
--> statement-breakpoint

ALTER TABLE app.survey_instance
  ADD CONSTRAINT survey_instance_status_matches_submission
  CHECK ((status = 'SUBMITTED') = (submitted_at IS NOT NULL));
--> statement-breakpoint

ALTER TABLE app.survey_campaign
  ADD CONSTRAINT survey_campaign_status_matches_activation
  CHECK (status = 'DRAFT' OR activated_at IS NOT NULL);
--> statement-breakpoint

ALTER TABLE app.survey_campaign
  ADD CONSTRAINT survey_campaign_target_after_start
  CHECK (starts_on IS NULL OR target_on IS NULL OR target_on >= starts_on);
