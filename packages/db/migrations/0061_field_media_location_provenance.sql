-- What is known about a photograph's position attempt, beyond whether a point arrived.
--
-- The device has recorded four facts since its own migration 5 — how the attempt ended, when the
-- fix was obtained, whether the platform called the position **simulated**, and which provider
-- answered — and only the point, its accuracy and the fix's moment reached the server. The rest
-- lived on the handset until the row was acknowledged and swept, and then nowhere.
--
-- That mattered most for the one flag nobody can reconstruct afterwards: an emulator reports every
-- position as mocked, and a simulated point presented as a measurement is the worst thing this
-- evidence could become.
--
-- **Null means unknown**, in all three. A photograph declared by a build that predates this, or one
-- whose platform reported nothing, has nothing to say here — which is a different statement from
-- "there is no position", and that one is already carried by a null `location`. Nothing is derived
-- from the point, from `captured_at` or from `located_at` to fill these in; old rows stay silent.
--
-- Compatible by direction rather than by version: this payload travels device → server, and a
-- `.strict()` schema refuses *unknown* fields, not absent ones. An installed build simply does not
-- send them. The opposite direction — the Field Pack, a command result — is where a new field is a
-- parse error on a handset, and that is why those grow by version instead.
--
-- Additive and reversible: three `DROP COLUMN`s. No backfill, no policy change, no grant change;
-- `field_media` keeps its FORCE RLS and its policies, which name the table and not its columns.
ALTER TABLE "app"."field_media" ADD COLUMN "location_outcome" text;--> statement-breakpoint
ALTER TABLE "app"."field_media" ADD COLUMN "location_mocked" boolean;--> statement-breakpoint
ALTER TABLE "app"."field_media" ADD COLUMN "location_source" text;