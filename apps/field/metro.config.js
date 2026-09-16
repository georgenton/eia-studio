// Metro in a pnpm monorepo.
//
// Two settings do the work. `watchFolders` puts the repository root in scope so the workspace
// packages EIA Field imports (`@eia/domain`, `@eia/field-sync-contract`) are watched and
// transformed as source rather than resolved as published builds; `nodeModulesPaths` lets Metro
// follow pnpm's symlinked store upwards. Both are required by pnpm's strict layout — the default
// Metro resolver looks only inside the app directory.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// pnpm's symlinks are the point of pnpm; following them is how the workspace packages resolve.
config.resolver.unstable_enableSymlinks = true;
// Hierarchical lookup stays **on**, which is the opposite of the advice written for npm/yarn
// hoisted layouts. Under pnpm a package's own dependencies live beside it inside `.pnpm/<pkg>/
// node_modules`, so a resolver that only consults the two roots above cannot find, say,
// `invariant` for `react-native`. Disabling it fails on the first `require` React Native makes.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
