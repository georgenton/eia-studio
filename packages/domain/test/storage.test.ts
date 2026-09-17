import {
  ARCHIVE_LIMITS,
  assertArchiveWithinLimits,
  assertBytesMatchFormat,
  assertDeclaredUploadAllowed,
  assertObjectKeyBelongsTo,
  buildObjectKey,
  DOCUMENT_FORMATS,
  FIELD_MEDIA_FORMATS,
  formatForMimeType,
  InvalidInput,
  parseObjectKey,
  resolveStorageAvailability,
  UnsupportedUpload,
} from "../src/index";
import { describe, expect, it } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OBJECT = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

describe("what a storage key may contain", () => {
  it("is tenant, project, namespace and an id this product minted — and nothing else", () => {
    expect(
      buildObjectKey({
        tenantId: TENANT,
        projectId: PROJECT,
        namespace: "documents",
        objectId: OBJECT,
      }),
    ).toBe(`t/${TENANT}/p/${PROJECT}/documents/${OBJECT}`);
  });

  it("carries no filename, because a bucket listing is not where a person's name goes", () => {
    const key = buildObjectKey({
      tenantId: TENANT,
      projectId: PROJECT,
      namespace: "field-media",
      objectId: OBJECT,
    });
    expect(key).not.toMatch(/\.(pdf|docx|jpe?g|png)$/i);
    // The check that matters, stated the way the rule is: nothing in the key is a word.
    for (const segment of key.split("/")) {
      expect(segment, segment).toMatch(/^(t|p|documents|field-media|[0-9a-f-]{36})$/);
    }
  });

  it("refuses anything that is not an identifier", () => {
    for (const parts of [
      { tenantId: "not-a-uuid", projectId: PROJECT, objectId: OBJECT },
      { tenantId: TENANT, projectId: "../../etc", objectId: OBJECT },
      { tenantId: TENANT, projectId: PROJECT, objectId: "informe final.pdf" },
    ]) {
      expect(() => buildObjectKey({ ...parts, namespace: "documents" } as never)).toThrow(
        InvalidInput,
      );
    }
  });
});

describe("reading a key back", () => {
  const key = buildObjectKey({
    tenantId: TENANT,
    projectId: PROJECT,
    namespace: "documents",
    objectId: OBJECT,
  });

  it("returns what the server put in it", () => {
    expect(parseObjectKey(key)).toEqual({
      tenantId: TENANT,
      projectId: PROJECT,
      namespace: "documents",
      objectId: OBJECT,
    });
  });

  it("refuses traversal, extra segments and unknown namespaces", () => {
    for (const bad of [
      `t/${TENANT}/p/${PROJECT}/documents/${OBJECT}/../../other`,
      `t/${TENANT}/p/${PROJECT}/exports/${OBJECT}`,
      `t/${TENANT}/p/${PROJECT}/documents`,
      `../${key}`,
      "",
    ]) {
      expect(parseObjectKey(bad), bad).toBeNull();
    }
  });

  it("refuses a key from another tenant, project or namespace", () => {
    // The check RLS cannot make: nothing in the database knows what a bucket key means.
    expect(() =>
      assertObjectKeyBelongsTo(key, {
        tenantId: OTHER,
        projectId: PROJECT,
        namespace: "documents",
      }),
    ).toThrow(InvalidInput);
    expect(() =>
      assertObjectKeyBelongsTo(key, {
        tenantId: TENANT,
        projectId: OTHER,
        namespace: "documents",
      }),
    ).toThrow(InvalidInput);
    expect(() =>
      assertObjectKeyBelongsTo(key, {
        tenantId: TENANT,
        projectId: PROJECT,
        namespace: "field-media",
      }),
    ).toThrow(InvalidInput);
    expect(
      assertObjectKeyBelongsTo(key, {
        tenantId: TENANT,
        projectId: PROJECT,
        namespace: "documents",
      }).objectId,
    ).toBe(OBJECT);
  });
});

describe("what a surface accepts", () => {
  it("maps a declared type to a format, and refuses one it does not know", () => {
    expect(formatForMimeType("application/pdf")).toBe("pdf");
    expect(formatForMimeType("APPLICATION/PDF; charset=binary")).toBe("pdf");
    expect(formatForMimeType("application/x-msdownload")).toBeNull();
    expect(formatForMimeType("text/csv")).toBeNull();
  });

  it("accepts a PDF as a document and refuses it as field media", () => {
    const declared = { filename: "informe.pdf", mimeType: "application/pdf", sizeBytes: 1024 };
    expect(assertDeclaredUploadAllowed({ ...declared, allowed: DOCUMENT_FORMATS }).format).toBe(
      "pdf",
    );
    expect(() =>
      assertDeclaredUploadAllowed({ ...declared, allowed: FIELD_MEDIA_FORMATS }),
    ).toThrow(UnsupportedUpload);
  });

  it("refuses a name and a type that disagree", () => {
    expect(() =>
      assertDeclaredUploadAllowed({
        filename: "informe.exe",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        allowed: DOCUMENT_FORMATS,
      }),
    ).toThrow(UnsupportedUpload);
  });

  it("refuses a size that is impossible or beyond the format's limit", () => {
    for (const sizeBytes of [0, -1, 1.5, 500 * 1024 * 1024]) {
      expect(
        () =>
          assertDeclaredUploadAllowed({
            filename: "informe.pdf",
            mimeType: "application/pdf",
            sizeBytes,
            allowed: DOCUMENT_FORMATS,
          }),
        String(sizeBytes),
      ).toThrow(UnsupportedUpload);
    }
  });
});

describe("what the bytes actually are", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  // `MZ`, the DOS header every Windows executable begins with.
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

  it("accepts a PDF that is one", () => {
    expect(() => assertBytesMatchFormat(pdf, "pdf")).not.toThrow();
  });

  it("refuses an executable renamed .pdf — the case this check exists for", () => {
    expect(() => assertBytesMatchFormat(exe, "pdf")).toThrow(UnsupportedUpload);
  });

  it("refuses a file too short to be what it claims", () => {
    expect(() => assertBytesMatchFormat(new Uint8Array([0x25]), "pdf")).toThrow(UnsupportedUpload);
  });

  it("knows a DOCX is a ZIP, and a JPEG is not", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(() => assertBytesMatchFormat(zip, "docx")).not.toThrow();
    expect(() => assertBytesMatchFormat(zip, "jpeg")).toThrow(UnsupportedUpload);
  });
});

describe("a container has to stay a document's size", () => {
  it("accepts an ordinary archive", () => {
    expect(() =>
      assertArchiveWithinLimits({
        entries: 24,
        compressedBytes: 40_000,
        uncompressedBytes: 600_000,
      }),
    ).not.toThrow();
  });

  it("refuses one that expands far beyond its size", () => {
    // 40 KB → 1 GB is not a malformed file; it is the format doing what it allows.
    expect(() =>
      assertArchiveWithinLimits({
        entries: 3,
        compressedBytes: 40_000,
        uncompressedBytes: 1024 * 1024 * 1024,
      }),
    ).toThrow(UnsupportedUpload);
  });

  it("refuses one with more parts than a document has", () => {
    expect(() =>
      assertArchiveWithinLimits({
        entries: ARCHIVE_LIMITS.maxEntries + 1,
        compressedBytes: 1_000_000,
        uncompressedBytes: 2_000_000,
      }),
    ).toThrow(UnsupportedUpload);
  });
});

describe("whether a file can be stored here at all", () => {
  const configured = {
    provider: "s3",
    bucket: "eia",
    region: "auto",
    endpoint: "http://localhost:9000",
    credentialsPresent: true,
  } as const;

  it("is unavailable when nothing is configured, and says so without being an outage", () => {
    const outcome = resolveStorageAvailability({
      appEnv: "staging",
      ...configured,
      provider: undefined,
    });
    expect(outcome).toMatchObject({ state: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
  });

  // The failure this prevents: `STORAGE_PROVIDR=s3` reading as "unset" and sending an operator to
  // look at a variable they had, in fact, set.
  it("names a provider it does not recognise rather than calling the variable unset", () => {
    const outcome = resolveStorageAvailability({
      appEnv: "staging",
      ...configured,
      provider: "s3x",
    });
    expect(outcome.state).toBe("UNAVAILABLE");
    if (outcome.state !== "UNAVAILABLE") return;
    expect(outcome.reason).toBe("NOT_CONFIGURED");
    expect(outcome.detail).toContain("s3x");
  });

  it("allows the in-memory store only where a process exiting loses nothing that matters", () => {
    for (const appEnv of ["local", "test"]) {
      expect(resolveStorageAvailability({ ...configured, appEnv, provider: "memory" })).toEqual({
        state: "AVAILABLE",
        provider: "memory",
        live: false,
      });
    }
    // Every other value is persistent, including a misspelt one: a typo loses file storage rather
    // than gaining a store whose contents vanish with the deployment.
    for (const appEnv of ["staging", "production", "stagin"]) {
      expect(
        resolveStorageAvailability({ ...configured, appEnv, provider: "memory" }),
      ).toMatchObject({
        state: "UNAVAILABLE",
        reason: "MEMORY_REFUSED_IN_PERSISTENT_ENVIRONMENT",
      });
    }
  });

  it("refuses a half-configured provider and names every variable that is missing", () => {
    const outcome = resolveStorageAvailability({
      appEnv: "staging",
      provider: "s3",
      bucket: undefined,
      region: undefined,
      endpoint: undefined,
      credentialsPresent: false,
    });
    expect(outcome.state).toBe("UNAVAILABLE");
    if (outcome.state !== "UNAVAILABLE") return;
    expect(outcome.reason).toBe("BLOCKED_EXTERNAL_CONFIG");
    expect(outcome.detail).toContain("STORAGE_BUCKET");
    expect(outcome.detail).toContain("STORAGE_REGION");
    expect(outcome.detail).toContain("STORAGE_ACCESS_KEY_ID");
    // Never the credential itself — this text is operator-facing and reaches logs.
    expect(outcome.detail).not.toContain("auto");
  });

  // AWS itself needs no endpoint; MinIO and R2 do. A missing endpoint is therefore not a missing
  // variable, and the resolver must not treat it as one.
  it("is available for a fully configured provider, with or without an endpoint", () => {
    expect(resolveStorageAvailability({ appEnv: "production", ...configured })).toEqual({
      state: "AVAILABLE",
      provider: "s3",
      live: true,
    });
    expect(
      resolveStorageAvailability({ appEnv: "production", ...configured, endpoint: undefined }),
    ).toEqual({ state: "AVAILABLE", provider: "s3", live: true });
  });
});
