-- A firm's public profile gets a revision that actually counts (Visión Ambiental, 2.3).
--
-- Hand-written and additive: one column with a default, no backfill, no data moved.
--
-- ## What was wrong
--
-- `portal.editorial_tenant_profile` had no revision of its own. The read model derived one from
-- existence — `0` when absent, `1` when present — and the write compared against that. Once the
-- row existed the value never changed again, so every administrator read `1` and every save
-- matched. Two people editing the same landing both passed the check and the second silently
-- overwrote the first, which is precisely the outcome optimistic concurrency exists to prevent.
--
-- ## Why DEFAULT 1 rather than 0
--
-- A row that already exists has been written once. `0` in this model means *there is no profile*,
-- and the read returns it only when no row comes back; a stored `0` would make an existing
-- profile indistinguishable from an absent one for every caller that compares the two.
--
-- ## What enforces it
--
-- Not this column on its own — a column cannot stop a lost update. The write is a single
-- conditional statement, `UPDATE … WHERE tenant_id = ? AND revision = ? RETURNING revision`, so
-- the comparison and the write are one atomic operation and the loser of a race updates zero
-- rows. Creation is `INSERT … ON CONFLICT (tenant_id) DO NOTHING RETURNING revision`, so two
-- first saves cannot both succeed. The UNIQUE on `tenant_id` already existed and is what makes
-- that conflict clause meaningful.
--
-- No policy, grant or trigger changes: the table keeps the RLS it was created with in 0053.

ALTER TABLE portal.editorial_tenant_profile
  ADD COLUMN revision integer NOT NULL DEFAULT 1;

-- A revision counts upwards from the first write. Zero is reserved for "no profile", which is a
-- read-model value and never a stored one.
ALTER TABLE portal.editorial_tenant_profile
  ADD CONSTRAINT editorial_tenant_profile_revision_positive CHECK (revision >= 1);

COMMENT ON COLUMN portal.editorial_tenant_profile.revision IS
  'Optimistic concurrency. Incremented by the conditional UPDATE that writes the row; a caller holding an older value updates no rows and is told so.';
