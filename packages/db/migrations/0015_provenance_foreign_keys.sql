-- Every provenance-bearing row must actually point at a provenance record.
--
-- ARCHITECTURE.md §5 states the rule — "a single `provenance_id` FK on provenance-bearing tables"
-- — and the Slice 1 tables (`metric_snapshot`, `forecast_snapshot`, `attention_item`,
-- `activity_event`) have it. The GIS tables added in Slice 2 and the field tables added in Slice 3
-- did not: the column was declared `NOT NULL` but nothing stopped it naming a record that no
-- longer exists.
--
-- That is not theoretical. The demo seeder used to delete and re-insert provenance records with
-- fresh ids on every run, which was invisible while every provenance-bearing row was recreated
-- alongside them, and produced a dangling reference the moment a row was legitimately *reused* —
-- a published questionnaire, or a campaign whose assignments carry submitted responses that must
-- not be deleted. The surface then failed with "provenance record missing", which is the right
-- failure and the wrong place to discover it.
--
-- The seeder now derives provenance ids deterministically from the fixture key, so a re-seed
-- updates records in place. These constraints are what make that a guarantee rather than a habit.
--
-- Composite `(tenant_id, provenance_id)`, like every other cross-table reference here, so a row
-- cannot borrow another tenant's provenance even if application code is wrong.

ALTER TABLE app.spatial_dataset_version
  ADD CONSTRAINT spatial_dataset_version_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.alignment
  ADD CONSTRAINT alignment_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.parcel
  ADD CONSTRAINT parcel_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.parcel_geometry
  ADD CONSTRAINT parcel_geometry_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.affectation
  ADD CONSTRAINT affectation_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.survey_version
  ADD CONSTRAINT survey_version_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.survey_campaign
  ADD CONSTRAINT survey_campaign_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.field_assignment
  ADD CONSTRAINT field_assignment_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.field_visit
  ADD CONSTRAINT field_visit_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.survey_instance
  ADD CONSTRAINT survey_instance_provenance_fk
  FOREIGN KEY (tenant_id, provenance_id) REFERENCES app.provenance_record (tenant_id, id);
