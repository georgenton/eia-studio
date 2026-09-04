-- Influence areas: grants, row level security, and the geometry invariants every spatial table
-- in this schema already carries (ADR-023). Hand-written because policies and CHECK constraints
-- must be reviewed SQL, not inferred from a schema diff (ADR-013).
--
-- Nothing here is new in kind. `influence_area` is a project-scoped table like `parcel_geometry`,
-- and it gets the identical treatment: the same three-part predicate for read and for write, FORCE
-- so the owning role is subject to it too, and a validity CHECK so an invalid polygon cannot
-- silently break every area computed from it.
--
-- The one thing worth stating: an influence area is **not** append-only. A study redelimits its
-- AID when the corridor changes, and that is a new `spatial_dataset_version`, not an amendment —
-- which the unique constraint on (tenant, version, kind) already enforces.

-------------------------------------------------------------------------------------------------
-- 1. Invariants
-------------------------------------------------------------------------------------------------
ALTER TABLE app.influence_area
  ADD CONSTRAINT influence_area_area_positive CHECK (area_m2 > 0);
--> statement-breakpoint
ALTER TABLE app.influence_area
  ADD CONSTRAINT influence_area_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom));
--> statement-breakpoint
ALTER TABLE app.influence_area
  ADD CONSTRAINT influence_area_label_present CHECK (length(btrim(label)) > 0);
--> statement-breakpoint

-- There is deliberately **no** CHECK that a frontage ends after it starts.
--
-- The first draft of this file had one, and the delivered package failed it twice: parcel `080A`
-- runs 2 583 → 2 557 and `132a` runs 5 885 → 5 596. Both are real errors in the delivery, and a
-- constraint that refused them would mean the study's own cartography could not be stored at all —
-- the product deciding that inconvenient data does not exist.
--
-- Storing what the source said and reporting the disagreement is this product's whole posture
-- (invariant 11, ADR-020). A reversed range is a Quality Gate finding, not a write error, and the
-- rule that states it can name both numbers. The non-negativity CHECK from migration 0010 stays:
-- a negative abscissa is not a disagreement between sources, it is nonsense.

-- The parcel code is the consultancy's, not ours.
--
-- `parcel_code_shape` was written in Slice 2 against the codes the corridor generator invented —
-- a project prefix, a region abbreviation and a sequence, joined by hyphens — and so requires at
-- least one hyphen and upper case throughout. The delivered package numbers its parcels `001`,
-- `032A`, `042a`: no hyphen, and sometimes lower case. A
-- constraint that rejects the real study's own identifiers is describing our fixture, not a
-- parcel code (ADR-023).
--
-- The replacement keeps what the rule was for: a code is short, has no whitespace, and cannot be a
-- name, a sentence or a free-text blob. It deliberately still accepts `042a` beside `042A`,
-- because those two spellings are a real defect in the delivery and hiding it behind a CHECK would
-- be the importer repairing the data instead of the Quality Gate reporting it.
ALTER TABLE app.parcel DROP CONSTRAINT parcel_code_shape;
--> statement-breakpoint
ALTER TABLE app.parcel
  ADD CONSTRAINT parcel_code_shape CHECK (parcel_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$');
--> statement-breakpoint

-------------------------------------------------------------------------------------------------
-- 2. Grants
-------------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON app.influence_area TO eia_app;
--> statement-breakpoint

-------------------------------------------------------------------------------------------------
-- 3. Row Level Security: enable and FORCE
-------------------------------------------------------------------------------------------------
ALTER TABLE app.influence_area ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.influence_area FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-------------------------------------------------------------------------------------------------
-- 4. Policies. Same predicate for USING and WITH CHECK, so a forged tenant_id or project_id is
--    rejected on write exactly as it is hidden on read. A missing setting reads as NULL, the
--    comparison is NULL, and the row is denied.
-------------------------------------------------------------------------------------------------
CREATE POLICY influence_area_select ON app.influence_area FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY influence_area_write ON app.influence_area FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
