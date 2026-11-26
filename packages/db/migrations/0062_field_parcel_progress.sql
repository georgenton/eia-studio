-- 0062 · where the work is, on the map, without reading what anybody answered.
--
-- Hand-written, because a SECURITY DEFINER function is reviewed SQL (ADR-013).
--
-- ## The question the map could not answer
--
-- The Parcel Explorer colours parcels by their **cartographic** state — confirmed, estimated,
-- not located, excluded — which says whether the geometry is trusted and nothing about whether
-- anybody has been there. A coordinator looking at a corridor wants the other one: which parcels
-- are assigned, which have a response, which are still untouched. Those are different facts about
-- the same object and the surface must not merge them, so this adds a second colouring with its
-- own legend rather than overloading the first.
--
-- ## Why it cannot be an ordinary aggregate
--
-- Exactly the defect migration 0059 fixed, one surface along. `app.field_assignment` and
-- `app.survey_instance` admit a row only when it is the caller's own *or* the caller holds
-- `field.responses.read` (migration 0014). A `GIS_SPECIALIST` — the role whose surface this is —
-- holds `field.read` and not the second, so a plain `count(*)` would paint **every parcel grey**
-- and call it "sin asignar" for a corridor a coordinator sees as half visited. A false map is
-- worse than no map: nobody doubts a colour.
--
-- So: identifiers and integers, from a privileged function, behind the same guard and the same
-- permission as the campaign counters. `app.assert_field_counts_allowed` is reused rather than
-- copied — one guard, so the three counters cannot drift apart, and a change to what `field.read`
-- means lands in one place.
--
-- ## What it returns, and what it has nowhere to put
--
-- A parcel id and three integers. There is no column for an answer, a respondent, a technician, a
-- note or a coordinate, which bounds the *shape*; the scope is the guard. A caller without
-- `field.read` is **refused**, not served zeros — the whole point.
--
-- ## Counting rules, the same ones the campaign counters use
--
--   * a **correction assignment is not a parcel** (ADR-038): `corrects_assignment_id IS NULL`, so
--     a revisit does not make a parcel count twice as assigned;
--   * open corrections are counted separately, because a parcel whose response is being corrected
--     is neither "answered and done" nor "never visited";
--   * `app.effective_survey_instance` decides what counts as answered, so an original and its
--     correction are one answered parcel. It is `security_invoker = true`, so inside this function
--     it resolves as `eia_policy` and walks the whole lineage; only the integer leaves.

CREATE FUNCTION app.field_parcel_progress(p_tenant uuid, p_project uuid)
RETURNS TABLE (
  parcel_id uuid,
  assigned integer,
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
  SELECT p.id,
         coalesce(a.assigned, 0)::integer,
         coalesce(s.submitted, 0)::integer,
         coalesce(corr.corrections_open, 0)::integer
    FROM app.parcel p
    LEFT JOIN LATERAL (
      SELECT count(*) AS assigned
        FROM app.field_assignment fa
       WHERE fa.tenant_id = p.tenant_id
         AND fa.parcel_id = p.id
         AND fa.status <> 'CANCELLED'
         AND fa.corrects_assignment_id IS NULL
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS corrections_open
        FROM app.field_assignment fa
       WHERE fa.tenant_id = p.tenant_id
         AND fa.parcel_id = p.id
         AND fa.status IN ('PENDING', 'IN_PROGRESS')
         AND fa.corrects_assignment_id IS NOT NULL
    ) corr ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS submitted
        FROM app.survey_instance si
        JOIN app.field_assignment fa2
          ON fa2.tenant_id = si.tenant_id AND fa2.id = si.assignment_id
       WHERE si.tenant_id = p.tenant_id
         AND fa2.parcel_id = p.id
         AND EXISTS (
           SELECT 1 FROM app.effective_survey_instance eff
            WHERE eff.tenant_id = si.tenant_id AND eff.effective_instance_id = si.id
         )
    ) s ON true
   WHERE p.tenant_id = p_tenant
     AND p.project_id = p_project;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION app.field_parcel_progress(uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.field_parcel_progress(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.field_parcel_progress(uuid, uuid) TO eia_app;
--> statement-breakpoint

-- BYPASSRLS removes the row filter and grants nothing. `eia_policy` already holds SELECT on
-- `field_assignment`, `survey_instance` and `effective_survey_instance` (migration 0059); the
-- parcel table is the one relation this counter adds, listed on its own rather than granted over
-- the schema.
GRANT SELECT ON app.parcel TO eia_policy;
