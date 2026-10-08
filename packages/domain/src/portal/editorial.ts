import { z } from "zod";

/**
 * The editorial presentation a consultancy publishes about a project (Visión Ambiental, block 2).
 *
 * ## How this differs from the client publication beside it
 *
 * `clientPublicationPayloadSchema` is a **projection**: every figure in it was computed, carries a
 * provenance id, and is refused if it rests on nothing (ADR-027). Nothing in it is typed by a
 * person, which is exactly why it cannot hold a paragraph a biologist wrote.
 *
 * This is the other half, and it is the opposite shape: **prose people wrote and reviewed**, with
 * no computed figure in it at all. It is not a weaker publication — it is a different kind of
 * statement, and keeping them in separate payloads is what stops a hand-typed number being read
 * as a calculated one. A page that wants both renders both; neither validates the other's content.
 *
 * So there is **no metric, no percentage field, no progress** here. A consultancy that wants to
 * state a figure writes it in a sentence and owns it, and the product does not dress it up as
 * something it derived. That is also why this payload has no `provenance` facets: claiming
 * provenance for a paragraph somebody typed would be the lie the whole provenance model exists to
 * prevent.
 *
 * ## One structure, not a layout language
 *
 * A page is an ordered list of sections; a section has a title, body text, and references to
 * assets. Four section kinds are named because the brief names them, and `custom` exists so a
 * consultancy can add its own — but they differ only in their *key*, never in what they may
 * contain. There is no column, no grid, no nesting and no component: the renderer decides how a
 * section looks, and an editor cannot invent a layout the renderer has never seen.
 */

export const EDITORIAL_SCHEMA_VERSION = 1;

/** Named because the brief names them; `custom` is the escape hatch, with identical shape. */
export const EDITORIAL_SECTION_KINDS = [
  "summary",
  "biotic",
  "environmental",
  "risks",
  "social",
  "team",
  "documents",
  "custom",
] as const;
export type EditorialSectionKind = (typeof EDITORIAL_SECTION_KINDS)[number];

/** What an attachment is for. The renderer uses it; it never changes what is authorised. */
export const EDITORIAL_ASSET_ROLES = ["photo", "document", "slides"] as const;
export type EditorialAssetRole = (typeof EDITORIAL_ASSET_ROLES)[number];

const LIMITS = {
  title: 160,
  body: 20_000,
  caption: 300,
  altText: 300,
  sections: 40,
  assetsPerSection: 24,
  team: 60,
  bio: 4_000,
} as const;
export const EDITORIAL_LIMITS = LIMITS;

/**
 * A reference to something already stored, never bytes.
 *
 * `storedObjectId` must belong to this project and to an editorial namespace; the use-case checks
 * that against the database, because a schema cannot know who owns a uuid. Alt text is required
 * for a photo and optional for the rest: a photograph with no alternative text is unreadable to
 * somebody using a screen reader, and "decorative" is not a thing a consultancy's site has.
 */
export const editorialAssetSchema = z
  .object({
    storedObjectId: z.uuid(),
    role: z.enum(EDITORIAL_ASSET_ROLES),
    caption: z.string().max(LIMITS.caption).nullable().default(null),
    altText: z.string().max(LIMITS.altText).nullable().default(null),
  })
  .strict()
  .refine((a) => a.role !== "photo" || (a.altText !== null && a.altText.trim().length > 0), {
    message: "a published photograph needs alternative text",
    path: ["altText"],
  });
export type EditorialAsset = z.infer<typeof editorialAssetSchema>;

export const editorialSectionSchema = z
  .object({
    /** Stable across edits, so reordering a page does not orphan an attachment. */
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,48}$/u),
    kind: z.enum(EDITORIAL_SECTION_KINDS),
    title: z.string().min(1).max(LIMITS.title),
    /** Plain text. Not HTML and not Markdown: see `sanitiseEditorialText`. */
    body: z.string().max(LIMITS.body).default(""),
    assets: z.array(editorialAssetSchema).max(LIMITS.assetsPerSection).default([]),
  })
  .strict();
export type EditorialSection = z.infer<typeof editorialSectionSchema>;

/**
 * A person as the consultancy presents them, which is **not** an account.
 *
 * Deliberately unlinked from `user` and from any membership: the people a firm shows on its site
 * and the people who can sign in are different lists, and joining them would mean a biologist
 * could not appear without being given a login, or that giving somebody a login put their face on
 * the internet. There is no `email` and no `phone` field — not "optional", absent — so publishing
 * a contact detail is unrepresentable rather than discouraged.
 */
export const editorialTeamMemberSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,48}$/u),
    name: z.string().min(1).max(LIMITS.title),
    /** The professional title the person supplied. Never derived from a product role. */
    position: z.string().min(1).max(LIMITS.title),
    speciality: z.string().max(LIMITS.title).nullable().default(null),
    /** Supplied and reviewed by a person. Empty is honest; invented is not. */
    biography: z.string().max(LIMITS.bio).default(""),
    photo: editorialAssetSchema.nullable().default(null),
    /** Free text the person supplied, not a query over this product's projects. */
    projects: z.array(z.string().min(1).max(LIMITS.title)).max(40).default([]),
  })
  .strict();
export type EditorialTeamMember = z.infer<typeof editorialTeamMemberSchema>;

/**
 * The management summary.
 *
 * Every field is prose, and `sources` is free text the author typed — a document title, a version
 * label, whatever they can stand behind. It is **not** a citation this product resolved, and the
 * surface says so, because a link that looks machine-checked and is not is worse than a sentence.
 */
export const editorialExecutiveSummarySchema = z
  .object({
    findings: z.string().max(LIMITS.body).default(""),
    implications: z.string().max(LIMITS.body).default(""),
    measures: z.string().max(LIMITS.body).default(""),
    /** Who stands behind it. A name the author typed, not a membership. */
    accountable: z.string().max(LIMITS.title).nullable().default(null),
    /** ISO date the author chose. Not `now()`: a summary can be dated to the meeting it came from. */
    asOf: z.iso.date().nullable().default(null),
    sources: z.array(z.string().min(1).max(LIMITS.title)).max(40).default([]),
  })
  .strict();
export type EditorialExecutiveSummary = z.infer<typeof editorialExecutiveSummarySchema>;

export const editorialPayloadSchema = z
  .object({
    schemaVersion: z.literal(EDITORIAL_SCHEMA_VERSION),
    locale: z.enum(["es-EC", "en"]),
    /** The project as the consultancy presents it publicly. Not the internal project name. */
    headline: z.string().min(1).max(LIMITS.title),
    subheadline: z.string().max(LIMITS.title).nullable().default(null),
    executiveSummary: editorialExecutiveSummarySchema.nullable().default(null),
    sections: z.array(editorialSectionSchema).max(LIMITS.sections).default([]),
    team: z.array(editorialTeamMemberSchema).max(LIMITS.team).default([]),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const seen = new Set<string>();
    for (const section of payload.sections) {
      if (seen.has(section.key)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate section key: ${section.key}`,
          path: ["sections"],
        });
      }
      seen.add(section.key);
    }
    const people = new Set<string>();
    for (const member of payload.team) {
      if (people.has(member.key)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate team key: ${member.key}`,
          path: ["team"],
        });
      }
      people.add(member.key);
    }
  });
export type EditorialPayload = z.infer<typeof editorialPayloadSchema>;

/* ---------------------------------------------------------------------------------------------
 * What a visitor must never be sent
 * ------------------------------------------------------------------------------------------ */

/**
 * Text is stored and rendered as **plain text**, and this is what makes that true rather than
 * intended.
 *
 * Not an HTML sanitiser: there is no HTML here to sanitise. The payload admits no markup, the
 * renderer interpolates text nodes, and this function removes the three things that survive a
 * naive round trip anyway — control characters, a U+2028/U+2029 that breaks a JSON-in-script
 * embedding, and a leading byte-order mark. An editor who pastes `<script>` gets those eleven
 * characters on screen, which is the correct outcome.
 */
/** U+2028 and U+2029: valid in a JSON string and fatal inside a script tag. Written by code
 *  point so this file stays pure ASCII and no editor can silently normalise them away. */
const LINE_SEPARATORS = new RegExp(`[\\u2028\\u2029]`, "gu");
const LEADING_BOM = new RegExp(`^\\uFEFF`, "u");

export function sanitiseEditorialText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
      .replace(LINE_SEPARATORS, "\n")
      .replace(LEADING_BOM, "")
  );
}

/** Every string in the payload, sanitised. Applied on save, so nothing unclean is ever stored. */
export function sanitiseEditorialPayload(payload: EditorialPayload): EditorialPayload {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return sanitiseEditorialText(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return editorialPayloadSchema.parse(walk(payload));
}

/**
 * Concepts a public editorial page may never carry, whatever an author typed.
 *
 * Narrower than `FORBIDDEN_PAYLOAD_CONCEPTS` on purpose. That list guards a **projection** whose
 * vocabulary is this product's own, so it can afford to ban words like `provenance`. This guards
 * **prose about an environmental study**, where "propietario" and "técnico" are ordinary Spanish a
 * consultancy will legitimately write. Banning them here would make the editor unusable and teach
 * people to work around the check, which is worse than the risk.
 *
 * What stays banned is what identifies somebody or exposes the operational record: a contact
 * detail, an identity number, a parcel code, or this product's internal record names.
 */
export const EDITORIAL_FORBIDDEN_PATTERNS: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: "email_address", pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/u },
  /*
   * An Ecuadorian cédula is ten digits and a RUC is thirteen, written without separators in every
   * document this product has seen. Contiguous only, deliberately: the first version of this
   * pattern allowed separators and matched `2026-10-06`, so a page could not carry a date. A
   * check that refuses ordinary content is a check people route around.
   */
  { key: "identity_number", pattern: /(?<!\d)(?:\d{10}|\d{13})(?!\d)/u },
  { key: "survey_answer_record", pattern: /\bsurvey[_\s-]?answer\b/iu },
  { key: "human_review_record", pattern: /\bhuman[_\s-]?review\b/iu },
  { key: "ai_classification_record", pattern: /\bai[_\s-]?classification\b/iu },
  { key: "quality_finding_record", pattern: /\bquality[_\s-]?finding\b/iu },
  { key: "parcel_code", pattern: /\bP-\d{3,}\b/u },
  { key: "finding_code", pattern: /\b(QG|IA)-\d{2,}\b/u },
];

/**
 * Fields that are identifiers this product generated, not words anybody wrote.
 *
 * The scan used to run over `JSON.stringify(payload)`, which swept these in with the prose — and
 * a stored object id is a UUID, so roughly one page in a few hundred carried a run of exactly ten
 * digits inside one and was refused as an `identity_number`. The author had typed nothing of the
 * kind and there was nothing on screen for them to remove: a refusal they could not act on, and
 * one that would have arrived at random after this shipped. (An integration run caught it, which
 * is the only reason it is not still latent.)
 *
 * Named exclusions rather than an allowlist of prose fields, so the sweep keeps the property that
 * made it worth writing: a new text field is covered the day it is added, with nobody remembering
 * to add it here.
 */
const MACHINE_FIELDS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "locale",
  "key",
  "kind",
  "role",
  "storedObjectId",
]);

/** Every string a reader could see, and none this product generated. */
function readableStrings(value: unknown, key: string | null = null): ReadonlyArray<string> {
  if (key !== null && MACHINE_FIELDS.has(key)) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => readableStrings(entry));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => readableStrings(v, k));
  }
  return [];
}

/** Every match, so an author is told all of it at once rather than one refusal at a time. */
export function findEditorialViolations(payload: EditorialPayload): ReadonlyArray<string> {
  // Joined on a newline rather than concatenated: two innocent fields must not form a match
  // across the seam between them.
  const text = readableStrings(payload).join("\n");
  return EDITORIAL_FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(text)).map((p) => p.key);
}

export class EditorialContentRefused extends Error {
  constructor(readonly violations: ReadonlyArray<string>) {
    super(`the page carries content a public page may not: ${violations.join(", ")}`);
    this.name = "EditorialContentRefused";
  }
}

/** Parse, sanitise and check. The one door every save and every publication goes through. */
export function assertPublishableEditorial(payload: unknown): EditorialPayload {
  const clean = sanitiseEditorialPayload(editorialPayloadSchema.parse(payload));
  const violations = findEditorialViolations(clean);
  if (violations.length > 0) throw new EditorialContentRefused(violations);
  return clean;
}
