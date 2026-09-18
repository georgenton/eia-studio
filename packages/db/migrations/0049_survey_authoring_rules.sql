-- Authoring a questionnaire inside the product: the two rules the new columns need (ADR-037).
-- Hand-written, because constraints and triggers are reviewed SQL (ADR-013).
--
-- Nothing here creates a table and nothing here relaxes anything. Migration 0014 already says the
-- thing that matters — a DRAFT version may be rewritten freely and a PUBLISHED one may not be
-- touched at all — and the authoring surface is built *on* that rule rather than beside it. Two
-- additions:
--
-- 1. a section is a heading, so it is bounded and never blank;
-- 2. `published_by_user_id` joins the columns a published version may no longer change, because it
--    records who decided that households would be asked this.

-- ---------------------------------------------------------------------------------------------
-- 1 · a heading is words, not an empty label
--
-- A blank section would render as a heading with nothing in it, which reads on a phone as a
-- grouping somebody forgot to name rather than as the absence of one. NULL is the absence of one.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.survey_question
  ADD CONSTRAINT survey_question_section_is_words
  CHECK (section IS NULL OR (length(btrim(section)) BETWEEN 1 AND 80));
--> statement-breakpoint
ALTER TABLE app.survey_question_translation
  ADD CONSTRAINT survey_question_translation_section_is_words
  CHECK (section IS NULL OR (length(btrim(section)) BETWEEN 1 AND 80));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · who published it is part of what was published
--
-- Extends the existing function rather than adding a second trigger beside it: "a published
-- questionnaire never changes" is one rule, and two implementations of it would eventually
-- disagree about which columns it covers. The only change is one more column in the frozen list.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.assert_survey_version_immutable() RETURNS trigger
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
     OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
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
