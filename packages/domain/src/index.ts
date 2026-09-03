// Public API of the domain package: pure rules and types only.
// It must not depend on @eia/db, Drizzle, pg or any persistence adapter (ADR-015); the boundary
// is enforced by ESLint and by packages/domain/test/purity.test.ts.
export * from "./core/index";
export * from "./provenance/index";
export * from "./projects/index";
export * from "./core/config/registry";
export * from "./field/index";
export * from "./social/index";
export * from "./quality/index";
export * from "./gis/index";
export * from "./audit/index";
