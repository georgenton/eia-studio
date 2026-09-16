/**
 * EIA Studio's institutional palette, chosen again for a phone in the sun.
 *
 * Same hues as the workspace (`packages/ui/src/tokens.css`), different contrast budget: the
 * screen a technician reads is held at arm's length on a road with no shade, often with the
 * brightness the battery allows rather than the brightness the light needs. So body text is
 * darker, touch targets are 48 points rather than 32, and no state is carried by colour alone —
 * every chip has a word in it.
 */
export const theme = {
  ink: "#101827",
  inkSoft: "#3d4650",
  muted: "#5a646c",
  accent: "#17506b",
  accentSoft: "#eef4f8",
  border: "#c8d0d6",
  hairline: "#e6eaed",
  surface: "#ffffff",
  canvas: "#f2f4f5",
  ok: "#2c6046",
  okBg: "#eaf3ee",
  warn: "#8a6512",
  warnBg: "#fbf3e2",
  crit: "#9e3b22",
  critBg: "#fbeae6",
  /** A tap target no smaller than this, anywhere. */
  touch: 48,
  space: { xs: 4, sm: 8, md: 14, lg: 20, xl: 28 },
  radius: 8,
  font: {
    title: 22,
    heading: 17,
    body: 16,
    label: 12,
    mono: 15,
  },
} as const;
