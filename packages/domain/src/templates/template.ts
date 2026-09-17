import { z } from "zod";

import { InvalidInput } from "../core/errors";
import { DRAFT_BANNER_PLACEHOLDER, PLACEHOLDER_KEYS, placeholderFor } from "./placeholders";

/**
 * A consultancy's own `.docx`, versioned, validated and activated (ADR-036).
 *
 * ## Why a template is a version and not a file
 *
 * The same reason a delivered document is (ADR-031): a generated deliverable has to remain
 * explicable a year later, and "which template produced this?" is only answerable if the template
 * that produced it still exists exactly as it was. A corrected template is **v2**; v1 keeps its
 * bytes, and every document generated from v1 keeps pointing at them.
 *
 * ## The three states, and the one that is a decision
 *
 * `UPLOADED` — stored and not yet read. `VALIDATED` — parsed, and every tag in it is a placeholder
 * this product declares. `ACTIVE` — somebody decided documents may be generated from it.
 *
 * Validation is a fact about the file. **Activation is a decision about the study**, which is why
 * it is a separate act with its own permission, and why an activated version becomes immutable:
 * from that moment on, a deliverable can name it.
 */
export const TEMPLATE_KINDS = [
  /** The study's own cover and front matter. */
  "cover",
  /** A chapter of the report, filled from the deterministic snapshot. */
  "chapter",
  /** A standalone annex: a table of measures, a register, a summary sheet. */
  "annex",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_VERSION_STATES = ["UPLOADED", "VALIDATED", "ACTIVE", "SUPERSEDED"] as const;
export type TemplateVersionState = (typeof TEMPLATE_VERSION_STATES)[number];

const TRANSITIONS: Readonly<Record<TemplateVersionState, ReadonlyArray<TemplateVersionState>>> = {
  UPLOADED: ["VALIDATED"],
  // Validation can be asked for again after the registry grows: the file has not changed, but what
  // this product is willing to say has.
  VALIDATED: ["ACTIVE", "VALIDATED"],
  // A later version of the same template and locale supersedes this one. Its bytes stay.
  ACTIVE: ["SUPERSEDED"],
  SUPERSEDED: [],
};

export function assertTemplateTransition(
  from: TemplateVersionState,
  to: TemplateVersionState,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidInput(`a template version cannot go from ${from} to ${to}`);
  }
}

/**
 * The locales a template version may be written in.
 *
 * **ES and EN are different versions of the same template, never one file translated.** A
 * consultancy's Spanish deliverable is their own register, their own legal phrasing and their own
 * headings; machine-translating it would produce a document the firm did not write and would have
 * to sign. The product holds both and renders the one asked for (ADR-029's rule: project source
 * material is not translated).
 */
export const TEMPLATE_LOCALES = ["es-EC", "en"] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

/** One tag as the parser found it in the file. */
export const templateTagSchema = z
  .object({
    name: z.string().min(1).max(120),
    /** `SelfClosed` for a value, `Open`/`Close` for a repetition container. */
    disposition: z.string().min(1).max(20),
  })
  .strict();
export type TemplateTag = z.infer<typeof templateTagSchema>;

/**
 * What validation found, stored on the version so a reader sees it without re-parsing the file.
 *
 * `unknown` is the list that matters: a tag the registry does not declare. It is **not** dropped
 * and **not** rendered as empty — it blocks activation, because a template silently printing
 * nothing where its author expected a figure is how a deliverable goes out with a hole in it.
 */
export const templateManifestSchema = z
  .object({
    /** Registered placeholders the template uses, de-duplicated, in the order first seen. */
    supported: z.array(z.string().min(1).max(120)),
    /** Tags no entry of the registry declares. Any one of these blocks activation. */
    unknown: z.array(z.string().min(1).max(120)),
    /** Of `supported`, the ones whose absence stops a document being produced at all. */
    required: z.array(z.string().min(1).max(120)),
    /** Container tags (repetition). Their names are checked against the registry as well. */
    containers: z.array(z.string().min(1).max(120)),
    /** Total tags found, including repeats: a bounded number a person can sanity-check. */
    tagCount: z.number().int().nonnegative(),
  })
  .strict();
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

/** The delimiters this product's templates use. Fixed, so a template cannot redefine the syntax. */
export const TEMPLATE_DELIMITERS = { tagStart: "{{", tagEnd: "}}" } as const;

/** A template with more tags than this is refused: a document is not a program. */
export const MAX_TEMPLATE_TAGS = 500;

/**
 * Turn the tags a parser found into a manifest, refusing nothing and hiding nothing.
 *
 * Every tag is classified against the registry — including the plugin-prefixed ones a template
 * might carry (`@raw`, `%image`, `*link`), which are *not* registry keys and therefore land in
 * `unknown` where they belong. The renderer is configured without those plugins as well, so this
 * is the second of two independent refusals rather than the only one.
 */
export function buildManifest(tags: ReadonlyArray<TemplateTag>): TemplateManifest {
  if (tags.length > MAX_TEMPLATE_TAGS) {
    throw new InvalidInput(
      `this template carries ${tags.length} tags, beyond the ${MAX_TEMPLATE_TAGS} a document is ` +
        "expected to hold. A template is a document with values in it, not a program.",
    );
  }
  const supported: string[] = [];
  const unknown: string[] = [];
  const required: string[] = [];
  const containers: string[] = [];

  for (const tag of tags) {
    const definition = placeholderFor(tag.name);
    if (tag.disposition === "Open") {
      if (!containers.includes(tag.name)) containers.push(tag.name);
    }
    if (!definition) {
      if (!unknown.includes(tag.name)) unknown.push(tag.name);
      continue;
    }
    if (!supported.includes(tag.name)) supported.push(tag.name);
    if (definition.absence === "BLOCKS" && !required.includes(tag.name)) required.push(tag.name);
  }

  return { supported, unknown, required, containers, tagCount: tags.length };
}

export class TemplateNotActivatable extends InvalidInput {
  constructor(readonly unknown: ReadonlyArray<string>) {
    super(
      "this template version cannot be activated because it uses placeholders this product does " +
        `not declare: ${unknown.join(", ")}. They are not ignored and not rendered empty — a ` +
        "template that silently prints nothing where its author expected a figure is how a " +
        `deliverable goes out with a hole in it. The declared vocabulary is: ${PLACEHOLDER_KEYS.join(", ")}.`,
    );
    this.name = "TemplateNotActivatable";
  }
}

export class TemplateMissingDraftBanner extends InvalidInput {
  constructor() {
    super(
      `this template version cannot be activated because it does not carry {{${DRAFT_BANNER_PLACEHOLDER}}}. ` +
        "Every document this product generates says it is a draft, because there is no approval " +
        "workflow here and a Word file detached from the screen that produced it carries no other " +
        "context. Put the placeholder where a banner reads properly in your layout.",
    );
    this.name = "TemplateMissingDraftBanner";
  }
}

/** Throws naming every unknown placeholder, or returns. */
export function assertActivatable(manifest: TemplateManifest): void {
  if (manifest.unknown.length > 0) throw new TemplateNotActivatable(manifest.unknown);
  if (manifest.supported.length === 0) {
    throw new InvalidInput(
      "this template has no placeholders this product recognises, so generating from it would " +
        "produce the template back. Nothing here refuses a fixed document; it refuses calling one " +
        "a template.",
    );
  }
  if (!manifest.supported.includes(DRAFT_BANNER_PLACEHOLDER)) {
    throw new TemplateMissingDraftBanner();
  }
}

/**
 * The banner every generated document carries, in both languages.
 *
 * It is a constant rather than copy a surface chooses, for the reason ADR-022 gave the report
 * generator: there is no approval workflow in this product (TD-060), a Word file detached from the
 * screen that produced it carries no other context, and a generated draft that looks finished
 * invites being circulated as one.
 */
export const DRAFT_BANNERS: Readonly<Record<TemplateLocale, string>> = {
  "es-EC": "BORRADOR — NO ES UN ENTREGABLE APROBADO",
  en: "DRAFT — NOT AN APPROVED DELIVERABLE",
};

export function draftBannerFor(locale: string): string {
  return locale.startsWith("es") ? DRAFT_BANNERS["es-EC"] : DRAFT_BANNERS.en;
}

/**
 * What a generated document records about itself.
 *
 * The list is the answer to *how was this produced?* asked a year later, and every entry is there
 * because its absence would make the question unanswerable: which template, which snapshot, which
 * bytes of that snapshot, which language, who asked, when — and, when a paragraph was written by a
 * model, which model and which prompt.
 */
export const generatedDocumentProvenanceSchema = z
  .object({
    templateVersionId: z.uuid(),
    templateVersionLabel: z.string().min(1).max(40),
    locale: z.enum(TEMPLATE_LOCALES),
    /** The report version this was rendered from, when it was rendered from one. */
    reportVersionId: z.uuid().nullable(),
    /** sha256 of the snapshot JSON: the bytes the figures came from, not merely its id. */
    snapshotDigest: z.string().length(64).nullable(),
    /** Null when no prose was generated, which is the ordinary case (ADR-021 §4). */
    narrativeModel: z.string().min(1).max(120).nullable(),
    narrativePromptVersion: z.string().min(1).max(60).nullable(),
  })
  .strict();
export type GeneratedDocumentProvenance = z.infer<typeof generatedDocumentProvenanceSchema>;
