-- Document intelligence: row level security, chunk immutability, the full-text index, and the
-- Quality Gate's new evidence lineage (Slice 6). Hand-written because policies, triggers, generated
-- columns and grants must be reviewed SQL, not inferred from a schema diff (ADR-013).
--
-- Four things this file does.
--
-- 1. **Scopes retrieval before it happens.** A chunk carries `tenant_id` and `project_id` and sits
--    behind FORCE RLS with the ordinary project predicate. The retriever also filters by both, so a
--    query that forgot its scope returns nothing rather than another project's documents. This is
--    the isolation SECURITY.md §8 requires of RAG, satisfied without a vector store.
--
-- 2. **Makes a citation permanent.** A chunk is never updated and never deleted while its version
--    stands: a citation points at it by id, and text that could change underneath a citation is the
--    one failure this layer cannot have. A corrected file is a new version with its own chunks.
--
-- 3. **Adds the search index.** A stored generated `tsvector` over the chunk's text in the
--    `spanish` configuration, with a GIN index. Generated rather than maintained, so it can never
--    disagree with the text it indexes. There is no embedding column and no `vec` schema: no
--    provider is configured, and a vector filled by a stand-in would be indistinguishable from a
--    real one (ADR-021).
--
-- 4. **Lets a quality assertion cite a real document.** `document_assertion` gains optional
--    `document_version_id` and `chunk_id`, and the CHECK that refused a `DOCUMENT_VERSION` source
--    kind is replaced by one that ties the claim to an actual reference — which is what ADR-020 §6
--    said this migration would do. Findings already raised keep the evidence they were raised with.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON app.source_document, app.document_version TO eia_app;
--> statement-breakpoint
-- A chunk is written once and read forever. The REVOKE is required, not decorative: migration 0002
-- set `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ... UPDATE, DELETE`, so a narrower GRANT beside
-- it changes nothing (the lesson of Slice 5's migration 0019).
GRANT SELECT, INSERT ON app.document_chunk TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.document_chunk FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.source_document ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.source_document FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY source_document_select ON app.source_document FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY source_document_write ON app.source_document FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.document_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.document_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_version_select ON app.document_version FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY document_version_write ON app.document_version FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.document_chunk ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.document_chunk FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Reachable only through a version the caller can already see, stated as an EXISTS so the version's
-- own policy applies first rather than being repeated here where the two could drift apart. This is
-- the predicate that makes cross-project retrieval impossible even if a retriever forgot its scope.
CREATE POLICY document_chunk_select ON app.document_chunk FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.document_version v
                      WHERE v.tenant_id = document_chunk.tenant_id
                        AND v.id = document_chunk.version_id));
--> statement-breakpoint
CREATE POLICY document_chunk_insert ON app.document_chunk FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND EXISTS (SELECT 1 FROM app.document_version v
                      WHERE v.tenant_id = document_chunk.tenant_id
                        AND v.id = document_chunk.version_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · a chunk is written once
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.document_chunk_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'document_chunk_immutable: a citation points at this passage by id; a corrected '
                  'file is a new document version with its own chunks, never an edit of these';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_chunk_no_update BEFORE UPDATE ON app.document_chunk
  FOR EACH ROW EXECUTE FUNCTION app.document_chunk_immutable();
--> statement-breakpoint
-- DELETE is allowed only by the cascade from its version, which is how a document is removed
-- wholesale. A row-level DELETE aimed at one chunk would leave a citation dangling.
CREATE TRIGGER document_chunk_no_delete BEFORE DELETE ON app.document_chunk
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION app.document_chunk_immutable();
--> statement-breakpoint
ALTER FUNCTION app.document_chunk_immutable() OWNER TO eia_policy;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · the search index
--
-- `spanish` because the corpus is Spanish and stemming matters: "afectaciones" must match
-- "afectación". Generated and stored so it cannot disagree with the text; GIN because the queries
-- are `@@` over a tsvector.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.document_chunk
  ADD COLUMN search tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', text)) STORED;
--> statement-breakpoint
CREATE INDEX document_chunk_search_idx ON app.document_chunk USING gin (search);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 5 · a quality assertion may now cite a real document version (ADR-020 §6)
--
-- The two optional columns come with the generated migration; here are the constraints that give
-- them meaning. Nothing is backfilled and no finding is rewritten: an
-- assertion that was reconstructed stays reconstructed, and the ones the seeder can now match to an
-- ingested excerpt gain a reference. Enrichment, not revision.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.document_assertion
  ADD CONSTRAINT document_assertion_version_fk
  FOREIGN KEY (tenant_id, document_version_id)
  REFERENCES app.document_version (tenant_id, id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.document_assertion
  ADD CONSTRAINT document_assertion_chunk_fk
  FOREIGN KEY (tenant_id, chunk_id)
  REFERENCES app.document_chunk (tenant_id, id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.document_assertion
  DROP CONSTRAINT document_assertion_source_kind_available;
--> statement-breakpoint
-- The rule it is replaced by: **a citation must be whole, and a claim must name what it claims.**
-- The old CHECK forbade a `DOCUMENT_VERSION` source outright because no document could exist; now
-- one can, so the question becomes whether the reference is real rather than whether it is possible.
--
-- Two clauses, and they say different things:
--
--   * naming a chunk without naming its version is half a citation — a reader could not resolve it,
--     and nothing would keep the chunk and the version in step;
--   * claiming the value was *extracted from* an ingested version must name that version.
--
-- What the check deliberately allows is a `RECONSTRUCTED_CORPUS` assertion that names both. That is
-- the pilot's whole corpus: a value transcribed by hand, whose passage is now in the system and can
-- be pointed at because its words match. The transcription does not become an extraction by
-- acquiring a link, and `source_kind` keeps saying which it was.
ALTER TABLE app.document_assertion
  ADD CONSTRAINT document_assertion_citation_is_real CHECK (
    (chunk_id IS NULL OR document_version_id IS NOT NULL)
    AND (source_kind <> 'DOCUMENT_VERSION' OR document_version_id IS NOT NULL)
  );
--> statement-breakpoint
CREATE INDEX document_assertion_version_idx
  ON app.document_assertion (tenant_id, project_id, document_version_id);
