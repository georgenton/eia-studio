-- 0059 · a count of work is not a reading of answers (TD-045, TENANCY.md §3.1/§3.5).
--
-- Hand-written, because a SECURITY DEFINER function is reviewed SQL (ADR-013).
--
-- ## What was wrong
--
-- `loadFieldOverview` carries this promise in its own comment: "Counts only — no individual
-- response is read here, so a role with `field.read` and no `field.responses.read` still gets a
-- useful picture without seeing anyone's answers." It did not keep it. The counts were ordinary
-- aggregates over `app.field_assignment` and `app.survey_instance`, whose SELECT policies
-- (migration 0014) admit a row only when it is the caller's own *or* the caller holds
-- `field.responses.read`. A `PROJECT_DATA_MANAGER` holds `field.read` and not the second, so every
-- subquery matched zero rows and the surface printed **0 asignadas · 0 pendientes · 0 enviadas**
-- for a campaign that a coordinator sees as 13 and 8.
--
-- Observed on staging on 19 November 2026 with a Gestor de información. The same would happen to a
-- GIS_SPECIALIST, who also holds `field.read` alone.
--
-- A zero is worse than a denial. `social/read-models.ts` already decided this question the honest
-- way — it requires `field.responses.read` and *denies*, rather than tabulating zeros (TD-045) —
-- and `docs/TENANCY.md` §3.3 states the principle. But §3.5 promises this role "the operational
-- workflow — campaigns, assignments, counts", so denying the whole surface would contradict the
-- role's documented purpose. The resolution is the third option: **count without reading**.
--
-- ## The contract these functions must not weaken
--
-- Project access is **not** the permission. A `FIELD_TECHNICIAN` is a member of the project and
-- passes `app.has_project_access`, and must still not obtain the project's overview: that is
-- `field.read`, which the technician does not hold. A counter gated on project access alone would
-- hand a technician the whole campaign through a direct call, bypassing the use-case that is
-- supposed to decide.
--
-- So the gate is the resolved permission itself, carried the way this database already carries
-- `field.responses.read` and `pii.read`: a transaction-local setting written by the application
-- layer from the verified `RequestContext`, never inferred here and never a role list duplicated
-- in SQL. `app.field_read_access` is to `field.read` what `app.field_responses_access` is to
-- `field.responses.read` (SECURITY.md §5, §10b).
--
-- ## A refusal is never a zero
--
-- The guard **raises**. Returning no rows would have reproduced the original defect one layer
-- down: the read model LEFT JOINs these counters and coalesces a missing row to 0, so a denial
-- that returned nothing would print *0 asignadas* again — the same plausible, entirely false
-- tabulation, now with a privileged function behind it. A zero from these functions means the
-- campaign has nothing to count, and nothing else.
--
-- ## Hardening (ADR-004, IG0-B01)
--
--   * owned by `eia_policy`, the NOLOGIN role that owns every privileged helper and nothing else;
--   * `eia_policy` carries BYPASSRLS, which removes the row filter and grants **no** privilege: the
--     SELECT and EXECUTE it needs are granted below, relation by relation;
--   * the return type is integers and identifiers, so there is nowhere to put an answer — but that
--     bounds the *shape*, not the *scope*. The scope is the guard, and the negative controls;
--   * ids are parameters, the caller is read from the transaction setting, and both must agree with
--     the transaction's own tenant and project;
--   * fixed `search_path` with `public` deliberately absent, every object schema-qualified, no
--     dynamic SQL;
--   * EXECUTE revoked from PUBLIC and granted only to `eia_app`, in the same transaction that
--     creates the function — drizzle's migrator wraps every pending migration in one transaction,
--     so the default world-executable grant is never visible to another session.

------------------------------------------------------------------------------------------------
-- 1 · the permission, carried into the transaction
--
-- Mirrors `app.can_read_field_responses()` (migration 0014): a plain, non-privileged reader of one
-- `SET LOCAL` value. Absent reads as `off`, so a caller that forgets it is refused rather than
-- served — the safe direction.
------------------------------------------------------------------------------------------------
CREATE FUNCTION app.can_read_field_workflow() RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT coalesce(current_setting('app.field_read_access', true), 'off') = 'on';
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.can_read_field_workflow() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.can_read_field_workflow() TO eia_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 2 · one guard, so the two counters cannot drift apart
--
-- Deliberately **not** SECURITY DEFINER: everything it consults is already executable by
-- `eia_app`, and a second privileged surface to ask a question that needs no privilege would be
-- one more thing to audit for nothing.
------------------------------------------------------------------------------------------------
CREATE FUNCTION app.assert_field_counts_allowed(p_tenant uuid, p_project uuid) RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  -- No context at all: a pooled connection that nobody configured. Deny loudly; a silent empty
  -- result here is how a false zero gets onto a screen.
  IF app.current_user_id() IS NULL OR app.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'field counts require a transaction context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The arguments are a claim; the transaction is the fact. They must agree, so a caller acting
  -- for one project cannot ask about another — including another project of the same tenant.
  IF p_tenant IS DISTINCT FROM app.current_tenant_id()
     OR p_project IS NULL
     OR (app.current_project_id() IS NOT NULL AND p_project IS DISTINCT FROM app.current_project_id())
  THEN
    RAISE EXCEPTION 'field counts asked for a tenant or project this transaction is not acting on'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT app.has_project_access(p_tenant, p_project) THEN
    RAISE EXCEPTION 'field counts require access to the project'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  /*
   * And the permission, which project access does not imply. A technician is a member of the
   * project and holds no `field.read`; without this line a direct call would hand them the whole
   * campaign, which is exactly the contract the use-case exists to enforce.
   */
  IF NOT app.can_read_field_workflow() THEN
    RAISE EXCEPTION 'field counts require the field.read permission'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.assert_field_counts_allowed(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.assert_field_counts_allowed(uuid, uuid) TO eia_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 3 · per-campaign progress
--
-- The four assignment states, the open corrections and the effective responses, with the meanings
-- the read model's lateral joins used to express and must keep:
--
--   * a **correction assignment is not a parcel** (ADR-038), so the denominator excludes it;
--   * open corrections are counted separately, beside the four states;
--   * one **effective** response per household, so an original and its correction are one answered
--     parcel rather than two.
------------------------------------------------------------------------------------------------
CREATE FUNCTION app.field_campaign_counts(p_tenant uuid, p_project uuid)
RETURNS TABLE (
  campaign_id uuid,
  pending integer,
  in_progress integer,
  completed integer,
  cancelled integer,
  submitted integer,
  corrections_open integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  PERFORM app.assert_field_counts_allowed(p_tenant, p_project);

  RETURN QUERY
  SELECT c.id,
         coalesce(a.pending, 0)::integer,
         coalesce(a.in_progress, 0)::integer,
         coalesce(a.completed, 0)::integer,
         coalesce(a.cancelled, 0)::integer,
         coalesce(s.submitted, 0)::integer,
         coalesce(corr.corrections_open, 0)::integer
    FROM app.survey_campaign c
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE fa.status = 'PENDING')     AS pending,
             count(*) FILTER (WHERE fa.status = 'IN_PROGRESS') AS in_progress,
             count(*) FILTER (WHERE fa.status = 'COMPLETED')   AS completed,
             count(*) FILTER (WHERE fa.status = 'CANCELLED')   AS cancelled
        FROM app.field_assignment fa
       WHERE fa.tenant_id = c.tenant_id AND fa.campaign_id = c.id
         AND fa.corrects_assignment_id IS NULL
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE fa.status IN ('PENDING', 'IN_PROGRESS')) AS corrections_open
        FROM app.field_assignment fa
       WHERE fa.tenant_id = c.tenant_id AND fa.campaign_id = c.id
         AND fa.corrects_assignment_id IS NOT NULL
    ) corr ON true
    /*
     * `app.effective_survey_instance` is `security_invoker = true`, so inside this function it
     * resolves as `eia_policy` and the lineage it walks is complete. That is the point rather than
     * a side effect: the count must be of the project's responses, not of the subset the caller
     * happens to be allowed to open. Only the integer leaves.
     */
    LEFT JOIN LATERAL (
      SELECT count(*) AS submitted
        FROM app.survey_instance si
        JOIN app.field_assignment fa2
          ON fa2.tenant_id = si.tenant_id AND fa2.id = si.assignment_id
       WHERE si.tenant_id = c.tenant_id
         AND fa2.campaign_id = c.id
         AND EXISTS (
           SELECT 1 FROM app.effective_survey_instance eff
            WHERE eff.tenant_id = si.tenant_id AND eff.effective_instance_id = si.id
         )
    ) s ON true
   WHERE c.tenant_id = p_tenant
     AND c.project_id = p_project;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION app.field_campaign_counts(uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.field_campaign_counts(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.field_campaign_counts(uuid, uuid) TO eia_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 4 · who is carrying the work
--
-- The project's whole load, not one campaign's: cancelled assignments are excluded and revisits
-- are included, because what a coordinator needs here is how much each technician is carrying.
--
-- Identifiers and counts. The display name is **not** returned: it is joined by the caller under
-- ordinary RLS, so whose name a reader may see stays a question the existing policies answer.
------------------------------------------------------------------------------------------------
CREATE FUNCTION app.field_technician_workload(p_tenant uuid, p_project uuid)
RETURNS TABLE (
  assignee_user_id uuid,
  pending integer,
  in_progress integer,
  completed integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  PERFORM app.assert_field_counts_allowed(p_tenant, p_project);

  RETURN QUERY
  SELECT fa.assignee_user_id,
         count(*) FILTER (WHERE fa.status = 'PENDING')::integer,
         count(*) FILTER (WHERE fa.status = 'IN_PROGRESS')::integer,
         count(*) FILTER (WHERE fa.status = 'COMPLETED')::integer
    FROM app.field_assignment fa
   WHERE fa.tenant_id = p_tenant
     AND fa.project_id = p_project
     AND fa.status <> 'CANCELLED'
   GROUP BY fa.assignee_user_id;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION app.field_technician_workload(uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.field_technician_workload(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.field_technician_workload(uuid, uuid) TO eia_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 5 · what the counters are allowed to read
--
-- BYPASSRLS removes the row filter; it does not grant a privilege. `eia_policy` holds SELECT on
-- exactly the relations these functions touch and on nothing else, listed one by one rather than
-- granted over the schema — the same narrow shape migration 0002 used for the membership helpers,
-- so what a privileged function can reach stays a short, reviewable list.
------------------------------------------------------------------------------------------------
GRANT SELECT ON app.survey_campaign, app.field_assignment, app.survey_instance,
                app.survey_correction, app.effective_survey_instance TO eia_policy;
--> statement-breakpoint

-- The readers the guard uses. Migration 0004 granted `eia_policy` `setting_uuid` and
-- `current_user_id` for the membership helpers; these are the same kind of thing.
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO eia_policy;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_project_id() TO eia_policy;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.can_read_field_workflow() TO eia_policy;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.assert_field_counts_allowed(uuid, uuid) TO eia_policy;
--> statement-breakpoint

-- The guard runs as the *caller*, and inside a SECURITY DEFINER counter the caller is
-- `eia_policy`, so it needs the membership helper too. `has_project_access` is itself a privileged
-- helper owned by the same role and reads the user from the transaction setting, so nothing widens.
GRANT EXECUTE ON FUNCTION app.has_project_access(uuid, uuid) TO eia_policy;
