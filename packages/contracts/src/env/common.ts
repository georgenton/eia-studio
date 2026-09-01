import { z } from "zod";

/** "true"/"false"/"1"/"0" → boolean; absent → undefined (so defaults apply). */
export const booleanString = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", "yes", "no"])])
  .transform((v) => v === true || v === "true" || v === "1" || v === "yes");

export const integerString = z
  .union([z.number().int(), z.string().regex(/^\d+$/)])
  .transform(Number);

export const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), "must be a postgres:// or postgresql:// URL");

export type EnvSource = Record<string, string | undefined>;

export class EnvValidationError extends Error {
  readonly issues: ReadonlyArray<{ key: string; message: string }>;
  constructor(scope: string, issues: ReadonlyArray<{ key: string; message: string }>) {
    // Only variable NAMES and rule messages are reported — never values.
    super(
      `Invalid ${scope} environment configuration: ` +
        issues.map((i) => `${i.key} (${i.message})`).join("; "),
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/** Keys declared by an object schema, also when wrapped by transform/refine pipes. */
function declaredKeys(schema: unknown): string[] {
  let current = schema as
    { shape?: Record<string, unknown>; in?: unknown; def?: { in?: unknown } } | undefined;
  for (let depth = 0; current && depth < 8; depth++) {
    if (current.shape) return Object.keys(current.shape);
    current = (current.in ?? current.def?.in) as typeof current;
  }
  throw new Error("loadEnv: schema must be (a pipe over) a zod object");
}

/**
 * Parse a subset of the environment with a schema. Only the keys declared by the schema are read
 * from `source`, so unrelated variables never leak into the result and `strict()` stays usable.
 */
export function loadEnv<T extends z.ZodType>(
  scope: string,
  schema: T,
  source: EnvSource = process.env,
): z.output<T> {
  const keys = declaredKeys(schema);
  const picked: Record<string, string | undefined> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== "") picked[key] = value;
  }
  const result = schema.safeParse(picked);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      key: issue.path.map(String).join(".") || "(root)",
      message: issue.message,
    }));
    throw new EnvValidationError(scope, issues);
  }
  return result.data;
}
