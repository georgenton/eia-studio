-- Implementation Gate 2, condition IG2-009: validate an analysis CRS from its definition, never
-- from its number. Forward-only; 0009, 0010 and 0011 are already applied to staging and are not
-- rewritten.
--
-- What was wrong. Migration 0011 asserted `analysis_srid NOT BETWEEN 4000 AND 4999`, reading the
-- 4xxx block as "geographic". An SRID is an identifier; its value encodes nothing about the CRS:
--
--   EPSG:4087  PROJCS, equidistant cylindrical, metres  -- projected, inside the 4xxx block
--   EPSG:6318  GEOGCS, NAD83(2011), degrees             -- geographic, outside it
--
-- The old rule rejected 4087, which is a perfectly good metric analysis CRS, and accepted 6318,
-- in which every area would silently be square degrees. It also restricted both SRIDs to
-- 1024–999999, which would reject a legitimately registered custom SRS outside that window.
--
-- What replaces it. The source of truth is `spatial_ref_sys`: the CRS must be registered, its
-- definition must be a projected CRS, its linear unit must be the metre, and PROJ must actually
-- be able to build a transform for it. No authority is assumed, no code list is maintained, and
-- nothing parses a projection definition beyond the two facts the calculations depend on.

-- ---------------------------------------------------------------------------------------------
-- 1 · drop the numeric heuristics
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.spatial_dataset_version
  DROP CONSTRAINT spatial_dataset_version_analysis_srid_projected;
--> statement-breakpoint

ALTER TABLE app.spatial_dataset_version
  DROP CONSTRAINT spatial_dataset_version_source_srid_range;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · CRS predicates, read from the catalogue
--
-- `spatial_ref_sys` is world-readable (PostGIS grants SELECT to PUBLIC), so these are plain
-- SECURITY INVOKER functions: the caller reads what it could already read, and no privilege is
-- borrowed. They are STABLE, not IMMUTABLE, because the catalogue is a table an operator can add
-- a custom SRS to.
--
-- `public` is deliberately absent from the search_path even though PostGIS lives there: every
-- reference below is schema-qualified, so nothing needs to resolve through a schema the runtime
-- role can write to (the hardening contract in ADR-004, asserted by the security-definer suite).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.srid_is_registered(candidate integer) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.spatial_ref_sys s WHERE s.srid = candidate);
$$;
--> statement-breakpoint

-- Projected, and measured in metres.
--
-- Both facts come from the CRS definition's own WKT. `PROJCS` is WKT1 and `PROJCRS` is WKT2; both
-- appear in the wild depending on how the catalogue was populated, so both are accepted. The
-- linear unit is the metre when the definition carries a unit named metre/meter with a conversion
-- factor of exactly 1 — `UNIT[...]` in WKT1, `LENGTHUNIT[...]` in WKT2. A projected CRS in feet
-- (EPSG:2225, EPSG:2263) carries its foot factor instead and is refused: this product's stored
-- areas are square metres, and converting them is future work, not a silent reinterpretation.
--
-- The angular unit of the nested geographic CRS ("degree", factor 0.0174…) never matches, so its
-- presence inside a PROJCS does not make the CRS look metric.
CREATE FUNCTION app.srid_is_metric_projected(candidate integer) RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  definition text;
  probe public.geometry;
BEGIN
  SELECT s.srtext INTO definition FROM public.spatial_ref_sys s WHERE s.srid = candidate;
  IF definition IS NULL OR definition = '' THEN
    RETURN false;
  END IF;

  IF definition !~* '^\s*(PROJCS|PROJCRS)' THEN
    RETURN false;
  END IF;

  IF definition !~* '(UNIT|LENGTHUNIT)\s*\[\s*"(metre|meter)"\s*,\s*1(\.0*)?\s*[,\]]' THEN
    RETURN false;
  END IF;

  -- The definition can be well formed and still unusable: a missing grid file, or a PROJ pipeline
  -- that cannot be built, fails only when a transform is attempted. So attempt one.
  --
  -- The probe runs *out of* the candidate CRS, from its own origin, rather than into it from a
  -- fixed lon/lat. A point in lon/lat is only valid inside the CRS's area of use — (0,0) is
  -- outside UTM zone 17S, so probing that way would reject the pilot's own CRS — whereas the
  -- origin of a projected CRS is always within the projection's mathematical domain. This asks
  -- PROJ the question we actually have ("can you build a transform for this CRS?") without
  -- needing to know where on earth the CRS applies.
  BEGIN
    probe := public.ST_Transform(
      public.ST_SetSRID(public.ST_MakePoint(0, 0), candidate),
      4326
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN false;
  END;

  RETURN probe IS NOT NULL;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.srid_is_registered(integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.srid_is_metric_projected(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.srid_is_registered(integer) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.srid_is_metric_projected(integer) TO eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · enforce it where dataset versions are written
--
-- A trigger rather than a CHECK because the answer depends on another table, and a constraint
-- trigger rather than a plain one so it participates in the transaction the same way a constraint
-- would. Dataset-version creation is a handful of rows per import, so the per-row cost is
-- irrelevant. The application validates first and raises a readable error; this is the floor
-- underneath it, not the user-facing message.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.assert_dataset_version_crs() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF NOT app.srid_is_registered(NEW.source_srid) THEN
    RAISE EXCEPTION
      'analysis_crs_unknown_source: SRID % is not registered in spatial_ref_sys', NEW.source_srid
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT app.srid_is_metric_projected(NEW.analysis_srid) THEN
    RAISE EXCEPTION
      'analysis_crs_not_metric_projected: SRID % is not a registered, projected, metre-based CRS '
      'usable by ST_Transform', NEW.analysis_srid
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.assert_dataset_version_crs() FROM PUBLIC;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER spatial_dataset_version_crs_valid
  AFTER INSERT OR UPDATE OF source_srid, analysis_srid ON app.spatial_dataset_version
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION app.assert_dataset_version_crs();
