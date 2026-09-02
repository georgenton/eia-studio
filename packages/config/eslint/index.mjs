// Shared ESLint (flat config) building blocks for the EIA Studio monorepo.
// One linter (ESLint + typescript-eslint), one formatter (Prettier). Formatting rules are
// disabled here so the two tools never overlap.
import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/** Domain modules under packages/domain/src/<module>; each exposes a public index.ts. */
export const DOMAIN_MODULES = [
  "core",
  "provenance",
  "audit",
  "projects",
  "documents",
  "gis",
  "field",
  "social",
  "quality",
  "reports",
  "client-portal",
  "ai",
];

/** Allowed dependency direction between domain modules (ARCHITECTURE.md §2). */
const DOMAIN_MODULE_DEPENDENCIES = {
  core: [],
  provenance: ["core"],
  audit: ["core"],
  projects: ["core", "provenance", "audit"],
  documents: ["core", "projects", "provenance"],
  gis: ["core", "projects", "provenance"],
  field: ["core", "projects", "gis", "provenance"],
  social: ["core", "projects", "field", "ai", "provenance"],
  quality: ["core", "projects", "documents", "gis", "field", "social", "provenance"],
  reports: ["core", "projects", "documents", "social", "quality", "ai", "provenance"],
  "client-portal": ["core", "projects", "provenance"],
  ai: ["core", "provenance"],
};

const NODE_GLOBALS = {
  console: "readonly",
  process: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  fetch: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
};

export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: NODE_GLOBALS },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@eia/*/src/*", "@eia/*/dist/*"],
              message: "Import workspace packages through their public entry point only.",
            },
          ],
        },
      ],
    },
  },
);

const element = (type) => ({ element: { type } });

/** Boundaries between domain modules: only public index files, only declared dependencies. */
export const domainBoundariesConfig = {
  files: ["packages/domain/src/**/*.ts"],
  plugins: { boundaries },
  settings: {
    "boundaries/elements": DOMAIN_MODULES.map((name) => ({
      type: name,
      pattern: `packages/domain/src/${name}/**`,
    })),
    "boundaries/ignore": ["packages/domain/src/index.ts"],
  },
  rules: {
    "boundaries/dependencies": [
      "error",
      {
        default: "disallow",
        policies: Object.entries(DOMAIN_MODULE_DEPENDENCIES).map(([from, allow]) => ({
          from: [element(from)],
          allow: [from, ...allow].map((type) => ({ to: element(type) })),
        })),
      },
    ],
    "boundaries/entry-point": [
      "error",
      {
        default: "disallow",
        policies: [{ target: DOMAIN_MODULES.map((type) => element(type)), allow: "index.ts" }],
      },
    ],
  },
};

/**
 * ADR-015 / IG0-B02: the domain package is pure. It may not import persistence adapters, an ORM
 * or a driver, and may not depend on the application layer. Mirrored by
 * packages/domain/test/purity.test.ts so the boundary also fails the unit suite.
 */
export const domainPurityConfig = {
  files: ["packages/domain/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@eia/db",
            message: "packages/domain is pure: use @eia/application for persistence.",
          },
          {
            name: "@eia/application",
            message: "The domain must not depend on the application layer.",
          },
          { name: "drizzle-orm", message: "packages/domain is pure: no ORM imports." },
          { name: "pg", message: "packages/domain is pure: no driver imports." },
          {
            name: "better-auth",
            message: "packages/domain is pure: identity lives behind IdentityPort.",
          },
        ],
        patterns: [
          {
            group: ["@eia/db/*", "drizzle-orm/*", "better-auth/*"],
            message: "packages/domain is pure.",
          },
        ],
      },
    ],
  },
};

export const ignores = {
  ignores: [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "**/.turbo/**",
    "design/**",
    "pnpm-lock.yaml",
    "**/next-env.d.ts",
    // Vendored third-party bundles copied into /public by a build step (the MapLibre worker).
    "apps/*/public/vendor/**",
  ],
};
