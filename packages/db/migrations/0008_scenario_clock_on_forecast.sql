-- 0008 · The simulation's as-of date moves from `project` to the forecast that uses it (IG1-009).
--
-- `project.demo_scenario_date` put a demonstration concern on a canonical entity: a Project is a
-- real consulting engagement and knows nothing about demos. The date it held is the anchor of a
-- calculation, so it belongs to the calculation. Storing it as `forecast_snapshot.as_of_date`
-- also completes the input snapshot — the result can now be recomputed from the row alone —
-- and, for a DEMO_SIMULATION forecast, that anchor *is* the scenario clock. No scenario table,
-- no scenario subsystem: one field, in the place that already needed it.
--
-- Forward-only: 0007 is already applied to staging and is not rewritten.
--
-- The generated diff would have added a NOT NULL column in one statement, which fails on a table
-- that already has rows. Add nullable, backfill, then constrain.

ALTER TABLE app.forecast_snapshot ADD COLUMN as_of_date date;
--> statement-breakpoint
-- Existing rows: the calculation instant is the anchor, by construction of the algorithm.
UPDATE app.forecast_snapshot SET as_of_date = calculated_at::date WHERE as_of_date IS NULL;
--> statement-breakpoint
ALTER TABLE app.forecast_snapshot ALTER COLUMN as_of_date SET NOT NULL;
--> statement-breakpoint
-- The projected close can never precede the date the projection was anchored to.
ALTER TABLE app.forecast_snapshot
  ADD CONSTRAINT forecast_snapshot_projection_not_before_anchor
  CHECK (projected_close_date >= as_of_date);
--> statement-breakpoint
ALTER TABLE app.project DROP COLUMN demo_scenario_date;
