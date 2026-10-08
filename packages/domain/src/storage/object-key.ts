import { InvalidInput } from "../core/errors";

/**
 * Where an object lives, and what may **not** be in the path that says so.
 *
 * ## The key is opaque, and that is the security property
 *
 * A storage key is read by whoever can see a log line, a metrics label, a bucket listing or an
 * error from the provider — none of which is the product's access-control surface. So a key
 * carries identifiers and nothing else: tenant, project, a namespace, and a UUID this product
 * minted. It does **not** carry the original filename, and that is the rule rather than an
 * omission: `Ficha_socioeconomica_Maria_Quizhpe.pdf` names a person, and a bucket listing is not
 * a place where a respondent's name may appear.
 *
 * The filename a person uploaded is kept in the database row, where RLS decides who reads it.
 *
 * ## The key is never accepted from a client
 *
 * `buildObjectKey` is the only way one is made, and the server calls it. A browser or a phone asks
 * for an upload *intent* and is handed a key it did not choose; a client that could name a key
 * could name another tenant's.
 */
/**
 * The namespaces, which are never mixed (ADR-031 §1, extended by ADR-036).
 *
 * `templates` holds a consultancy's own `.docx` templates and `generated` holds the documents this
 * product produced from them. They are separate from `documents` — a delivered study — because the
 * three have different formats, different retention questions and different readers, and because a
 * generated draft must never be reachable by a query written for the corpus.
 */
/**
 * `portal-editorial` is media a firm chose to publish. It is its own namespace rather than a
 * flag on `documents` so that "could this file ever be served to a visitor?" is answerable from
 * the key, and so that a query written for the corpus can never reach it — or the reverse.
 */
/**
 * `socialization-evidence` is the photograph a technician takes when they hand over an
 * invitation. It is its own namespace, and the two it is not are the point: not `field-media`,
 * because that is evidence of a **visit** and is read by the surfaces that read a visit; and
 * emphatically not `portal-editorial`, which is the one namespace whose objects a visitor can be
 * served. A delivery photograph is private evidence, and no public route resolves this prefix.
 */
export const STORAGE_NAMESPACES = [
  "documents",
  "field-media",
  "templates",
  "generated",
  "portal-editorial",
  "socialization-evidence",
] as const;
export type StorageNamespace = (typeof STORAGE_NAMESPACES)[number];

/**
 * The namespaces a client may ask for an upload intent in.
 *
 * Everything except `generated`, which is what this product writes for itself: no caller uploads
 * into it, and an intent for it would be a way to put a file where a reader expects only output
 * this product produced.
 *
 * Derived from the list above rather than written out again. The second hand-maintained copy is
 * exactly what went wrong: `portal-editorial` was added to the namespace rules and to the key
 * builder and **not** to the intent schema, so the permission existed, the formats existed, and
 * no editorial upload could be requested at all.
 */
export const UPLOADABLE_NAMESPACES = STORAGE_NAMESPACES.filter(
  (namespace) => namespace !== "generated",
) as ReadonlyArray<Exclude<StorageNamespace, "generated">>;
export type UploadableNamespace = (typeof UPLOADABLE_NAMESPACES)[number];

export interface ObjectKeyParts {
  readonly tenantId: string;
  readonly projectId: string;
  readonly namespace: StorageNamespace;
  /** A UUID this product minted. Never a filename, never a business code. */
  readonly objectId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildObjectKey(parts: ObjectKeyParts): string {
  for (const [name, value] of [
    ["tenantId", parts.tenantId],
    ["projectId", parts.projectId],
    ["objectId", parts.objectId],
  ] as const) {
    if (!UUID.test(value)) throw new InvalidInput(`storage key: ${name} must be a UUID`);
  }
  if (!(STORAGE_NAMESPACES as ReadonlyArray<string>).includes(parts.namespace)) {
    throw new InvalidInput("storage key: unknown namespace");
  }
  return `t/${parts.tenantId}/p/${parts.projectId}/${parts.namespace}/${parts.objectId}`;
}

/**
 * Read a key back, refusing anything that is not one this product built.
 *
 * Used on the finalize path: a client returns the key it was given, and the server checks that it
 * is the key it issued *for this tenant and project* rather than trusting the string. Parsing is
 * strict — exactly five segments, three UUIDs, a known namespace — because a lenient parser here
 * is how `../` reaches a bucket.
 */
export function parseObjectKey(key: string): ObjectKeyParts | null {
  const parts = key.split("/");
  if (parts.length !== 6) return null;
  const [t, tenantId, p, projectId, namespace, objectId] = parts;
  if (t !== "t" || p !== "p") return null;
  if (!tenantId || !projectId || !objectId || !namespace) return null;
  if (!UUID.test(tenantId) || !UUID.test(projectId) || !UUID.test(objectId)) return null;
  if (!(STORAGE_NAMESPACES as ReadonlyArray<string>).includes(namespace)) return null;
  return {
    tenantId,
    projectId,
    namespace: namespace as StorageNamespace,
    objectId,
  };
}

/**
 * The key belongs to this tenant, this project, and this namespace — or it is refused.
 *
 * Every finalize goes through here before anything is written. RLS would stop the *row* reaching
 * another tenant, but nothing in the database knows what a bucket key means, so the check that a
 * key is the caller's has to be made here and cannot be delegated.
 */
export function assertObjectKeyBelongsTo(
  key: string,
  scope: { tenantId: string; projectId: string; namespace: StorageNamespace },
): ObjectKeyParts {
  const parsed = parseObjectKey(key);
  if (!parsed) throw new InvalidInput("storage key: not a key this product issued");
  if (
    parsed.tenantId !== scope.tenantId ||
    parsed.projectId !== scope.projectId ||
    parsed.namespace !== scope.namespace
  ) {
    throw new InvalidInput("storage key: outside this tenant, project or namespace");
  }
  return parsed;
}
