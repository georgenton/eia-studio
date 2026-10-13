import { describe, expect, it } from "vitest";

import { resolveDescriptorPath } from "../scripts/resolve-descriptor-path";

/**
 * The bug this exists for: `pnpm --filter @eia/application gis:corridor-intake plan
 * ./descriptor.json` moved to the package directory first, so a path the operator typed from the
 * repository root resolved to `packages/application/descriptor.json` and the run died on ENOENT.
 */
const PKG = "/repo/packages/application";
const ROOT = "/repo";

describe("where a relative descriptor path is relative to", () => {
  it("resolves against the directory the operator invoked from, not the package", () => {
    expect(resolveDescriptorPath("./descriptor.json", { INIT_CWD: ROOT }, PKG)).toBe(
      "/repo/descriptor.json",
    );
  });

  it("handles a path with no leading dot the same way", () => {
    expect(resolveDescriptorPath("work/d.json", { INIT_CWD: ROOT }, PKG)).toBe("/repo/work/d.json");
  });

  it("walks up out of the invocation directory when asked", () => {
    expect(resolveDescriptorPath("../d.json", { INIT_CWD: "/repo/apps/web" }, PKG)).toBe(
      "/repo/apps/d.json",
    );
  });

  it("leaves an absolute path untouched", () => {
    expect(resolveDescriptorPath("/tmp/d.json", { INIT_CWD: ROOT }, PKG)).toBe("/tmp/d.json");
  });

  it("falls back to the working directory when INIT_CWD is absent", () => {
    // The script run directly rather than through a package manager: cwd is then the right answer.
    expect(resolveDescriptorPath("./d.json", {}, "/somewhere")).toBe("/somewhere/d.json");
  });

  it("treats an empty INIT_CWD as absent rather than as the filesystem root", () => {
    expect(resolveDescriptorPath("./d.json", { INIT_CWD: "" }, "/somewhere")).toBe(
      "/somewhere/d.json",
    );
  });
});
