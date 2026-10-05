import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The amber fill is not a text colour, and the only place that can be enforced is here.
 *
 * The approved bundle gives amber as two values — "`#B08519` · texto `#8A6512`" (README §Paleta) —
 * and uses the first for the `Requiere revisita` stroke and the `SeverityTag` dot, never for a
 * word. It is 3,38:1 on white, below the 4,5:1 WCAG 2 AA minimum for normal text; `--eia-warn-text`
 * is 5,32:1 and exists for exactly that. So this is not a divergence from the bundle to record —
 * using the fill for text is a misuse of a design system that already distinguishes the two
 * (ARCHITECTURE.md §11a would decide it the same way if they disagreed, which they do not).
 *
 * Two components had taken the fill as a text colour. The axe scans did not catch it for a reason
 * worth keeping in mind: `.correction` renders only for a correction revisit (ADR-038), which does
 * not exist on a freshly seeded database at the point the `technician` project runs, so the
 * violation appeared only on a second run against a database that already held one. **A runtime
 * scan can only see what renders.** This check reads the stylesheet instead, so it holds whatever
 * the data happens to be.
 *
 * It is deliberately about this one token rather than a general "no low-contrast text colour"
 * rule. A static scan cannot know what a declaration sits on: `color: var(--eia-surface)` is white
 * on a dark chip and correct, and `--eia-text-disabled` carries separators and glyphs by its own
 * documented contract. Judging those needs the rendered page, which is what the axe scans are for.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TOKENS = join(ROOT, "packages/ui/src/tokens.css");
const SKIP = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);
const AA_NORMAL_TEXT = 4.5;

/** WCAG 2.x relative luminance and contrast ratio, from the sRGB definition. */
function luminance(hex: string): number {
  const channels = hex.match(/\w\w/g);
  if (channels?.length !== 3) throw new Error(`not a six-digit hex colour: ${hex}`);
  const [r, g, b] = channels.map((pair) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenValues(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of readFileSync(TOKENS, "utf8").matchAll(
    /(--eia-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    const [, name, value] = m;
    if (name && value) out.set(name, value.toLowerCase());
  }
  return out;
}

function stylesheets(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) stylesheets(full, out);
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

describe("the amber fill token never carries text", () => {
  const tokens = tokenValues();
  /** A token this check is about must exist; a renamed one is a failure, not a skipped assertion. */
  const token = (name: string): string => {
    const value = tokens.get(name);
    if (!value) throw new Error(`${name} is not defined in tokens.css`);
    return value;
  };
  const files = [...stylesheets(join(ROOT, "apps/web")), ...stylesheets(join(ROOT, "packages/ui"))];

  it("has stylesheets to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("keeps --eia-warn-text above AA on both grounds it sits on", () => {
    const text = token("--eia-warn-text");
    expect(contrast(text, token("--eia-surface"))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrast(text, token("--eia-warn-bg"))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  /*
   * Not a tautology: it states why the rule below exists. Should anyone darken the fill past AA,
   * this fails and says that the reason for separating the two tokens has changed — a decision for
   * the design system rather than something to discover from a stylesheet.
   */
  it("records that the fill is below AA for text, which is why it is fill-only", () => {
    expect(contrast(token("--eia-warn"), token("--eia-surface"))).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("is referenced by no `color:` declaration", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          // `color:` only — `border-color`, `background-color` and the rest are fills and strokes,
          // where the 4,5:1 rule for text does not apply and this token belongs.
          if (!/(?:^|[^-\w])color:\s*var\(\s*--eia-warn\s*[,)]/.test(line)) return;
          offenders.push(`${relative(ROOT, file)}:${index + 1} — ${line.trim()}`);
        });
    }
    expect(offenders, `use --eia-warn-text for text:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
