import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * The closed placeholder vocabulary (ADR-036).
 *
 * A consultancy's `.docx` template is a file somebody outside this product wrote, and the tags in
 * it are strings that file chose. The question this registry answers is therefore not *what can we
 * substitute* but **what is this product willing to say**.
 *
 * ## Why a registry rather than object traversal
 *
 * The obvious implementation — hand the renderer a data object and let a tag name be a path into
 * it — makes the template decide what it reads. Whatever is in that object becomes reachable, so
 * the next person who adds a field to it silently widens what a template may print. A registry
 * inverts that: a tag is a **key somebody declared here**, with a declared type, a declared source
 * and a declared behaviour when the value is missing. A tag that is not in this list is not a
 * placeholder; it is an error that stops activation.
 *
 * ## What may never be in it
 *
 * No personal data. No individual survey answer. No AI classification or review candidate — those
 * are proposals, and a proposal printed into a consultancy's deliverable has been promoted to a
 * fact by a template. No open quality finding stated as settled. No storage key. No internal UUID.
 * The registry is the enumeration that makes those absences checkable rather than intended.
 */

/** What the value is, which decides how the binding formats it and what the validator accepts. */
export const PLACEHOLDER_KINDS = ["text", "count", "decimal", "date"] as const;
export type PlaceholderKind = (typeof PLACEHOLDER_KINDS)[number];

/**
 * What happens when the project does not have this value.
 *
 * `BLOCKS` — a document that names this placeholder cannot be generated without it. The cover of a
 * study cannot say *Proyecto:* followed by nothing.
 *
 * `DECLARED` — the document is generated and the placeholder renders an explicit, localized *no
 * value* — never `0`, never an empty space that reads as deliberate. A corridor length nobody has
 * measured is not zero kilometres, and a template that printed `0` would have invented a
 * measurement.
 *
 * It is a property of the **placeholder**, declared here, and never of the template: a template
 * that could choose its own tolerance would be choosing this product's honesty rule.
 */
export const ABSENCE_BEHAVIOURS = ["BLOCKS", "DECLARED"] as const;
export type AbsenceBehaviour = (typeof ABSENCE_BEHAVIOURS)[number];

export interface PlaceholderDefinition {
  readonly key: string;
  readonly kind: PlaceholderKind;
  readonly absence: AbsenceBehaviour;
  /**
   * Where the value comes from, in words an operator can check against the product.
   *
   * Not decoration: it is what a reviewer reads when asking *is this figure allowed to be in a
   * deliverable?*, and it is the reason every entry below names a deterministic or
   * specialist-validated source and none names a model.
   */
  readonly source: string;
}

/**
 * Every placeholder this product will substitute, and nothing else.
 *
 * Deliberately small. It grows when a concept is backed by a deterministic computation or a
 * specialist's validated decision — never so that a template can be satisfied.
 */
export const PLACEHOLDERS: ReadonlyArray<PlaceholderDefinition> = [
  {
    key: "project.name",
    kind: "text",
    absence: "BLOCKS",
    source: "project.name — the short name the workspace navigates by",
  },
  {
    key: "project.official_title",
    kind: "text",
    absence: "DECLARED",
    source: "project.official_title — the study's own title, as its cover states it",
  },
  {
    key: "project.locality",
    kind: "text",
    absence: "DECLARED",
    source: "project.location_label — the free-text location line",
  },
  {
    key: "project.programme_reference",
    kind: "text",
    absence: "DECLARED",
    source: "project.programme_reference — the programme the study belongs to",
  },
  {
    key: "territory.corridor_length_km",
    kind: "decimal",
    absence: "DECLARED",
    source: "metric_snapshot.corridor_length_km — a measured value with its provenance record",
  },
  {
    key: "territory.parcel_universe",
    kind: "count",
    absence: "DECLARED",
    source: "metric_snapshot.universe_confirmed — the confirmed universe, not the estimate",
  },
  {
    key: "social.surveys_complete",
    kind: "count",
    absence: "DECLARED",
    source: "metric_snapshot.surveys_complete — submitted instruments, counted deterministically",
  },
  {
    key: "social.consultation_participants",
    kind: "count",
    absence: "DECLARED",
    source: "metric_snapshot.consultation_participants — attendance as the register records it",
  },
  {
    key: "pgas.plans",
    kind: "count",
    absence: "DECLARED",
    source: "count of pgas_plan rows of the current import — what the plan proposes",
  },
  {
    key: "pgas.programmes",
    kind: "count",
    absence: "DECLARED",
    source: "count of distinct programmes across pgas_measure of the current import",
  },
  {
    key: "pgas.measures",
    kind: "count",
    absence: "DECLARED",
    source: "count of pgas_measure rows of the current import",
  },
  {
    key: "generation.date",
    kind: "date",
    absence: "BLOCKS",
    source: "the instant the document was generated; never the study's own date",
  },
  {
    key: "generation.locale",
    kind: "text",
    absence: "BLOCKS",
    source: "the locale the document was rendered in, so a reader knows which version this is",
  },
  {
    key: "generation.draft_banner",
    kind: "text",
    absence: "BLOCKS",
    source:
      "a constant this product supplies — BORRADOR — NO ES UN ENTREGABLE APROBADO, or its " +
      "English equivalent. A template must carry it, and a rendered document is refused without it",
  },
] as const;

/**
 * The one placeholder every template must contain.
 *
 * There is no approval workflow in this product (TD-060) and a Word file detached from the screen
 * that produced it carries no other context, so a generated draft that looks finished invites
 * being circulated as one (ADR-022's reasoning, one layer out).
 *
 * It is a **required placeholder** rather than a paragraph this product injects, because injecting
 * one means editing the author's Word XML — and the author is the person who knows where a banner
 * reads properly in their own layout. The guarantee is kept in two places instead: activation
 * refuses a template that does not carry it, and generation refuses a rendered document whose text
 * does not contain it.
 */
export const DRAFT_BANNER_PLACEHOLDER = "generation.draft_banner";

export const PLACEHOLDER_KEYS: ReadonlyArray<string> = PLACEHOLDERS.map((entry) => entry.key);

export function placeholderFor(key: string): PlaceholderDefinition | null {
  return PLACEHOLDERS.find((entry) => entry.key === key) ?? null;
}

/**
 * A value the binding carries, or the fact that there is none.
 *
 * `null` is representable and `0` is not a substitute for it. That distinction is the whole point:
 * "nobody has measured the corridor" and "the corridor is zero kilometres long" are different
 * statements, and a template that cannot tell them apart will print the second.
 */
export const bindingValueSchema = z
  .object({
    key: z.string().min(1).max(80),
    /** Already formatted for the locale. The renderer substitutes text and formats nothing. */
    text: z.string().min(1).max(400).nullable(),
  })
  .strict();
export type BindingValue = z.infer<typeof bindingValueSchema>;

/**
 * The one bounded object a renderer is given (ADR-022's rule, one layer further out).
 *
 * It carries values and a locale and nothing else — no database handle, no context, no project id,
 * no snapshot. A renderer that cannot reach the database cannot be made to leak from it.
 */
export const templateBindingSchema = z
  .object({
    locale: z.string().min(2).max(10),
    values: z.array(bindingValueSchema),
  })
  .strict();
export type TemplateBinding = z.infer<typeof templateBindingSchema>;

export function bindingMap(binding: TemplateBinding): ReadonlyMap<string, string | null> {
  return new Map(binding.values.map((value) => [value.key, value.text]));
}

/**
 * Which placeholders a template needs and the project cannot supply.
 *
 * Returned rather than thrown so the surface can show a person the list before they ask for a
 * document, and so generation refuses with the same list rather than a single name.
 */
export interface BindingShortfall {
  readonly blocking: ReadonlyArray<string>;
  readonly declaredAbsent: ReadonlyArray<string>;
}

export function bindingShortfall(
  required: ReadonlyArray<string>,
  binding: TemplateBinding,
): BindingShortfall {
  const values = bindingMap(binding);
  const blocking: string[] = [];
  const declaredAbsent: string[] = [];
  for (const key of required) {
    const definition = placeholderFor(key);
    if (!definition) {
      // An unknown key here means the template was activated against a different registry, which
      // cannot happen through the product — but refusing is the only safe reading of it.
      blocking.push(key);
      continue;
    }
    const value = values.get(key) ?? null;
    if (value !== null) continue;
    if (definition.absence === "BLOCKS") blocking.push(key);
    else declaredAbsent.push(key);
  }
  return { blocking, declaredAbsent };
}

export class TemplateDataMissing extends InvalidInput {
  constructor(readonly blocking: ReadonlyArray<string>) {
    super(
      "this document cannot be generated because the project has no value for: " +
        `${blocking.join(", ")}. A template must not create meaning from absence, and these ` +
        "placeholders are ones a document cannot honestly be produced without.",
    );
    this.name = "TemplateDataMissing";
  }
}

/**
 * What an absent optional value prints.
 *
 * A key rather than a sentence, because the words belong to whoever is reading (ADR-029). The
 * catalogue renders `templates.notAvailable`; what matters here is that the value is *explicit*
 * and could never be mistaken for a measurement.
 */
export const NOT_AVAILABLE_KEY = "templates.notAvailable";
