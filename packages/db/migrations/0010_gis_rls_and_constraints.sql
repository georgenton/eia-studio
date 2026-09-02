-- 0010 · Row Level Security, grants and spatial integrity for the GIS tables (hand-written).
--
-- These six tables hold project data, so their policies use app.has_project_access — explicit
-- project membership or OWNER implicit access (D-015) — never can_administer_project. Geometry is
-- project data like any other: a tenant ADMIN without a ProjectMembership must not read it.

------------------------------------------------------------------------------------------------
-- 1. Spatial and domain integrity the type system cannot express
------------------------------------------------------------------------------------------------
-- Business identifier shape. The technical key stays the UUID; this is the cartographer's code.
ALTER TABLE app.parcel
  ADD CONSTRAINT parcel_code_shape
  CHECK (parcel_code ~ '^[A-Z][A-Z0-9]{0,9}(-[A-Z0-9]{1,10}){1,3}$');
--> statement-breakpoint
-- A chainage is a reference along the corridor, so it is non-negative and always says how it was
-- obtained; a value without a method is unreadable six months later.
ALTER TABLE app.parcel
  ADD CONSTRAINT parcel_chainage_non_negative CHECK (chainage_m IS NULL OR chainage_m >= 0);
--> statement-breakpoint
ALTER TABLE app.parcel
  ADD CONSTRAINT parcel_chainage_has_method
  CHECK (num_nonnulls(chainage_m, chainage_method) <> 1);
--> statement-breakpoint
ALTER TABLE app.parcel_geometry
  ADD CONSTRAINT parcel_geometry_area_positive CHECK (area_m2 > 0);
--> statement-breakpoint
-- Only one active geometry per parcel: the active boundary is a fact, not a query.
CREATE UNIQUE INDEX parcel_geometry_one_active_idx
  ON app.parcel_geometry (tenant_id, parcel_id) WHERE is_active;
--> statement-breakpoint
-- Only one active version per dataset, for the same reason.
CREATE UNIQUE INDEX spatial_dataset_version_one_active_idx
  ON app.spatial_dataset_version (tenant_id, dataset_id) WHERE is_active;
--> statement-breakpoint
-- A version cannot supersede itself; replacement chains stay acyclic at the first link.
ALTER TABLE app.spatial_dataset_version
  ADD CONSTRAINT spatial_dataset_version_no_self_supersede
  CHECK (supersedes_version_id IS NULL OR supersedes_version_id <> id);
--> statement-breakpoint
ALTER TABLE app.spatial_dataset_version
  ADD CONSTRAINT spatial_dataset_version_feature_count_non_negative CHECK (feature_count >= 0);
--> statement-breakpoint
-- Generated data must name the algorithm that produced it; an import must not pretend to have one.
ALTER TABLE app.spatial_dataset_version
  ADD CONSTRAINT spatial_dataset_version_generator_matches_origin
  CHECK ((origin = 'generated') = (generator_version IS NOT NULL));
--> statement-breakpoint
ALTER TABLE app.alignment
  ADD CONSTRAINT alignment_length_positive CHECK (length_m > 0);
--> statement-breakpoint
ALTER TABLE app.affectation
  ADD CONSTRAINT affectation_area_positive CHECK (affected_area_m2 > 0);
--> statement-breakpoint
-- Geometry must be valid and non-empty: an invalid polygon silently breaks every area and
-- intersection computed from it.
ALTER TABLE app.parcel_geometry
  ADD CONSTRAINT parcel_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom));
--> statement-breakpoint
ALTER TABLE app.affectation
  ADD CONSTRAINT affectation_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom));
--> statement-breakpoint
ALTER TABLE app.alignment
  ADD CONSTRAINT alignment_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom));
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 2. Grants
------------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.spatial_dataset, app.spatial_dataset_version, app.alignment,
  app.parcel, app.parcel_geometry, app.affectation
TO eia_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 3. Row Level Security: enable and FORCE
------------------------------------------------------------------------------------------------
ALTER TABLE app.spatial_dataset ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.spatial_dataset FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.spatial_dataset_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.spatial_dataset_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.alignment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.alignment FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.parcel ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.parcel FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.parcel_geometry ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.parcel_geometry FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.affectation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.affectation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 4. Policies. Same predicate for USING and WITH CHECK, so a forged tenant_id or project_id is
--    rejected on write exactly as it is hidden on read. A missing setting reads as NULL, the
--    comparison is NULL, and the row is denied.
------------------------------------------------------------------------------------------------
CREATE POLICY spatial_dataset_select ON app.spatial_dataset FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY spatial_dataset_write ON app.spatial_dataset FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY spatial_dataset_version_select ON app.spatial_dataset_version FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY spatial_dataset_version_write ON app.spatial_dataset_version FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY alignment_select ON app.alignment FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY alignment_write ON app.alignment FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY parcel_select ON app.parcel FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY parcel_write ON app.parcel FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY parcel_geometry_select ON app.parcel_geometry FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY parcel_geometry_write ON app.parcel_geometry FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY affectation_select ON app.affectation FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY affectation_write ON app.affectation FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
