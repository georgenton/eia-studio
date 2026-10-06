-- The editorial presentation a consultancy publishes about a project, and the one place in this
-- product a request with no session is served (Visión Ambiental, block 2).
--
-- Hand-written, because policies, grants and triggers are reviewed SQL (ADR-013).
--
-- Two things here are new to this codebase and both are deliberate:
--
--   1. a **public** surface. Every policy until now has denied a transaction with no tenant; this
--      file adds one branch, on two tables, that admits a row *because the row is published*. The
--      branch requires `app.surface = 'public'` and reads no setting the caller could forge into
--      something broader: there is no tenant to claim and no project to name. What it can reach
--      is a currently-visible publication and the attachments that publication authorises.
--      Nothing else in either schema gains a public branch.
--
--   2. slugs stored on the publication. A visitor's URL has to become a row without touching
--      `app.project`, because a public read that could resolve a slug against the operational
--      tables is a public read that has a path into them.
--
-- `eia_portal` is still granted nothing. It remains the intended role for an authenticated
-- external client (ADR-009, TD-005), and that is a different surface from an open page: this one
-- has no caller to authenticate.

-- ---------------------------------------------------------------------------------------------
-- 0 · a namespace of its own for published media
--
-- Not a flag on `documents`: "could this file ever be served to a visitor?" has to be answerable
-- from the key, and a query written for the corpus must be unable to reach a published photograph
-- — or the reverse. `ADD VALUE` is safe inside this transaction because nothing here writes a row
-- carrying the new value; the first one is written by the application.
-- ---------------------------------------------------------------------------------------------
ALTER TYPE app.storage_namespace ADD VALUE IF NOT EXISTS 'portal-editorial';
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 1 · tables
-- ---------------------------------------------------------------------------------------------
CREATE TABLE portal.editorial_draft (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  schema_version integer NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  CONSTRAINT editorial_draft_project_key UNIQUE (tenant_id, project_id),
  CONSTRAINT editorial_draft_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT editorial_draft_revision_positive CHECK (revision >= 1),
  CONSTRAINT editorial_draft_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES app.project (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT editorial_draft_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app."user" (id)
);
--> statement-breakpoint

CREATE TABLE portal.editorial_publication (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  tenant_slug text NOT NULL,
  project_slug text NOT NULL,
  sequence integer NOT NULL,
  published_at timestamptz NOT NULL,
  published_by uuid NOT NULL,
  schema_version integer NOT NULL,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT editorial_publication_project_sequence_key UNIQUE (tenant_id, project_id, sequence),
  CONSTRAINT editorial_publication_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT editorial_publication_sequence_positive CHECK (sequence >= 1),
  CONSTRAINT editorial_publication_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES app.project (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT editorial_publication_published_by_fk FOREIGN KEY (published_by) REFERENCES app."user" (id)
);
--> statement-breakpoint

CREATE INDEX editorial_publication_public_lookup
  ON portal.editorial_publication (tenant_slug, project_slug, sequence DESC);
--> statement-breakpoint

CREATE TABLE portal.editorial_publication_asset (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  stored_object_id uuid NOT NULL,
  role text NOT NULL,
  caption text,
  alt_text text,
  ordinal integer NOT NULL,
  /*
   * Copied from `stored_object` at publication, so the public read touches **only** this schema.
   * The alternative was a public branch on `app.stored_object`, which would have opened a table
   * holding every delivered file and every field photograph in order to serve three columns.
   */
  object_key text NOT NULL,
  original_filename text,
  mime_type text,
  CONSTRAINT editorial_publication_asset_unique UNIQUE (tenant_id, publication_id, stored_object_id),
  CONSTRAINT editorial_publication_asset_role_known CHECK (role IN ('photo', 'document', 'slides')),
  -- A photograph on a public page without alternative text is unreadable to somebody using a
  -- screen reader. The schema asks for it; this makes it impossible to store without it.
  CONSTRAINT editorial_publication_asset_photo_alt CHECK (
    role <> 'photo' OR (alt_text IS NOT NULL AND btrim(alt_text) <> '')
  ),
  CONSTRAINT editorial_publication_asset_publication_fk FOREIGN KEY (tenant_id, publication_id)
    REFERENCES portal.editorial_publication (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT editorial_publication_asset_object_fk FOREIGN KEY (tenant_id, stored_object_id)
    REFERENCES app.stored_object (tenant_id, id)
);
--> statement-breakpoint

CREATE TABLE portal.editorial_visibility_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  state text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid NOT NULL,
  reason text,
  CONSTRAINT editorial_visibility_event_state_known CHECK (state IN ('PUBLISHED', 'WITHDRAWN')),
  -- Withdrawing is a decision somebody takes about what a client can see, so it is explained.
  CONSTRAINT editorial_visibility_event_reason CHECK (
    state <> 'WITHDRAWN' OR (reason IS NOT NULL AND length(btrim(reason)) >= 8)
  ),
  CONSTRAINT editorial_visibility_event_publication_fk FOREIGN KEY (tenant_id, publication_id)
    REFERENCES portal.editorial_publication (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT editorial_visibility_event_decided_by_fk FOREIGN KEY (decided_by) REFERENCES app."user" (id)
);
--> statement-breakpoint

CREATE INDEX editorial_visibility_event_latest
  ON portal.editorial_visibility_event (tenant_id, publication_id, occurred_at DESC);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · what, if anything, is public for this project right now?
--
-- Keyed on the **project**, not on the publication, and that is the whole substance of it. The
-- first version asked "has this version been withdrawn?", which meant withdrawing v2 made v1 —
-- published months earlier and never withdrawn — the live page again. A consultancy that takes
-- its page down does not mean "show the previous one".
--
-- So one event stream per project decides: the latest event names the publication that is public,
-- and a `WITHDRAWN` event means nothing is.
--
-- SECURITY DEFINER with a fixed search_path, owned by `eia_policy`, no dynamic SQL, EXECUTE
-- revoked from PUBLIC: the same discipline as every other privileged helper here (ADR-004,
-- IG0-B01). Definer-rights because it is called from a policy on the table it would otherwise
-- read through, and an invoker-rights function there recurses.
-- ---------------------------------------------------------------------------------------------
-- The definer role owns functions in `app`, not in `portal`, so it needs the schema as well as
-- the table: a SECURITY DEFINER function runs as its owner and fails on USAGE otherwise.
GRANT USAGE ON SCHEMA portal TO eia_policy;
--> statement-breakpoint
GRANT SELECT ON portal.editorial_visibility_event TO eia_policy;
--> statement-breakpoint

CREATE FUNCTION portal.visible_editorial_publication(p_tenant uuid, p_project uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT CASE WHEN e.state = 'PUBLISHED' THEN e.publication_id END
    FROM portal.editorial_visibility_event e
   WHERE e.tenant_id = p_tenant AND e.project_id = p_project
   ORDER BY e.occurred_at DESC, e.id DESC
   LIMIT 1;
$$;
--> statement-breakpoint
ALTER FUNCTION portal.visible_editorial_publication(uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION portal.visible_editorial_publication(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION portal.visible_editorial_publication(uuid, uuid) TO eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2b · grants
--
-- `portal` has no `ALTER DEFAULT PRIVILEGES`, so a new table there arrives with nothing granted —
-- the opposite of `app`, where 0002 hands out full DML and only an explicit REVOKE narrows it.
-- Each table therefore gets exactly the verbs it needs, and the three write-once ones get no
-- UPDATE or DELETE to revoke later.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON portal.editorial_draft TO eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON portal.editorial_publication TO eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON portal.editorial_publication_asset TO eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON portal.editorial_visibility_event TO eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · row level security
-- ---------------------------------------------------------------------------------------------
ALTER TABLE portal.editorial_draft ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_draft FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_publication ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_publication FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_publication_asset ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_publication_asset FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_visibility_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_visibility_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The draft has **no public branch**. A visitor never reaches an unpublished page, and the
-- absence of a policy is what guarantees it rather than a condition somebody could get wrong.
CREATE POLICY editorial_draft_rw ON portal.editorial_draft FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

CREATE POLICY editorial_publication_internal ON portal.editorial_publication FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- The public branch. SELECT only, and a row qualifies because it is visible — not because the
-- caller named a tenant. A forged `app.tenant_id` buys nothing here, because this policy does not
-- read one.
CREATE POLICY editorial_publication_public ON portal.editorial_publication FOR SELECT TO eia_app
  USING (current_setting('app.surface', true) = 'public'
         AND id = portal.visible_editorial_publication(tenant_id, project_id));
--> statement-breakpoint

CREATE POLICY editorial_publication_asset_internal ON portal.editorial_publication_asset FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

CREATE POLICY editorial_publication_asset_public ON portal.editorial_publication_asset FOR SELECT TO eia_app
  USING (current_setting('app.surface', true) = 'public'
         AND publication_id = portal.visible_editorial_publication(tenant_id, project_id));
--> statement-breakpoint

CREATE POLICY editorial_visibility_event_internal ON portal.editorial_visibility_event FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · what is written once stays written
--
-- The grants above already withhold UPDATE and DELETE, so these REVOKEs change nothing today.
-- They are kept because `portal` could gain an `ALTER DEFAULT PRIVILEGES` later the way `app`
-- has one, and on that day the narrow GRANT would stop being the thing that holds (ADR-020's
-- lesson, applied before it bites). The trigger is the half that does not depend on either: the
-- owning role is not stopped by a revoke.
-- ---------------------------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON portal.editorial_publication FROM eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON portal.editorial_publication_asset FROM eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON portal.editorial_visibility_event FROM eia_app;
--> statement-breakpoint

CREATE FUNCTION portal.editorial_write_once() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is write-once: a published page keeps its words, and withdrawing is a new event',
    TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER editorial_publication_no_change BEFORE UPDATE OR DELETE ON portal.editorial_publication
  FOR EACH ROW EXECUTE FUNCTION portal.editorial_write_once();
--> statement-breakpoint
CREATE TRIGGER editorial_publication_asset_no_change BEFORE UPDATE OR DELETE ON portal.editorial_publication_asset
  FOR EACH ROW EXECUTE FUNCTION portal.editorial_write_once();
--> statement-breakpoint
CREATE TRIGGER editorial_visibility_event_no_change BEFORE UPDATE OR DELETE ON portal.editorial_visibility_event
  FOR EACH ROW EXECUTE FUNCTION portal.editorial_write_once();
