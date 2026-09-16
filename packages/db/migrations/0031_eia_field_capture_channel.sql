-- EIA Field becomes a capture channel the database knows about (Production V1, Wave 1).
--
-- Additive and forward-only: one value on an existing enum. Nothing is rewritten, no row changes,
-- and every existing campaign keeps `NATIVE_WEB`. The rollback, if one were ever wanted, is a new
-- migration — PostgreSQL does not remove an enum value, which is the usual reason to prefer a
-- lookup table; this vocabulary is a closed domain concept mirrored from `@eia/domain` and
-- asserted identical by a test, so the enum is the right shape and its immutability is a feature.
ALTER TYPE "app"."field_capture_channel" ADD VALUE IF NOT EXISTS 'EIA_FIELD_MOBILE';
