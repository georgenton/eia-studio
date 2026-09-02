-- Implementation Gate 2 hardening (IG2-001, IG2-004). Forward-only: migrations 0009 and 0010 are
-- already applied to staging and are not rewritten.
--
-- 1. Canonical geometry moves from EPSG:32717 to EPSG:4326.
--
--    0009 typed every geometry column as `geometry(...,32717)`, which made one pilot's UTM zone a
--    property of the platform: a project outside zone 17S could not be stored at all. Canonical
--    storage is now EPSG:4326 — the one CRS every project shares, and the one MapLibre consumes.
--    The projected CRS a dataset's metres are computed in becomes metadata on its version.
--
-- 2. `source_crs` (text) is replaced by `source_srid` and `analysis_srid` (integers).
--
--    A text label cannot be passed to ST_Transform and could not say where metres come from.
--    Two integers say both, and the label is derived ('EPSG:' || srid).
--
-- 3. Area invariants that geometry cannot state for itself (IG2-004).
--
-- Rollback: transform the geometry columns back to 32717, restore `source_crs` from
-- `source_srid`, and drop the new constraints. No data is lost by this migration: the geometry is
-- reprojected, not recomputed, and the stored metric values were computed in the analysis CRS and
-- stay valid.

-- ---------------------------------------------------------------------------------------------
-- 1 · dataset CRS metadata
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.spatial_dataset_version
  ADD COLUMN source_srid integer,
  ADD COLUMN analysis_srid integer;
--> statement-breakpoint

-- Backfill from the text label written by 0009 ('EPSG:32717'). Existing rows are all generated
-- data produced in the same CRS they were stored in, so source and analysis coincide for them.
UPDATE app.spatial_dataset_version
   SET source_srid = nullif(regexp_replace(source_crs, '\D', '', 'g'), '')::integer,
       analysis_srid = nullif(regexp_replace(source_crs, '\D', '', 'g'), '')::integer
 WHERE source_srid IS NULL;
--> statement-breakpoint

ALTER TABLE app.spatial_dataset_version
  ALTER COLUMN source_srid SET NOT NULL,
  ALTER COLUMN analysis_srid SET NOT NULL;
--> statement-breakpoint

ALTER TABLE app.spatial_dataset_version DROP COLUMN source_crs;
--> statement-breakpoint

-- Bounded to the published EPSG range so a forged value cannot reach ST_Transform as an
-- arbitrary integer. The analysis CRS must additionally be projected: lengths and areas computed
-- in a geographic CRS (the 4xxx block) are degrees, a number that looks plausible and means
-- nothing.
ALTER TABLE app.spatial_dataset_version
  ADD CONSTRAINT spatial_dataset_version_source_srid_range
  CHECK (source_srid BETWEEN 1024 AND 999999);
--> statement-breakpoint

ALTER TABLE app.spatial_dataset_version
  ADD CONSTRAINT spatial_dataset_version_analysis_srid_projected
  CHECK (analysis_srid BETWEEN 1024 AND 999999 AND analysis_srid NOT BETWEEN 4000 AND 4999);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · canonical geometry in EPSG:4326
--
-- The ST_IsValid CHECKs are dropped first: a CHECK constraint is re-validated during the type
-- change, and validity is asserted again afterwards on the reprojected geometry. The GiST indexes
-- are rebuilt automatically by ALTER COLUMN TYPE.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.parcel_geometry DROP CONSTRAINT parcel_geometry_valid;
--> statement-breakpoint
ALTER TABLE app.affectation DROP CONSTRAINT affectation_geometry_valid;
--> statement-breakpoint
ALTER TABLE app.alignment DROP CONSTRAINT alignment_geometry_valid;
--> statement-breakpoint

ALTER TABLE app.parcel_geometry
  ALTER COLUMN geom TYPE geometry(Polygon, 4326) USING ST_Transform(geom, 4326);
--> statement-breakpoint
ALTER TABLE app.affectation
  ALTER COLUMN geom TYPE geometry(Polygon, 4326) USING ST_Transform(geom, 4326);
--> statement-breakpoint
ALTER TABLE app.alignment
  ALTER COLUMN geom TYPE geometry(LineString, 4326) USING ST_Transform(geom, 4326);
--> statement-breakpoint

ALTER TABLE app.parcel_geometry
  ADD CONSTRAINT parcel_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom));
--> statement-breakpoint
ALTER TABLE app.affectation
  ADD CONSTRAINT affectation_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom));
--> statement-breakpoint
ALTER TABLE app.alignment
  ADD CONSTRAINT alignment_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · metric invariants (IG2-004)
--
-- The stored metric columns are square metres and metres, computed in the dataset's analysis CRS
-- at write time. The affected share is NOT stored: it is derived as affected_area / parcel_area
-- wherever it is shown, so it cannot drift from the geometry it came from.
--
-- 0010 already asserts `parcel_geometry.area_m2 > 0`, `alignment.length_m > 0` and a
-- non-negative chainage. What follows is only what it did not say.
-- ---------------------------------------------------------------------------------------------

-- 0010 required `affected_area_m2 > 0`, which makes a parcel the right of way happens to miss
-- unrepresentable: a 0 m² affectation is a legitimate observation ("this parcel is not affected"),
-- and forbidding it pushes that fact into the absence of a row, where it cannot be distinguished
-- from "nobody has looked yet".
ALTER TABLE app.affectation DROP CONSTRAINT affectation_area_positive;
--> statement-breakpoint

ALTER TABLE app.affectation
  ADD CONSTRAINT affectation_area_non_negative CHECK (affected_area_m2 >= 0);
--> statement-breakpoint

ALTER TABLE app.parcel
  ADD CONSTRAINT parcel_frontage_positive CHECK (frontage_m IS NULL OR frontage_m > 0);
--> statement-breakpoint

-- An affectation cannot take more of a parcel than the parcel has. The two areas live in
-- different tables, so this is the one invariant a CHECK cannot express; a constraint trigger
-- states it where it cannot be bypassed by a repository that forgets.
--
-- SECURITY INVOKER on purpose: it reads `app.parcel_geometry` as the caller, so it can never
-- become a way to learn about another tenant's rows. A caller who cannot see the parcel's active
-- geometry simply has no row to compare against, and RLS has already refused their write.
CREATE FUNCTION app.assert_affectation_within_parcel() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  parcel_area numeric;
BEGIN
  SELECT g.area_m2 INTO parcel_area
    FROM app.parcel_geometry g
   WHERE g.tenant_id = NEW.tenant_id
     AND g.parcel_id = NEW.parcel_id
     AND g.is_active;

  IF parcel_area IS NOT NULL AND NEW.affected_area_m2 > parcel_area THEN
    RAISE EXCEPTION
      'affectation_exceeds_parcel: affected area % m2 is larger than the parcel''s % m2',
      NEW.affected_area_m2, parcel_area
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_affectation_within_parcel() FROM PUBLIC;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER affectation_within_parcel
  AFTER INSERT OR UPDATE OF affected_area_m2, parcel_id ON app.affectation
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION app.assert_affectation_within_parcel();
