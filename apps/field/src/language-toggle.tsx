import { LOCALE_ENDONYM, LOCALES } from "@eia/i18n";
import { StyleSheet, View } from "react-native";

import { useLocaleState } from "./i18n";
import { theme } from "./theme";
import { Button, Label } from "./ui";

/**
 * Two buttons, named in their own languages, reachable **before** sign-in and with no network.
 *
 * Before sign-in because a technician who cannot read the sign-in screen cannot get past it; with
 * no network because the catalogue and the stored choice are both already on the device. The
 * options say «Español» and «English» rather than being translated into whichever language is
 * currently the wrong one for the person reading.
 */
export function LanguageToggle() {
  const { locale, setLocale } = useLocaleState();
  return (
    <View style={styles.wrap}>
      <Label>{LOCALE_ENDONYM[locale]}</Label>
      <View style={styles.options}>
        {LOCALES.map((option) => (
          <Button
            key={option}
            label={LOCALE_ENDONYM[option]}
            onPress={() => setLocale(option)}
            tone={option === locale ? "primary" : "secondary"}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.space.xs },
  options: { flexDirection: "row", gap: theme.space.sm },
});
