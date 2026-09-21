const { AndroidConfig, withStringsXml } = require("@expo/config-plugins");

/**
 * Give Android's **default** locale the permission copy, so a release build lints.
 *
 * `expo.locales` exists so an English-language device shows the English permission prompts ADR-029
 * requires. `@expo/config-plugins` reads `config.locales` with no platform scoping
 * (`android/Locales.js`: `return config.locales ?? null`), so the English file is also written to
 * `res/values-b+en/strings.xml`. The default `res/values/strings.xml` held only `app_name`, and
 * Android Lint's `ExtraTranslation` is right to object: *"translated here but not found in default
 * locale"*. `lintVitalRelease` is fatal, and that is what failed EAS build b665c60b once the Babel
 * fix had got the bundle through.
 *
 * The check is not disabled — it is correct, and a real Android translation missing from the
 * default locale should still fail a release. What was missing is the default itself. This app's
 * default language is Spanish (ADR-025), so the default resources get the Spanish copy and
 * `values-b+en` keeps the English: a coherent bilingual resource set rather than a suppressed lint.
 *
 * The strings are the same sentences as `ios.infoPlist`, kept here in one place beside them.
 */
const DEFAULT_LOCALE_STRINGS = {
  NSLocationWhenInUseUsageDescription:
    "EIA Field registra la ubicación del técnico al iniciar una visita, cuando el técnico lo autoriza. Nunca se infiere la ubicación de una vivienda.",
  NSCameraUsageDescription:
    "EIA Field usa la cámara para registrar fotografías de la visita: el predio, la afectación y el acceso. Las fotografías se guardan en el dispositivo y se envían al estudio; no se publican al cliente ni se envían a ningún proveedor de modelos.",
};

module.exports = function withDefaultLocalePermissionCopy(config) {
  return withStringsXml(config, (modConfig) => {
    for (const [name, value] of Object.entries(DEFAULT_LOCALE_STRINGS)) {
      modConfig.modResults = AndroidConfig.Strings.setStringItem(
        // No `translatable="false"`: the English file below *is* a translation of these, and
        // marking them untranslatable is the other half of the same lint error.
        [{ _: value, $: { name } }],
        modConfig.modResults,
      );
    }
    return modConfig;
  });
};
