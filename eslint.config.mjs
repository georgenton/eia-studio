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
    // Tests and scripts may use console output.
    files: [
      "**/*.test.ts",
      "**/test/**/*.ts",
      "tooling/**/*.mjs",
      "packages/db/scripts/**/*.{ts,mjs}",
    ],
    rules: { "no-console": "off" },
  },
];
