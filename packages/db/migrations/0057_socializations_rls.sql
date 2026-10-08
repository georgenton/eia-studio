-- Socializations: grants, row level security, and the rule that an attempt is written once
-- (Visión Ambiental block 3, ADR-041). Hand-written, because policies and grants are reviewed
-- SQL (ADR-013).
--
-- Three things this file decides.
--
-- 1. **An event is project reference data; an invitation is not.** The event is a title, a time
--    and a place — the same kind of fact as a campaign's name, and a technician must be able to
--    read the one their invitation belongs to. The invitation carries `recipient_label`, which
--    is a name somebody wrote on a list, and it names which household is being convened. So the
--    invitation takes the row-ownership predicate of SECURITY.md §10b — *this row is mine, or I
--    hold `field.responses.read`* — and the event takes ordinary project access.
--
--    `field.responses.read` rather than a new flag, for the reason §3.2 of TENANCY.md gives about
--    reusing it in Social: a second transaction-local setting for "may see other people's field
--    rows" is a second thing that can drift from the first. It is held by COORDINATOR,
--    SOCIAL_SPECIALIST and REVIEWER, which is exactly who should see a project's invitations, and
--    not by GIS_SPECIALIST, ENVIRONMENTAL_SPECIALIST, VIEWER or FIELD_TECHNICIAN.
--
-- 2. **A technician records in their own name.** The insert policy on an attempt has no
--    `can_read_field_responses()` escape: being allowed to read what other people did is not
--    being allowed to file a delivery as them. The same asymmetry `field_media` has.
--
-- 3. **An attempt is written once.** What a technician reported at a gate, at a time, is a
--    statement they made; a second visit is a second row, which is why `ABSENT` leaves the
--    invitation open. REVOKE *and* trigger, because migration 0002's default privileges hand
--    every new table in `app` full DML and a narrower GRANT beside them changes nothing.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON app.socialization_event TO eia_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.socialization_event FROM eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.socialization_invitation TO eia_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.socialization_invitation FROM eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.socialization_delivery_attempt TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.socialization_delivery_attempt FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · the event — ordinary project access
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.socialization_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.socialization_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY socialization_event_select ON app.socialization_event FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- Who may *write* one is `field.socializations.manage`, checked in the use-case. The policy's job
-- is the boundary a bug cannot cross: another tenant's project, or a project this caller is not
-- on. No DELETE is granted at all — a cancelled event keeps its history.
CREATE POLICY socialization_event_write ON app.socialization_event FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · the invitation — mine, or I may read this project's field rows
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.socialization_invitation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.socialization_invitation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY socialization_invitation_select ON app.socialization_invitation FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (assignee_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint

-- Generating and reassigning are desk acts behind `field.socializations.manage` and
-- `field.assignments.manage`; a technician holds neither, and the predicate says so by requiring
-- the reader's door rather than the row's own ownership.
CREATE POLICY socialization_invitation_write ON app.socialization_invitation FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (assignee_user_id = app.current_user_id() OR app.can_read_field_responses()))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (assignee_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · the attempt — read like the invitation, written only in your own name
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.socialization_delivery_attempt ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.socialization_delivery_attempt FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY socialization_delivery_attempt_select ON app.socialization_delivery_attempt
  FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND (technician_user_id = app.current_user_id() OR app.can_read_field_responses()));
--> statement-breakpoint

CREATE POLICY socialization_delivery_attempt_insert ON app.socialization_delivery_attempt
  FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND technician_user_id = app.current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 5 · written once, by the owner as well
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.socialization_attempt_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'app.socialization_delivery_attempt is written once: a delivery attempt cannot be % (ADR-041)',
    lower(TG_OP);
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.socialization_attempt_immutable() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.socialization_attempt_immutable() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER socialization_attempt_no_update
BEFORE UPDATE ON app.socialization_delivery_attempt
FOR EACH ROW EXECUTE FUNCTION app.socialization_attempt_immutable();
--> statement-breakpoint

CREATE TRIGGER socialization_attempt_no_delete
BEFORE DELETE ON app.socialization_delivery_attempt
FOR EACH ROW EXECUTE FUNCTION app.socialization_attempt_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 6 · an event's logistics freeze once somebody has been told them
-- ---------------------------------------------------------------------------------------------
-- The rule is `assertEventLogisticsEditable` in the domain, where it produces a sentence a person
-- can act on. It is here as well because a rule that lives only in a use-case is one repository
-- call away from being bypassed, and because this one protects a statement already made to
-- somebody outside this product: an invitation that was printed, carried and handed over.
CREATE FUNCTION app.socialization_event_logistics_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF (NEW.title, NEW.purpose, NEW.starts_at, NEW.timezone, NEW.location_label)
     IS DISTINCT FROM
     (OLD.title, OLD.purpose, OLD.starts_at, OLD.timezone, OLD.location_label)
     AND EXISTS (SELECT 1 FROM app.socialization_invitation i
                  WHERE i.tenant_id = OLD.tenant_id AND i.event_id = OLD.id)
  THEN
    RAISE EXCEPTION
      'app.socialization_event: this event has invitations, so its time, place and title cannot change (ADR-041)';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION app.socialization_event_logistics_frozen() OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.socialization_event_logistics_frozen() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER socialization_event_logistics_frozen
BEFORE UPDATE ON app.socialization_event
FOR EACH ROW EXECUTE FUNCTION app.socialization_event_logistics_frozen();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 7 · why a delivery a device captured offline can no longer be recorded
-- ---------------------------------------------------------------------------------------------
-- The select policy above is doing its job, and that is the problem this function solves.
--
-- A technician captures a delivery in a valley. By the time the phone reaches a signal the
-- invitation has been reassigned — so the row is no longer theirs, the policy hides it, and the
-- use-case's lookup finds nothing. "Not found" is the wrong answer: it is indistinguishable from
-- a malformed command, and the device would discard a photograph of a real delivery or retry
-- something that can never succeed. What the protocol needs is *conflict*, so the attempt and its
-- evidence are kept and a person looks.
--
-- So: a SECURITY DEFINER function that answers **one bounded question** — why can this caller no
-- longer record against this invitation? — and returns a reason code and nothing else. No row, no
-- parcel, no recipient, no event title, no other technician's name. It is the shape
-- `app.claim_classification` uses: step outside RLS to answer a question, never to hand back data.
--
-- The disclosure it does permit is narrow and deliberate: somebody with project access and
-- `field.capture` learns whether a UUID they already hold names an invitation here. They cannot
-- enumerate — a UUID is not guessable — and the id in their hand came from their own pack.
-- `eia_policy` owns the function, so the reads inside it run as that role. Two tables, SELECT
-- only, and the function hands back none of what it reads (the pattern of 0043 and 0017).
GRANT SELECT ON app.socialization_invitation, app.socialization_event TO eia_policy;
--> statement-breakpoint

-- The answer is an **enum**, not text, and that is the contract rather than a style choice.
-- `packages/testing/test/rls/security-definer.integration.test.ts` asserts that every privileged
-- helper returns a boolean, a uuid, a count — or a closed vocabulary like this one. A `text`
-- return would be a place where a row's own words could one day be put; a type with six labels
-- is a place where they cannot.
CREATE TYPE app.socialization_delivery_block AS ENUM (
  'none',
  'not_found',
  'invitation_reassigned',
  'invitation_cancelled',
  'event_cancelled',
  'already_settled'
);
--> statement-breakpoint

CREATE FUNCTION app.socialization_delivery_conflict(
  p_tenant uuid, p_project uuid, p_invitation uuid
) RETURNS app.socialization_delivery_block
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT (CASE
           WHEN NOT app.has_project_access(p_tenant, p_project) THEN 'not_found'
           WHEN i.id IS NULL                                    THEN 'not_found'
           WHEN e.status = 'CANCELLED'                          THEN 'event_cancelled'
           WHEN i.status = 'CANCELLED'                          THEN 'invitation_cancelled'
           WHEN i.assignee_user_id <> app.current_user_id()     THEN 'invitation_reassigned'
           WHEN i.status IN ('DELIVERED', 'REFUSED')            THEN 'already_settled'
           ELSE 'none'
         END)::app.socialization_delivery_block
    FROM (SELECT 1 AS one) probe
    LEFT JOIN app.socialization_invitation i
      ON i.tenant_id = p_tenant AND i.project_id = p_project AND i.id = p_invitation
    LEFT JOIN app.socialization_event e
      ON e.tenant_id = i.tenant_id AND e.id = i.event_id;
$$;
--> statement-breakpoint

ALTER FUNCTION app.socialization_delivery_conflict(uuid, uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.socialization_delivery_conflict(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.socialization_delivery_conflict(uuid, uuid, uuid) TO eia_app;
