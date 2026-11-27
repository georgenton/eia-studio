import {
  FIELD_MAP_SCHEMA_VERSION,
  FIELD_MAP_SCHEMA_VERSION_BASEMAP,
  FIELD_MAP_SCHEMA_VERSION_PARTS,
  fieldMapRequestSchema,
  fieldMapResponseSchema,
  fieldMapResponseV2Schema,
  fieldMapResponseV3Schema,
} from "../src/index";
import { describe, expect, it } from "vitest";

/**
 * Three released shapes, and the rule that a released one never changes.
 *
 * Every one of these schemas is `.strict()` and pins `schemaVersion` to a literal, which is what
 * makes a version a promise rather than a suggestion. The failure this file exists to prevent is
 * the one that nearly shipped: `referenceBasemap` was added to **version 2**, which was already
 * live on three servers. That breaks a client in both directions at once — it rejects the extra
 * key coming down, and it rejects a stored payload for lacking it. The second is the worse one,
 * because it demands a fresh download from somebody with no signal.
 */
const BASE = {
  projectName: "Capacitación Bramadora",
  generatedAt: "2026-11-27T03:00:00.000Z",
  provenance: {
    datasetVersionLabel: "alignment_intake_3ba567e478ea",
    origin: "imported",
    condition: "PRELIMINARY_DRAFT",
  },
  axis: null,
  chainageDeclared: false,
  milestones: [],
};
const RING = [
  [-78.6, -3.79],
  [-78.599, -3.79],
  [-78.599, -3.789],
  [-78.6, -3.789],
  [-78.6, -3.79],
];
const PARCEL_V1 = {
  assignmentId: "6f1f5f9e-7b0a-4f5e-9d6c-2b7d0f9a1c33",
  parcelCode: "101",
  chainageLabel: "4+572",
  side: "right",
  place: { kind: "polygon", ring: RING },
};
const PARCEL_V2 = {
  ...PARCEL_V1,
  place: { ...PARCEL_V1.place, parts: [{ outer: RING, holes: [] }] },
};

const v1 = { ...BASE, schemaVersion: 1, parcels: [PARCEL_V1] };
const v2 = { ...BASE, schemaVersion: 2, parcels: [PARCEL_V2] };
const v3 = { ...v2, schemaVersion: 3, referenceBasemap: null };

describe("the map resource's released versions", () => {
  it("numbers them distinctly, newest last", () => {
    expect([
      FIELD_MAP_SCHEMA_VERSION,
      FIELD_MAP_SCHEMA_VERSION_PARTS,
      FIELD_MAP_SCHEMA_VERSION_BASEMAP,
    ]).toEqual([1, 2, 3]);
  });

  it("A · a request with no version is valid, which is what an installed build sends", () => {
    const parsed = fieldMapRequestSchema.safeParse({
      tenantSlug: "demo-consultancy",
      projectSlug: "capacitacion-bramadora-la-alegria",
    });
    expect(parsed.success).toBe(true);
    expect(fieldMapResponseSchema.safeParse(v1).success).toBe(true);
  });

  it("A · a request carrying an unknown field is refused, which is why ordering matters", () => {
    /*
     * `.strict()` cuts both ways. An *optional* field is free to add — an old client simply does
     * not send it — but a server that predates the field **rejects** a request carrying it. That
     * makes the deployment order a requirement, not a preference: server first, application
     * after. A comment in `api.ts` used to claim the opposite.
     */
    expect(
      fieldMapRequestSchema.safeParse({
        tenantSlug: "t",
        projectSlug: "p",
        somethingOlderServersNeverHeardOf: true,
      }).success,
    ).toBe(false);
  });

  it("B · version 2 is exactly what #95 released: parts, and no background field", () => {
    expect(fieldMapResponseV2Schema.safeParse(v2).success).toBe(true);
    // The regression. A version 2 payload carrying the new field must be refused by the parser
    // every already-released version 2 client holds.
    expect(fieldMapResponseV2Schema.safeParse({ ...v2, referenceBasemap: null }).success).toBe(
      false,
    );
  });

  it("C · version 3 carries the background, present or null", () => {
    expect(fieldMapResponseV3Schema.safeParse(v3).success).toBe(true);
    expect(
      fieldMapResponseV3Schema.safeParse({
        ...v3,
        referenceBasemap: {
          tileUrl: "https://example.invalid/{z}/{x}/{y}.jpg?key=k",
          attribution: "© Proveedor",
          maxZoom: 20,
        },
      }).success,
    ).toBe(true);
    // Absent is not the same as null: version 3 promises the field exists.
    const { referenceBasemap: _omitted, ...withoutField } = v3;
    expect(fieldMapResponseV3Schema.safeParse(withoutField).success).toBe(false);
  });

  it("D and E · a map stored by any earlier build is still readable, unchanged", () => {
    /*
     * What the device does on opening a stored payload with no signal. Each version is read by
     * its own schema and by no other, so the reader has to try all three — and must never demand
     * a fresh download because the shape is older than the build.
     */
    expect(fieldMapResponseSchema.safeParse(v1).success).toBe(true);
    expect(fieldMapResponseV2Schema.safeParse(v1).success).toBe(false);
    expect(fieldMapResponseV3Schema.safeParse(v1).success).toBe(false);

    expect(fieldMapResponseV2Schema.safeParse(v2).success).toBe(true);
    expect(fieldMapResponseV3Schema.safeParse(v2).success).toBe(false);
  });

  it("no version accepts another's number, so a mislabelled payload cannot pass", () => {
    expect(fieldMapResponseV3Schema.safeParse({ ...v3, schemaVersion: 2 }).success).toBe(false);
    expect(fieldMapResponseV2Schema.safeParse({ ...v2, schemaVersion: 3 }).success).toBe(false);
  });
});
