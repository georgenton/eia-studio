import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "./theme";

/**
 * The handful of primitives every screen uses.
 *
 * Kept in one file because there are six of them and they exist to enforce three rules: a tap
 * target is never smaller than 48 points, a state always carries a word and not only a colour, and
 * body text is 16 points or larger. Those are the accessibility decisions of this application, and
 * putting them in components is how they survive the next screen somebody adds.
 */
export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted ? styles.mutedText : null]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  tone = "primary",
  disabled,
  hint,
}: {
  label: string;
  onPress: () => void;
  tone?: "primary" | "secondary";
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null,
      ]}
    >
      <Text style={tone === "primary" ? styles.buttonPrimaryText : styles.buttonSecondaryText}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A state, always with its word. Colour is a reinforcement here and never the message. */
export function Chip({
  text,
  tone = "neutral",
}: {
  text: string;
  tone?: "neutral" | "ok" | "warn" | "crit";
}) {
  const toneStyle =
    tone === "ok"
      ? styles.chipOk
      : tone === "warn"
        ? styles.chipWarn
        : tone === "crit"
          ? styles.chipCrit
          : styles.chipNeutral;
  return (
    <View style={[styles.chip, toneStyle]}>
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      {children}
    </Pressable>
  );
}

export function Notice({ text, tone }: { text: string; tone: "ok" | "warn" | "crit" }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        tone === "ok" ? styles.chipOk : tone === "warn" ? styles.chipWarn : styles.chipCrit,
      ]}
    >
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  title: { fontSize: theme.font.title, fontWeight: "600", color: theme.ink },
  heading: { fontSize: theme.font.heading, fontWeight: "600", color: theme.ink },
  body: { fontSize: theme.font.body, color: theme.inkSoft, lineHeight: 23 },
  mutedText: { color: theme.muted },
  label: {
    fontSize: theme.font.label,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: theme.muted,
    fontWeight: "600",
  },
  button: {
    minHeight: theme.touch,
    borderRadius: theme.radius,
    paddingHorizontal: theme.space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: { backgroundColor: theme.accent },
  buttonSecondary: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.8 },
  buttonPrimaryText: { color: "#ffffff", fontSize: theme.font.body, fontWeight: "600" },
  buttonSecondaryText: { color: theme.ink, fontSize: theme.font.body, fontWeight: "600" },
  chip: {
    borderRadius: 4,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    alignSelf: "flex-start",
  },
  chipNeutral: { backgroundColor: theme.hairline },
  chipOk: { backgroundColor: theme.okBg },
  chipWarn: { backgroundColor: theme.warnBg },
  chipCrit: { backgroundColor: theme.critBg },
  chipText: { fontSize: 13, color: theme.ink, fontWeight: "600" },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  cardPressed: { backgroundColor: theme.accentSoft },
  notice: { borderRadius: theme.radius, padding: theme.space.md },
  noticeText: { fontSize: theme.font.body, color: theme.ink, lineHeight: 22 },
});
