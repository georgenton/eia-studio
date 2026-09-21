import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import {
  baseConfig,
  domainBoundariesConfig,
  domainPurityConfig,
  ignores,
} from "@eia/config/eslint";

export default [
  ignores,
  ...baseConfig,
  domainBoundariesConfig,
  domainPurityConfig,
  {
    // Next.js app: React hooks and Next rules; route/page files may import the web lib only.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
    },
    settings: { next: { rootDir: "apps/web" } },
  },
  {
    // Pages, layouts and route handlers never touch the database or Better Auth directly;
    // they go through apps/web/lib (context builder, identity port, thin actions).
    files: ["apps/web/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@eia/db", "@eia/db/*"],
              message: "Use apps/web/lib instead of @eia/db in routes.",
            },
            {
              group: ["better-auth", "better-auth/*"],
              message: "Use apps/web/lib/identity instead.",
            },
            { group: ["@eia/*/src/*"], message: "Public entry points only." },
          ],
        },
      ],
    },
  },
  {
    /*
     * EIA Field is a React Native application, not a Next.js one.
     *
     * Two of its files are CommonJS by requirement rather than by choice: Metro and Babel load
     * `metro.config.js` and `babel.config.js` with `require`, before any bundler or transform is
     * involved, so they cannot be ES modules and cannot be typechecked as browser code.
     *
     * The same holds for `plugins/`: an Expo config plugin is `require`d by the config resolver
     * during prebuild, outside any bundler, so it is CommonJS for the same reason.
     */
    files: ["apps/field/*.config.js", "apps/field/plugins/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The mobile application never reaches the database or the application layer; its boundary is
    // the shared contract and the domain's platform-safe entry point, asserted by
    // `apps/field/test/bundle-safety.test.ts` as well as here.
    files: ["apps/field/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@eia/db", "@eia/db/*", "@eia/application", "@eia/application/*"],
              message: "EIA Field talks to the server over HTTP, never to the database.",
            },
          ],
          // Exact, not a pattern: `@eia/domain/mobile` is the entry this app must use, and a
          // prefix rule would forbid the very thing it is steering towards.
          paths: [
            {
              name: "@eia/domain",
              message:
                "Use @eia/domain/mobile: the barrel reaches node:crypto and cannot be bundled.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tests and scripts may use console output.
    files: [
      "**/*.test.ts",
      "**/test/**/*.ts",
      "tooling/**/*.mjs",
      "e2e/**/*.ts",
      "packages/*/scripts/**/*.{ts,mjs}",
      "apps/*/scripts/**/*.{ts,mjs}",
    ],
    rules: { "no-console": "off" },
  },
];
