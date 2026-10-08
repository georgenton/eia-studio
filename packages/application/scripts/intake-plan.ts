/**
 * Read a consultancy's intake manifest and say what the product would do with it.
 *
 *     pnpm intake:plan -- --manifest ~/.config/syntavera/work/<engagement>/manifest.<name>.json
 *
 * Dry run is the only behaviour. There is no `--apply` in this block, and the flag is refused
 * rather than ignored: applying needs an explicit destination and an authorization this script
 * has no way to check, and a switch that silently did nothing would be worse than none.
 *
 * The manifest lives **outside the repository** — it carries a team's names and, later, their
 * addresses — so this script takes a path and prints a plan. It never writes the manifest back,
 * never contacts a database and never sends anything anywhere.
 */
import { readFileSync } from "node:fs";

import { consultancyManifestSchema, EMPTY_SNAPSHOT, planConsultancyIntake } from "../src/index";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : null;
}

if (process.argv.includes("--apply")) {
  console.error(
    "intake:plan refuses --apply: applying needs an explicit destination and an authorization " +
      "this script cannot verify. Dry run only.",
  );
  process.exit(2);
}

const path = arg("manifest");
if (path === null) {
  console.error("usage: intake:plan -- --manifest <path to a manifest outside the repository>");
  process.exit(2);
}

const parsed = consultancyManifestSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
if (!parsed.success) {
  console.error("the manifest does not validate:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

const manifest = parsed.data;
/*
 * The empty snapshot, on purpose. Nothing has been checked against any database, so every line
 * below reads as *if this ran against an empty product*. Saying that out loud is the difference
 * between a plan and a promise.
 */
const result = planConsultancyIntake(manifest, EMPTY_SNAPSHOT);

const LABEL = {
  would_create: "se crearía     ",
  exists: "ya existe      ",
  requires_review: "requiere revisión",
  not_supported: "no compatible  ",
} as const;

console.log(
  `consultoría : ${manifest.consultancy.name.canonical} (${manifest.consultancy.tenantSlug})`,
);
console.log(`encargo     : ${manifest.consultancy.engagementLabel}`);
console.log(`entrega     : ${manifest.delivery.archiveName}`);
console.log(`              sha256 ${manifest.delivery.archiveSha256}`);
console.log(
  `              ${manifest.delivery.archiveSizeBytes.toLocaleString("es-EC")} bytes · inventario privado en ${manifest.delivery.inventoryReference}`,
);
console.log(`\nsnapshot    : vacío — nada se comprobó contra ninguna base de datos\n`);

for (const kind of ["tenant", "project", "user", "project_membership", "layer"] as const) {
  const steps = result.steps.filter((s) => s.kind === kind);
  if (steps.length === 0) continue;
  // A hundred-odd map sheets would bury the plan, so identical outcomes collapse to a count and
  // one example. The full list is the private inventory's job.
  const groups = new Map<string, typeof steps>();
  for (const s of steps) {
    const k = `${s.outcome}|${s.reason ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  console.log(`${kind} (${steps.length})`);
  for (const group of groups.values()) {
    const first = group[0]!;
    const suffix = group.length > 1 ? `  ×${group.length} (p. ej. ${first.ref})` : `  ${first.ref}`;
    console.log(`  ${LABEL[first.outcome]}${suffix}`);
    if (first.reason) console.log(`      ${first.reason}`);
  }
  console.log();
}

console.log(
  "resumen     : " +
    (["would_create", "exists", "requires_review", "not_supported"] as const)
      .map((o) => `${LABEL[o].trim()}=${result.counts[o]}`)
      .join(" · "),
);

if (result.openDecisions.length > 0) {
  console.log(`\ndecisiones pendientes (${result.openDecisions.length}):`);
  for (const d of result.openDecisions) console.log(`  · ${d}`);
}

for (const person of manifest.people) {
  if (person.openQuestions.length === 0) continue;
  console.log(`\n${person.name.canonical} — ${person.statedRole}`);
  if (person.name.variants.length > 0) {
    console.log(`  otras grafías recibidas: ${person.name.variants.join(", ")}`);
  }
  for (const q of person.openQuestions) console.log(`  · ${q}`);
}

console.log("\nnada se creó: esta ejecución es sólo validación previa.");
