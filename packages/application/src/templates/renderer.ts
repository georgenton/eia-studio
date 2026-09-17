import {
  ARCHIVE_LIMITS,
  assertArchiveWithinLimits,
  assertNoMacroProject,
  assertWordPackage,
  bindingMap,
  bindingShortfall,
  buildManifest,
  draftBannerFor,
  DRAFT_BANNER_PLACEHOLDER,
  InvalidInput,
  NOT_AVAILABLE_KEY,
  placeholderFor,
  TEMPLATE_DELIMITERS,
  TemplateDataMissing,
  UnsupportedUpload,
  type TemplateBinding,
  type TemplateManifest,
  type TemplateTag,
} from "@eia/domain";
import { unzipSync } from "fflate";

/**
 * The `.docx` template renderer, and everything it is not allowed to be (ADR-036).
 *
 * ## Why a library, and why this one
 *
 * Replacing `{{project.name}}` in Word XML with a regular expression does not work, and the reason
 * is structural rather than fiddly: Word splits a run whenever anything about the text changes —
 * a spell-check mark, a language tag, an edit somebody made three years ago — so the file usually
 * holds `{{`, `pro`, `ject.na`, `me}}` in four `<w:r>` elements. A regex sees none of it. Doing
 * that properly means walking the run tree, and that is a parser, not a substitution.
 *
 * `easy-template-x` (MIT) is that parser. What the audit settled before it was adopted (ADR-036 §2)
 * is that it can be configured to do **only** substitution:
 *
 * | Risk | What is done about it |
 * |---|---|
 * | Code in a template | the package contains no `eval`, no `new Function`, no `vm` and no `child_process`; `docx-templates`, which evaluates JavaScript from the template, was rejected for exactly this |
 * | Raw XML, images, charts, hyperlinks from a template | the plugin list is **replaced** with text and loop only, so `{{@raw}}`, `{{%image}}`, `{{*link}}` and `{{$chart}}` reach no handler |
 * | The template choosing what it reads | the default resolver is `lodash.get` over the data object — a path traversal the template controls. It is **replaced** by `closedVocabularyResolver`, which answers only from the closed registry |
 * | A template redefining the syntax | delimiters are fixed here, not read from the file |
 * | An untrusted archive | the same `ARCHIVE_LIMITS` ADR-033 applies to a delivered DOCX, plus the macro-project and Word-package checks |
 * | A vulnerable XML parser underneath | the package pins `@xmldom/xmldom@0.8.13`, which carries ten open advisories including quadratic-time parsing reachable from an uploaded file. A workspace-wide pnpm override lifts it to `0.8.15`, which has none |
 *
 * ## What the renderer is given
 *
 * The template's bytes and **one bounded validated object** — `TemplateBinding`, which is a locale
 * and a list of already-formatted values. No database handle, no `RequestContext`, no project id,
 * no snapshot. A renderer that cannot reach the database cannot be made to leak from it (ADR-022's
 * rule, one layer further out).
 */

/** Read the archive once, bounded, and answer what is in it. */
interface ArchiveFacts {
  readonly entryNames: ReadonlyArray<string>;
  readonly contentTypesXml: string;
}

/**
 * Walk the container under the same limits a delivered DOCX is read under (ADR-033).
 *
 * The limits are checked against **declared** sizes as the central directory is walked, which is
 * where a zip bomb lies, and only `[Content_Types].xml` is decompressed.
 */
export function inspectDocxArchive(bytes: Uint8Array): ArchiveFacts {
  let entries = 0;
  let uncompressed = 0;
  const entryNames: string[] = [];

  const files = unzipSync(bytes, {
    filter: (file) => {
      entries += 1;
      uncompressed += file.originalSize ?? 0;
      entryNames.push(file.name);
      assertArchiveWithinLimits({
        entries,
        compressedBytes: bytes.byteLength,
        uncompressedBytes: uncompressed,
      });
      return file.name === "[Content_Types].xml";
    },
  });

  const raw = files["[Content_Types].xml"];
  return {
    entryNames,
    contentTypesXml: raw ? new TextDecoder().decode(raw) : "",
  };
}

/**
 * Everything checked about the bytes before a template is read as a template.
 *
 * Three refusals, each for a file that would pass the previous one: a container that is not a Word
 * document, a Word document carrying a macro project, and an archive that expands beyond what a
 * document does.
 */
export function assertTemplateArchiveSafe(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new UnsupportedUpload("it is empty", { sizeBytes: 0 });
  let facts: ArchiveFacts;
  try {
    facts = inspectDocxArchive(bytes);
  } catch (error) {
    if (error instanceof UnsupportedUpload) throw error;
    throw new UnsupportedUpload("it could not be read as a Word package", {
      reason: (error as Error).message.slice(0, 120),
    });
  }
  assertWordPackage(facts.entryNames);
  assertNoMacroProject(facts);
}

export const TEMPLATE_ARCHIVE_LIMITS = ARCHIVE_LIMITS;

/**
 * The tags a template actually contains, as a manifest checked against the closed registry.
 *
 * `parseTags` reassembles a tag split across runs, which is the whole reason a library is here, and
 * it reports the plugin-prefixed forms (`@raw`, `%image`) under their literal names — so they land
 * in `manifest.unknown` and block activation, independently of the plugins being removed.
 */
export async function readTemplateManifest(bytes: Uint8Array): Promise<TemplateManifest> {
  assertTemplateArchiveSafe(bytes);
  const handler = await createHandler();
  let tags;
  try {
    tags = await handler.parseTags(toBuffer(bytes));
  } catch (error) {
    throw new UnsupportedUpload("its Word XML could not be parsed", {
      reason: (error as Error).message.slice(0, 120),
    });
  }
  const typed: TemplateTag[] = tags.map((tag) => ({
    name: String(tag.name ?? ""),
    disposition: String(tag.disposition ?? "SelfClosed"),
  }));
  return buildManifest(typed.filter((tag) => tag.name.length > 0));
}

export interface RenderedTemplate {
  readonly bytes: Uint8Array;
  /** Placeholders that rendered an explicit *no value*, recorded on the generated document. */
  readonly declaredAbsent: ReadonlyArray<string>;
}

/**
 * Render one template against one binding.
 *
 * Refusals, in order, and each is a way a generated deliverable goes wrong:
 *
 * 1. the archive is not a safe Word package;
 * 2. the template uses a placeholder this product does not declare (it should have been caught at
 *    activation; it is checked again because the registry can change under an activated template);
 * 3. the project has no value for a placeholder whose absence blocks;
 * 4. the rendered text does not contain the draft banner.
 *
 * The fourth is the one that looks redundant and is not: activation requires the placeholder, and
 * this requires that the placeholder actually *rendered*. Between them there is no arrangement in
 * which a document leaves this product without saying what it is.
 */
export async function renderTemplate(input: {
  readonly bytes: Uint8Array;
  readonly binding: TemplateBinding;
  /** The localized words for an absent optional value. Supplied by the caller (ADR-029). */
  readonly notAvailableText: string;
}): Promise<RenderedTemplate> {
  const manifest = await readTemplateManifest(input.bytes);
  if (manifest.unknown.length > 0) {
    throw new InvalidInput(
      `this template uses placeholders this product does not declare: ${manifest.unknown.join(", ")}`,
    );
  }

  const shortfall = bindingShortfall(manifest.required, input.binding);
  if (shortfall.blocking.length > 0) throw new TemplateDataMissing(shortfall.blocking);

  const optionalAbsent = bindingShortfall(manifest.supported, input.binding).declaredAbsent;

  const values = bindingMap(input.binding);
  const handler = await createHandler(input.notAvailableText, values);
  // The data object is deliberately empty: every value reaches the document through the closed
  // resolver, so there is nothing here for a tag to traverse into.
  const rendered = await handler.process(toBuffer(input.bytes), {});

  assertDraftBannerPresent(rendered, draftBannerFor(input.binding.locale));

  return { bytes: new Uint8Array(rendered), declaredAbsent: optionalAbsent };
}

/**
 * The rendered document says what it is, checked in its own text.
 *
 * Read-only: the document is parsed, not rewritten. Editing somebody's Word XML to insert a banner
 * would put this product in the business of laying out their deliverable, and the author is the
 * one who knows where a banner reads properly — so the placeholder is required at activation and
 * its result is verified here.
 */
function assertDraftBannerPresent(rendered: Buffer, banner: string): void {
  const files = unzipSync(new Uint8Array(rendered), {
    filter: (file) => file.name === "word/document.xml",
  });
  const xml = files["word/document.xml"];
  if (!xml) {
    throw new InvalidInput("the rendered document has no Word main part");
  }
  // Tags stripped, because Word may split the banner across runs exactly as it splits a
  // placeholder; entities decoded for the em dash the Spanish banner carries.
  const text = new TextDecoder()
    .decode(xml)
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
  if (!text.includes(banner)) {
    throw new InvalidInput(
      `the rendered document does not contain the draft banner. {{${DRAFT_BANNER_PLACEHOLDER}}} ` +
        "must appear in the template's body, and this document is refused rather than delivered " +
        "without it.",
    );
  }
}

/**
 * The handler, configured so the template can do exactly one thing.
 *
 * The import is dynamic so `@eia/application` loads — in the worker, in the seeder, in a test that
 * never touches a template — without the renderer being initialised.
 */
async function createHandler(
  notAvailableText?: string,
  values?: ReadonlyMap<string, string | null>,
) {
  const { TemplateHandler, TextPlugin, LoopPlugin } = await import("easy-template-x");

  const options: ConstructorParameters<typeof TemplateHandler>[0] = {
    // Text and repetition. Deliberately without RawXmlPlugin, ImagePlugin, ChartPlugin and
    // LinkPlugin: each of those turns a value into document structure, and a template that could
    // ask for one would be asking this product to put unreviewed markup into a deliverable.
    plugins: [new LoopPlugin(), new TextPlugin()],
    delimiters: { ...TEMPLATE_DELIMITERS },
    // An unresolved tag renders empty rather than leaving `{{…}}` in the document. It cannot
    // happen on this path — every tag is a registry key and every registry key is in the binding —
    // and the honest failure is the refusal above, not a tag left on the page.
    skipEmptyTags: false,
  };
  if (values !== undefined) {
    options.scopeDataResolver = (args) =>
      closedVocabularyResolver(args, values, notAvailableText ?? "");
  }
  return new TemplateHandler(options);
}

/**
 * What a tag may read: the closed registry, and nothing else.
 *
 * This replaces the library's default resolver, which is `lodash.get` over the data object and
 * therefore lets the **template** decide what it reads — every field of that object becomes
 * reachable, and the next person to add one silently widens what a template may print. Here a tag
 * is a registry key or it is nothing.
 *
 * An absent optional value returns the localized *no value* rather than `0` or an empty string: a
 * corridor length nobody has measured is not zero kilometres.
 */
function closedVocabularyResolver(
  args: { strPath: ReadonlyArray<string> },
  values: ReadonlyMap<string, string | null>,
  notAvailableText: string,
): string {
  const key = args.strPath.join(".");
  const definition = placeholderFor(key);
  if (!definition) {
    // Unreachable through the product — activation refuses an unknown tag — and answered with the
    // empty string rather than an exception so a stale template cannot crash a render loop. The
    // refusal that matters already happened.
    return "";
  }
  const value = values.get(key) ?? null;
  if (value !== null) return value;
  if (definition.absence === "BLOCKS") {
    // Also unreachable: `bindingShortfall` refused before the render began.
    throw new TemplateDataMissing([key]);
  }
  return notAvailableText;
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export { NOT_AVAILABLE_KEY };
