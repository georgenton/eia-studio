import { describe, expect, it } from "vitest";

import { resolveTrustedOrigins, vercelHosts } from "../lib/trusted-origins";

/**
 * Which origins may post to `/api/auth`.
 *
 * The regression that produced this file: a Vercel deployment answers on two hostnames — its
 * immutable per-deployment URL and its per-branch alias — and only the one the base URL happened to
 * be derived from was trusted, so a reviewer opening the other got
 * `403 Invalid origin` on sign-in.
 *
 * The property under test is narrow on purpose: **this deployment's own origins, and nothing
 * else**. Sharing a suffix with a trusted origin buys a stranger nothing, because no pattern is
 * ever matched — every entry is a literal origin that either we configured or the platform handed
 * to this process as our own hostname.
 */
const DEPLOYMENT = "eia-studio-example123.vercel.app";
const BRANCH = "eia-studio-web-git-main-example.vercel.app";

const base = {
  configured: [] as string[],
  baseURL: `https://${BRANCH}`,
  publicAppUrl: `https://${BRANCH}`,
  vercel: {},
  appEnv: "preview" as const,
};

describe("trusted origins on a Vercel deployment", () => {
  it("trusts the deployment origin, which is the one the browser is actually on", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      vercel: { deploymentHost: DEPLOYMENT, branchHost: BRANCH },
    });
    expect(origins).toContain(`https://${DEPLOYMENT}`);
  });

  it("trusts the branch alias too, because a reviewer may arrive on either", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      vercel: { deploymentHost: DEPLOYMENT, branchHost: BRANCH },
    });
    expect(origins).toContain(`https://${BRANCH}`);
  });

  it("trusts the project's production hostname when the platform names one", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      vercel: { deploymentHost: DEPLOYMENT, productionHost: "eia-studio.example.com" },
    });
    expect(origins).toContain("https://eia-studio.example.com");
  });

  it("does not trust a foreign origin merely for ending in .vercel.app", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      vercel: { deploymentHost: DEPLOYMENT, branchHost: BRANCH },
    });
    expect(origins).not.toContain("https://attacker-project.vercel.app");
    // …and no entry is a pattern that could match one.
    for (const origin of origins) expect(origin).not.toContain("*");
  });

  it("keeps explicitly configured origins, and puts intent first", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      configured: ["https://staging.eia.example"],
      vercel: { deploymentHost: DEPLOYMENT },
    });
    expect(origins[0]).toBe("https://staging.eia.example");
    expect(origins).toContain(`https://${DEPLOYMENT}`);
  });

  it("deduplicates, including when the base URL is one of the platform hosts", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      baseURL: `https://${BRANCH}`,
      publicAppUrl: `https://${BRANCH}`,
      configured: [`https://${BRANCH}`],
      vercel: { deploymentHost: DEPLOYMENT, branchHost: BRANCH },
    });
    expect(origins.filter((o) => o === `https://${BRANCH}`)).toHaveLength(1);
    expect(new Set(origins).size).toBe(origins.length);
  });
});

describe("malformed and hostile input", () => {
  it("never produces https://undefined from a missing variable", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      vercel: { deploymentHost: undefined, branchHost: "undefined" },
    });
    expect(origins.join(" ")).not.toMatch(/undefined|null/);
    for (const origin of origins) expect(() => new URL(origin)).not.toThrow();
  });

  it("drops an empty or whitespace host rather than guessing", () => {
    const origins = resolveTrustedOrigins({ ...base, vercel: { deploymentHost: "   " } });
    expect(origins).toEqual([`https://${BRANCH}`]);
  });

  it("refuses a platform host that is not purely a host", () => {
    for (const host of [
      "https://evil.example",
      "eia.example/path",
      "user:pass@eia.example",
      "eia.example evil.example",
      "*.vercel.app",
      "eia.example\\@evil.example",
    ]) {
      const origins = resolveTrustedOrigins({ ...base, vercel: { deploymentHost: host } });
      expect(origins, host).toEqual([`https://${BRANCH}`]);
    }
  });

  it("drops configured entries that are not usable origins", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      configured: ["not a url", "ftp://eia.example", "https://user:pw@eia.example", ""],
    });
    expect(origins).toEqual([`https://${BRANCH}`]);
  });

  it("reduces a configured URL with a path to its origin", () => {
    const origins = resolveTrustedOrigins({
      ...base,
      configured: ["https://eia.example/some/path?q=1"],
    });
    expect(origins).toContain("https://eia.example");
    expect(origins.join(" ")).not.toContain("/some/path");
  });
});

describe("loopback origins belong to development only", () => {
  const local = {
    configured: ["http://localhost:3000"],
    baseURL: "http://localhost:3000",
    publicAppUrl: "http://localhost:3000",
    vercel: {},
  };

  it("are accepted in local and test", () => {
    for (const appEnv of ["local", "test"] as const) {
      expect(resolveTrustedOrigins({ ...local, appEnv })).toContain("http://localhost:3000");
    }
    expect(
      resolveTrustedOrigins({
        ...local,
        configured: ["http://127.0.0.1:3100"],
        baseURL: "http://127.0.0.1:3100",
        publicAppUrl: "http://127.0.0.1:3100",
        appEnv: "test",
      }),
    ).toContain("http://127.0.0.1:3100");
  });

  it("are refused in preview, staging and production even if configured", () => {
    // A deployed environment that still carried localhost in its configuration would be trusting
    // any process on a reviewer's machine. Dropping it is not politeness; it is the boundary.
    for (const appEnv of ["preview", "staging", "production"] as const) {
      const origins = resolveTrustedOrigins({
        ...local,
        baseURL: `https://${BRANCH}`,
        publicAppUrl: `https://${BRANCH}`,
        vercel: { deploymentHost: DEPLOYMENT },
        appEnv,
      });
      expect(origins, appEnv).not.toContain("http://localhost:3000");
      expect(origins, appEnv).toContain(`https://${DEPLOYMENT}`);
    }
  });
});

describe("reading the platform environment", () => {
  it("takes the hostnames Vercel actually sets, and interprets nothing", () => {
    expect(
      vercelHosts({
        VERCEL_URL: DEPLOYMENT,
        VERCEL_BRANCH_URL: BRANCH,
        VERCEL_PROJECT_PRODUCTION_URL: "eia.example",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({
      deploymentHost: DEPLOYMENT,
      branchHost: BRANCH,
      productionHost: "eia.example",
    });
  });

  it("returns undefined where the platform sets nothing", () => {
    expect(vercelHosts({} as unknown as NodeJS.ProcessEnv)).toEqual({
      deploymentHost: undefined,
      branchHost: undefined,
      productionHost: undefined,
    });
  });
});

describe("the reported failure, reproduced", () => {
  it("the deployment that returned 403 would now be trusted", () => {
    // The exact pair from the incident: the base URL derived from the branch alias, the browser on
    // the immutable deployment URL.
    const origins = resolveTrustedOrigins({
      configured: [],
      baseURL: "https://eia-studio-web-git-main-georgentons-projects.vercel.app",
      publicAppUrl: "https://eia-studio-web-git-main-georgentons-projects.vercel.app",
      vercel: {
        deploymentHost: "eia-studio-5ftqg28xs-georgentons-projects.vercel.app",
        branchHost: "eia-studio-web-git-main-georgentons-projects.vercel.app",
      },
      appEnv: "preview",
    });
    expect(origins).toContain("https://eia-studio-5ftqg28xs-georgentons-projects.vercel.app");
    expect(origins).toContain("https://eia-studio-web-git-main-georgentons-projects.vercel.app");
  });
});
