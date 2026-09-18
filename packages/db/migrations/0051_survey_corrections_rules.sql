-- Correcting a submitted response: grants, row level security, the structural guarantees, and the
-- one place "which response does this study currently mean?" is answered (Go-Live Wave A, ADR-038).
-- Hand-written, because policies, constraints and views are reviewed SQL (ADR-013).
--
-- Nothing here relaxes the rule of migration 0014. A `SUBMITTED` response and its answers still
-- refuse every write, by trigger; this file adds the *other* thing that comment promised — "a
-- reviewed workflow that records who changed what" — beside it rather than in place of it.

-- ---------------------------------------------------------------------------------------------
-- 1 · one live ORDINARY assignment per parcel per campaign
--
-- Migration 0012's plain unique constraint said "one assignment per (campaign, parcel)", and it was
-- written when a second assignment could only be a mistake. A correction is the case it did not
-- know about: the same parcel, the same campaign, on purpose. The rule is therefore restated as a
-- partial index over the assignments it was about, and corrections sit beside them.
--
-- The constraint itself was dropped by 0050 (drizzle), which is why this file only creates.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX field_assignment_campaign_parcel_key
  ON app.field_assignment (tenant_id, campaign_id, parcel_id)
  WHERE corrects_assignment_id IS NULL;
--> statement-breakpoint

-- A correction assignment corrects exactly one assignment, and never itself.
ALTER TABLE app.field_assignment
  ADD CONSTRAINT field_assignment_corrects_not_self
  CHECK (corrects_assignment_id IS NULL OR corrects_assignment_id <> id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · grants
--
-- A correction is history. `state`, `correcting_instance_id` and the settlement timestamps move
-- once, from REQUESTED to APPLIED or CANCELLED, so the table keeps UPDATE and the trigger of §4
-- bounds which columns that may touch. DELETE is revoked for the reason every append-only table
-- here revokes it: the record of what replaced what is the thing a study cannot lose.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON app.survey_correction TO eia_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.survey_correction FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · row level security
--
-- A correction names a household's response, so it takes the `field.responses.read` door of
-- SECURITY.md §10b exactly as `survey_instance` does — **or** the row belongs to the caller's own
-- correction assignment, which is how a technician sees the revisit they were given without
-- gaining the project's responses.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.survey_correction ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.survey_correction FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY survey_correction_select ON app.survey_correction FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (app.can_read_field_responses()
              OR EXISTS (SELECT 1 FROM app.field_assignment fa
                          WHERE fa.tenant_id = survey_correction.tenant_id
                            AND fa.id = survey_correction.correction_assignment_id
                            AND fa.assignee_user_id = app.current_user_id())));
--> statement-breakpoint

-- Requesting one is a coordinator's or a social specialist's act, checked in the use-case. The
-- policy adds what a policy can: the row is this tenant's, this project's, and named by its author.
CREATE POLICY survey_correction_insert ON app.survey_correction FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND app.can_read_field_responses()
         AND requested_by_user_id = app.current_user_id());
--> statement-breakpoint

-- Settling one: applying is done by the technician's own submit, so the technician's own
-- assignment is admitted here too, and the trigger of §4 decides what may actually change.
CREATE POLICY survey_correction_update ON app.survey_correction FOR UPDATE TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (app.can_read_field_responses()
              OR EXISTS (SELECT 1 FROM app.field_assignment fa
                          WHERE fa.tenant_id = survey_correction.tenant_id
                            AND fa.id = survey_correction.correction_assignment_id
                            AND fa.assignee_user_id = app.current_user_id())))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · a lineage is a line, and it is written once
--
-- Four guarantees, none of which the interface is trusted to provide.
-- ---------------------------------------------------------------------------------------------

-- 4a · at most one OPEN or APPLIED correction of any one response. A cancelled one leaves the
-- response correctable again, which is the whole point of cancelling.
CREATE UNIQUE INDEX survey_correction_one_live_per_original
  ON app.survey_correction (tenant_id, original_instance_id)
  WHERE state <> 'CANCELLED';
--> statement-breakpoint

-- 4b · a response corrects at most one other. Two lineages cannot merge into one.
CREATE UNIQUE INDEX survey_correction_one_per_correcting
  ON app.survey_correction (tenant_id, correcting_instance_id)
  WHERE correcting_instance_id IS NOT NULL;
--> statement-breakpoint

-- 4c · a response never supersedes itself.
ALTER TABLE app.survey_correction
  ADD CONSTRAINT survey_correction_not_self
  CHECK (correcting_instance_id IS NULL OR correcting_instance_id <> original_instance_id);
--> statement-breakpoint

-- 4d · the state and its evidence agree. APPLIED means there is a correcting response; CANCELLED
-- means there is not, and both carry the timestamp that says when.
ALTER TABLE app.survey_correction
  ADD CONSTRAINT survey_correction_state_evidence
  CHECK (
    (state = 'REQUESTED' AND correcting_instance_id IS NULL
       AND applied_at IS NULL AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL)
    OR (state = 'APPLIED' AND correcting_instance_id IS NOT NULL
       AND applied_at IS NOT NULL AND cancelled_at IS NULL)
    OR (state = 'CANCELLED' AND correcting_instance_id IS NULL
       AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL AND applied_at IS NULL)
  );
--> statement-breakpoint

-- 4e · a reason is words somebody wrote, not "ok". The bound `specialist_review` already uses.
ALTER TABLE app.survey_correction
  ADD CONSTRAINT survey_correction_reason_is_words
  CHECK (length(btrim(reason)) >= 12);
--> statement-breakpoint

CREATE FUNCTION app.assert_survey_correction_rules() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  cursor_id uuid;
  hops int := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- No cycles. 4a and 4b already make the graph a set of disjoint paths, so the only way back
    -- into a lineage is to correct a response that the new correcting response descends from.
    -- Walked here explicitly rather than argued, because "it cannot happen" is not a constraint.
    cursor_id := NEW.original_instance_id;
    WHILE cursor_id IS NOT NULL AND hops < 64 LOOP
      SELECT c.original_instance_id INTO cursor_id
        FROM app.survey_correction c
       WHERE c.tenant_id = NEW.tenant_id AND c.correcting_instance_id = cursor_id
         AND c.state = 'APPLIED';
      hops := hops + 1;
      IF cursor_id IS NOT NULL AND cursor_id = NEW.correcting_instance_id THEN
        RAISE EXCEPTION
          'survey_correction_cycle: this correction would close a loop in the lineage'
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    IF hops >= 64 THEN
      RAISE EXCEPTION 'survey_correction_cycle: correction lineage is longer than 64 generations'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- What was requested never changes. Only the settlement may be written, and only once.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.original_instance_id IS DISTINCT FROM OLD.original_instance_id
     OR NEW.correction_assignment_id IS DISTINCT FROM OLD.correction_assignment_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'survey_correction_request_fixed: what was requested, by whom and why does not change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'REQUESTED' THEN
    RAISE EXCEPTION
      'survey_correction_settled: this correction is already %, and a settled correction is not '
      'reopened; request another one against the response that is now effective', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;

  -- The correcting response must be the one captured on *this correction's own assignment*, and it
  -- must answer the same questionnaire the original answered. Without the first, any response
  -- could be recorded as the correction of any other; without the second, a lineage could change
  -- what its answers mean halfway along (ADR-006, ADR-037).
  IF NEW.correcting_instance_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM app.survey_instance c
        JOIN app.survey_instance o
          ON o.tenant_id = c.tenant_id AND o.id = NEW.original_instance_id
       WHERE c.tenant_id = NEW.tenant_id
         AND c.id = NEW.correcting_instance_id
         AND c.assignment_id = NEW.correction_assignment_id
         AND c.survey_version_id = o.survey_version_id
         AND c.status = 'SUBMITTED'
    ) THEN
      RAISE EXCEPTION
        'survey_correction_evidence: a correction is applied by the submitted response captured on '
        'its own assignment, against the questionnaire the original answered'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.assert_survey_correction_rules() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.assert_survey_correction_rules() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER survey_correction_rules
  BEFORE INSERT OR UPDATE ON app.survey_correction
  FOR EACH ROW EXECUTE FUNCTION app.assert_survey_correction_rules();
--> statement-breakpoint

CREATE FUNCTION app.survey_correction_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'app.survey_correction is history: it cannot be deleted (ADR-038)';
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.survey_correction_no_delete() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.survey_correction_no_delete() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER survey_correction_no_delete
  BEFORE DELETE ON app.survey_correction
  FOR EACH ROW EXECUTE FUNCTION app.survey_correction_no_delete();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 5 · THE one place the question is answered
--
-- *Which response does this study currently mean?*
--
-- Every analytic — social tabulation, the numeric summary, validated theme distribution, field
-- progress, the report snapshot — joins this view. It is a view rather than a predicate each module
-- repeats, because `where superseded = false` written in six places is six chances to disagree, and
-- the disagreement would be silent: two screens showing different counts of the same households.
--
-- `security_invoker = true` is load-bearing. Without it the view would run as its owner and hand
-- back rows the caller's policies refuse — a view is exactly the shape in which RLS is accidentally
-- bypassed, so it is stated here and asserted by an integration test.
--
-- Wall-clock time decides nothing: the chain is followed through an explicit relation, so two
-- corrections recorded in the same millisecond still have one order.
-- ---------------------------------------------------------------------------------------------
CREATE VIEW app.effective_survey_instance
WITH (security_invoker = true) AS
WITH RECURSIVE lineage AS (
    -- A root is a submitted response that is nobody's correction.
    SELECT i.tenant_id,
           i.project_id,
           i.survey_version_id,
           i.id AS root_instance_id,
           i.id AS instance_id,
           0    AS generation
      FROM app.survey_instance i
     WHERE i.status = 'SUBMITTED'
       AND NOT EXISTS (SELECT 1
                         FROM app.survey_correction c
                        WHERE c.tenant_id = i.tenant_id
                          AND c.correcting_instance_id = i.id)
  UNION ALL
    -- Follow applied corrections only. A REQUESTED one changes nothing until it is captured.
    SELECT l.tenant_id,
           l.project_id,
           l.survey_version_id,
           l.root_instance_id,
           c.correcting_instance_id,
           l.generation + 1
      FROM lineage l
      JOIN app.survey_correction c
        ON c.tenant_id = l.tenant_id
       AND c.original_instance_id = l.instance_id
       AND c.state = 'APPLIED'
       AND c.correcting_instance_id IS NOT NULL
)
SELECT DISTINCT ON (tenant_id, root_instance_id)
       tenant_id,
       project_id,
       survey_version_id,
       root_instance_id,
       instance_id AS effective_instance_id,
       generation
  FROM lineage
 ORDER BY tenant_id, root_instance_id, generation DESC;
--> statement-breakpoint

GRANT SELECT ON app.effective_survey_instance TO eia_app;
