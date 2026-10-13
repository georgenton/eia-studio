import { isAbsolute, resolve } from "node:path";

/**
 * Where a relative descriptor path is relative *to*.
 *
 * `pnpm --filter @eia/application gis:corridor-intake plan ./descriptor.json` does not run in the
 * directory the operator typed it in: pnpm moves to the package first, so `process.cwd()` is
 * `packages/application` and `./descriptor.json` quietly means a file nobody has. The invocation
 * directory survives as `INIT_CWD`, which pnpm and npm both set, so that is what a relative path
 * resolves against.
 *
 * Absolute paths are returned untouched, and a missing `INIT_CWD` — the script run directly rather
 * than through a package manager — falls back to the working directory, which is then correct.
 */
export function resolveDescriptorPath(
  given: string,
  env: { readonly INIT_CWD?: string | undefined },
  cwd: string,
): string {
  if (isAbsolute(given)) return given;
  const from = env.INIT_CWD !== undefined && env.INIT_CWD !== "" ? env.INIT_CWD : cwd;
  return resolve(from, given);
}
