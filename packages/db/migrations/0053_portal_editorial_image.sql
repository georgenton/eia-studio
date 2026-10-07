-- A published photograph is a derivative, and the original stays private (Visión Ambiental, 2.1).
--
-- Hand-written, because grants, policies and triggers are reviewed SQL (ADR-013).
--
-- The row below is what makes "never serve the original" checkable rather than intended: the
-- publishing path refuses a `role = 'photo'` asset whose object is not the derivative side of one
-- of these pairs. Keeping the link also answers the audit question — *which upload is this
-- published picture?* — without putting the original anywhere a visitor can reach.
--
-- Nothing here touches `field-media`. A technician's photograph is evidence and keeps its EXIF
-- exactly as the camera wrote it (ADR-032); this is a different file with a different purpose.

CREATE TABLE portal.editorial_image_derivative (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  /** What somebody uploaded. Private: it is never referenced by a publication. */
  original_object_id uuid NOT NULL,
  /** What a visitor may be served: new bytes, no metadata that was not written by the encoder. */
  derivative_object_id uuid NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT editorial_image_derivative_original_key UNIQUE (tenant_id, original_object_id),
  CONSTRAINT editorial_image_derivative_derivative_key UNIQUE (tenant_id, derivative_object_id),
  CONSTRAINT editorial_image_derivative_distinct CHECK (original_object_id <> derivative_object_id),
  CONSTRAINT editorial_image_derivative_dimensions CHECK (width > 0 AND height > 0),
  CONSTRAINT editorial_image_derivative_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES app.project (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT editorial_image_derivative_original_fk FOREIGN KEY (tenant_id, original_object_id)
    REFERENCES app.stored_object (tenant_id, id),
  CONSTRAINT editorial_image_derivative_derivative_fk FOREIGN KEY (tenant_id, derivative_object_id)
    REFERENCES app.stored_object (tenant_id, id),
  CONSTRAINT editorial_image_derivative_created_by_fk FOREIGN KEY (created_by) REFERENCES app."user" (id)
);
--> statement-breakpoint

GRANT SELECT, INSERT ON portal.editorial_image_derivative TO eia_app;
--> statement-breakpoint

ALTER TABLE portal.editorial_image_derivative ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_image_derivative FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Internal only, and deliberately **no public branch**: a visitor is served the derivative
-- through the publication's own asset row, and has no business knowing an original exists.
CREATE POLICY editorial_image_derivative_internal ON portal.editorial_image_derivative FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

CREATE TRIGGER editorial_image_derivative_no_change
  BEFORE UPDATE OR DELETE ON portal.editorial_image_derivative
  FOR EACH ROW EXECUTE FUNCTION portal.editorial_write_once();

--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- The firm's own name on its landing page
--
-- Two columns, because the engagement is a *title* and this product has no entity between a
-- tenant and a project. Inventing a "programme" to hold a heading would be a schema change in
-- service of a string.
--
-- The slug is carried here for the same reason a publication carries one: a visitor has no
-- session, so the public read must not join `app.tenant` to turn a URL into a row. The public
-- branch is SELECT only and admits a profile **only when that firm has something visible** —
-- otherwise a tenant slug would be an oracle for which consultancies exist.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE portal.editorial_tenant_profile (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE,
  tenant_slug text NOT NULL UNIQUE,
  name text NOT NULL,
  engagement_label text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  CONSTRAINT editorial_tenant_profile_name_present CHECK (btrim(name) <> ''),
  CONSTRAINT editorial_tenant_profile_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES app.tenant (id) ON DELETE CASCADE,
  CONSTRAINT editorial_tenant_profile_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app."user" (id)
);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON portal.editorial_tenant_profile TO eia_app;
--> statement-breakpoint
GRANT SELECT ON portal.editorial_publication TO eia_policy;
--> statement-breakpoint

ALTER TABLE portal.editorial_tenant_profile ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.editorial_tenant_profile FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY editorial_tenant_profile_internal ON portal.editorial_tenant_profile FOR ALL TO eia_app
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint

-- Does this firm have anything a visitor may see? Definer-rights for the same reason as its
-- sibling: it is read from a policy, and it must see publications the caller cannot.
CREATE FUNCTION portal.tenant_has_visible_editorial(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM portal.editorial_publication p
     WHERE p.tenant_id = p_tenant
       AND p.id = portal.visible_editorial_publication(p.tenant_id, p.project_id));
$$;
--> statement-breakpoint
ALTER FUNCTION portal.tenant_has_visible_editorial(uuid) OWNER TO eia_policy;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION portal.tenant_has_visible_editorial(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION portal.tenant_has_visible_editorial(uuid) TO eia_app;
--> statement-breakpoint

CREATE POLICY editorial_tenant_profile_public ON portal.editorial_tenant_profile FOR SELECT TO eia_app
  USING (current_setting('app.surface', true) = 'public'
         AND portal.tenant_has_visible_editorial(tenant_id));
